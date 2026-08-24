import { expect, test } from "@playwright/test";

test("a prepared conversion-required movie never offers Watch", async ({ page }) => {
  await page.route("**/api/discovery/search?*", (route) =>
    route.fulfill({
      json: {
        results: [{
          id: "candidate",
          title: "Candidate.Movie.2026.1080p.WEB-DL.x264",
          size: 2_000_000_000,
          seeders: 12,
          peers: 2,
          source: "Test source",
          category: "movie",
          magnet: "magnet:?xt=urn:btih:CANDIDATE",
          metadata: {
            displayTitle: "Candidate Movie",
            year: 2026,
            resolution: "1080p",
            seasonPack: false,
            videoCodec: "H.264",
            sourceType: "WEB-DL",
            audioLanguages: [],
            subtitleLanguages: [],
          },
        }],
      },
    }),
  );
  await page.route("**/api/debrid/magnets**", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({ status: 201, json: { magnet: { id: 42, ready: true } } });
      return;
    }
    await route.fulfill({
      json: {
        magnets: [{
          id: 42,
          filename: "Candidate Movie",
          statusCode: 4,
          status: "Ready",
          videoFiles: [{ index: 0, name: "Candidate.Movie.2026.mkv", size: 2_000_000_000, path: "" }],
        }],
      },
    });
  });

  await page.goto("/discover");
  await page.getByLabel("Search connected sources").fill("Candidate Movie");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByText("I confirm I’m authorized").click();
  await page.getByRole("button", { name: "Prepare", exact: true }).click();

  await expect(page.getByText("This release needs conversion and is not available for direct playback.")).toBeVisible({ timeout: 8_000 });
  await expect(page.getByRole("button", { name: "Watch", exact: true })).toHaveCount(0);
});
