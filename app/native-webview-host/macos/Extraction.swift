import Foundation
import WebKit

struct NativeArticle {
    let title: String
    let text: String
    let markdown: String
}

@MainActor
final class ArticleExtractor {
    private weak var webView: WKWebView?
    private let script: String
    private let world = WKContentWorld.world(name: "pro.8xf.webview-host.extraction.v1")
    private var token: UUID?
    private var callbackTimer: DispatchSourceTimer?
    private var sampleTimer: DispatchSourceTimer?
    private var previousRevision: UInt64?
    private var stableSamples = 0
    private let resourcesSettled: () -> Bool

    init(webView: WKWebView, script: String, resourcesSettled: @escaping () -> Bool) {
        self.webView = webView
        self.script = script
        self.resourcesSettled = resourcesSettled
    }

    func invalidate() {
        token = nil
        callbackTimer?.cancel()
        callbackTimer = nil
        sampleTimer?.cancel()
        sampleTimer = nil
        previousRevision = nil
        stableSamples = 0
    }

    func waitForStableDocument(generation: UInt64, failed: @escaping (HostFailure) -> Void,
                               stable: @escaping () -> Void) {
        invalidate()
        let current = UUID()
        token = current
        scheduleSample(token: current, failed: failed, stable: stable)
    }

    private func scheduleSample(token current: UUID, failed: @escaping (HostFailure) -> Void,
                                stable: @escaping () -> Void) {
        guard token == current else { return }
        let timer = DispatchSource.makeTimerSource(queue: .main)
        timer.schedule(deadline: .now() + .milliseconds(500))
        timer.setEventHandler { [weak self] in
            MainActor.assumeIsolated {
                guard let self, self.token == current else { return }
                self.sampleTimer?.cancel()
                self.sampleTimer = nil
                guard self.resourcesSettled() else {
                    self.previousRevision = nil
                    self.stableSamples = 0
                    self.scheduleSample(token: current, failed: failed, stable: stable)
                    return
                }
                self.call(Self.sampleScript, arguments: [:], token: current) { [weak self] result in
                    guard let self, self.token == current else { return }
                    switch result {
                    case .failure(let error): failed(error)
                    case .success(let value):
                        guard let result = value as? [String: Any], let status = result["status"] as? String else {
                            failed(.browserFailed)
                            return
                        }
                        if status == "limit" { failed(.domLimit); return }
                        guard status == "ready", let revision = result["revision"] as? NSNumber else {
                            self.previousRevision = nil
                            self.stableSamples = 0
                            self.scheduleSample(token: current, failed: failed, stable: stable)
                            return
                        }
                        if self.previousRevision == revision.uint64Value { self.stableSamples += 1 }
                        else { self.previousRevision = revision.uint64Value; self.stableSamples = 1 }
                        if self.stableSamples >= 3 && self.resourcesSettled() { stable() }
                        else { self.scheduleSample(token: current, failed: failed, stable: stable) }
                    }
                }
            }
        }
        sampleTimer = timer
        timer.resume()
    }

    func extract(generation: UInt64, sourceURL: String, completion: @escaping (Result<NativeArticle, HostFailure>) -> Void) {
        guard let current = token else { completion(.failure(.sourceChanged)); return }
        let extraction = script + "\n" + Self.extractScript
        call(extraction, arguments: ["sourceURL": sourceURL], token: current) { result in
            switch result {
            case .failure(let error): completion(.failure(error))
            case .success(let value):
                guard let result = value as? [String: Any], let ok = result["ok"] as? Bool else {
                    completion(.failure(.browserFailed)); return
                }
                guard ok else {
                    completion(.failure(Self.extractionError(result["error"] as? String))); return
                }
                guard Set(result.keys) == ["ok", "title", "text", "markdown"],
                      let title = result["title"] as? String, !title.isEmpty, title.unicodeScalars.count <= 512,
                      let text = result["text"] as? String, !text.isEmpty, text.utf8.count <= 2 * 1024 * 1024,
                      let markdown = result["markdown"] as? String, !markdown.isEmpty,
                      markdown.utf8.count <= 4 * 1024 * 1024 else { completion(.failure(.resourceLimit)); return }
                completion(.success(NativeArticle(title: title, text: text, markdown: markdown)))
            }
        }
    }

    private func call(_ body: String, arguments: [String: Any], token current: UUID,
                      completion: @escaping (Result<Any, HostFailure>) -> Void) {
        guard token == current, let webView else { return }
        let timer = DispatchSource.makeTimerSource(queue: .main)
        timer.schedule(deadline: .now() + .seconds(2))
        var completed = false
        timer.setEventHandler { [weak self] in
            MainActor.assumeIsolated {
                guard let self, self.token == current, !completed else { return }
                completed = true
                self.invalidate()
                completion(.failure(.timeout))
            }
        }
        callbackTimer = timer
        timer.resume()
        webView.callAsyncJavaScript(body, arguments: arguments, in: nil, in: world) { [weak self] result in
            guard let self, self.token == current, !completed else { return }
            completed = true
            timer.cancel()
            self.callbackTimer = nil
            switch result {
            case .success(let value): completion(.success(value))
            case .failure: completion(.failure(.browserFailed))
            }
        }
    }

    private static func extractionError(_ code: String?) -> HostFailure {
        switch code {
        case "dom_limit", "input_limit": return .domLimit
        case "text_limit", "markdown_limit": return .resourceLimit
        case "unsupported_page": return .accessRestricted
        case "no_article", "missing_title", "no_document": return .contentTypeInvalid
        default: return .browserFailed
        }
    }

    private static let sampleScript = """
    if (!document.documentElement || !document.body || document.readyState !== "complete") {
      return { status: "waiting" };
    }
    let state = globalThis.__appNativeDocumentState;
    if (!state || state.document !== document) {
      state = { document, revision: 0, observer: null };
      state.observer = new MutationObserver(() => { state.revision += 1; });
      state.observer.observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
      Object.defineProperty(globalThis, "__appNativeDocumentState", { value: state, configurable: false, writable: false });
    }
    const walker = document.createTreeWalker(document, 0xffffffff);
    let count = 0;
    while (walker.nextNode()) { if (++count > 100000) return { status: "limit" }; }
    if (new TextEncoder().encode(document.documentElement.outerHTML).byteLength > 8388608) return { status: "limit" };
    return { status: "ready", revision: state.revision };
    """

    private static let extractScript = """
    try {
      if (typeof globalThis.__appExtractArticle !== "function") return { ok: false, error: "missing_extractor" };
      const article = globalThis.__appExtractArticle(document, sourceURL);
      return { ok: true, title: article.title, text: article.text, markdown: article.markdown };
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const prefix = "article_extraction:";
      return { ok: false, error: message.startsWith(prefix) ? message.slice(prefix.length) : "extraction_failed" };
    }
    """
}
