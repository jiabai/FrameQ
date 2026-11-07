import Foundation
import Darwin

enum HostFailure: String, Error {
    case invalidRequest = "WEB_REQUEST_INVALID"
    case unsupportedPlatform = "WEB_RUNTIME_UNSUPPORTED"
    case invalidHost = "WEB_HOST_FAILED"
    case loadFailed = "WEB_NAVIGATION_FAILED"
    case browserFailed = "WEB_PROCESS_FAILED"
    case timeout = "WEB_TIMEOUT"
    case resourceLimit = "WEB_RESOURCE_LIMIT"
    case cancelled = "WEB_CANCELLED"
    case networkBlocked = "WEB_URL_BLOCKED"
    case policyTimeout = "WEB_NETWORK_POLICY_TIMEOUT"
    case dnsFailed = "WEB_LOAD_FAILED"
    case accessRestricted = "WEB_PAGE_ACCESS_RESTRICTED"
    case httpFailed = "WEB_PAGE_HTTP_FAILED"
    case contentTypeInvalid = "WEB_PAGE_CONTENT_TYPE_INVALID"
    case domLimit = "WEB_PAGE_DOM_LIMIT"
    case sourceChanged = "WEB_PAGE_SOURCE_CHANGED"
    case contentUnstable = "WEB_PAGE_CONTENT_UNSTABLE"
}

struct HostIdentity: Equatable {
    let operationID: String
    let sessionID: String

    var fields: [String: Any] {
        ["contract_version": 1, "operation_id": operationID, "session_id": sessionID]
    }
}

struct HostInitialization: Decodable {
    struct Platform: Decodable {
        let kind: String
        let proxy_url: String
    }
    let type: String
    let contract_version: Int
    let operation_id: String
    let session_id: String
    let url: String
    let extraction_script: String
    let platform: Platform
    let deadline_ms: Int

    var identity: HostIdentity {
        HostIdentity(operationID: operation_id, sessionID: session_id)
    }
}

private struct ControlMessage: Decodable {
    let type: String
    let contract_version: Int
    let operation_id: String
    let session_id: String
}

struct HostPolicyDecision: Decodable {
    let type: String
    let contract_version: Int
    let operation_id: String
    let session_id: String
    let request_id: UInt64
    let navigation_generation: UInt64
    let allow: Bool
    let error: String?
}

enum HostCommand {
    case initialize(HostInitialization)
    case start
    case cancel
    case policy(HostPolicyDecision)
}

enum HostProtocol {
    static let maximumRecordBytes = 40 * 1024 * 1024
    static let baseFields: Set<String> = ["type", "contract_version", "operation_id", "session_id"]

    static func decode(_ data: Data, expected: HostIdentity?) throws -> HostCommand {
        guard !data.isEmpty, data.count <= maximumRecordBytes,
              let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let kind = object["type"] as? String else { throw HostFailure.invalidRequest }
        let decoder = JSONDecoder()
        let base = try decoder.decode(ControlMessage.self, from: data)
        guard base.contract_version == 1,
              let operation = UUID(uuidString: base.operation_id),
              operation.uuidString.lowercased() == base.operation_id,
              let session = UUID(uuidString: base.session_id),
              session.uuidString.lowercased() == base.session_id else { throw HostFailure.invalidRequest }
        let identity = HostIdentity(operationID: base.operation_id, sessionID: base.session_id)
        if let expected, identity != expected { throw HostFailure.invalidRequest }
        let fields = Set(object.keys)
        switch kind {
        case "init":
            guard expected == nil,
                  fields == baseFields.union(["url", "extraction_script", "platform", "deadline_ms"]),
                  let platform = object["platform"] as? [String: Any],
                  Set(platform.keys) == ["kind", "proxy_url"] else { throw HostFailure.invalidRequest }
            let initialization = try decoder.decode(HostInitialization.self, from: data)
            guard initialization.platform.kind == "macos", initialization.deadline_ms == 90_000,
                  !initialization.extraction_script.isEmpty,
                  initialization.extraction_script.utf8.count <= 2 * 1024 * 1024,
                  initialization.url.utf8.count <= 16 * 1024,
                  initialization.platform.proxy_url.utf8.count <= 256 else { throw HostFailure.invalidRequest }
            return .initialize(initialization)
        case "start", "cancel":
            guard expected != nil, fields == baseFields else { throw HostFailure.invalidRequest }
            return kind == "start" ? .start : .cancel
        case "policy_decision":
            guard expected != nil,
                  fields == baseFields.union(["request_id", "navigation_generation", "allow", "error"]) else {
                throw HostFailure.invalidRequest
            }
            let decision = try decoder.decode(HostPolicyDecision.self, from: data)
            guard decision.request_id > 0, decision.navigation_generation > 0,
                  (decision.allow && decision.error == nil) || (!decision.allow && decision.error != nil),
                  decision.error.map({ $0.utf8.count <= 128 }) ?? true else { throw HostFailure.invalidRequest }
            return .policy(decision)
        default:
            throw HostFailure.invalidRequest
        }
    }
}

final class HostPipe {
    private let reader = DispatchQueue(label: "com.frameq.webview-host.input")
    private let writer = DispatchQueue(label: "com.frameq.webview-host.output")

    func start(receive: @escaping @MainActor (Data) -> Void,
               failed: @escaping @MainActor (HostFailure) -> Void,
               ended: @escaping @MainActor () -> Void) {
        reader.async {
            var buffer = Data()
            var bytes = [UInt8](repeating: 0, count: 64 * 1024)
            do {
                while true {
                    // 单次read返回当前收到的字节，完整记录立即交付。
                    let count = bytes.withUnsafeMutableBufferPointer {
                        Darwin.read(FileHandle.standardInput.fileDescriptor, $0.baseAddress, $0.count)
                    }
                    if count < 0 {
                        if errno == EINTR { continue }
                        throw HostFailure.invalidRequest
                    }
                    if count == 0 { break }
                    buffer.append(contentsOf: bytes[..<count])
                    while let newline = buffer.firstIndex(of: 0x0A) {
                        let count = buffer.distance(from: buffer.startIndex, to: newline)
                        guard count > 0, count <= HostProtocol.maximumRecordBytes else { throw HostFailure.invalidRequest }
                        let record = Data(buffer[..<newline])
                        buffer.removeSubrange(...newline)
                        DispatchQueue.main.sync { MainActor.assumeIsolated { receive(record) } }
                    }
                    guard buffer.count <= HostProtocol.maximumRecordBytes else { throw HostFailure.resourceLimit }
                }
            } catch let error as HostFailure {
                DispatchQueue.main.sync { MainActor.assumeIsolated { failed(error) } }
                return
            } catch {
                DispatchQueue.main.sync { MainActor.assumeIsolated { failed(.invalidRequest) } }
                return
            }
            DispatchQueue.main.sync {
                MainActor.assumeIsolated {
                    if buffer.isEmpty { ended() }
                    else { failed(.invalidRequest) }
                }
            }
        }
    }

    func send(_ object: [String: Any], completion: (@MainActor () -> Void)? = nil) {
        do {
            var data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys, .withoutEscapingSlashes])
            guard data.count <= HostProtocol.maximumRecordBytes else { Darwin.exit(2) }
            data.append(0x0A)
            let record = data
            writer.async {
                do { try FileHandle.standardOutput.write(contentsOf: record) }
                catch { Darwin.exit(2) }
                if let completion { DispatchQueue.main.async { completion() } }
            }
        } catch {
            Darwin.exit(2)
        }
    }
}

enum HostURLPolicy {
    private static let accessRestrictedPaths: Set<String> = [
        "login", "signin", "sign-in", "logon", "auth", "authorize", "authenticate", "verify",
        "verification", "captcha", "checkpoint", "passport", "sso"
    ]

    static func accessRestrictedURL(_ url: URL) -> Bool {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return false }
        guard let last = components.path.split(separator: "/").last.map(String.init)?.lowercased() else { return false }
        return accessRestrictedPaths.contains(last)
    }
}
