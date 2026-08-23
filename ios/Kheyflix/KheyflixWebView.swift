import SwiftUI
import WebKit

struct KheyflixWebView: UIViewRepresentable {
    @ObservedObject var model: WebViewModel

    func makeCoordinator() -> Coordinator { Coordinator(model: model) }

    func makeUIView(context: Context) -> WKWebView {
        let controller = WKUserContentController()
        controller.addUserScript(WKUserScript(
            source: "document.documentElement.dataset.kheyflixNative='ios'; document.documentElement.style.webkitTouchCallout='none';",
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        ))

        let configuration = WKWebViewConfiguration()
        configuration.userContentController = controller
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.websiteDataStore = .default()

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.keyboardDismissMode = .interactive
        webView.scrollView.backgroundColor = UIColor(red: 0.031, green: 0.035, blue: 0.043, alpha: 1)
        webView.backgroundColor = webView.scrollView.backgroundColor
        webView.isOpaque = false
        webView.allowsBackForwardNavigationGestures = true
        webView.accessibilityIdentifier = "kheyflix.webview"

        context.coordinator.progressObservation = webView.observe(\.estimatedProgress, options: [.new]) { [weak model] view, _ in
            Task { @MainActor in model?.progress = view.estimatedProgress }
        }
        model.webView = webView
        model.beginReadinessTimeout()
        webView.load(URLRequest(url: AppConfiguration.baseURL, cachePolicy: .reloadRevalidatingCacheData, timeoutInterval: 30))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        let model: WebViewModel
        var progressObservation: NSKeyValueObservation?

        init(model: WebViewModel) { self.model = model }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            Task { @MainActor in
                model.isLoading = true
                model.errorMessage = nil
                model.beginReadinessTimeout()
            }
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            Task { @MainActor in
                model.finishLoading()
                model.canGoBack = webView.canGoBack
            }
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            report(error, in: webView)
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            report(error, in: webView)
        }

        private func report(_ error: Error, in webView: WKWebView) {
            let nsError = error as NSError
            guard nsError.code != NSURLErrorCancelled else { return }
            Task { @MainActor in
                model.finishLoading()
                model.canGoBack = webView.canGoBack
                model.errorMessage = nsError.code == NSURLErrorNotConnectedToInternet
                    ? "You appear to be offline."
                    : "Kheyflix could not reach the streaming server."
            }
        }

        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction) async -> WKNavigationActionPolicy {
            guard let url = navigationAction.request.url else { return .cancel }
            guard url.isFileURL || ["http", "https"].contains(url.scheme?.lowercased() ?? "") else { return .cancel }
            let isMainFrame = navigationAction.targetFrame?.isMainFrame ?? true
            if !isMainFrame { return .allow }
            if AppConfiguration.isSameOrigin(url, AppConfiguration.baseURL) { return .allow }
            await UIApplication.shared.open(url)
            return .cancel
        }
    }
}
