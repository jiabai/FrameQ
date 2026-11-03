import AppKit
import Foundation
import Network
import Security
import WebKit

@MainActor
final class WebPageHost {
    let runtimeVersion: String
    private let initialization: HostInitialization
    private let emitRecord: ([String: Any]) -> Void
    private let failOperation: (HostFailure) -> Void
    private let completeOperation: ([String: Any]) -> Void
    private var webView: WKWebView?
    private var window: NSWindow?
    private var dataStore: WKWebsiteDataStore?
    private var policyDelegate: PolicyDelegate?
    private var extractor: ArticleExtractor?
    private var navigationTimer: DispatchSourceTimer?
    private var pending: [UInt64: PendingPolicy] = [:]
    private var queued: [QueuedPolicy] = []
    private var expiredPolicyIDs: Set<UInt64> = []
    private var requestSequence: UInt64 = 0
    private var diagnosticCount = 0
    private var started = false
    private(set) var closed = false
    private(set) var navigationGeneration: UInt64 = 0
    private var navigationCount = 0
    private var redirectCount = 0
    private var navigationIdentity: ObjectIdentifier?
    private var activeNavigationGeneration: UInt64 = 0
    private var mainNavigationPending = false
    private var loadedGeneration: UInt64?

    private var policiesSettled: Bool {
        !pending.contains { id, request in
            request.mainFrame && request.generation == navigationGeneration && !expiredPolicyIDs.contains(id)
        } && !queued.contains { $0.request.mainFrame && $0.request.generation == navigationGeneration }
    }

    private struct PendingPolicy {
        let generation: UInt64
        let mainFrame: Bool
        let timer: DispatchSourceTimer
        let decision: (Bool) -> Void
    }

    private struct QueuedPolicy {
        let id: UInt64
        let url: URL
        let request: PendingPolicy
    }

    @available(macOS 14.0, *)
    init(initialization: HostInitialization, emit: @escaping ([String: Any]) -> Void,
         failed: @escaping (HostFailure) -> Void, completed: @escaping ([String: Any]) -> Void) throws {
        self.initialization = initialization
        emitRecord = emit
        failOperation = failed
        completeOperation = completed
        guard let frameworkVersion = Bundle(for: WKWebView.self).object(forInfoDictionaryKey: "CFBundleVersion") as? String,
              !frameworkVersion.isEmpty else { throw HostFailure.unsupportedPlatform }
        runtimeVersion = "WKWebView/\(frameworkVersion) macOS/\(ProcessInfo.processInfo.operatingSystemVersionString)"
        try Self.validateSandbox()
        guard let url = URL(string: initialization.url), Self.permittedURL(url) else { throw HostFailure.networkBlocked }
        let proxyEndpoint = try Self.proxyEndpoint(initialization.platform.proxy_url)
        var proxy = ProxyConfiguration(httpCONNECTProxy: proxyEndpoint, tlsOptions: nil)
        proxy.allowFailover = false
        proxy.excludedDomains = []
        proxy.matchDomains = []
        let store = WKWebsiteDataStore.nonPersistent()
        store.proxyConfigurations = [proxy]
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = store
        configuration.userContentController = WKUserContentController()
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.mediaTypesRequiringUserActionForPlayback = .all
        let view = WKWebView(frame: NSRect(x: 0, y: 0, width: 1280, height: 900), configuration: configuration)
        view.isInspectable = false
        view.allowsLinkPreview = false
        view.allowsBackForwardNavigationGestures = false
        let delegate = PolicyDelegate(owner: self)
        view.navigationDelegate = delegate
        view.uiDelegate = delegate
        let hiddenWindow = NSWindow(contentRect: view.frame, styleMask: [.borderless], backing: .buffered, defer: false)
        hiddenWindow.isReleasedWhenClosed = false
        hiddenWindow.contentView = view
        hiddenWindow.orderOut(nil)
        webView = view
        window = hiddenWindow
        dataStore = store
        policyDelegate = delegate
        extractor = ArticleExtractor(webView: view, script: initialization.extraction_script, resourcesSettled: { [weak self] in
            guard let self, !self.closed else { return false }
            return self.policiesSettled
        })
    }

    private static func validateSandbox() throws {
        guard Bundle.main.bundleIdentifier == "com.frameq.webview-host" else { throw HostFailure.invalidHost }
        var code: SecCode?
        guard SecCodeCopySelf([], &code) == errSecSuccess, let code,
              SecCodeCheckValidity(code, SecCSFlags(rawValue: kSecCSStrictValidate | SecCSFlags.noNetworkAccess.rawValue), nil) == errSecSuccess else {
            throw HostFailure.invalidHost
        }
        var staticCode: SecStaticCode?
        guard SecCodeCopyStaticCode(code, [], &staticCode) == errSecSuccess, let staticCode else { throw HostFailure.invalidHost }
        var information: CFDictionary?
        guard SecCodeCopySigningInformation(staticCode, SecCSFlags(rawValue: kSecCSSigningInformation), &information) == errSecSuccess,
              let information = information as? [String: Any],
              information[kSecCodeInfoIdentifier as String] as? String == "com.frameq.webview-host",
              let entitlements = information[kSecCodeInfoEntitlementsDict as String] as? [String: Any],
              entitlements["com.apple.security.app-sandbox"] as? Bool == true,
              entitlements["com.apple.security.network.client"] as? Bool == true else { throw HostFailure.invalidHost }
        let allowed = Set(["com.apple.security.app-sandbox", "com.apple.security.network.client",
                           "com.apple.application-identifier", "com.apple.developer.team-identifier"])
        guard Set(entitlements.keys).isSubset(of: allowed) else { throw HostFailure.invalidHost }
    }

    private static func proxyEndpoint(_ raw: String) throws -> NWEndpoint {
        guard let components = URLComponents(string: raw), components.scheme == "http",
              components.host == "127.0.0.1", let port = components.port,
              port > 0, port <= 65535, components.user == nil, components.password == nil,
              components.path.isEmpty || components.path == "/",
              components.query == nil, components.fragment == nil,
              let networkPort = NWEndpoint.Port(rawValue: UInt16(port)) else { throw HostFailure.invalidRequest }
        return .hostPort(host: .ipv4(.loopback), port: networkPort)
    }

    static func permittedURL(_ url: URL) -> Bool {
        guard url.absoluteString.utf8.count <= 16 * 1024,
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let scheme = components.scheme?.lowercased(), ["http", "https"].contains(scheme),
              let host = components.host, !host.isEmpty,
              components.user == nil, components.password == nil else { return false }
        // DNS 与地址规则由父进程和任务代理执行；原生入口仅接受 HTTP(S) URL。
        return true
    }

    func start() throws {
        guard !closed, !started, let view = webView, let url = URL(string: initialization.url) else {
            throw HostFailure.invalidRequest
        }
        started = true
        let timer = DispatchSource.makeTimerSource(queue: .main)
        timer.schedule(deadline: .now() + .seconds(60))
        timer.setEventHandler { [weak self] in
            MainActor.assumeIsolated {
                guard let self else { return }
                self.fail(self.loadedGeneration == self.navigationGeneration ? .contentUnstable : .timeout)
            }
        }
        timer.resume()
        navigationTimer = timer
        var request = URLRequest(url: url)
        request.timeoutInterval = 60
        request.cachePolicy = .reloadIgnoringLocalCacheData
        guard view.load(request) != nil else { throw HostFailure.loadFailed }
    }

    func prepareNavigation(mainFrame: Bool) -> UInt64? {
        guard !closed, started else { return nil }
        if mainFrame {
            navigationCount += 1
            guard navigationCount <= 6 else { fail(.resourceLimit); return nil }
            if navigationGeneration == 0 {
                navigationGeneration = 1
                emitRecord(["type": "stage", "navigation_generation": navigationGeneration, "stage": "web_loading"])
            }
            loadedGeneration = nil
            mainNavigationPending = true
            extractor?.invalidate()
        }
        return navigationGeneration > 0 ? navigationGeneration : nil
    }

    func diagnose(reason: String, mainFrame: Bool) {
        guard diagnosticCount < 16 else { return }
        diagnosticCount += 1
        let record = ["reason": reason, "resource": mainFrame ? "document" : "subdocument"]
        var data = try! JSONSerialization.data(withJSONObject: record, options: [.sortedKeys])
        data.append(0x0A)
        FileHandle.standardError.write(data)
    }

    func checkPolicy(url: URL, generation: UInt64, mainFrame: Bool = true, decision: @escaping (Bool) -> Void) {
        guard !closed, generation == navigationGeneration else {
            diagnose(reason: closed ? "cancelled" : "stale_generation", mainFrame: mainFrame)
            decision(false)
            return
        }
        guard Self.permittedURL(url) else {
            diagnose(reason: "blocked_url", mainFrame: mainFrame)
            decision(false)
            if mainFrame { fail(.networkBlocked) }
            return
        }
        guard queued.count < 512, requestSequence < UInt64.max else {
            diagnose(reason: "queue_full", mainFrame: mainFrame)
            decision(false)
            if mainFrame { fail(.resourceLimit) }
            return
        }
        requestSequence += 1
        let id = requestSequence
        let timer = DispatchSource.makeTimerSource(queue: .main)
        timer.schedule(deadline: .now() + .seconds(10))
        timer.setEventHandler { [weak self] in
            MainActor.assumeIsolated {
                guard let self, let index = self.queued.firstIndex(where: { $0.id == id }) else { return }
                let request = self.queued.remove(at: index).request
                request.timer.cancel()
                self.diagnose(reason: "queue_timeout", mainFrame: request.mainFrame)
                request.decision(false)
                if request.mainFrame && request.generation == self.navigationGeneration { self.fail(.policyTimeout) }
                self.dispatchPolicies()
            }
        }
        queued.append(QueuedPolicy(id: id, url: url, request: PendingPolicy(
            generation: generation, mainFrame: mainFrame, timer: timer, decision: decision)))
        timer.resume()
        dispatchPolicies()
    }

    private func dispatchPolicies() {
        while !closed && pending.count < 16 && !queued.isEmpty {
            let item = queued.removeFirst()
            item.request.timer.cancel()
            guard item.request.generation == navigationGeneration else {
                diagnose(reason: "stale_generation", mainFrame: item.request.mainFrame)
                item.request.decision(false)
                continue
            }
            let id = item.id
            let timer = DispatchSource.makeTimerSource(queue: .main)
            timer.schedule(deadline: .now() + .seconds(2))
            timer.setEventHandler { [weak self] in
                MainActor.assumeIsolated {
                    guard let self, let request = self.pending[id] else { return }
                    request.timer.cancel()
                    self.expiredPolicyIDs.insert(id)
                    self.diagnose(reason: "dns_timeout", mainFrame: request.mainFrame)
                    request.decision(false)
                    if request.mainFrame && request.generation == self.navigationGeneration { self.fail(.policyTimeout) }
                }
            }
            pending[id] = PendingPolicy(generation: item.request.generation, mainFrame: item.request.mainFrame,
                                        timer: timer, decision: item.request.decision)
            timer.resume()
            emitRecord(["type": "policy_check", "request_id": id, "navigation_generation": item.request.generation,
                        "url": item.url.absoluteString, "kind": item.request.mainFrame ? "navigation" : "resource"])
        }
    }

    func receive(_ decision: HostPolicyDecision) throws {
        guard !closed, decision.request_id <= requestSequence else { throw HostFailure.invalidRequest }
        guard let request = pending.removeValue(forKey: decision.request_id) else { throw HostFailure.invalidRequest }
        request.timer.cancel()
        guard decision.navigation_generation == request.generation else {
            if !expiredPolicyIDs.contains(decision.request_id) { request.decision(false) }
            throw HostFailure.invalidRequest
        }
        defer { dispatchPolicies() }
        if expiredPolicyIDs.remove(decision.request_id) != nil { return }
        guard request.generation == navigationGeneration else {
            diagnose(reason: "stale_generation", mainFrame: request.mainFrame)
            request.decision(false)
            return
        }
        request.decision(decision.allow)
        if !decision.allow {
            let failure: HostFailure
            switch decision.error {
            case "WEB_LOAD_FAILED": failure = .dnsFailed
            case "WEB_NETWORK_POLICY_TIMEOUT": failure = .policyTimeout
            default: failure = .networkBlocked
            }
            diagnose(reason: failure == .dnsFailed ? "dns_failed" : failure == .policyTimeout ? "dns_timeout" : "blocked_url",
                     mainFrame: request.mainFrame)
            if request.mainFrame { fail(failure) }
        }
    }

    func didStart(_ navigation: WKNavigation?) {
        guard !closed, let navigation, navigationGeneration > 0 else { fail(.loadFailed); return }
        if let previous = navigationIdentity, previous != ObjectIdentifier(navigation) {
            guard navigationGeneration < 6 else { fail(.resourceLimit); return }
            navigationGeneration += 1
            emitRecord(["type": "stage", "navigation_generation": navigationGeneration, "stage": "web_loading"])
        }
        navigationIdentity = ObjectIdentifier(navigation)
        activeNavigationGeneration = navigationGeneration
        mainNavigationPending = false
    }

    func didRedirect(_ navigation: WKNavigation?) {
        guard !closed, let navigation, navigationIdentity == ObjectIdentifier(navigation) else { return }
        redirectCount += 1
        guard redirectCount <= 5 else { fail(.resourceLimit); return }
        activeNavigationGeneration = navigationGeneration
        mainNavigationPending = false
        extractor?.invalidate()
        loadedGeneration = nil
    }

    func didAuthorizeMainResponse() { mainNavigationPending = false }

    private func owns(_ navigation: WKNavigation?) -> Bool {
        guard !closed, let navigation else { return false }
        return navigationIdentity == ObjectIdentifier(navigation)
            && activeNavigationGeneration == navigationGeneration && !mainNavigationPending
    }

    func didFinish(_ navigation: WKNavigation?) {
        guard owns(navigation), let view = webView, let url = view.url,
              Self.permittedURL(url), loadedGeneration != navigationGeneration else { return }
        let generation = navigationGeneration
        loadedGeneration = generation
        checkPolicy(url: url, generation: generation) { [weak self] allow in
            guard let self, allow, !self.closed, generation == self.navigationGeneration else { return }
            self.extractor?.waitForStableDocument(generation: generation, failed: { [weak self] error in
                guard let self, !self.closed, generation == self.navigationGeneration else { return }
                self.fail(error)
            }, stable: { [weak self] in self?.extract(generation: generation) })
        }
    }

    private func extract(generation: UInt64) {
        guard !closed, generation == navigationGeneration, let view = webView, let url = view.url,
              Self.permittedURL(url) else { return }
        guard policiesSettled else { fail(.contentUnstable); return }
        navigationTimer?.cancel()
        navigationTimer = nil
        emitRecord(["type": "stage", "navigation_generation": generation, "stage": "web_extracting"])
        extractor?.extract(generation: generation, sourceURL: url.absoluteString) { [weak self] result in
            guard let self, !self.closed, generation == self.navigationGeneration else { return }
            guard self.webView?.url == url else { self.fail(.sourceChanged); return }
            switch result {
            case .success(let article):
                self.checkPolicy(url: url, generation: generation) { [weak self] allowed in
                    guard let self, allowed, !self.closed, generation == self.navigationGeneration else { return }
                    guard self.webView?.url == url else { self.fail(.sourceChanged); return }
                    guard self.policiesSettled else { self.fail(.contentUnstable); return }
                    self.completeOperation(["type": "article", "navigation_generation": generation,
                                            "final_url": url.absoluteString, "title": article.title,
                                            "text": article.text, "markdown": article.markdown])
                }
            case .failure(let error): self.fail(error)
            }
        }
    }

    func navigationFailed(_ navigation: WKNavigation?, error: Error) {
        guard owns(navigation) else { return }
        let native = error as NSError
        fail(native.domain == NSURLErrorDomain && native.code == NSURLErrorTimedOut ? .timeout : .loadFailed)
    }

    func fail(_ error: HostFailure) {
        guard !closed else { return }
        failOperation(error)
    }

    func shutdown() {
        guard !closed else { return }
        closed = true
        navigationGeneration += 1
        navigationTimer?.cancel()
        navigationTimer = nil
        extractor?.invalidate()
        extractor = nil
        let requests = pending.filter { !expiredPolicyIDs.contains($0.key) }.map(\.value)
        pending.removeAll()
        expiredPolicyIDs.removeAll()
        for request in requests { request.timer.cancel(); request.decision(false) }
        let waiting = queued
        queued.removeAll()
        for item in waiting { item.request.timer.cancel(); item.request.decision(false) }
        webView?.stopLoading()
        webView?.navigationDelegate = nil
        webView?.uiDelegate = nil
        webView?.configuration.userContentController.removeAllUserScripts()
        webView?.configuration.userContentController.removeAllScriptMessageHandlers()
        window?.contentView = nil
        webView?.removeFromSuperview()
        webView = nil
        policyDelegate = nil
        window?.close()
        window = nil
        dataStore = nil
    }
}
