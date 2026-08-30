import { expect, test } from "@playwright/test";

const compatibilityPath =
  process.env.KHEYFLIX_COMPATIBILITY_TEST_PATH ||
  "/stream/536498972/23/friends-s02-e01-the-one-with-ross-s-new-girlfriend?compat=1";

test.afterEach(async ({ page }) => {
  if (!page.isClosed())
    await page.goto("/", { waitUntil: "domcontentloaded", timeout: 15_000 }).catch(
      () => undefined,
    );
});

test("a compatibility-only catalog episode decodes and advances", async ({
  page,
}) => {
  test.setTimeout(100_000);
  await page.goto(compatibilityPath, { waitUntil: "domcontentloaded" });

  const video = page.locator("video");
  await expect(video).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(() => video.evaluate((element) => element.readyState), {
      timeout: 70_000,
    })
    .toBeGreaterThanOrEqual(2);
  await expect
    .poll(() => video.evaluate((element) => element.videoWidth), {
      timeout: 30_000,
    })
    .toBeGreaterThan(0);
  await expect
    .poll(
      () => page.locator("main.player-shell").getAttribute("data-first-frame-ms"),
      { timeout: 15_000 },
    )
    .not.toBeNull();
  if (await video.evaluate((element) => element.paused))
    await page.getByRole("button", { name: "Play", exact: true }).click();
  const timeline = page.getByRole("slider", { name: "Seek video" });
  const startedAt = Number(await timeline.inputValue());
  await expect
    .poll(() => timeline.inputValue().then(Number), {
      timeout: 30_000,
    })
    .toBeGreaterThan(startedAt);
  await expect(page.getByRole("alert")).toHaveCount(0);

  await expect(page.getByRole("button", { name: "Audio languages" })).toBeVisible();
  await page.getByRole("button", { name: "Subtitles", exact: true }).click();
  const subtitles = page.getByRole("dialog", { name: "Subtitles" });
  await expect(subtitles.getByRole("button", { name: "English" })).toBeDisabled();
  await expect(
    subtitles.getByText("Image subtitles unsupported").first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Subtitles", exact: true }).click();
});
