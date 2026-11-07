import AppKit
import Foundation
import WebKit

@MainActor
final class PolicyDelegate: NSObject, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    private weak var owner: WebPageHost?

    init(owner: WebPageHost) { self.owner = owner }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let owner, !owner.closed, let target = navigationAction.targetFrame else {
            decisionHandler(.cancel)
            return
        }
        guard !navigationAction.shouldPerformDownload else {
            decisionHandler(.cancel)
            if target.isMainFrame { owner.fail(.contentTypeInvalid) }
            return
        }
        guard let url = navigationAction.request.url,
              WebPageHost.permittedURL(url) else {
            decisionHandler(.cancel)
            owner.diagnose(reason: "blocked_url", mainFrame: target.isMainFrame)
            if target.isMainFrame { owner.fail(.networkBlocked) }
            return
        }
        guard navigationAction.navigationType != .formSubmitted,
              navigationAction.navigationType != .formResubmitted,
              navigationAction.request.httpMethod == nil || navigationAction.request.httpMethod == "GET" else {
            decisionHandler(.cancel)
            if target.isMainFrame { owner.fail(.accessRestricted) }
            return
        }
        guard let generation = owner.prepareNavigation(mainFrame: target.isMainFrame) else {
            decisionHandler(.cancel)
            return
        }
        owner.checkPolicy(url: url, generation: generation, mainFrame: target.isMainFrame) { allow in
            decisionHandler(allow ? .allow : .cancel)
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        guard let owner, !owner.closed else { decisionHandler(.cancel); return }
        guard let response = navigationResponse.response as? HTTPURLResponse,
              let url = response.url, WebPageHost.permittedURL(url) else {
            decisionHandler(.cancel)
            owner.diagnose(reason: "blocked_url", mainFrame: navigationResponse.isForMainFrame)
            if navigationResponse.isForMainFrame { owner.fail(.networkBlocked) }
            return
        }
        let failure: HostFailure?
        if [401, 403, 407].contains(response.statusCode) { failure = .accessRestricted }
        else if !(200..<300).contains(response.statusCode) { failure = .httpFailed }
        else if owner.hasFollowedRedirect && HostURLPolicy.accessRestrictedURL(url) { failure = .accessRestricted }
        else if !navigationResponse.canShowMIMEType || !["text/html", "application/xhtml+xml"].contains(response.mimeType?.lowercased() ?? "") {
            failure = .contentTypeInvalid
        } else if response.value(forHTTPHeaderField: "Content-Disposition")?.lowercased().hasPrefix("attachment") == true {
            failure = .contentTypeInvalid
        } else { failure = nil }
        if let failure {
            decisionHandler(.cancel)
            if navigationResponse.isForMainFrame { owner.fail(failure) }
            return
        }
        owner.checkPolicy(url: url, generation: owner.navigationGeneration, mainFrame: navigationResponse.isForMainFrame) { allow in
            if allow && navigationResponse.isForMainFrame { owner.didAuthorizeMainResponse() }
            decisionHandler(allow ? .allow : .cancel)
        }
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        owner?.didStart(navigation)
    }

    func webView(_ webView: WKWebView, didReceiveServerRedirectForProvisionalNavigation navigation: WKNavigation!) {
        owner?.didRedirect(navigation)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { owner?.didFinish(navigation) }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        owner?.navigationFailed(navigation, error: error)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        owner?.navigationFailed(navigation, error: error)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { owner?.fail(.browserFailed) }

    func webView(_ webView: WKWebView, didReceive challenge: URLAuthenticationChallenge,
                 completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        if challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust {
            completionHandler(.performDefaultHandling, nil)
        } else {
            completionHandler(.cancelAuthenticationChallenge, nil)
        }
    }

    func webView(_ webView: WKWebView, authenticationChallenge challenge: URLAuthenticationChallenge,
                 shouldAllowDeprecatedTLS decisionHandler: @escaping (Bool) -> Void) { decisionHandler(false) }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? { nil }

    func webViewDidClose(_ webView: WKWebView) { owner?.fail(.browserFailed) }

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        completionHandler(nil)
    }

    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                 initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
                 decisionHandler: @escaping (WKPermissionDecision) -> Void) { decisionHandler(.deny) }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) { completionHandler() }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) { completionHandler(false) }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String,
                 defaultText: String?, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (String?) -> Void) { completionHandler(nil) }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
        download.cancel { _ in }
        if navigationAction.targetFrame?.isMainFrame == true { owner?.fail(.contentTypeInvalid) }
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
        download.cancel { _ in }
        if navigationResponse.isForMainFrame { owner?.fail(.contentTypeInvalid) }
    }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse,
                  suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) { completionHandler(nil) }

    func download(_ download: WKDownload, didReceive challenge: URLAuthenticationChallenge,
                  completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        completionHandler(.cancelAuthenticationChallenge, nil)
    }
}
