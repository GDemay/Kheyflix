import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const partialFriends = {
  id: 10,
  filename: "Friends (1994) S01",
  statusCode: 4,
  status: "Ready",
  videoFiles: [
    { index: 0, name: "Friends.S01E01.mkv", size: 1_000_000_000, path: "" },
  ],
};

const nextFriends = {
  id: 11,
  filename: "Friends (1994) S01E02",
  statusCode: 4,
  status: "Ready",
  videoFiles: [
    { index: 0, name: "Friends.S01E02.mkv", size: 1_000_000_000, path: "" },
  ],
};

test("finds, prepares, and exposes the next missing episode from series details", async ({ page }) => {
  let prepared = false;
  let searchUrl = "";
  await page.route("**/api/metadata?*", (route) => route.fulfill({
    json: {
      metadata: {
        provider: "tvmaze",
        providerUrl: "https://www.tvmaze.com/shows/431/friends",
        canonicalTitle: "Friends",
        year: 1994,
        genres: ["Comedy"],
        episodeNames: { "1:1": "Pilot", "1:2": "The One with the Sonogram" },
      },
    },
  }));
  await page.route("**/api/discovery/search?*", (route) => {
    searchUrl = route.request().url();
    return route.fulfill({
      json: {
        results: [{
          id: "friends-s01e02",
          title: "Friends.S01E02.1080p.WEB-DL",
          size: 1_000_000_000,
          seeders: 12,
          peers: 2,
          source: "Test source",
          category: "series",
          magnet: "magnet:?xt=urn:btih:FRIENDSS01E02",
          metadata: {
            displayTitle: "Friends",
            year: 1994,
            season: 1,
            episode: 2,
            seasonPack: false,
            resolution: "1080p",
            audioLanguages: ["English"],
            subtitleLanguages: ["English"],
          },
        }],
      },
    });
  });
  await page.route("**/api/debrid/magnets**", async (route) => {
    if (route.request().method() === "POST") {
      prepared = true;
      await route.fulfill({ status: 201, json: { magnet: { id: 11, ready: true } } });
      return;
    }
    await route.fulfill({ json: { magnets: prepared ? [partialFriends, nextFriends] : [partialFriends] } });
  });

  await page.goto("/debrid/series-friends-1994?title=Friends");
  await expect(page.getByRole("heading", { name: "Friends" })).toBeVisible();
  await expect(page.getByText("The One with the Sonogram")).toBeVisible();
  await page.getByRole("button", { name: "Find S01E02" }).click();

  await expect(page.getByRole("heading", { name: /find it.*press play/i })).toBeVisible();
  await expect(page.getByLabel("Search connected sources")).toHaveValue("Friends");
  await expect(page.getByLabel("Season to search")).toHaveValue("1");
  await expect(page.getByLabel("Episode to search")).toHaveValue("2");
  await expect(page.getByRole("heading", { name: "Friends (1994)" })).toBeVisible();
  const parameters = new URL(searchUrl).searchParams;
  expect(parameters.get("kind")).toBe("series");
  expect(parameters.get("season")).toBe("1");
  expect(parameters.get("episode")).toBe("2");

  const prepare = page.getByRole("button", { name: "Prepare", exact: true });
  await expect(prepare).toBeDisabled();
  await page.getByText("I confirm I’m authorized").click();
  await expect(prepare).toBeEnabled();
  await prepare.click();
  await expect(page.getByRole("button", { name: "Back to Friends" })).toBeVisible({ timeout: 8_000 });

  const accessibility = await new AxeBuilder({ page })
    .disableRules(["color-contrast"])
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(accessibility.violations.filter(({ impact }) => impact === "serious" || impact === "critical")).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);

  await page.getByRole("button", { name: "Back to Friends" }).click();
  await expect(page.getByRole("heading", { name: "Friends" })).toBeVisible();
  await expect(page.getByText("The One with the Sonogram")).toBeVisible();
  await expect(page.locator(".episodes > button")).toHaveCount(2);
});
