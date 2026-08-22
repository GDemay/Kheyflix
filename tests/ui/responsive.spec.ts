import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
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
