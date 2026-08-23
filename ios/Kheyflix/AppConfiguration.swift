import Foundation

enum AppConfiguration {
    static let serverURLKey = "KheyflixServerURL"

    static var isUITesting: Bool {
        ProcessInfo.processInfo.arguments.contains("--ui-testing")
    }

    static var baseURL: URL {
        if isUITesting,
           let fixture = Bundle.main.url(forResource: "UITestFixture", withExtension: "html") {
            return fixture
        }

        let arguments = ProcessInfo.processInfo.arguments
        if let marker = arguments.firstIndex(of: "--server-url"), arguments.indices.contains(marker + 1),
           let launchURL = normalizedURL(arguments[marker + 1]) {
            return launchURL
        }

        if let override = UserDefaults.standard.string(forKey: serverURLKey),
           let url = normalizedURL(override) {
            return url
        }

        let bundled = Bundle.main.object(forInfoDictionaryKey: "KheyflixBaseURL") as? String
        return normalizedURL(bundled ?? "") ?? URL(string: "http://localhost:3001")!
    }

    static func normalizedURL(_ value: String) -> URL? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        let candidate = trimmed.contains("://") ? trimmed : "https://\(trimmed)"
        guard var components = URLComponents(string: candidate),
              let scheme = components.scheme?.lowercased(),
              ["http", "https"].contains(scheme), components.host != nil else { return nil }
        components.path = components.path == "/" ? "" : components.path
        return components.url
    }

    static func isSameOrigin(_ lhs: URL, _ rhs: URL) -> Bool {
        guard !lhs.isFileURL, !rhs.isFileURL else { return lhs.isFileURL && rhs.isFileURL }
        return lhs.scheme?.lowercased() == rhs.scheme?.lowercased()
            && lhs.host?.lowercased() == rhs.host?.lowercased()
            && lhs.port == rhs.port
    }
}
