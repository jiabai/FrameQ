import AppKit
import Foundation
import Darwin

@main
enum AppWebViewHost {
    @MainActor
    static func main() {
        guard CommandLine.arguments.count == 3, CommandLine.arguments[1] == "--operation-id",
              let operation = UUID(uuidString: CommandLine.arguments[2]),
              operation.uuidString.lowercased() == CommandLine.arguments[2] else { Darwin.exit(2) }
        signal(SIGPIPE, SIG_IGN)
        let application = NSApplication.shared
        application.setActivationPolicy(.prohibited)
        let controller = HostApplication(operationID: CommandLine.arguments[2])
        application.delegate = controller
        withExtendedLifetime(controller) { application.run() }
    }
}

@MainActor
final class HostApplication: NSObject, NSApplicationDelegate {
    private let operationID: String
    private let pipe = HostPipe()
    private var identity: HostIdentity?
    private var host: WebPageHost?
    private var startupTimer: DispatchSourceTimer?
    private var operationTimer: DispatchSourceTimer?
    private var parentTimer: DispatchSourceTimer?
    private let parentPID = getppid()
    private var closing = false
    private var started = false

    init(operationID: String) {
        self.operationID = operationID
        super.init()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        startupTimer = timer(after: 15) { [weak self] in self?.fail(.timeout) }
        parentTimer = DispatchSource.makeTimerSource(queue: .main)
        parentTimer?.schedule(deadline: .now(), repeating: .milliseconds(250))
        parentTimer?.setEventHandler { [weak self] in
            MainActor.assumeIsolated {
                guard let self else { return }
                if self.parentPID <= 1 || getppid() != self.parentPID { self.finish(code: 1) }
            }
        }
        parentTimer?.resume()
        pipe.start(receive: { [weak self] in self?.receive($0) }, failed: { [weak self] in self?.fail($0) }, ended: { [weak self] in
            guard let self, !self.closing else { return }
            self.fail(.cancelled)
        })
    }

    private func receive(_ data: Data) {
        guard !closing else { return }
        do {
            switch try HostProtocol.decode(data, expected: identity) {
            case .initialize(let initialization):
                guard initialization.operation_id == operationID else { throw HostFailure.invalidRequest }
                identity = initialization.identity
                operationTimer = timer(after: 90) { [weak self] in self?.fail(.timeout) }
                guard #available(macOS 14.0, *) else { throw HostFailure.unsupportedPlatform }
                let host = try WebPageHost(initialization: initialization, emit: { [weak self] fields in
                    self?.emit(fields)
                }, failed: { [weak self] error in self?.fail(error) }, completed: { [weak self] article in
                    guard let self, !self.closing else { return }
                    self.emit(article)
                    self.finish(code: 0)
                })
                self.host = host
                startupTimer?.cancel()
                startupTimer = nil
                emit(["type": "ready", "runtime_version": host.runtimeVersion, "browser_pid": NSNull()])
            case .start:
                guard !started, let host else { throw HostFailure.invalidRequest }
                started = true
                try host.start()
            case .cancel:
                fail(.cancelled)
            case .policy(let decision):
                guard started, let host else { throw HostFailure.invalidRequest }
                try host.receive(decision)
            }
        } catch let error as HostFailure { fail(error) }
        catch { fail(.invalidRequest) }
    }

    private func timer(after seconds: Int, handler: @escaping @MainActor () -> Void) -> DispatchSourceTimer {
        let timer = DispatchSource.makeTimerSource(queue: .main)
        timer.schedule(deadline: .now() + .seconds(seconds))
        timer.setEventHandler { MainActor.assumeIsolated { handler() } }
        timer.resume()
        return timer
    }

    private func emit(_ fields: [String: Any], completion: (@MainActor () -> Void)? = nil) {
        guard let identity else { Darwin.exit(2) }
        var record = identity.fields
        fields.forEach { record[$0.key] = $0.value }
        pipe.send(record, completion: completion)
    }

    private func fail(_ error: HostFailure) {
        guard !closing else { return }
        if identity != nil { emit(["type": "error", "code": error.rawValue]) }
        finish(code: 1)
    }

    private func finish(code: Int32) {
        guard !closing else { return }
        closing = true
        startupTimer?.cancel()
        operationTimer?.cancel()
        parentTimer?.cancel()
        host?.shutdown()
        host = nil
        guard identity != nil else { Darwin.exit(code) }
        emit(["type": "closed", "clean": true]) { Darwin.exit(code) }
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        fail(.cancelled)
        return .terminateCancel
    }
}
