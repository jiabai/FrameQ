import Foundation
import Dispatch
import Darwin

@main
enum ProtocolTests {
    private static let identity = HostIdentity(operationID: "4eb13fa9-84d8-4389-861e-e4c3b2519298",
                                                sessionID: "3aee7c0a-fd93-4e32-aa09-d244d6c5e959")

    static func main() throws {
        if CommandLine.arguments.count > 1 {
            guard CommandLine.arguments.count == 3, CommandLine.arguments[1] == "--pipe-probe",
                  ["start", "init"].contains(CommandLine.arguments[2]) else {
                throw TestFailure("管道探针参数无效")
            }
            runPipeProbe(kind: CommandLine.arguments[2])
        }
        let initialization = identity.fields.merging([
            "type": "init", "url": "https://example.com/article", "extraction_script": "// 协议字符串字段验证",
            "platform": ["kind": "macos", "proxy_url": "http://127.0.0.1:32100"], "deadline_ms": 90_000
        ]) { _, value in value }
        guard case .initialize(let decoded) = try decode(initialization), decoded.identity == identity else {
            throw TestFailure("合法初始化必须保留 operation/session")
        }
        for field in initialization.keys {
            var missing = initialization
            missing.removeValue(forKey: field)
            try rejected(missing)
        }
        for (key, value) in [("contract_version", 2 as Any), ("deadline_ms", 90_001 as Any),
                             ("operation_id", "invalid" as Any), ("session_id", NSNull() as Any),
                             ("extraction_script", "" as Any), ("task_directory", "/private/account" as Any)] {
            var invalid = initialization
            invalid[key] = value
            try rejected(invalid)
        }
        var invalidPlatform = initialization
        invalidPlatform["platform"] = ["kind": "macos", "proxy_url": "http://127.0.0.1:32100", "udf_path": "/private/data"]
        try rejected(invalidPlatform)
        invalidPlatform["platform"] = ["kind": "windows", "proxy_url": "http://127.0.0.1:32100"]
        try rejected(invalidPlatform)
        try rejected(initialization, expected: identity)

        for control in ["start", "cancel"] {
            var record = identity.fields
            record["type"] = control
            _ = try decode(record, expected: identity)
            try rejected(record)
            record["extra"] = true
            try rejected(record, expected: identity)
        }
        var policy = identity.fields.merging([
            "type": "policy_decision", "request_id": 1, "navigation_generation": 1, "allow": true, "error": NSNull()
        ]) { _, value in value }
        guard case .policy(let decision) = try decode(policy, expected: identity), decision.allow else {
            throw TestFailure("合法策略消息必须保留 allow")
        }
        for (key, value) in [("allow", 1 as Any), ("request_id", -1 as Any), ("navigation_generation", 0 as Any),
                             ("error", "WEB_PAGE_NETWORK_BLOCKED" as Any),
                             ("session_id", "bf3c2236-c78b-41e8-ab12-1ca0c38b4959" as Any)] {
            var invalid = policy
            invalid[key] = value
            try rejected(invalid, expected: identity)
        }
        policy["allow"] = false
        policy["error"] = "WEB_PAGE_NETWORK_BLOCKED"
        _ = try decode(policy, expected: identity)
        var large = initialization
        large["extraction_script"] = String(repeating: "中", count: 3 * 1024 * 1024)
        try rejected(large)
        let overRecordLimit = Data(repeating: 0x20, count: HostProtocol.maximumRecordBytes + 1)
        do {
            _ = try HostProtocol.decode(overRecordLimit, expected: nil)
            throw TestFailure("超限记录必须拒绝")
        } catch HostFailure.invalidRequest {}
        var start = identity.fields
        start["type"] = "start"
        try roundTripThroughOpenPipe(start, kind: "start")
        var largeInitialization = initialization
        largeInitialization["extraction_script"] = "//" + String(repeating: "a", count: 96 * 1024)
        guard try JSONSerialization.data(withJSONObject: largeInitialization).count > 64 * 1024 else {
            throw TestFailure("初始化管道测试必须跨越64 KiB")
        }
        try roundTripThroughOpenPipe(largeInitialization, kind: "init")
        print("macOS 原生宿主协议：初始化、字段闭集、身份、版本、类型和容量验证通过")
        print("macOS 实际HostPipe：stdin保持开放时，短控制消息和跨64 KiB初始化均及时响应")
    }

    private static func runPipeProbe(kind: String) -> Never {
        let pipe = HostPipe()
        pipe.start(receive: { record in
            let command = try! HostProtocol.decode(record, expected: kind == "init" ? nil : identity)
            let received: String
            switch command {
            case .initialize: received = "init"
            case .start: received = "start"
            default: Darwin.exit(3)
            }
            guard received == kind else { Darwin.exit(3) }
            pipe.send(["kind": received, "bytes": record.count]) { Darwin.exit(0) }
        }, failed: { _ in Darwin.exit(3) }, ended: { Darwin.exit(4) })
        withExtendedLifetime(pipe) { dispatchMain() }
    }

    private static func roundTripThroughOpenPipe(_ object: [String: Any], kind: String) throws {
        var request = try JSONSerialization.data(withJSONObject: object)
        _ = try HostProtocol.decode(request, expected: kind == "init" ? nil : identity)
        let requestBytes = request.count
        request.append(0x0A)
        let child = Process()
        let input = Pipe()
        let output = Pipe()
        let exited = DispatchSemaphore(value: 0)
        child.executableURL = URL(fileURLWithPath: CommandLine.arguments[0])
        child.arguments = ["--pipe-probe", kind]
        child.standardInput = input
        child.standardOutput = output
        child.standardError = FileHandle.standardError
        child.terminationHandler = { _ in exited.signal() }
        try child.run()
        let watchdog = DispatchWorkItem { if child.isRunning { child.terminate() } }
        DispatchQueue.global().asyncAfter(deadline: .now() + 5, execute: watchdog)
        defer {
            watchdog.cancel()
            try? input.fileHandleForWriting.close()
            if child.isRunning {
                child.terminate()
                if exited.wait(timeout: .now() + 2) == .timedOut, child.isRunning {
                    Darwin.kill(child.processIdentifier, SIGKILL)
                }
            }
            child.waitUntilExit()
            try? output.fileHandleForReading.close()
        }
        let deadline = ProcessInfo.processInfo.systemUptime + 5
        try input.fileHandleForWriting.write(contentsOf: request)
        var response = Data()
        while !response.contains(0x0A) {
            let remaining = deadline - ProcessInfo.processInfo.systemUptime
            guard remaining > 0 else { throw TestFailure("HostPipe未在stdin开放期间响应：\(kind)") }
            var descriptor = pollfd(fd: output.fileHandleForReading.fileDescriptor, events: Int16(POLLIN), revents: 0)
            let ready = Darwin.poll(&descriptor, 1, Int32(max(1, remaining * 1000)))
            if ready < 0, errno == EINTR { continue }
            guard ready > 0 else { throw TestFailure("HostPipe等待响应超时：\(kind)") }
            let chunk = output.fileHandleForReading.availableData
            guard !chunk.isEmpty else { throw TestFailure("HostPipe在响应前退出：\(kind)") }
            response.append(chunk)
            guard response.count <= 1024 else { throw TestFailure("HostPipe探针响应超限") }
        }
        guard let acknowledgment = try JSONSerialization.jsonObject(with: response) as? [String: Any],
              acknowledgment["kind"] as? String == kind,
              acknowledgment["bytes"] as? Int == requestBytes else { throw TestFailure("HostPipe消息内容不一致") }
        guard exited.wait(timeout: .now() + 2) == .success else { throw TestFailure("HostPipe探针未正常退出") }
        child.waitUntilExit()
        guard child.terminationStatus == 0 else { throw TestFailure("HostPipe探针执行失败") }
    }

    private static func decode(_ object: [String: Any], expected: HostIdentity? = nil) throws -> HostCommand {
        try HostProtocol.decode(JSONSerialization.data(withJSONObject: object), expected: expected)
    }

    private static func rejected(_ object: [String: Any], expected: HostIdentity? = nil) throws {
        do { _ = try decode(object, expected: expected) }
        catch { return }
        throw TestFailure("非法协议消息被接受")
    }

    private struct TestFailure: Error { let message: String; init(_ message: String) { self.message = message } }
}
