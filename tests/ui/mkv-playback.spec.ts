import { expect, test } from "@playwright/test";

const mkvPlaybackPath =
  process.env.KHEYFLIX_MKV_PLAYBACK_TEST_PATH ||
  "/stream/72935164/0/how-to-train-your-dragon-homecoming?compat=1";
const safeMediaPath = (value: string) => new URL(value).pathname;

test.afterEach(async ({ page }) => {
  if (!page.isClosed())
    await page.goto("/", { waitUntil: "domcontentloaded", timeout: 15_000 }).catch(
      () => undefined,
    );
});

test("a real MKV starts progressively and keeps advancing", async ({ page }) => {
  test.setTimeout(100_000);
  let blockingPreflights = 0;
  const mediaFailures: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error")
      console.info("[mkv-playback] browser media error");
  });
  page.on("response", (response) => {
    if (
      response.status() >= 400 &&
      /\/api\/debrid\/(?:hls|media|stream|transcode)\//.test(response.url())
    ) {
      const path = safeMediaPath(response.url()),
        method = response.request().method();
      mediaFailures.push(`${response.status()} ${method} ${path}`);
      console.info(
        `[mkv-playback] ${response.status()} ${method} ${path}`,
      );
    }
  });
  page.on("request", (request) => {
    if (
      request.method() === "HEAD" &&
      request.url().includes("/api/debrid/stream/")
    )
      blockingPreflights += 1;
  });

  await page.goto(mkvPlaybackPath, { waitUntil: "domcontentloaded" });
  const player = page.locator("main.player-shell"),
    video = page.locator("video");

  await expect(video).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect
    .poll(() => video.evaluate((element) => element.readyState), {
      timeout: 70_000,
    })
    .toBeGreaterThanOrEqual(2);
  await expect
    .poll(() => video.evaluate((element) => element.videoWidth), {
      timeout: 20_000,
    })
    .toBeGreaterThan(0);
  await expect
    .poll(() => player.getAttribute("data-first-frame-ms"), {
      timeout: 20_000,
    })
    .not.toBeNull();

  const firstFrameMs = Number(await player.getAttribute("data-first-frame-ms"));
  console.info(`[mkv-playback] first decoded frame: ${firstFrameMs}ms`);
  expect(firstFrameMs).toBeLessThan(30_000);
  expect(blockingPreflights).toBe(0);
  expect(mediaFailures).toEqual([]);

  if (await video.evaluate((element) => element.paused))
    await page.getByRole("button", { name: "Play", exact: true }).click();
  const timeline = page.getByRole("slider", { name: "Seek video" });
  const playbackStart = Number(await timeline.inputValue());
  // Confirm the decoded frame has become continuously advancing before
  // sampling cadence. This keeps the regression focused on sustained MKV
  // playback rather than conflating its startup ramp with a rebuffer.
  await expect
    .poll(() => timeline.inputValue().then(Number), { timeout: 15_000 })
    .toBeGreaterThan(playbackStart + 3);
  const checkpoints: number[] = [];
  for (let sample = 0; sample < 4; sample += 1) {
    await page.waitForTimeout(5_000);
    checkpoints.push(Number(await timeline.inputValue()));
    await expect(page.getByRole("alert")).toHaveCount(0);
  }
  console.info(`[mkv-playback] timeline checkpoints: ${checkpoints.join(", ")}`);
  for (let index = 1; index < checkpoints.length; index += 1)
    expect(checkpoints[index]).toBeGreaterThan(checkpoints[index - 1] + 2);
  expect(checkpoints.at(-1)! - checkpoints[0]).toBeGreaterThan(8);
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(mediaFailures).toEqual([]);
});
