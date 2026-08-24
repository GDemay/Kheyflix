import { expect, test } from "@playwright/test";

test("a provider outage fails quickly instead of looping on mobile", async ({
  page,
}) => {
  let preflightAttempts = 0;
  await page.route("**/api/debrid/stream/514397162/2", async (route) => {
    if (route.request().method() === "HEAD" && preflightAttempts++ === 0)
      await route.fulfill({
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({
          error: { code: "PROVIDER_UNAVAILABLE", message: "Provider unavailable" },
        }),
      });
    else await route.continue();
  });

  await page.goto("/stream/514397162/2/smiling-friends-s01-e04-episode-4", {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByRole("alert")).toBeVisible({ timeout: 5_000 });
  await expect(page.getByRole("status")).toHaveCount(0);
  await page.getByRole("button", { name: "Retry" }).click();
  const video = page.locator("video");
  await expect
    .poll(() => video.evaluate((element) => element.readyState), {
      timeout: 30_000,
    })
    .toBeGreaterThanOrEqual(2);
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(preflightAttempts).toBeGreaterThanOrEqual(2);
  await page.goto("/", { waitUntil: "domcontentloaded" });
});
