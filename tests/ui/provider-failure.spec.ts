import { expect, test } from "@playwright/test";

test("a provider outage fails quickly instead of looping on mobile", async ({
  page,
}) => {
  let outage = true;
  let failedMediaRequests = 0;
  let mediaRequests = 0;
  let bootstrapRequests = 0;
  await page.route("**/api/debrid/media/514397162/2", async (route) => {
    mediaRequests += 1;
    if (route.request().method() === "GET" && outage) {
      failedMediaRequests += 1;
      await route.fulfill({
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({
          error: { code: "PROVIDER_UNAVAILABLE", message: "Provider unavailable" },
        }),
      });
    } else await route.continue();
  });
  await page.route("**/api/debrid/transcode/514397162/2**", async (route) => {
    if (route.request().method() === "GET") bootstrapRequests += 1;
    await route.fulfill({ status: 204 });
  });

  await page.goto("/stream/514397162/2/smiling-friends-s01-e04-episode-4", {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByRole("alert")).toBeVisible({ timeout: 5_000 });
  await expect(page.getByRole("status")).toHaveCount(0);
  // A simultaneous bootstrap media error must not replace a terminal
  // provider failure with another loading source.
  await page.waitForTimeout(100);
  expect(bootstrapRequests).toBe(1);
  outage = false;
  await page.getByRole("button", { name: "Retry" }).click();
  await expect
    .poll(() => mediaRequests, { timeout: 5_000 })
    .toBeGreaterThanOrEqual(2);
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(failedMediaRequests).toBeGreaterThanOrEqual(1);
  await page.goto("/", { waitUntil: "domcontentloaded" });
});

test("the persistent Back action remains available during a playback failure", async ({
  page,
}) => {
  await page.route("**/api/debrid/media/514397162/2", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({
          error: { code: "PROVIDER_UNAVAILABLE", message: "Provider unavailable" },
        }),
      });
      return;
    }
    await route.continue();
  });

  await page.goto("/stream/514397162/2/smiling-friends-s01-e04-episode-4", {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByRole("alert")).toBeVisible({ timeout: 5_000 });

  await page.getByRole("button", { name: "Back to browsing" }).click();
  await expect(page).toHaveURL(/\/$/);
});
