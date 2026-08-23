import { expect, test } from "@playwright/test";

test("a provider outage fails quickly instead of looping on mobile", async ({
  page,
}) => {
  await page.route("**/api/debrid/stream/42/0", async (route) => {
    await route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "AUTH_USER_BANNED", message: "This account is banned" },
      }),
    });
  });
  await page.route("**/api/debrid/media/42/0", async (route) => {
    await route.fulfill({ status: 502, contentType: "application/json", body: "{}" });
  });

  await page.goto("/stream/42/0/provider-test", {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByRole("alert")).toBeVisible({ timeout: 5_000 });
  await expect(page.getByRole("status")).toHaveCount(0);
});
