import XCTest
@testable import Kheyflix

final class AppConfigurationTests: XCTestCase {
    func testNormalizesHostToHTTPS() {
        XCTAssertEqual(AppConfiguration.normalizedURL("kheyflix.example")?.absoluteString, "https://kheyflix.example")
    }

    func testPreservesLocalHTTPServer() {
        XCTAssertEqual(AppConfiguration.normalizedURL("http://localhost:3001")?.absoluteString, "http://localhost:3001")
    }

    func testRejectsUnsafeSchemesAndEmptyValues() {
        XCTAssertNil(AppConfiguration.normalizedURL("javascript:alert(1)"))
        XCTAssertNil(AppConfiguration.normalizedURL("   "))
    }

    func testSameOriginIncludesSchemeHostAndPort() {
        XCTAssertTrue(AppConfiguration.isSameOrigin(URL(string: "https://kheyflix.example/a")!, URL(string: "https://kheyflix.example/b")!))
        XCTAssertFalse(AppConfiguration.isSameOrigin(URL(string: "https://kheyflix.example")!, URL(string: "http://kheyflix.example")!))
        XCTAssertFalse(AppConfiguration.isSameOrigin(URL(string: "https://kheyflix.example")!, URL(string: "https://video.example")!))
    }
}
