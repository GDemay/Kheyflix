import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/debrid/magnets**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ magnets: [] }),
    }),
  );
});

test.describe("cinematic app startup", () => {
  test.use({ reducedMotion: "no-preference" });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const audioProbe = { contexts: 0, starts: 0 };
      Object.defineProperty(window, "__kheyflixAudioProbe", {
        value: audioProbe,
      });
      const connect = function (this: unknown) {
        return this;
      };
      class StartupAudioContext {
        currentTime = 0;
        destination = {};
        state = "running";
        constructor() {
          audioProbe.contexts += 1;
        }
        resume() {
          return Promise.resolve();
        }
        close() {
          return Promise.resolve();
        }
        createDynamicsCompressor() {
          return {
            threshold: { value: 0 },
            knee: { value: 0 },
            ratio: { value: 0 },
            connect,
          };
        }
        createGain() {
          return {
            gain: {
              setValueAtTime() {},
              exponentialRampToValueAtTime() {},
            },
            connect,
          };
        }
        createOscillator() {
          return {
            type: "sine",
            frequency: {
              setValueAtTime() {},
              exponentialRampToValueAtTime() {},
            },
            connect,
            start() {
              audioProbe.starts += 1;
            },
            stop() {},
          };
        }
      }
      Object.defineProperty(window, "AudioContext", {
        configurable: true,
        value: StartupAudioContext,
      });
    });
  });

  test("rushes the Kheyflix mark toward the viewer and clears within two seconds", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const intro = page.locator(".app-startup-intro");
    await expect(intro).toBeVisible();
    await expect(intro.locator(".app-startup-intro__mark")).toBeVisible();
    await expect(intro.locator(".app-startup-intro__tunnel")).toBeVisible();
    await expect(intro.locator(".startup-k-silhouette")).toHaveCount(1);
    await expect(intro.locator(".startup-k-panel")).toHaveCount(0);

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

  test("schedules the original startup sting once", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });

    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as typeof window & {
                __kheyflixAudioProbe?: { contexts: number; starts: number };
              }
            ).__kheyflixAudioProbe,
        ),
      )
      .toEqual({ contexts: 1, starts: 6 });
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
