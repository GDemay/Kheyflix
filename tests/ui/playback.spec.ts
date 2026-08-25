import { expect, test } from "@playwright/test";

const playbackPath =
  process.env.KHEYFLIX_PLAYBACK_TEST_PATH ||
  "/stream/701203060/0/shrek";
const trackPlaybackPath =
  process.env.KHEYFLIX_TRACK_TEST_PATH ||
  process.env.KHEYFLIX_PLAYBACK_TEST_PATH ||
  "/stream/660270988/3/shrek-2001-multilingual";

test("a real movie starts and keeps streaming", async ({ page }) => {
  test.setTimeout(90_000);
  let blockingPreflights = 0;
  page.on("request", (request) => {
    if (request.method() === "HEAD" && request.url().includes("/api/debrid/stream/"))
      blockingPreflights += 1;
  });
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
  expect(blockingPreflights).toBe(0);

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
  // A native-compatible source is already original quality even when an
  // optional transcoder prewarm remains in its internal bootstrap phase.
  await expect(page.locator(".player-top span")).toContainText(
    "Auto · Original",
    { timeout: 20_000 },
  );

  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const paused = page.getByLabel("Playback paused");
  await expect(paused).toBeVisible();
  await expect(page.locator("main.player-shell")).toHaveClass(/video-dimmed/);
  expect(
    await video.evaluate((element) => getComputedStyle(element).filter),
  ).not.toBe("none");
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

test("real media exposes audio and subtitle languages", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto(trackPlaybackPath, { waitUntil: "domcontentloaded" });

  await expect(
    page.getByRole("button", { name: "Audio languages" }),
  ).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Audio languages" }).click();
  const audioMenu = page.getByRole("dialog", { name: "Audio languages" });
  await expect(
    audioMenu.locator("button.active").filter({ hasText: "English" }),
  ).toHaveClass(/active/);
  await page.getByRole("button", { name: "Audio languages" }).click();

  await expect(page.getByRole("button", { name: "Subtitles" })).toBeVisible();
  await page.getByRole("button", { name: "Subtitles" }).click();
  const subtitleMenu = page.getByRole("dialog", { name: "Subtitles" });
  await expect(subtitleMenu).toBeVisible();
  await expect(subtitleMenu.getByRole("button", { name: "English" })).toHaveClass(
    /active/,
  );
});

test("pointer movement reveals unobtrusive playback chrome", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "laptop", "mouse-specific desktop behavior");
  test.setTimeout(60_000);
  await page.addInitScript(() => {
    Object.defineProperty(HTMLMediaElement.prototype, "paused", {
      configurable: true,
      get() {
        return (this as HTMLMediaElement).dataset.mockPaused === "true";
      },
    });
    HTMLMediaElement.prototype.play = function () {
      this.dataset.mockPaused = "false";
      this.dispatchEvent(new Event("play", { bubbles: true }));
      this.dispatchEvent(new Event("playing", { bubbles: true }));
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function () {
      this.dataset.mockPaused = "true";
      this.dataset.syntheticPause = "true";
      this.dispatchEvent(new Event("pause", { bubbles: true }));
      delete this.dataset.syntheticPause;
    };
    window.addEventListener(
      "pause",
      (event) => {
        if ((event.target as HTMLMediaElement).dataset?.syntheticPause !== "true")
          event.stopImmediatePropagation();
      },
      true,
    );
  });
  await page.clock.install();
  await page.goto(playbackPath, { waitUntil: "domcontentloaded" });

  const shell = page.locator("main.player-shell");
  const video = page.locator("video");
  await expect(video).toBeVisible({ timeout: 30_000 });
  await video.evaluate((element) => element.play());
  await expect.poll(() => video.evaluate((element) => element.paused)).toBe(false);

  await page.clock.fastForward(3_000);
  await expect(shell).not.toHaveClass(/controls-visible/);
  await page.mouse.move(640, 360);
  await expect(shell).toHaveClass(/controls-visible/);
  await page.waitForTimeout(200);
  await expect(page.getByRole("group", { name: "Playback quick controls" })).toHaveCount(0);
  const pauseButton = page.locator('.player-controls button[aria-label="Pause"]');
  await expect(pauseButton).toBeVisible();
  await pauseButton.click();
  const pausedControls = page.getByRole("group", { name: "Playback paused" });
  await expect(pausedControls).toBeVisible();
  await expect(pausedControls.getByRole("button", { name: "Play" })).toBeVisible();
  await expect(pausedControls.getByRole("button", { name: "Back 10 seconds" })).toBeVisible();
  await expect(pausedControls.getByRole("button", { name: "Forward 10 seconds" })).toBeVisible();
  await pausedControls.getByRole("button", { name: "Play" }).click();
  await page.mouse.move(700, 400);
  await expect(shell).toHaveClass(/controls-visible/);
  await expect(page.getByRole("group", { name: "Playback quick controls" })).toHaveCount(0);
  await video.evaluate((element) =>
    element.dispatchEvent(new Event("waiting")),
  );
  await expect(page.getByRole("status", { name: "Buffering" })).toBeVisible();
  await expect(shell).not.toHaveClass(/video-dimmed/);
  await video.evaluate((element) =>
    element.dispatchEvent(new Event("playing")),
  );
  await expect(page.getByRole("status", { name: "Buffering" })).toBeHidden();
  await page.clock.fastForward(3_000);
  await expect(shell).not.toHaveClass(/controls-visible/);
});

test("touch playback keeps central quick controls", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "touch-specific behavior");
  await page.goto(playbackPath, { waitUntil: "domcontentloaded" });
  const shell = page.locator("main.player-shell");
  const video = page.locator("video");
  await expect(video).toBeVisible({ timeout: 30_000 });
  await video.evaluate((element) => {
    Object.defineProperty(element, "paused", { configurable: true, value: false });
    element.dispatchEvent(new Event("playing", { bubbles: true }));
  });
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
  await expect(shell).toHaveClass(/video-dimmed/);

  await video.evaluate((element) =>
    element.dispatchEvent(new Event("waiting")),
  );
  await expect(quickControls).toBeHidden();
  await expect(page.getByRole("status", { name: "Buffering" })).toBeVisible();
  await expect(shell).not.toHaveClass(/video-dimmed/);
  await video.evaluate((element) =>
    element.dispatchEvent(new Event("playing")),
  );
  await expect(page.getByRole("status", { name: "Buffering" })).toBeHidden();
  await expect(quickControls).toBeVisible();
});
