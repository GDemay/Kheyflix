import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const visualCatalog = {
  magnets: [
    {
      id: 101,
      filename: "Friends.S01.1080p",
      statusCode: 4,
      uploadDate: 1_700_000_006,
      videoFiles: [
        {
          index: 0,
          name: "Friends.S01E01.The.One.Where.Monica.Gets.a.Roommate.mkv",
          size: 1_200_000_000,
          path: "Friends/S01E01.mkv",
        },
      ],
    },
    {
      id: 102,
      filename: "The.Mentalist.S01.1080p",
      statusCode: 4,
      uploadDate: 1_700_000_005,
      videoFiles: [
        {
          index: 0,
          name: "The.Mentalist.S01E01.Red.Johns.Footsteps.mkv",
          size: 1_100_000_000,
          path: "The Mentalist/S01E01.mkv",
        },
      ],
    },
    {
      id: 103,
      filename: "Shrek.2001.1080p",
      statusCode: 4,
      uploadDate: 1_700_000_004,
      videoFiles: [
        { index: 0, name: "Shrek.2001.mp4", size: 1_000_000_000, path: "Shrek.mp4" },
      ],
    },
    {
      id: 104,
      filename: "Shrek.2.2004.1080p",
      statusCode: 4,
      uploadDate: 1_700_000_003,
      videoFiles: [
        { index: 0, name: "Shrek.2.2004.mp4", size: 1_050_000_000, path: "Shrek 2.mp4" },
      ],
    },
    {
      id: 105,
      filename: "Arrival.2016.1080p",
      statusCode: 4,
      uploadDate: 1_700_000_002,
      videoFiles: [
        { index: 0, name: "Arrival.2016.mkv", size: 1_150_000_000, path: "Arrival.mkv" },
      ],
    },
    {
      id: 106,
      filename: "The.Last.of.Us.S01.1080p",
      statusCode: 4,
      uploadDate: 1_700_000_001,
      videoFiles: [
        {
          index: 0,
          name: "The.Last.of.Us.S01E01.When.Youre.Lost.in.the.Darkness.mkv",
          size: 1_250_000_000,
          path: "The Last of Us/S01E01.mkv",
        },
      ],
    },
  ],
};

test.beforeEach(async ({ page }) => {
  await page.route("**/api/debrid/magnets**", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify(visualCatalog) }),
  );
  await page.route("**/api/metadata**", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ metadata: null }) }),
  );
  await page.goto("/");
  await page.waitForLoadState("domcontentloaded");
  await page.locator(".app-header").waitFor({ state: "visible", timeout: 30_000 });
  await page.addStyleTag({
    content: "*,*::before,*::after{animation-delay:0s!important;animation-duration:.001ms!important;transition:none!important}",
  });
});

test("home remains within every supported viewport", async ({ page }) => {
  const geometry = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    header: document.querySelector(".app-header")?.getBoundingClientRect().toJSON(),
    hero: document.querySelector(".featured-hero, .debrid-hero, .catalog-loading, .catalog-skeleton")?.getBoundingClientRect().toJSON(),
  }));

  expect(geometry.document).toBeLessThanOrEqual(geometry.viewport + 1);
  expect(geometry.header?.x).toBeGreaterThanOrEqual(0);
  expect(geometry.header?.right).toBeLessThanOrEqual(geometry.viewport + 1);
  expect(geometry.hero?.width).toBeGreaterThanOrEqual(geometry.viewport - 20);
});

test("profile is the rightmost desktop header control", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) <= 700, "desktop header layout");
  const geometry = await page.evaluate(() => {
    const header = document.querySelector(".app-header")!.getBoundingClientRect();
    const profile = document.querySelector(".app-header .profile")!.getBoundingClientRect();
    const controls = [...document.querySelectorAll<HTMLElement>(".app-header button")]
      .filter((control) => getComputedStyle(control).display !== "none")
      .map((control) => ({ label: control.getAttribute("aria-label"), right: control.getBoundingClientRect().right }));
    return { headerRight: header.right, profileRight: profile.right, controls };
  });

  expect(geometry.headerRight - geometry.profileRight).toBeLessThanOrEqual(65);
  expect(geometry.profileRight).toBe(Math.max(...geometry.controls.map(({ right }) => right)));
});

test("primary controls meet touch-target and visibility requirements", async ({ page }) => {
  const narrow = (page.viewportSize()?.width ?? 0) <= 700;
  const play = page.getByRole("button", { name: "Play" }).first();
  await expect(play).toBeVisible();
  const box = await play.boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(narrow ? 40 : 42);

  if (narrow) {
    await expect(page.getByRole("button", { name: "Toggle navigation" })).toBeVisible();
    await page.getByRole("button", { name: "Toggle navigation" }).click();
    await expect(page.getByRole("navigation", { name: "Primary navigation" })).toBeVisible();
  }
});

test("home visual baseline", async ({ page }) => {
  await page.locator(".debrid-hero, .featured-hero").waitFor({ state: "visible", timeout: 30_000 });
  await expect(page).toHaveScreenshot("home.png", { fullPage: false });
});

test("has no serious accessibility violations", async ({ page }) => {
  const results = await new AxeBuilder({ page })
    .disableRules(["color-contrast"])
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const serious = results.violations.filter(({ impact }) => impact === "serious" || impact === "critical");
  expect(serious, serious.map(({ id, help }) => `${id}: ${help}`).join("\n")).toEqual([]);
});

test("discover page preserves its product-specific workflow", async ({ page }) => {
  if ((page.viewportSize()?.width ?? 0) <= 700) {
    await page.getByRole("button", { name: "Toggle navigation" }).click();
  }
  await page.getByRole("button", { name: "Discover" }).click();
  await expect(page.getByRole("heading", { name: /find it.*press play/i })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await expect(page).toHaveScreenshot("discover.png", { fullPage: false });
});
