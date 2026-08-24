import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

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

test("language status is explicit and language filters are actionable", async ({ page }) => {
  await page.route("**/api/discovery/search?*", (route) => route.fulfill({
    json: {
      results: [
        {
          id: "english",
          title: "Example.Movie.2026.1080p.English.ESubs",
          size: 2_000_000_000,
          seeders: 12,
          peers: 2,
          source: "Test source",
          category: "movie",
          magnet: "magnet:?xt=urn:btih:ENGLISH",
          metadata: { displayTitle: "Example Movie", year: 2026, resolution: "1080p", seasonPack: false, audioLanguages: ["English"], subtitleLanguages: ["English"] },
        },
        {
          id: "italian",
          title: "Example.Movie.2026.720p.ITA",
          size: 1_000_000_000,
          seeders: 8,
          peers: 1,
          source: "Test source",
          category: "movie",
          magnet: "magnet:?xt=urn:btih:ITALIAN",
          metadata: { displayTitle: "Example Movie", year: 2026, resolution: "720p", seasonPack: false, audioLanguages: ["Italian"], subtitleLanguages: [] },
        },
        {
          id: "unknown",
          title: "Example.Movie.2026.1080p",
          size: 3_000_000_000,
          seeders: 4,
          peers: 1,
          source: "Test source",
          category: "movie",
          magnet: "magnet:?xt=urn:btih:UNKNOWN",
          metadata: { displayTitle: "Example Movie", year: 2026, resolution: "1080p", seasonPack: false, audioLanguages: [], subtitleLanguages: [] },
        },
      ],
    },
  }));

  await page.goto("/discover");
  await page.getByLabel("Search connected sources").fill("Example Movie");
  await page.getByRole("button", { name: "Search", exact: true }).click();

  await expect(page.getByText("Audio: Not specified")).toBeVisible();
  await expect(page.getByText("Subtitles: Not specified")).toHaveCount(2);
  await expect(page.getByLabel("Filter by audio")).toContainText("English (1)");
  await expect(page.getByLabel("Filter by subtitles")).toContainText("English (1)");

  if ((page.viewportSize()?.width ?? 0) <= 700) {
    const subtitleFilterWidth = await page.getByLabel("Filter by subtitles").evaluate((element) => element.getBoundingClientRect().width);
    expect(subtitleFilterWidth).toBeGreaterThanOrEqual(260);
  }

  await page.getByLabel("Filter by subtitles").selectOption("English");
  await expect(page.getByText("Showing 1 of 3 releases")).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(1);
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.getByRole("article")).toHaveCount(3);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  const accessibility = await new AxeBuilder({ page })
    .disableRules(["color-contrast"])
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(accessibility.violations.filter(({ impact }) => impact === "serious" || impact === "critical")).toEqual([]);
});

test("unavailable language filters explain why they are disabled", async ({ page }) => {
  await page.route("**/api/discovery/search?*", (route) => route.fulfill({
    json: {
      results: [{
        id: "unknown",
        title: "Example.Movie.2026.1080p",
        size: 3_000_000_000,
        seeders: 4,
        peers: 1,
        source: "Test source",
        category: "movie",
        magnet: "magnet:?xt=urn:btih:UNKNOWN",
        metadata: { displayTitle: "Example Movie", year: 2026, resolution: "1080p", seasonPack: false, audioLanguages: [], subtitleLanguages: [] },
      }],
    },
  }));

  await page.goto("/discover");
  await page.getByLabel("Search connected sources").fill("Example Movie");
  await page.getByRole("button", { name: "Search", exact: true }).click();

  await expect(page.getByLabel("Filter by audio")).toBeDisabled();
  await expect(page.getByLabel("Filter by subtitles")).toBeDisabled();
  await expect(page.getByText("No audio languages advertised by sources")).toBeVisible();
  await expect(page.getByText("No subtitle languages advertised by sources")).toBeVisible();
});

test("a progress refresh failure becomes retryable and carries its request reference", async ({ page }) => {
  const browserErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  await page.route("**/api/discovery/search?*", (route) => route.fulfill({
    json: {
      results: [{
        id: "pokemon-movie",
        title: "Pokemon.Detective.Pikachu.2019.1080p.x264",
        size: 2_000_000_000,
        seeders: 12,
        peers: 2,
        source: "Test source",
        category: "movie",
        magnet: "magnet:?xt=urn:btih:POKEMONMOVIE",
        metadata: { displayTitle: "Pokemon Detective Pikachu", year: 2019, resolution: "1080p", audioLanguages: [], subtitleLanguages: [] },
      }],
    },
  }));
  await page.route("**/api/debrid/magnets**", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 201,
        headers: { "x-request-id": "upload-ref" },
        json: { magnet: { id: 42, ready: false } },
      });
      return;
    }
    await route.fulfill({
      status: 503,
      headers: { "x-request-id": "refresh-ref" },
      json: { error: { code: "ALLDEBRID_UNAVAILABLE", message: "Media preparation is temporarily unavailable." } },
    });
  });

  await page.goto("/discover");
  await page.getByLabel("Search connected sources").fill("Pokemon");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByText("I confirm I’m authorized").click();
  await page.getByRole("button", { name: "Prepare", exact: true }).click();

  await expect(page.getByText(/Media preparation is temporarily unavailable.*refresh-ref/)).toBeVisible({ timeout: 5_000 });
  await expect(page.getByRole("button", { name: "Try again", exact: true })).toBeVisible();
  expect(browserErrors.some((message) => message.includes("refresh-ref"))).toBe(true);
});

test("a network failure during preparation has a client-generated trace reference", async ({ page }) => {
  let requestId = "";
  const browserErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  await page.route("**/api/discovery/search?*", (route) => route.fulfill({
    json: {
      results: [{
        id: "pokemon-movie",
        title: "Pokemon.Detective.Pikachu.2019.1080p.x264",
        size: 2_000_000_000,
        seeders: 12,
        peers: 2,
        source: "Test source",
        category: "movie",
        magnet: "magnet:?xt=urn:btih:POKEMONMOVIE",
        metadata: { displayTitle: "Pokemon Detective Pikachu", year: 2019, resolution: "1080p", audioLanguages: [], subtitleLanguages: [] },
      }],
    },
  }));
  await page.route("**/api/debrid/magnets", async (route) => {
    requestId = route.request().headers()["x-request-id"] || "";
    await route.abort("failed");
  });

  await page.goto("/discover");
  await page.getByLabel("Search connected sources").fill("Pokemon");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByText("I confirm I’m authorized").click();
  await page.getByRole("button", { name: "Prepare", exact: true }).click();

  expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
  await expect(page.getByText(new RegExp(`Reference: ${requestId}`))).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again", exact: true })).toBeVisible();
  expect(browserErrors.some((message) => message.includes(requestId))).toBe(true);
});
