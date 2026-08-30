import { expect, test, type Page } from "@playwright/test";
import { releaseActivePlaybackSession } from "./playback-cleanup";

const playbackPath =
  process.env.KHEYFLIX_PLAYBACK_TEST_PATH ||
  "/stream/701203060/0/shrek";
const trackPlaybackPath =
  process.env.KHEYFLIX_TRACK_TEST_PATH ||
  process.env.KHEYFLIX_PLAYBACK_TEST_PATH ||
  "/stream/660270988/3/shrek-2001-multilingual";
const safeMediaPath = (value: string) => new URL(value).pathname;
const controlOnlyMedia = {
  duration: 600,
  format: "matroska,webm",
  video: [{ index: 0, codec: "h264", width: 1920, height: 1080 }],
  audio: [
    {
      index: 1,
      codec: "aac",
      language: "eng",
      title: "English",
      channels: 2,
      default: true,
    },
    {
      index: 2,
      codec: "aac",
      language: "fra",
      title: "French",
      channels: 2,
      default: false,
    },
  ],
  subtitles: [
    {
      index: 3,
      codec: "webvtt",
      language: "eng",
      title: "English",
      supported: true,
    },
  ],
};

const mockControlOnlyPlayback = async (page: Page) => {
  let interceptedMediaRequests = 0;
  await page.addInitScript(() => {
    window.addEventListener(
      "error",
      (event) => {
        if (event.target instanceof HTMLMediaElement) event.stopImmediatePropagation();
      },
      true,
    );
  });
  await page.context().route(
    "**/api/debrid/**",
    async (route) => {
      interceptedMediaRequests += 1;
      if (new URL(route.request().url()).pathname.startsWith("/api/debrid/media/"))
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify(controlOnlyMedia),
        });
      else await route.fulfill({ status: 204 });
    },
  );
  // The route fulfillment prevents every matched request from reaching the
  // backend. Keep an assertion so a control-only test cannot accidentally
  // become a no-op while production playback runs beside it.
  return () => expect(interceptedMediaRequests).toBeGreaterThan(0);
};

test.afterEach(async ({ page }) => {
  // Release the current session before the next production playback profile
  // starts. Context teardown is best-effort, whereas this awaits the exact
  // close contract that protects the two-slot transcoder from test bleed.
  if (!page.isClosed()) {
    await releaseActivePlaybackSession(page);
    await page.goto("/", { waitUntil: "domcontentloaded", timeout: 15_000 }).catch(
      () => undefined,
    );
  }
});

test("a real movie starts and keeps streaming", async ({ page }) => {
  test.setTimeout(90_000);
  let blockingPreflights = 0;
  const mediaFailures: string[] = [];
  const playbackTelemetry: Array<Record<string, unknown>> = [];
  await page.route("**/api/playback/telemetry", async (route) => {
    try {
      playbackTelemetry.push(
        JSON.parse(route.request().postData() || "{}") as Record<string, unknown>,
      );
    } catch {}
    await route.fulfill({ status: 204 });
  });
  page.on("request", (request) => {
    if (request.method() === "HEAD" && request.url().includes("/api/debrid/stream/"))
      blockingPreflights += 1;
  });
  page.on("response", (response) => {
    if (
      response.status() >= 400 &&
      /\/api\/debrid\/(?:hls|media|stream|transcode)\//.test(response.url())
    ) {
      const path = safeMediaPath(response.url()),
        method = response.request().method();
      mediaFailures.push(`${response.status()} ${method} ${path}`);
      console.info(`[playback] ${response.status()} ${method} ${path}`);
    }
  });
  await page.goto(playbackPath, { waitUntil: "domcontentloaded" });

  const video = page.locator("video");
  // The full local app/transcoder topology can spend a few seconds compiling
  // its first route. The decoded-frame budget below remains strict; this only
  // prevents cold development-server startup from hiding the actual playback
  // assertion behind Playwright's generic five-second locator timeout.
  await expect(video).toBeVisible({ timeout: 30_000 });
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
  await expect
    .poll(
      () => playbackTelemetry.find((telemetry) => telemetry.event === "first_frame"),
      { timeout: 15_000 },
    )
    .toBeTruthy();
  const firstFrameTelemetry = playbackTelemetry.find(
    (telemetry) => telemetry.event === "first_frame",
  )!;
  const firstFrameIndex = playbackTelemetry.indexOf(firstFrameTelemetry);
  // Auto promotion is only allowed after a decoded bootstrap frame. A clean
  // startup therefore has one source attempt; recovery before that frame is
  // deliberately surfaced below instead of being counted as fast playback.
  expect(firstFrameTelemetry).toMatchObject({ event: "first_frame", attempt: 1 });
  expect(Number(firstFrameTelemetry.elapsedMs)).toBeLessThan(10_000);
  expect(
    playbackTelemetry
      .slice(0, firstFrameIndex)
      .some((telemetry) =>
        [
          "failure",
          "startup_retry",
          "startup_timeout",
          "bootstrap_eof_before_frame",
        ].includes(
          String(telemetry.event),
        ),
      ),
  ).toBe(false);
  expect([
    { phase: "bootstrap", quality: "bootstrap" },
    { phase: "standard", quality: "original" },
  ]).toContainEqual({
    phase: firstFrameTelemetry.phase,
    quality: firstFrameTelemetry.quality,
  });
  expect(blockingPreflights).toBe(0);
  expect(mediaFailures).toEqual([]);

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
  // Bootstrap is only for the first frame. Auto must promote to the source
  // quality while the user is watching, rather than remaining at startup HD.
  console.info(
    "[playback] automatic-quality state:",
    await page.locator("main.player-shell").evaluate((element) => ({
      phase: element.getAttribute("data-playback-phase"),
      quality: element.getAttribute("data-playback-quality"),
      sourceHeight: element.getAttribute("data-source-height"),
      state: element.getAttribute("data-playback-state"),
    })),
  );
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
  expect(mediaFailures).toEqual([]);
});

test("audio and subtitle controls expose translated tracks", async ({ page }) => {
  test.setTimeout(60_000);
  const assertSynthetic = await mockControlOnlyPlayback(page);
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
  assertSynthetic();
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
  const assertSynthetic = await mockControlOnlyPlayback(page);
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
  await expect(pausedControls.getByRole("button", { name: "Back 10 seconds" })).toBeVisible();
  await expect(pausedControls.getByRole("button", { name: "Forward 10 seconds" })).toBeVisible();
  const centralTransport = pausedControls.locator(".pause-overlay-play");
  await expect(centralTransport).toBeVisible();
  await centralTransport.click();
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
  assertSynthetic();
});

test("touch playback keeps central quick controls", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "touch-specific behavior");
  const assertSynthetic = await mockControlOnlyPlayback(page);
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
  assertSynthetic();
});
