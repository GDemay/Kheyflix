import { expect, test } from "@playwright/test";

test("search state survives result navigation and browser history", async ({ page }) => {
  await page.goto("/search?q=shrek", { waitUntil: "domcontentloaded" });
  await expect(page.getByLabel("Search titles")).toHaveValue("shrek");
  await page.getByRole("button").filter({ hasText: "Shrek 2" }).first().click();
  await expect(page).toHaveURL(/\/debrid\//);

  await page.goBack();
  await expect(page).toHaveURL(/\/search\?q=shrek$/);
  await expect(page.getByLabel("Search titles")).toHaveValue("shrek");
  await expect(page.getByText("Results for “shrek”", { exact: true })).toBeVisible();

  await page.goForward();
  await expect(page).toHaveURL(/\/debrid\//);
});

test("player back returns directly to browsing without reopening title details", async ({ page }) => {
  await page.route("**/api/debrid/magnets*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        magnets: [{
          id: 90,
          filename: "Heroes S01",
          statusCode: 4,
          videoFiles: [{
            index: 3,
            name: "Heroes.S01E04.Collision.mkv",
            size: 1_000_000_000,
            path: "",
          }],
        }],
      }),
    });
  });
  await page.route("**/api/metadata*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ metadata: null, cached: false }),
    });
  });
  await page.goto("/search?q=heroes", { waitUntil: "domcontentloaded" });
  await page.getByRole("button").filter({ hasText: "Heroes" }).first().click();
  await expect(page.getByRole("dialog", { name: "Heroes" })).toBeVisible();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page).toHaveURL(/\/stream\//);

  await page.getByRole("button", { name: "Back to browsing" }).click();

  await expect(page).toHaveURL(/\/search\?q=heroes$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByLabel("Search titles")).toHaveValue("heroes");

  await page.goBack();
  await expect(page.getByRole("dialog", { name: "Heroes" })).toBeVisible();
  await page.getByRole("button", { name: "Close title details" }).click();
  await expect(page).toHaveURL(/\/search\?q=heroes$/);
  await expect(page.locator("main.player-shell")).toHaveCount(0);
});

test("invalid watch routes provide an explicit recovery path", async ({ page }) => {
  await page.goto("/watch/not-real", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Title not found" })).toBeVisible();
  await page.getByRole("button", { name: "Return home" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("title details trap focus, close on Escape, and restore search focus", async ({ page }) => {
  await page.goto("/search?q=shrek", { waitUntil: "domcontentloaded" });
  await page.getByRole("button").filter({ hasText: "Shrek 2" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("button", { name: "Close title details" })).toBeFocused();
  await expect(page.locator(".app-background")).toHaveAttribute("inert", "");
  await expect(page.locator(".app-background")).toHaveAttribute(
    "aria-hidden",
    "true",
  );
  await expect(
    page.getByRole("button", { name: "Kheyflix home" }),
  ).toHaveCount(0);

  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("button", { name: /Like|Liked/ })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Close title details" })).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/search\?q=shrek$/);
  await expect(page.getByLabel("Search titles")).toBeFocused();
});

test("profile editor closes on Escape and restores its opener", async ({ page }) => {
  await page.goto("/profile", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Manage Profiles" }).click();
  const opener = page.getByRole("button", { name: "Edit Kheyflix" });
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "Edit Profile" });
  await expect(dialog).toBeVisible();
  await expect(page.getByLabel("Profile name")).toBeFocused();
  await expect(page.locator(".profile-background")).toHaveAttribute(
    "aria-hidden",
    "true",
  );
  await expect(page.locator(".app-background")).toHaveAttribute("inert", "");
  await expect(page.locator(".app-background")).toHaveAttribute(
    "aria-hidden",
    "true",
  );
  await expect(
    page.getByRole("button", { name: "Kheyflix home" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("navigation", { name: "Primary navigation" }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
  await expect(page.locator(".app-background")).not.toHaveAttribute("inert", "");
});

test("existing profiles and the active selection keep their established storage keys", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "kheyflix.profiles.v2",
      JSON.stringify([{ id: "returning", name: "Returning User", color: "#145a8d" }]),
    );
  });
  await page.goto("/profile", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Continue as Returning User" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("kheyflix.active-profile")),
    )
    .toBe("returning");
});
