import { expect, test, type Page } from "@playwright/test";
import { BOOTSTRAP_PROMOTION_DELAY_MS } from "../../app/lib/playback";
import { NATIVE_STARTUP_TIMEOUT_MS } from "../../app/lib/playback-recovery";

type Deferred = {
  promise: Promise<void>;
  resolve: () => void;
};

const deferred = (): Deferred => {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
};

type DelayedHandoff = {
  waitForRelease: Promise<void>;
  allowRelease: () => void;
  releaseStarted: () => boolean;
  freshSourceStartedEarly: () => boolean;
};

const sourceSession = (source: string) =>
  new URL(source, "http://localhost").searchParams.get("session");

const configureDelayedTranscoder = async (page: Page) => {
  let active:
    | {
        allowRelease: Deferred;
        oldSession: string;
        releaseObserved: Deferred;
        releaseStarted: boolean;
        released: boolean;
        freshSourceStartedEarly: boolean;
      }
    | undefined;
  await page.route("**/api/debrid/transcode/42/0**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "GET") {
      if (
        active &&
        !active.released &&
        url.searchParams.get("session") !== active.oldSession
      )
        active.freshSourceStartedEarly = true;
      await route.fulfill({ status: 204 });
      return;
    }
    if (
      request.method() === "POST" &&
      active &&
      url.searchParams.get("session") === active.oldSession &&
      !active.released
    ) {
      active.releaseStarted = true;
      active.releaseObserved.resolve();
      await active.allowRelease.promise;
      active.released = true;
    }
    await route.fulfill({ status: 204 });
  });
  return {
    arm(oldSession: string): DelayedHandoff {
      const allowRelease = deferred();
      const releaseObserved = deferred();
      active = {
        allowRelease,
        oldSession,
        releaseObserved,
        releaseStarted: false,
        released: false,
        freshSourceStartedEarly: false,
      };
      return {
        waitForRelease: releaseObserved.promise,
        allowRelease: allowRelease.resolve,
        releaseStarted: () => active?.releaseStarted ?? false,
        freshSourceStartedEarly: () => active?.freshSourceStartedEarly ?? false,
      };
    },
  };
};

const replacementMedia = {
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
  subtitles: [],
};

const isolateSyntheticMediaError = (page: Page) =>
  page.addInitScript(() => {
    window.addEventListener(
      "error",
      (event) => {
        const media = event.target;
        if (
          media instanceof HTMLMediaElement &&
          media.dataset.kheyflixSyntheticError !== "true"
        )
          event.stopImmediatePropagation();
      },
      true,
    );
  });

const installQueuedVideoFrameCallbacks = (page: Page) =>
  page.addInitScript(() => {
    const target = window as Window & {
      __kheyflixFrameCallbacks?: VideoFrameRequestCallback[];
    };
    const callbacks: VideoFrameRequestCallback[] = [];
    target.__kheyflixFrameCallbacks = callbacks;
    Object.defineProperty(HTMLVideoElement.prototype, "requestVideoFrameCallback", {
      configurable: true,
      value(callback: VideoFrameRequestCallback) {
        callbacks.push(callback);
        return callbacks.length;
      },
    });
    Object.defineProperty(HTMLVideoElement.prototype, "cancelVideoFrameCallback", {
      configurable: true,
      value() {},
    });
  });

const queuedVideoFrameCallbacks = (page: Page) =>
  page.evaluate(
    () =>
      (
        window as Window & {
          __kheyflixFrameCallbacks?: VideoFrameRequestCallback[];
        }
      ).__kheyflixFrameCallbacks?.length ?? 0,
  );

const invokeQueuedVideoFrameCallback = (page: Page, index: number) =>
  page.evaluate((callbackIndex) => {
    const callback = (
      window as Window & {
        __kheyflixFrameCallbacks?: VideoFrameRequestCallback[];
      }
    ).__kheyflixFrameCallbacks?.[callbackIndex];
    if (!callback) throw new Error(`Missing queued video frame callback ${callbackIndex}.`);
    callback(performance.now(), {} as VideoFrameCallbackMetadata);
  }, index);

test("a failed bootstrap switches to a non-bootstrap recovery source", async ({ page }) => {
  test.setTimeout(30_000);
  await isolateSyntheticMediaError(page);
  await page.route("**/api/debrid/media/42/0", async (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        duration: 120,
        format: "mov,mp4,m4a,3gp,3g2,mj2",
        video: [{ index: 0, codec: "h264", width: 1280, height: 720 }],
        audio: [
          {
            index: 1,
            codec: "aac",
            language: "eng",
            title: "English",
            channels: 2,
            default: true,
          },
        ],
        subtitles: [],
      }),
    }),
  );
  await page.route("**/api/debrid/transcode/42/0**", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fulfill({ status: 204 });
      return;
    }
    await route.fulfill({ status: 204 });
  });
  await page.route("**/api/debrid/stream/42/0", (route) =>
    route.fulfill({ status: 503, body: "synthetic direct retry" }),
  );

  await page.goto("/stream/42/0/bootstrap-recovery", {
    waitUntil: "domcontentloaded",
  });

  await expect(page.getByText("Starting · 360p · H264")).toBeVisible({
    timeout: 15_000,
  });
  const directRetry = page.waitForRequest(
    (request) =>
      request.method() === "GET" &&
      new URL(request.url()).pathname === "/api/debrid/stream/42/0",
  );
  await page.locator("video").evaluate((element) => {
    element.dataset.kheyflixSyntheticError = "true";
    element.dispatchEvent(new Event("error"));
    delete element.dataset.kheyflixSyntheticError;
  });
  await directRetry;
  await expect(page.locator("main.player-shell")).toHaveAttribute(
    "data-playback-phase",
    "standard",
  );
});

test("a known compatible title starts one sustained fixed profile without a bootstrap handoff", async ({ page }) => {
  test.setTimeout(30_000);
  await isolateSyntheticMediaError(page);
  await page.route("**/api/debrid/media/42/0", async (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        duration: 120,
        format: "matroska,webm",
        video: [{ index: 0, codec: "hevc", width: 1280, height: 720 }],
        audio: [
          {
            index: 1,
            codec: "dts",
            language: "eng",
            title: "English",
            channels: 2,
            default: true,
          },
        ],
        subtitles: [],
      }),
    }),
  );
  await page.route("**/api/debrid/transcode/42/0**", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fulfill({ status: 204 });
      return;
    }
    await route.fulfill({ status: 204 });
  });

  await page.goto("/stream/42/0/compatibility-bootstrap-recovery?compat=1", {
    waitUntil: "domcontentloaded",
  });

  const video = page.locator("video");
  await expect(video).toHaveAttribute("src", /\/api\/debrid\/transcode\/42\/0/);
  const initialSource = await video.getAttribute("src");
  expect(initialSource).toBeTruthy();
  await expect(page.locator("main.player-shell")).toHaveAttribute(
    "data-playback-phase",
    "standard",
  );
  await expect(page.locator("main.player-shell")).toHaveAttribute(
    "data-playback-quality",
    "480",
  );
  await page.waitForTimeout(7_000);
  await expect(video).toHaveAttribute("src", initialSource!);
});

test("a paused native HLS stream resumes from a fresh session at the saved position", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "laptop", "controlled native-HLS regression coverage");
  test.setTimeout(30_000);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "vendor", {
      configurable: true,
      value: "Apple Computer, Inc.",
    });
    Object.defineProperty(window, "MediaSource", {
      configurable: true,
      value: class {
        static isTypeSupported() {
          return true;
        }
      },
    });
    Object.defineProperty(HTMLMediaElement.prototype, "canPlayType", {
      configurable: true,
      value: () => "maybe",
    });
    Object.defineProperty(HTMLMediaElement.prototype, "paused", {
      configurable: true,
      get() {
        return (this as HTMLMediaElement).dataset.mockPaused !== "false";
      },
    });
    Object.defineProperty(HTMLMediaElement.prototype, "currentTime", {
      configurable: true,
      get() {
        return Number((this as HTMLMediaElement).dataset.mockCurrentTime || 0);
      },
      set(value) {
        (this as HTMLMediaElement).dataset.mockCurrentTime = String(value);
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
      this.dispatchEvent(new Event("pause", { bubbles: true }));
    };
    window.addEventListener(
      "error",
      (event) => {
        if (event.target instanceof HTMLMediaElement) event.stopImmediatePropagation();
      },
      true,
    );
  });
  await page.route("**/api/debrid/media/42/0", async (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        duration: 120,
        format: "matroska,webm",
        video: [{ index: 0, codec: "h264", width: 1280, height: 720 }],
        audio: [
          {
            index: 1,
            codec: "aac",
            language: "eng",
            title: "English",
            channels: 2,
            default: true,
          },
        ],
        subtitles: [],
      }),
    }),
  );
  await page.route("**/api/debrid/transcode/42/0**", async (route) => {
    await route.fulfill({ status: 204 });
  });
  await page.route("**/api/debrid/hls/42/0/**", async (route) => {
    await route.fulfill({ status: 204 });
  });

  await page.goto("/stream/42/0/native-hls-resume?compat=1", {
    waitUntil: "domcontentloaded",
  });
  const video = page.locator("video");
  await expect(video).toHaveAttribute("src", /\/api\/debrid\/hls\/42\/0\//);
  const before = await video.getAttribute("src");
  expect(before).toBeTruthy();
  await video.evaluate((element) => {
    element.currentTime = 27.25;
    element.dataset.mockPaused = "false";
    element.dispatchEvent(new Event("playing", { bubbles: true }));
  });
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const paused = page.getByRole("group", { name: "Playback paused" });
  await expect(paused).toBeVisible();

  const oldSession = new URL(before!, "http://localhost").pathname.split("/")[6];
  const oldSessionStop = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      new URL(request.url()).searchParams.get("session") === oldSession,
  );
  await paused.getByRole("button", { name: "Play", exact: true }).click();
  await oldSessionStop;
  await expect
    .poll(async () => {
      const value = await video.getAttribute("src");
      return value
        ? new URL(value, "http://localhost").searchParams.get("start")
        : null;
    })
    .toBe("27.25");
  const after = await video.getAttribute("src");
  const resumed = new URL(after!, "http://localhost");
  expect(resumed.searchParams.get("start")).toBe("27.25");
  expect(resumed.pathname.split("/")[6]).not.toBe(oldSession);
});

test("a finite native VOD chunk advances Safari at its exact absolute position", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "laptop", "controlled native-HLS regression coverage");
  test.setTimeout(30_000);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "vendor", {
      configurable: true,
      value: "Apple Computer, Inc.",
    });
    Object.defineProperty(HTMLMediaElement.prototype, "canPlayType", {
      configurable: true,
      value: () => "maybe",
    });
    // The controlled end event below is the behavior under test. Suppress
    // Chromium's parser error for the deliberately empty mocked playlist so
    // it cannot launch an unrelated recovery race.
    window.addEventListener(
      "error",
      (event) => {
        if (event.target instanceof HTMLMediaElement) event.stopImmediatePropagation();
      },
      true,
    );
  });
  await page.route("**/api/debrid/media/42/0", async (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        duration: 120,
        format: "matroska,webm",
        video: [{ index: 0, codec: "h264", width: 1280, height: 720 }],
        audio: [
          {
            index: 1,
            codec: "aac",
            language: "eng",
            title: "English",
            channels: 2,
            default: true,
          },
        ],
        subtitles: [],
      }),
    }),
  );
  await page.route("**/api/debrid/hls/42/0/**", async (route) => {
    await route.fulfill({ status: 204 });
  });
  const sessionStops: string[] = [];
  await page.route("**/api/debrid/transcode/42/0**", async (route) => {
    if (route.request().method() === "POST")
      sessionStops.push(
        new URL(route.request().url()).searchParams.get("session") || "",
      );
    await route.fulfill({ status: 204 });
  });

  await page.goto("/stream/42/0/native-vod-chunk?compat=1", {
    waitUntil: "domcontentloaded",
  });
  const video = page.locator("video");
  await expect(video).toHaveAttribute("src", /\/api\/debrid\/hls\/42\/0\//);
  await expect(video).toHaveJSProperty("controls", false);
  const first = await video.getAttribute("src");
  expect(first).toBeTruthy();
  const firstSession = new URL(first!, "http://localhost").pathname.split("/")[6];
  expect(new URL(first!, "http://localhost").searchParams.get("mode")).toBe(
    "native-vod",
  );

  await video.evaluate((element) => {
    Object.defineProperty(element, "duration", {
      configurable: true,
      value: 15,
    });
    Object.defineProperty(element, "currentTime", {
      configurable: true,
      value: 15,
    });
    element.dispatchEvent(new Event("ended", { bubbles: true }));
    element.dispatchEvent(new Event("ended", { bubbles: true }));
  });

  await expect.poll(
    () => sessionStops.filter((session) => session === firstSession).length,
  ).toBe(1);
  await expect.poll(async () => video.getAttribute("src")).not.toBe(first);
  const next = new URL((await video.getAttribute("src"))!, "http://localhost");
  expect(next.searchParams.get("start")).toBe("15");
  expect(next.searchParams.get("mode")).toBe("native-vod");
});

test("native VOD playback prewarms and adopts the next immutable chunk", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "laptop", "controlled native-HLS regression coverage");
  test.setTimeout(30_000);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "vendor", {
      configurable: true,
      value: "Apple Computer, Inc.",
    });
    Object.defineProperty(HTMLMediaElement.prototype, "canPlayType", {
      configurable: true,
      value: () => "maybe",
    });
    window.addEventListener(
      "error",
      (event) => {
        if (event.target instanceof HTMLMediaElement) event.stopImmediatePropagation();
      },
      true,
    );
  });
  await page.route("**/api/debrid/media/42/0", async (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        duration: 120,
        format: "matroska,webm",
        video: [{ index: 0, codec: "h264", width: 1280, height: 720 }],
        audio: [
          {
            index: 1,
            codec: "aac",
            language: "eng",
            title: "English",
            channels: 2,
            default: true,
          },
        ],
        subtitles: [],
      }),
    }),
  );
  await page.route("**/api/debrid/hls/42/0/**", async (route) => {
    await route.fulfill({
      contentType: "application/vnd.apple.mpegurl",
      body: "#EXTM3U\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXTINF:1,\nsegment00000.ts\n#EXT-X-ENDLIST\n",
    });
  });
  await page.route("**/api/debrid/transcode/42/0**", async (route) => {
    await route.fulfill({ status: 204 });
  });
  const playbackTelemetry: Array<Record<string, unknown>> = [];
  await page.route("**/api/playback/telemetry", async (route) => {
    playbackTelemetry.push(
      JSON.parse(route.request().postData() || "{}") as Record<string, unknown>,
    );
    await route.fulfill({ status: 204 });
  });

  await page.goto("/stream/42/0/native-vod-prewarm?compat=1", {
    waitUntil: "domcontentloaded",
  });
  const video = page.locator("video");
  await expect(video).toHaveAttribute("src", /\/api\/debrid\/hls\/42\/0\//);
  const initialSource = await video.getAttribute("src");
  expect(initialSource).toBeTruthy();
  const initialSession = new URL(initialSource!, "http://localhost").pathname.split("/")[6];
  const prewarmRequest = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return (
      request.method() === "GET" &&
      url.pathname.startsWith("/api/debrid/hls/42/0/") &&
      url.searchParams.get("start") === "15" &&
      url.pathname.split("/")[6] !== initialSession
    );
  });
  await video.evaluate((element) => {
    Object.defineProperty(element, "duration", {
      configurable: true,
      value: 15,
    });
    // WebKit can report a source as playable after a handoff without a new
    // duration value. The player still has to re-arm its successor prewarm.
    element.dispatchEvent(new Event("loadeddata", { bubbles: true }));
    element.dispatchEvent(new Event("playing", { bubbles: true }));
  });
  const prewarm = new URL((await prewarmRequest).url());
  const preparedSession = prewarm.pathname.split("/")[6];
  expect(prewarm.searchParams.get("mode")).toBe("native-vod-warm");

  const oldSessionStop = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      new URL(request.url()).searchParams.get("session") === initialSession,
  );
  await video.evaluate((element) => {
    Object.defineProperty(element, "currentTime", {
      configurable: true,
      value: 15,
    });
    element.dispatchEvent(new Event("ended", { bubbles: true }));
  });
  await oldSessionStop;
  await expect.poll(async () => video.getAttribute("src")).toContain(
    `/${preparedSession}/master.m3u8`,
  );
  await video.evaluate((element) => {
    element.dispatchEvent(new Event("waiting", { bubbles: true }));
    element.dispatchEvent(new Event("playing", { bubbles: true }));
  });
  await expect.poll(() =>
    playbackTelemetry.some((entry) => entry.event === "native_vod_handoff"),
  ).toBe(true);
  expect(
    playbackTelemetry.find((entry) => entry.event === "native_vod_handoff"),
  ).toMatchObject({ rebufferCount: 0 });
});

test("native HLS Auto preserves its stable 480p session instead of interrupting Safari", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "laptop", "controlled native-HLS regression coverage");
  test.setTimeout(30_000);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "vendor", {
      configurable: true,
      value: "Apple Computer, Inc.",
    });
    Object.defineProperty(window, "MediaSource", {
      configurable: true,
      value: class {
        static isTypeSupported() {
          return true;
        }
      },
    });
    Object.defineProperty(HTMLMediaElement.prototype, "canPlayType", {
      configurable: true,
      value: () => "maybe",
    });
    Object.defineProperty(HTMLMediaElement.prototype, "paused", {
      configurable: true,
      get() {
        return (this as HTMLMediaElement).dataset.mockPaused !== "false";
      },
    });
    Object.defineProperty(HTMLMediaElement.prototype, "currentTime", {
      configurable: true,
      get() {
        return Number((this as HTMLMediaElement).dataset.mockCurrentTime || 0);
      },
      set(value) {
        (this as HTMLMediaElement).dataset.mockCurrentTime = String(value);
      },
    });
    HTMLMediaElement.prototype.play = function () {
      this.dataset.mockPaused = "false";
      this.dispatchEvent(new Event("play", { bubbles: true }));
      this.dispatchEvent(new Event("playing", { bubbles: true }));
      return Promise.resolve();
    };
    window.addEventListener(
      "error",
      (event) => {
        if (event.target instanceof HTMLMediaElement) event.stopImmediatePropagation();
      },
      true,
    );
  });
  await page.route("**/api/debrid/media/42/0", async (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        duration: 120,
        format: "mov,mp4,m4a,3gp,3g2,mj2",
        video: [{ index: 0, codec: "h264", width: 1280, height: 720 }],
        audio: [
          {
            index: 1,
            codec: "aac",
            language: "eng",
            title: "English",
            channels: 2,
            default: true,
          },
        ],
        subtitles: [],
      }),
    }),
  );
  await page.route("**/api/debrid/transcode/42/0**", async (route) => {
    await route.fulfill({ status: 204 });
  });
  await page.route("**/api/debrid/hls/42/0/**", async (route) => {
    await route.fulfill({ status: 204 });
  });
  let directRequests = 0;
  await page.route("**/api/debrid/stream/42/0", async (route) => {
    directRequests += 1;
    await route.fulfill({ status: 503, body: "native HLS must not go direct" });
  });

  await page.goto("/stream/42/0/native-hls-auto-promotion", {
    waitUntil: "domcontentloaded",
  });
  const video = page.locator("video");
  await expect(video).toHaveAttribute("src", /\/api\/debrid\/hls\/42\/0\//);
  const before = await video.getAttribute("src");
  expect(before).toBeTruthy();
  const oldSession = new URL(before!, "http://localhost").pathname.split("/")[6];
  let sessionReleases = 0;
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      request.method() === "POST" &&
      url.pathname === "/api/debrid/transcode/42/0" &&
      url.searchParams.get("session") === oldSession
    )
      sessionReleases += 1;
  });
  await video.evaluate((element) => {
    element.currentTime = 41.5;
    element.dispatchEvent(new Event("timeupdate", { bubbles: true }));
  });
  // Let React publish the saved position before Auto schedules its promotion.
  await page.waitForTimeout(50);
  await video.evaluate((element) => {
    element.dataset.mockPaused = "false";
    element.dispatchEvent(new Event("playing", { bubbles: true }));
  });
  await page.waitForTimeout(7_000);
  await expect(video).toHaveAttribute("src", before!);
  await expect(page.locator("main.player-shell")).toHaveAttribute(
    "data-playback-quality",
    "480",
  );
  expect(sessionReleases).toBe(0);
  expect(directRequests).toBe(0);
});

test("a terminal native HLS failure releases its latest session", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "laptop", "controlled native-HLS regression coverage");
  test.setTimeout(30_000);
  await isolateSyntheticMediaError(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "vendor", {
      configurable: true,
      value: "Apple Computer, Inc.",
    });
    Object.defineProperty(window, "MediaSource", {
      configurable: true,
      value: class {
        static isTypeSupported() {
          return true;
        }
      },
    });
    Object.defineProperty(HTMLMediaElement.prototype, "canPlayType", {
      configurable: true,
      value: () => "maybe",
    });
  });
  await page.route("**/api/debrid/media/42/0", async (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(replacementMedia),
    }),
  );
  await page.route("**/api/debrid/hls/42/0/**", async (route) => {
    await route.fulfill({ status: 204 });
  });
  await page.route("**/api/debrid/transcode/42/0**", async (route) => {
    await route.fulfill({ status: 204 });
  });

  await page.goto("/stream/42/0/native-hls-terminal-release?compat=1", {
    waitUntil: "domcontentloaded",
  });
  const video = page.locator("video");
  await expect(video).toHaveAttribute("src", /\/api\/debrid\/hls\/42\/0\//);
  const firstSource = await video.getAttribute("src");
  expect(firstSource).toBeTruthy();
  const firstSession = new URL(firstSource!, "http://localhost").pathname.split("/")[6];
  const firstStop = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      new URL(request.url()).searchParams.get("session") === firstSession,
  );
  await video.evaluate((element) => {
    element.dataset.kheyflixSyntheticError = "true";
    element.dispatchEvent(new Event("error"));
    delete element.dataset.kheyflixSyntheticError;
  });
  await firstStop;
  await expect.poll(() => video.getAttribute("src")).not.toBe(firstSource);
  const secondSource = await video.getAttribute("src");
  expect(secondSource).toBeTruthy();
  const secondSession = new URL(secondSource!, "http://localhost").pathname.split("/")[6];
  const terminalStop = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      new URL(request.url()).searchParams.get("session") === secondSession,
  );
  await video.evaluate((element) => {
    element.dataset.kheyflixSyntheticError = "true";
    element.dispatchEvent(new Event("error"));
    delete element.dataset.kheyflixSyntheticError;
  });

  await terminalStop;
  await expect(page.getByRole("alert")).toBeVisible();
});

test("late metadata never mutates a running compatible source", async ({ page }) => {
  test.setTimeout(30_000);
  await isolateSyntheticMediaError(page);
  await page.addInitScript(() => {
    localStorage.setItem("kheyflix:audio-language:v1", "fra");
  });
  const releaseMetadata = deferred();
  await page.route("**/api/debrid/media/42/0", async (route) => {
    await releaseMetadata.promise;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(replacementMedia),
    });
  });
  let sourceRequests = 0;
  let sessionStops = 0;
  await page.route("**/api/debrid/transcode/42/0**", async (route) => {
    if (route.request().method() === "GET") sourceRequests += 1;
    if (route.request().method() === "POST") sessionStops += 1;
    await route.fulfill({ status: 204 });
  });

  await page.goto("/stream/42/0/late-metadata?compat=1", {
    waitUntil: "domcontentloaded",
  });
  const video = page.locator("video");
  await expect(video).toHaveAttribute("src", /\/api\/debrid\/transcode\/42\/0/);
  const initialSource = await video.getAttribute("src");
  expect(initialSource).toBeTruthy();

  releaseMetadata.resolve();
  await expect(page.getByRole("button", { name: "Audio languages" })).toBeVisible();
  await page.waitForTimeout(250);

  expect(sourceRequests).toBe(1);
  expect(sessionStops).toBe(0);
  await expect(video).toHaveAttribute("src", initialSource!);
});

test("a compatible subtitle choice uses a sidecar track without rotating playback", async ({
  page,
}) => {
  test.setTimeout(30_000);
  await isolateSyntheticMediaError(page);
  await page.route("**/api/debrid/media/42/0", async (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ...replacementMedia,
        subtitles: [
          {
            index: 3,
            codec: "subrip",
            language: "eng",
            title: "English",
            supported: true,
          },
        ],
      }),
    }),
  );
  let sourceRequests = 0;
  let sessionStops = 0;
  await page.route("**/api/debrid/transcode/42/0**", async (route) => {
    if (route.request().method() === "GET") sourceRequests += 1;
    if (route.request().method() === "POST") sessionStops += 1;
    await route.fulfill({ status: 204 });
  });
  await page.route("**/api/debrid/subtitle/42/0/3**", async (route) =>
    route.fulfill({
      contentType: "text/vtt",
      body: "WEBVTT\n\n00:00.000 --> 00:01.000\nHello\n",
    }),
  );

  await page.goto("/stream/42/0/sidecar-subtitle?compat=1", {
    waitUntil: "domcontentloaded",
  });
  const video = page.locator("video");
  await expect(video).toHaveAttribute("src", /\/api\/debrid\/transcode\/42\/0/);
  const initialSource = await video.getAttribute("src");
  expect(initialSource).toBeTruthy();
  await page
    .getByRole("button", { name: "Subtitles" })
    .evaluate((button: HTMLButtonElement) => button.click());
  await page
    .getByRole("dialog", { name: "Subtitles" })
    .getByRole("button", { name: "English" })
    .evaluate((button: HTMLButtonElement) => button.click());

  await expect(video.locator("track")).toHaveAttribute(
    "src",
    /\/api\/debrid\/subtitle\/42\/0\/3/,
  );
  await page.waitForTimeout(150);
  expect(sourceRequests).toBe(1);
  expect(sessionStops).toBe(0);
  await expect(video).toHaveAttribute("src", initialSource!);
});

test("native HLS waits for its first frame before fetching an optional subtitle sidecar", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "laptop", "controlled native-HLS regression coverage");
  test.setTimeout(30_000);
  await isolateSyntheticMediaError(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "vendor", {
      configurable: true,
      value: "Apple Computer, Inc.",
    });
    Object.defineProperty(HTMLMediaElement.prototype, "canPlayType", {
      configurable: true,
      value: () => "maybe",
    });
  });
  await page.route("**/api/debrid/media/42/0", async (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ...replacementMedia,
        subtitles: [
          {
            index: 3,
            codec: "subrip",
            language: "eng",
            title: "English",
            supported: true,
          },
        ],
      }),
    }),
  );
  await page.route("**/api/debrid/hls/42/0/**", async (route) =>
    route.fulfill({
      contentType: "application/vnd.apple.mpegurl",
      body: "#EXTM3U\n#EXT-X-VERSION:3\n",
    }),
  );
  await page.route("**/api/debrid/transcode/42/0**", async (route) =>
    route.fulfill({ status: 204 }),
  );
  await page.route("**/api/debrid/subtitle/42/0/3**", async (route) =>
    route.fulfill({ contentType: "text/vtt", body: "WEBVTT\n" }),
  );

  await page.goto("/stream/42/0/native-subtitle-priority?compat=1", {
    waitUntil: "domcontentloaded",
  });
  const video = page.locator("video");
  await expect(video).toHaveAttribute("src", /\/api\/debrid\/hls\/42\/0/);
  await expect(page.getByRole("button", { name: "Subtitles" })).toBeVisible();
  await expect(video.locator("track")).toHaveCount(0);

  await video.evaluate((element) =>
    element.dispatchEvent(new Event("playing", { bubbles: true })),
  );
  await expect(video.locator("track")).toHaveAttribute(
    "src",
    /\/api\/debrid\/subtitle\/42\/0\/3/,
  );
});

test("next episode waits for release and cannot override a later Back action", async ({
  page,
}) => {
  test.setTimeout(30_000);
  await isolateSyntheticMediaError(page);
  await page.addInitScript(() => {
    sessionStorage.setItem(
      "kheyflix:playback-queue:v1",
      JSON.stringify([
        {
          titleId: "series-42",
          seriesId: "series-42",
          seriesTitle: "A Real Series",
          magnetId: 42,
          file: 0,
          season: 1,
          episode: 1,
          label: "Episode 1",
        },
        {
          titleId: "series-42",
          seriesId: "series-42",
          seriesTitle: "A Real Series",
          magnetId: 43,
          file: 1,
          season: 1,
          episode: 2,
          label: "Episode 2",
        },
      ]),
    );
  });
  await page.route("**/api/debrid/media/**", async (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(replacementMedia),
    }),
  );
  const handoffs = await configureDelayedTranscoder(page);
  let nextSourceStarted = false;
  await page.route("**/api/debrid/transcode/43/1**", async (route) => {
    if (route.request().method() === "GET") nextSourceStarted = true;
    await route.fulfill({ status: 204 });
  });

  await page.goto("/stream/42/0/a-real-series-episode-1?compat=1", {
    waitUntil: "domcontentloaded",
  });
  const video = page.locator("video");
  await expect(video).toHaveAttribute("src", /\/api\/debrid\/transcode\/42\/0/);
  const source = await video.getAttribute("src");
  expect(source).toBeTruthy();
  const handoff = handoffs.arm(sourceSession(source!));

  await page.getByRole("button", { name: "Next episode" }).click();
  await handoff.waitForRelease;
  await page.waitForTimeout(150);
  await expect(page).toHaveURL(/\/stream\/42\/0\//);
  expect(nextSourceStarted).toBe(false);

  await page.getByRole("button", { name: "Back to browsing" }).click();
  await expect(page).toHaveURL(/\/$/);
  handoff.allowRelease();
  await page.waitForTimeout(250);
  await expect(page).toHaveURL(/\/$/);
  expect(nextSourceStarted).toBe(false);
});

test("a later player choice is coalesced while the active session releases", async ({
  page,
}) => {
  test.setTimeout(30_000);
  await isolateSyntheticMediaError(page);
  await page.route("**/api/debrid/media/42/0", async (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(replacementMedia),
    }),
  );
  const handoffs = await configureDelayedTranscoder(page);
  await page.goto("/stream/42/0/coalesced-choice?compat=1", {
    waitUntil: "domcontentloaded",
  });
  const video = page.locator("video");
  await expect(video).toHaveAttribute("src", /\/api\/debrid\/transcode\/42\/0/);
  const source = await video.getAttribute("src");
  expect(source).toBeTruthy();
  const oldSession = sourceSession(source!);
  expect(oldSession).toBeTruthy();
  const handoff = handoffs.arm(oldSession!);
  const finalSource = page.waitForRequest((request) => {
    if (request.method() !== "GET") return false;
    const url = new URL(request.url());
    return (
      url.pathname === "/api/debrid/transcode/42/0" &&
      url.searchParams.get("session") !== oldSession &&
      url.searchParams.get("quality") === "original"
    );
  });

  await page
    .getByRole("button", { name: "Playback settings" })
    .evaluate((button: HTMLButtonElement) => button.click());
  await page
    .getByRole("dialog", { name: "Playback settings" })
    .getByRole("button", { name: "720p HD" })
    .evaluate((button: HTMLButtonElement) => button.click());
  await handoff.waitForRelease;
  await page
    .getByRole("dialog", { name: "Playback settings" })
    .getByRole("button", { name: "Original" })
    .evaluate((button: HTMLButtonElement) => button.click());
  await page.waitForTimeout(150);
  expect(handoff.freshSourceStartedEarly()).toBe(false);
  handoff.allowRelease();
  await finalSource;
  await expect(page.locator("main.player-shell")).toHaveAttribute(
    "data-playback-quality",
    "original",
  );
});

test("seek, audio, and quality changes wait for the active transcoder session to release", async ({
  page,
}) => {
  test.setTimeout(45_000);
  await isolateSyntheticMediaError(page);
  await page.route("**/api/debrid/media/42/0", async (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(replacementMedia),
    }),
  );
  const handoffs = await configureDelayedTranscoder(page);
  await page.goto("/stream/42/0/release-order?compat=1", {
    waitUntil: "domcontentloaded",
  });
  const video = page.locator("video");
  await expect(video).toHaveAttribute("src", /\/api\/debrid\/transcode\/42\/0/);
  await video.evaluate((element) =>
    element.dispatchEvent(new Event("playing", { bubbles: true })),
  );

  const assertOrderedHandoff = async (trigger: () => Promise<void>) => {
    const before = await video.getAttribute("src");
    expect(before).toBeTruthy();
    const oldSession = sourceSession(before!);
    expect(oldSession).toBeTruthy();
    const handoff = handoffs.arm(oldSession!);
    const replacementRequest = page.waitForRequest((request) =>
      request.method() === "GET" &&
      new URL(request.url()).pathname === "/api/debrid/transcode/42/0" &&
      new URL(request.url()).searchParams.get("session") !== oldSession,
    );

    await trigger();
    await handoff.waitForRelease;
    await page.waitForTimeout(150);
    expect(handoff.freshSourceStartedEarly()).toBe(false);
    handoff.allowRelease();
    await replacementRequest;
    await expect.poll(() => video.getAttribute("src")).not.toBe(before);
  };

  await assertOrderedHandoff(async () => {
    await page
      .locator(".player-controls")
      .getByRole("button", { name: "Forward 10 seconds" })
      .evaluate((button: HTMLButtonElement) => button.click());
  });
  await assertOrderedHandoff(async () => {
    await page
      .getByRole("button", { name: "Audio languages" })
      .evaluate((button: HTMLButtonElement) => button.click());
    await page
      .getByRole("dialog", { name: "Audio languages" })
      .getByRole("button", { name: /Français/ })
      .evaluate((button: HTMLButtonElement) => button.click());
  });
  await assertOrderedHandoff(async () => {
    await page
      .getByRole("button", { name: "Playback settings" })
      .evaluate((button: HTMLButtonElement) => button.click());
    await page
      .getByRole("dialog", { name: "Playback settings" })
      .getByRole("button", { name: "720p HD" })
      .evaluate((button: HTMLButtonElement) => button.click());
  });
});

test("automatic desktop quality promotion waits for a decoded bootstrap frame and its release", async ({
  page,
}) => {
  test.setTimeout(30_000);
  await page.clock.install();
  await installQueuedVideoFrameCallbacks(page);
  await isolateSyntheticMediaError(page);
  await page.route("**/api/debrid/media/42/0", async (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ...replacementMedia,
        format: "mov,mp4,m4a,3gp,3g2,mj2",
      }),
    }),
  );
  const handoffs = await configureDelayedTranscoder(page);
  await page.route("**/api/debrid/stream/42/0", async (route) => {
    await route.fulfill({ status: 204 });
  });
  const playbackTelemetry: Array<Record<string, unknown>> = [];
  await page.route("**/api/playback/telemetry", async (route) => {
    playbackTelemetry.push(
      JSON.parse(route.request().postData() || "{}") as Record<string, unknown>,
    );
    await route.fulfill({ status: 204 });
  });
  await page.goto("/stream/42/0/automatic-release-order", {
    waitUntil: "domcontentloaded",
  });
  const video = page.locator("video");
  await expect(video).toHaveAttribute("src", /\/api\/debrid\/transcode\/42\/0/);
  const before = await video.getAttribute("src");
  expect(before).toBeTruthy();
  const oldSession = sourceSession(before!);
  expect(oldSession).toBeTruthy();
  const handoff = handoffs.arm(oldSession!);
  const replacementRequest = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return (
      request.method() === "GET" &&
      url.pathname === "/api/debrid/stream/42/0"
    );
  });
  await video.evaluate((element) =>
    element.dispatchEvent(new Event("playing", { bubbles: true })),
  );

  await expect.poll(() => queuedVideoFrameCallbacks(page)).toBe(1);
  await page.clock.fastForward(BOOTSTRAP_PROMOTION_DELAY_MS);
  expect(handoff.releaseStarted()).toBe(false);

  await invokeQueuedVideoFrameCallback(page, 0);
  await expect
    .poll(() =>
      playbackTelemetry.find((telemetry) => telemetry.event === "first_frame"),
    )
    .toMatchObject({ attempt: 1, phase: "bootstrap", quality: "bootstrap" });

  await handoff.waitForRelease;
  await page.waitForTimeout(150);
  expect(handoff.freshSourceStartedEarly()).toBe(false);
  handoff.allowRelease();
  await replacementRequest;
  await expect(page.locator("main.player-shell")).toHaveAttribute(
    "data-playback-quality",
    "original",
  );
});

test("a bootstrap EOF before its first decoded frame is observable and retains viewer startup timing", async ({
  page,
}) => {
  test.setTimeout(30_000);
  await page.clock.install();
  await installQueuedVideoFrameCallbacks(page);
  await isolateSyntheticMediaError(page);
  await page.route("**/api/debrid/media/42/0", async (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ...replacementMedia,
        format: "mov,mp4,m4a,3gp,3g2,mj2",
      }),
    }),
  );
  const handoffs = await configureDelayedTranscoder(page);
  await page.route("**/api/debrid/stream/42/0", async (route) => {
    await route.fulfill({ status: 204 });
  });
  const playbackTelemetry: Array<Record<string, unknown>> = [];
  await page.route("**/api/playback/telemetry", async (route) => {
    playbackTelemetry.push(
      JSON.parse(route.request().postData() || "{}") as Record<string, unknown>,
    );
    await route.fulfill({ status: 204 });
  });

  await page.goto("/stream/42/0/bootstrap-eof-before-frame", {
    waitUntil: "domcontentloaded",
  });
  const video = page.locator("video");
  await expect(video).toHaveAttribute("src", /\/api\/debrid\/transcode\/42\/0/);
  const before = await video.getAttribute("src");
  expect(before).toBeTruthy();
  const oldSession = sourceSession(before!);
  expect(oldSession).toBeTruthy();
  const handoff = handoffs.arm(oldSession!);
  const replacementRequest = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return request.method() === "GET" && url.pathname === "/api/debrid/stream/42/0";
  });

  await video.evaluate((element) =>
    element.dispatchEvent(new Event("playing", { bubbles: true })),
  );
  await expect.poll(() => queuedVideoFrameCallbacks(page)).toBe(1);
  await page.clock.fastForward(2_000);
  await video.evaluate((element) =>
    element.dispatchEvent(new Event("ended", { bubbles: true })),
  );

  await handoff.waitForRelease;
  expect(handoff.freshSourceStartedEarly()).toBe(false);
  handoff.allowRelease();
  await replacementRequest;
  await expect(page.locator("main.player-shell")).toHaveAttribute(
    "data-playback-quality",
    "original",
  );
  await expect
    .poll(() =>
      playbackTelemetry.find(
        (telemetry) => telemetry.event === "bootstrap_eof_before_frame",
      ),
    )
    .toMatchObject({ attempt: 1, phase: "bootstrap", quality: "bootstrap" });

  // The callback queued by the failed bootstrap must not be attributed to the
  // replacement source. It never produces a first-frame metric.
  await invokeQueuedVideoFrameCallback(page, 0);
  await page.waitForTimeout(50);
  expect(
    playbackTelemetry.some((telemetry) => telemetry.event === "first_frame"),
  ).toBe(false);

  await video.evaluate((element) =>
    element.dispatchEvent(new Event("playing", { bubbles: true })),
  );
  await expect.poll(() => queuedVideoFrameCallbacks(page)).toBe(2);
  await invokeQueuedVideoFrameCallback(page, 1);
  await expect
    .poll(() =>
      playbackTelemetry.find((telemetry) => telemetry.event === "first_frame"),
    )
    .toMatchObject({ attempt: 2, phase: "standard", quality: "original" });
  const firstFrame = playbackTelemetry.find(
    (telemetry) => telemetry.event === "first_frame",
  )!;
  expect(Number(firstFrame.elapsedMs)).toBeGreaterThanOrEqual(2_000);
  expect(Number(firstFrame.sourceElapsedMs)).toBeLessThan(
    Number(firstFrame.elapsedMs),
  );
  expect(
    Number(await page.locator("main.player-shell").getAttribute("data-first-frame-ms")),
  ).toBeGreaterThanOrEqual(2_000);
  expect(
    playbackTelemetry.filter((telemetry) => telemetry.event === "first_frame"),
  ).toHaveLength(1);
});

test("first-frame telemetry includes media resolution before a direct source starts", async ({
  page,
}) => {
  test.setTimeout(30_000);
  await page.clock.install();
  await installQueuedVideoFrameCallbacks(page);
  await isolateSyntheticMediaError(page);
  await page.addInitScript(() => {
    localStorage.setItem(
      "kheyflix:playback-preferences:v1:stream-42",
      JSON.stringify({
        audioLanguage: "eng",
        subtitleSize: "medium",
        qualityMode: "original",
        playbackRate: 1,
        audioSync: 0,
      }),
    );
  });
  const releaseMetadata = deferred();
  await page.route("**/api/debrid/media/42/0", async (route) => {
    await releaseMetadata.promise;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ...replacementMedia,
        format: "mov,mp4,m4a,3gp,3g2,mj2",
      }),
    });
  });
  await page.route("**/api/debrid/stream/42/0", async (route) => {
    await route.fulfill({ status: 204 });
  });
  const playbackTelemetry: Array<Record<string, unknown>> = [];
  await page.route("**/api/playback/telemetry", async (route) => {
    playbackTelemetry.push(
      JSON.parse(route.request().postData() || "{}") as Record<string, unknown>,
    );
    await route.fulfill({ status: 204 });
  });

  await page.goto("/stream/42/0/delayed-direct-start", {
    waitUntil: "domcontentloaded",
  });
  const video = page.locator("video");
  await expect(video).not.toHaveAttribute("src", /\/api\/debrid\//);
  await page.clock.fastForward(3_000);
  releaseMetadata.resolve();
  await expect(video).toHaveAttribute("src", /\/api\/debrid\/stream\/42\/0/);

  await video.evaluate((element) =>
    element.dispatchEvent(new Event("playing", { bubbles: true })),
  );
  await expect.poll(() => queuedVideoFrameCallbacks(page)).toBe(1);
  await invokeQueuedVideoFrameCallback(page, 0);
  await expect
    .poll(() =>
      playbackTelemetry.find((telemetry) => telemetry.event === "first_frame"),
    )
    .toMatchObject({ attempt: 1, phase: "standard", quality: "original" });
  const firstFrame = playbackTelemetry.find(
    (telemetry) => telemetry.event === "first_frame",
  )!;
  expect(Number(firstFrame.elapsedMs)).toBeGreaterThanOrEqual(3_000);
  expect(Number(firstFrame.sourceElapsedMs)).toBeLessThan(
    Number(firstFrame.elapsedMs),
  );
  expect(
    Number(await page.locator("main.player-shell").getAttribute("data-first-frame-ms")),
  ).toBeGreaterThanOrEqual(3_000);
});

test("iPhone first-frame telemetry starts at the trusted play tap", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "controlled iPhone activation coverage");
  test.setTimeout(30_000);
  await page.clock.install();
  await installQueuedVideoFrameCallbacks(page);
  await isolateSyntheticMediaError(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "vendor", {
      configurable: true,
      value: "Apple Computer, Inc.",
    });
    Object.defineProperty(HTMLMediaElement.prototype, "canPlayType", {
      configurable: true,
      value: () => "maybe",
    });
    HTMLMediaElement.prototype.play = () => Promise.resolve();
  });
  await page.route("**/api/debrid/media/42/0", async (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(replacementMedia),
    }),
  );
  await page.route("**/api/debrid/hls/42/0/**", async (route) => {
    await route.fulfill({ status: 204 });
  });
  await page.route("**/api/debrid/transcode/42/0**", async (route) => {
    await route.fulfill({ status: 204 });
  });
  const playbackTelemetry: Array<Record<string, unknown>> = [];
  await page.route("**/api/playback/telemetry", async (route) => {
    playbackTelemetry.push(
      JSON.parse(route.request().postData() || "{}") as Record<string, unknown>,
    );
    await route.fulfill({ status: 204 });
  });

  await page.goto("/stream/42/0/ios-viewer-start", {
    waitUntil: "domcontentloaded",
  });
  const video = page.locator("video");
  await expect(page.getByRole("button", { name: "Tap to play" })).toBeVisible();
  await page.clock.fastForward(3_000);
  await page.getByRole("button", { name: "Tap to play" }).click();
  await expect
    .poll(() => video.evaluate((element) => element.currentSrc))
    .toContain("/api/debrid/hls/42/0/");
  await page.clock.fastForward(2_000);
  await video.evaluate((element) =>
    element.dispatchEvent(new Event("playing", { bubbles: true })),
  );
  await expect.poll(() => queuedVideoFrameCallbacks(page)).toBe(1);
  await invokeQueuedVideoFrameCallback(page, 0);
  await expect
    .poll(() =>
      playbackTelemetry.find((telemetry) => telemetry.event === "first_frame"),
    )
    .toMatchObject({ attempt: 1, phase: "standard", quality: "480" });
  const firstFrame = playbackTelemetry.find(
    (telemetry) => telemetry.event === "first_frame",
  )!;
  expect(Number(firstFrame.elapsedMs)).toBeGreaterThanOrEqual(2_000);
  expect(Number(firstFrame.elapsedMs)).toBeLessThan(3_000);
});

test("an Apple HLS startup deadline stays absolute when metadata resolves", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "laptop", "controlled native-HLS regression coverage");
  test.setTimeout(30_000);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "vendor", {
      configurable: true,
      value: "Apple Computer, Inc.",
    });
    Object.defineProperty(window, "MediaSource", {
      configurable: true,
      value: class {
        static isTypeSupported() {
          return true;
        }
      },
    });
    Object.defineProperty(HTMLMediaElement.prototype, "canPlayType", {
      configurable: true,
      value: () => "maybe",
    });
    window.addEventListener(
      "error",
      (event) => {
        if (event.target instanceof HTMLMediaElement) event.stopImmediatePropagation();
      },
      true,
    );
  });
  await page.clock.install();
  const releaseMetadata = deferred();
  await page.route("**/api/debrid/media/42/0", async (route) => {
    await releaseMetadata.promise;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(replacementMedia),
    });
  });
  await page.route("**/api/debrid/hls/42/0/**", async (route) =>
    route.fulfill({
      contentType: "application/vnd.apple.mpegurl",
      body: "#EXTM3U\n#EXT-X-VERSION:3\n",
    }),
  );
  let oldSession = "";
  let oldSessionStops = 0;
  await page.route("**/api/debrid/transcode/42/0**", async (route) => {
    if (
      route.request().method() === "POST" &&
      new URL(route.request().url()).searchParams.get("session") === oldSession
    )
      oldSessionStops += 1;
    await route.fulfill({ status: 204 });
  });

  await page.goto("/stream/42/0/pending-native-hls?compat=1", {
    waitUntil: "domcontentloaded",
  });
  const video = page.locator("video");
  await expect(video).toHaveAttribute("src", /\/api\/debrid\/hls\/42\/0/);
  const before = await video.getAttribute("src");
  expect(before).toBeTruthy();
  oldSession = new URL(before!, "http://localhost").pathname.split("/")[6];
  await page.clock.fastForward(6_000);
  releaseMetadata.resolve();
  await expect(page.getByRole("button", { name: "Audio languages" })).toBeVisible();
  // Metadata resolves halfway through the original source budget. The
  // fallback must happen soon after that, rather than granting a second full
  // native-HLS timeout from the metadata render.
  await page.clock.fastForward(NATIVE_STARTUP_TIMEOUT_MS - 6_000 + 500);
  await expect.poll(() => oldSessionStops).toBeGreaterThanOrEqual(1);
  await expect.poll(() => video.getAttribute("src")).not.toBe(before);
});

test("a normal post-start rebuffer does not re-arm the Apple startup watchdog", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "laptop", "controlled native-HLS regression coverage");
  test.setTimeout(30_000);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "vendor", {
      configurable: true,
      value: "Apple Computer, Inc.",
    });
    Object.defineProperty(window, "MediaSource", {
      configurable: true,
      value: class {
        static isTypeSupported() {
          return true;
        }
      },
    });
    Object.defineProperty(HTMLMediaElement.prototype, "canPlayType", {
      configurable: true,
      value: () => "maybe",
    });
    window.addEventListener(
      "error",
      (event) => {
        if (event.target instanceof HTMLMediaElement) event.stopImmediatePropagation();
      },
      true,
    );
  });
  await page.clock.install();
  await page.route("**/api/debrid/media/42/0", async (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(replacementMedia),
    }),
  );
  await page.route("**/api/debrid/hls/42/0/**", async (route) =>
    route.fulfill({ status: 204 }),
  );
  let sessionStops = 0;
  await page.route("**/api/debrid/transcode/42/0**", async (route) => {
    if (route.request().method() === "POST") sessionStops += 1;
    await route.fulfill({ status: 204 });
  });

  await page.goto("/stream/42/0/rebuffered-native-hls?compat=1", {
    waitUntil: "domcontentloaded",
  });
  const video = page.locator("video");
  await expect(video).toHaveAttribute("src", /\/api\/debrid\/hls\/42\/0/);
  const source = await video.getAttribute("src");
  await video.evaluate((element) => {
    element.dispatchEvent(new Event("playing", { bubbles: true }));
    element.dispatchEvent(new Event("waiting", { bubbles: true }));
  });
  await page.clock.fastForward(NATIVE_STARTUP_TIMEOUT_MS + 500);

  expect(sessionStops).toBe(0);
  await expect(video).toHaveAttribute("src", source!);
  await expect(page.getByRole("alert")).toHaveCount(0);
});
