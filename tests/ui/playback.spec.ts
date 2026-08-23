import { expect, test } from "@playwright/test";

const playbackPath =
  process.env.KHEYFLIX_PLAYBACK_TEST_PATH ||
  "/stream/514397162/2/smiling-friends-s01-e04-episode-4";

test("a real movie starts and keeps streaming", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto(playbackPath, { waitUntil: "domcontentloaded" });

  const video = page.locator("video");
  await expect(video).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByText("Preparing compatible playback…")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Back 10 seconds" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Forward 10 seconds" })).toBeVisible();
  await expect
    .poll(() => video.evaluate((element) => element.readyState), {
      timeout: 30_000,
    })
    .toBeGreaterThanOrEqual(2);
  await expect(page.getByRole("status")).toBeHidden({ timeout: 30_000 });

  const initial = await video.evaluate((element) => ({
    muted: element.muted,
    volume: element.volume,
    paused: element.paused,
    readyState: element.readyState,
    width: element.videoWidth,
    height: element.videoHeight,
    userAgent: navigator.userAgent,
  }));
  const ios = /(?:iPhone|iPad|iPod)/i.test(initial.userAgent) ||
    (/Macintosh/i.test(initial.userAgent) && /Mobile/i.test(initial.userAgent));
  expect(initial.readyState).toBeGreaterThanOrEqual(2);
  expect(initial.width).toBeGreaterThanOrEqual(640);
  expect(initial.height).toBeGreaterThanOrEqual(360);

  // Desktop browsers may still require an explicit gesture for audible video.
  if (initial.paused) {
    await page.getByRole("button", { name: "Play", exact: true }).click();
  }

  const start = await video.evaluate((element) => element.currentTime);
  await expect
    .poll(
      () => video.evaluate((element) => element.currentTime),
      { timeout: 15_000 },
    )
    .toBeGreaterThan(start + 3);

  if (ios) {
    await page.getByRole("button", { name: "Unmute" }).click();
    await expect.poll(() => video.evaluate((element) => element.muted)).toBe(false);
  }

  const checkpoints: number[] = [];
  for (let sample = 0; sample < 4; sample += 1) {
    await page.waitForTimeout(5_000);
    checkpoints.push(await video.evaluate((element) => element.currentTime));
    await expect(page.getByRole("alert")).toHaveCount(0);
  }
  expect(checkpoints.at(-1)! - checkpoints[0]).toBeGreaterThan(12);

  await expect(page.getByRole("button", { name: "Audio languages" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Subtitles" })).toBeVisible();
  await page.getByRole("button", { name: "Subtitles" }).click();
  await expect(page.getByRole("dialog", { name: "Subtitles" })).toBeVisible();
  await expect(page.getByRole("button", { name: "English" })).toHaveClass(
    /active/,
  );
  await page.getByRole("button", { name: "Subtitles" }).click();
  await page.getByRole("button", { name: "Playback settings" }).click();
  await expect(
    page.getByRole("dialog", { name: "Playback settings" }),
  ).toBeVisible();
  const settings = page.getByRole("dialog", { name: "Playback settings" });
  await expect(settings.getByRole("button", { name: /Auto/ })).toHaveClass(
    /active/,
  );
  await expect(
    settings.getByRole("button", { name: "480p Data saver" }),
  ).toBeVisible();
  await expect(
    settings.getByRole("button", { name: "Original Best source quality" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "1×" })).toHaveClass(/active/);
  await expect(page.getByRole("button", { name: "Voice earlier" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Voice later" })).toBeVisible();
  await page.goto("/", { waitUntil: "domcontentloaded" });
});
