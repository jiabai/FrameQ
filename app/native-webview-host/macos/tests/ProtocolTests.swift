import Foundation

@main
enum ProtocolTests {
    private static let identity = HostIdentity(operationID: "4eb13fa9-84d8-4389-861e-e4c3b2519298",
                                                sessionID: "3aee7c0a-fd93-4e32-aa09-d244d6c5e959")

    static func main() throws {
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
        print("macOS 原生宿主协议：初始化、字段闭集、身份、版本、类型和容量验证通过")
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
