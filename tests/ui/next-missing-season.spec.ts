import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const partialFriends = {
  id: 10,
  filename: "Friends (1994) S01",
  statusCode: 4,
  status: "Ready",
  videoFiles: [
    { index: 0, name: "Friends.S01E01.mkv", size: 1_000_000_000, path: "" },
    { index: 1, name: "Friends.S02E01.mkv", size: 1_000_000_000, path: "" },
  ],
};

const nextFriends = {
  id: 11,
  filename: "Friends (1994) S03 COMPLETE",
  statusCode: 4,
  status: "Ready",
  videoFiles: [
    { index: 0, name: "Friends.S03E01.mkv", size: 1_000_000_000, path: "" },
    { index: 1, name: "Friends.S03E02.mkv", size: 1_000_000_000, path: "" },
  ],
};

test("finds, prepares, and exposes the next missing season from series details", async ({ page }) => {
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
        episodeNames: { "1:1": "Pilot", "2:1": "The One with Ross's New Girlfriend", "3:1": "The One with the Princess Leia Fantasy", "3:2": "The One Where No One's Ready" },
      },
    },
  }));
  await page.route("**/api/discovery/search?*", (route) => {
    searchUrl = route.request().url();
    return route.fulfill({
      json: {
        results: [{
          id: "friends-s03-complete",
          title: "Friends.S03.COMPLETE.1080p.WEB-DL",
          size: 20_000_000_000,
          seeders: 12,
          peers: 2,
          source: "Test source",
          category: "series",
          magnet: "magnet:?xt=urn:btih:FRIENDSS03COMPLETE",
          metadata: {
            displayTitle: "Friends",
            year: 1994,
            season: 3,
            seasonPack: true,
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
  await expect(page.getByText("Season 3 is not in your library yet.")).toBeVisible();
  await page.getByRole("button", { name: "Find Season 3" }).click();

  await expect(page.getByRole("heading", { name: /find it.*press play/i })).toBeVisible();
  await expect(page.getByLabel("Search connected sources")).toHaveValue("Friends");
  await expect(page.getByLabel("Season to search")).toHaveValue("3");
  await expect(page.getByLabel("Episode to search")).toHaveValue("");
  await expect(page.getByRole("heading", { name: "Friends (1994)" })).toBeVisible();
  const parameters = new URL(searchUrl).searchParams;
  expect(parameters.get("kind")).toBe("series");
  expect(parameters.get("season")).toBe("3");
  expect(parameters.has("episode")).toBe(false);
  await expect(page.getByText("Complete season")).toBeVisible();

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
  await expect(page.getByLabel("Season").locator("option")).toHaveCount(3);
  await page.getByLabel("Season").selectOption("3");
  await expect(page.locator(".episodes > button")).toHaveCount(2);
});
