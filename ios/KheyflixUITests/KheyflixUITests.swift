import XCTest

@MainActor
final class KheyflixUITests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    private func requireLiveServer() async throws {
        do {
            let (_, response) = try await URLSession.shared.data(
                from: URL(string: "http://127.0.0.1:3001/api/health")!
            )
            guard (response as? HTTPURLResponse)?.statusCode == 200 else {
                throw URLError(.cannotConnectToHost)
            }
        } catch {
            throw XCTSkip("Run npm run dev:ios to execute live acceptance tests.")
        }
    }

    func testLaunchesBrandedSharedExperience() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing"]
        app.launch()
        XCTAssertTrue(app.webViews["kheyflix.webview"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.webViews.staticTexts["KHEYFLIX"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.webViews.buttons["Play Rabbit"].exists)
    }


    func testRabbitPlaybackStartsInLiveSharedApp() async throws {
        try await requireLiveServer()
        let app = XCUIApplication()
        app.launchArguments = ["--server-url", "http://127.0.0.1:3001/title/big-buck-bunny"]
        app.launch()
        let play = app.webViews.buttons["Play"]
        XCTAssertTrue(play.waitForExistence(timeout: 15))
        play.tap()
        XCTAssertTrue(app.webViews.sliders["Seek video"].waitForExistence(timeout: 8))
        XCTAssertTrue(app.webViews.buttons["Pause"].waitForExistence(timeout: 20), "Rabbit media never entered the playing state")
    }

    func testAllDebridFailureOffersWorkingRabbitFallback() async throws {
        try await requireLiveServer()
        let app = XCUIApplication()
        app.launchArguments = ["--server-url", "http://127.0.0.1:3001/"]
        app.launch()

        let fallback = app.webViews.buttons["Watch Big Buck Bunny"]
        guard fallback.waitForExistence(timeout: 15) else {
            throw XCTSkip("The configured AllDebrid account is healthy, so recovery UI is not expected.")
        }
        XCTAssertTrue(app.webViews.staticTexts["Kheyflix needs its catalog"].exists)
        fallback.tap()
        XCTAssertTrue(app.webViews.sliders["Seek video"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.webViews.buttons["Pause"].waitForExistence(timeout: 20))
    }
}
