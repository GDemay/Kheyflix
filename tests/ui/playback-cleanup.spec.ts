import { expect, test } from "@playwright/test";
import { releaseActivePlaybackSession } from "./playback-cleanup";

test("awaits a confirmed close before releasing a progressive playback fixture", async ({
  page,
}) => {
  let stopRequests = 0;
  await page.route("**/api/debrid/magnets", async (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ magnets: [] }),
    }),
  );
  await page.route("**/api/debrid/transcode/42/0**", async (route) => {
    if (route.request().method() === "POST") {
      stopRequests += 1;
      await route.fulfill(
        stopRequests === 1
          ? { status: 202, headers: { "Retry-After": "1" } }
          : { status: 204 },
      );
      return;
    }
    await route.fulfill({ status: 204 });
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    const video = document.createElement("video");
    video.src = "/api/debrid/transcode/42/0?session=closing-progressive";
    document.body.append(video);
  });

  await releaseActivePlaybackSession(page);

  expect(stopRequests).toBe(2);
});

test("releases an active native-HLS session through the same close contract", async ({
  page,
}) => {
  let stopUrl = "";
  await page.route("**/api/debrid/**", async (route) => {
    if (route.request().method() === "POST") stopUrl = route.request().url();
    await route.fulfill({ status: 204 });
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    const video = document.createElement("video");
    video.src = "/api/debrid/hls/42/0/native-closing/master.m3u8";
    document.body.append(video);
  });

  await releaseActivePlaybackSession(page);

  expect(new URL(stopUrl).pathname).toBe("/api/debrid/transcode/42/0");
  expect(new URL(stopUrl).searchParams.get("session")).toBe("native-closing");
});
