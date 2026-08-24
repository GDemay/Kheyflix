import { expect, test } from "@playwright/test";

test.describe("cinematic app startup", () => {
  test.use({ reducedMotion: "no-preference" });

  test("rushes the Kheyflix mark toward the viewer and clears within two seconds", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const intro = page.locator(".app-startup-intro");
    await expect(intro).toBeVisible();
    await expect(intro.locator(".app-startup-intro__mark")).toBeVisible();
    await expect(intro.locator(".app-startup-intro__tunnel")).toBeVisible();

    const presentation = await intro.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        animationDurationMs:
          Number.parseFloat(style.animationDuration) *
          (style.animationDuration.endsWith("ms") ? 1 : 1_000),
        pointerEvents: style.pointerEvents,
        position: style.position,
      };
    });

    expect(presentation.animationDurationMs).toBeGreaterThanOrEqual(1_200);
    expect(presentation.animationDurationMs).toBeLessThanOrEqual(2_000);
    expect(presentation.pointerEvents).toBe("none");
    expect(presentation.position).toBe("fixed");
    await expect(intro).toBeHidden({ timeout: 2_100 });
    await expect(page.locator(".app-header")).toBeVisible({ timeout: 30_000 });
  });
});

test.describe("reduced-motion app startup", () => {
  test.use({ reducedMotion: "reduce" });

  test("suppresses the perspective rush and clears immediately", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const intro = page.locator(".app-startup-intro");
    await expect(intro).toBeAttached();
    expect(
      await page.evaluate(
        () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      ),
    ).toBe(true);
    const tunnelAnimation = await intro
      .locator(".app-startup-intro__tunnel")
      .evaluate((element) => getComputedStyle(element).animationName);

    expect(tunnelAnimation).toBe("none");
    await expect(intro).toBeHidden({ timeout: 500 });
  });
});
