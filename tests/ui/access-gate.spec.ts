import { expect, test } from "@playwright/test";

test("a configured deployment presents a private access screen before loading the catalog", async ({ page }) => {
  let authorized = false;
  const accessRequests: Array<{ method: string; body: string | null }> = [];

  await page.route("**/api/access", async (route) => {
    const request = route.request();
    accessRequests.push({ method: request.method(), body: request.postData() });
    if (request.method() === "GET") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ configured: true, authorized }),
      });
      return;
    }
    if (request.method() === "POST") {
      expect(request.postDataJSON()).toEqual({ accessCode: "test-access-code" });
      authorized = true;
      await route.fulfill({ status: 204 });
      return;
    }
    await route.fulfill({ status: 204 });
  });
  await page.route("**/api/debrid/magnets**", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ magnets: [] }) }),
  );

  await page.goto("/", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: "Your cinema is ready" })).toBeVisible();
  const accessCode = page.getByLabel("Kheyflix access code");
  await accessCode.fill("test-access-code");
  await page.getByRole("button", { name: "Enter Kheyflix" }).click();

  await expect(page.getByRole("heading", { name: "Your cinema is ready" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Kheyflix home" })).toBeVisible();
  expect(page.url()).not.toContain("test-access-code");
  expect(await page.locator("body").innerText()).not.toContain("test-access-code");
  expect(accessRequests.map(({ method }) => method)).toEqual(["GET", "POST"]);
});

test("a configured deployment gates deep-linked browse and playback routes", async ({ page }) => {
  await page.route("**/api/access", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ configured: true, authorized: false }),
    }),
  );
  await page.route("**/api/debrid/magnets**", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ magnets: [] }) }),
  );

  await page.goto("/stream/42/0/a-real-title", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: "Your cinema is ready" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Kheyflix home" })).toBeHidden();
});
