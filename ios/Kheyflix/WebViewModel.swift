import Combine
import Foundation
import WebKit

@MainActor
final class WebViewModel: ObservableObject {
    @Published var isLoading = true
    @Published var progress = 0.0
    @Published var errorMessage: String?
    @Published var canGoBack = false
    private var readinessTask: Task<Void, Never>?

    weak var webView: WKWebView?

    func reload() {
        errorMessage = nil
        guard let webView else { return }
        if webView.url == nil { webView.load(URLRequest(url: AppConfiguration.baseURL)) }
        else { webView.reload() }
    }

    func loadServer(_ value: String) -> Bool {
        guard let url = AppConfiguration.normalizedURL(value) else { return false }
        UserDefaults.standard.set(url.absoluteString, forKey: AppConfiguration.serverURLKey)
        errorMessage = nil
        isLoading = true
        progress = 0
        beginReadinessTimeout()
        webView?.load(URLRequest(url: url, cachePolicy: .reloadRevalidatingCacheData, timeoutInterval: 30))
        return true
    }

    func beginReadinessTimeout() {
        readinessTask?.cancel()
        readinessTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(12))
            guard !Task.isCancelled, let self, self.isLoading else { return }
            self.isLoading = false
            self.errorMessage = "The streaming server did not respond in time."
        }
    }

    func finishLoading() {
        readinessTask?.cancel()
        isLoading = false
    }

    func goBack() {
        webView?.goBack()
    }
}
