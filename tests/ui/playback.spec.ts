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
  await expect
    .poll(
      () => page.locator("main.player-shell").getAttribute("data-first-frame-ms"),
      { timeout: 15_000 },
    )
    .not.toBeNull();
  const firstFrameMs = Number(
    await page.locator("main.player-shell").getAttribute("data-first-frame-ms"),
  );
  console.info(`[playback] first decoded frame: ${firstFrameMs}ms`);
  expect(firstFrameMs).toBeLessThan(10_000);

  const initial = await video.evaluate((element) => ({
    muted: element.muted,
    volume: element.volume,
    paused: element.paused,
    readyState: element.readyState,
    width: element.videoWidth,
    height: element.videoHeight,
    userAgent: navigator.userAgent,
    vendor: navigator.vendor,
  }));
  const ios = /Apple/i.test(initial.vendor) &&
    (/(?:iPhone|iPad|iPod)/i.test(initial.userAgent) ||
      (/Macintosh/i.test(initial.userAgent) && /Mobile/i.test(initial.userAgent)));
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
    checkpoints.push(
      Number(await page.getByRole("slider", { name: "Seek video" }).inputValue()),
    );
    await expect(page.getByRole("alert")).toHaveCount(0);
  }
  expect(checkpoints.at(-1)! - checkpoints[0]).toBeGreaterThan(12);
  await expect
    .poll(
      () => page.locator("main.player-shell").getAttribute("data-playback-quality"),
      { timeout: 20_000 },
    )
    .toBe("original");

  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const paused = page.getByLabel("Playback paused");
  await expect(paused).toBeVisible();
  await expect(paused.getByRole("button", { name: "Play" })).toBeVisible();
  await expect(
    paused.getByRole("button", { name: "Back 10 seconds" }),
  ).toBeVisible();
  await expect(
    paused.getByRole("button", { name: "Forward 10 seconds" }),
  ).toBeVisible();
  await expect(page.locator(".shard-portal-loader")).toHaveCount(0);
  const pausedAt = await video.evaluate((element) => element.currentTime);
  await paused.getByRole("button", { name: "Forward 10 seconds" }).click();
  await expect
    .poll(
      () =>
        page
          .getByRole("slider", { name: "Seek video" })
          .inputValue()
          .then(Number),
      {
      timeout: 30_000,
      },
    )
    .toBeGreaterThan(pausedAt + 8);
  await expect(page.locator(".shard-portal-loader")).toHaveCount(0);
  await page.getByLabel("Playback paused").getByRole("button", { name: "Play" }).click();

  await expect(page.getByRole("button", { name: "Audio languages" })).toBeVisible();
  await page.getByRole("button", { name: "Audio languages" }).click();
  const audioMenu = page.getByRole("dialog", { name: "Audio languages" });
  await expect(audioMenu.getByRole("button", { name: /English/ })).toHaveClass(
    /active/,
  );
  await page.getByRole("button", { name: "Audio languages" }).click();
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
  await settings.getByRole("button", { name: "480p Data saver" }).click();
  await expect(
    settings.getByRole("button", { name: "480p Data saver" }),
  ).toHaveClass(/active/);
  await expect(page.locator(".shard-portal-loader")).toHaveCount(0);
  await page.getByRole("button", { name: "Playback settings" }).click();
  await expect
    .poll(() => video.evaluate((element) => element.readyState), {
      timeout: 30_000,
    })
    .toBeGreaterThanOrEqual(2);
  const qualitySwitchStart = await video.evaluate((element) => element.currentTime);
  await expect
    .poll(() => video.evaluate((element) => element.currentTime), {
      timeout: 15_000,
    })
    .toBeGreaterThan(qualitySwitchStart + 3);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.goto("/", { waitUntil: "domcontentloaded" });
});

test("pointer movement reveals central playback quick controls", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto(playbackPath, { waitUntil: "domcontentloaded" });

  const shell = page.locator("main.player-shell");
  const video = page.locator("video");
  await expect(video).toBeVisible();
  await expect
    .poll(() => shell.getAttribute("data-first-frame-ms"), { timeout: 30_000 })
    .not.toBeNull();
  if (await video.evaluate((element) => element.paused))
    await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect.poll(() => video.evaluate((element) => element.paused)).toBe(false);

  await page.mouse.move(1200, 180);
  await expect(shell).not.toHaveClass(/controls-visible/, { timeout: 5_000 });
  await page.mouse.move(640, 360);
  const quickControls = page.getByRole("group", {
    name: "Playback quick controls",
  });
  await expect(quickControls).toBeVisible();
  await expect(
    quickControls.getByRole("button", { name: "Back 10 seconds" }),
  ).toBeVisible();
  await expect(
    quickControls.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
  await expect(
    quickControls.getByRole("button", { name: "Forward 10 seconds" }),
  ).toBeVisible();
  await expect(quickControls).toBeHidden({ timeout: 5_000 });
});
