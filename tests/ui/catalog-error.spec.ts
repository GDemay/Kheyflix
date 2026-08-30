import { expect, test } from "@playwright/test";

test("invalid catalog responses survive Discover navigation without a React crash", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/api/debrid/magnets**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "AUTH_USER_BANNED", message: "This account is banned" },
      }),
    });
  });

  await page.goto("/discover");
  await expect(
    page.getByRole("heading", { name: /find it.*press play/i }),
  ).toBeVisible();
  if ((page.viewportSize()?.width ?? 0) <= 700)
    await page.getByRole("button", { name: "Toggle navigation" }).click();
  await page.getByRole("button", { name: "Home", exact: true }).click();

  await expect(
    page.getByRole("heading", { name: "Kheyflix needs its catalog" }),
  ).toBeVisible();
  await expect(page.getByText("Kheyflix received an invalid catalog response."))
    .toBeVisible();
  expect(pageErrors).toEqual([]);
});
