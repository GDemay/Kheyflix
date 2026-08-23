import { expect, test } from "@playwright/test";

const livePath =
  process.env.KHEYFLIX_LOADER_TEST_PATH || "/stream/701203060/0/shrek";

test("the loader reveals a continuously advancing live catalog stream", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto(livePath, { waitUntil: "domcontentloaded" });

  const player = page.locator("main.player-shell");
  const video = page.locator("video");
  const loader = page.locator(".shard-portal-loader");
  await expect(video).toBeVisible();
  await expect(loader).toBeAttached();
  await expect
    .poll(() => video.evaluate((element) => element.readyState), {
      timeout: 30_000,
    })
    .toBeGreaterThanOrEqual(2);
  await expect
    .poll(() => video.evaluate((element) => element.videoWidth), {
      timeout: 30_000,
    })
    .toBeGreaterThan(0);
  await expect(loader).toBeHidden({ timeout: 15_000 });
  await expect
    .poll(() => player.getAttribute("data-first-frame-ms"), {
      timeout: 15_000,
    })
    .not.toBeNull();

  const firstFrameMs = Number(await player.getAttribute("data-first-frame-ms"));
  expect(firstFrameMs).toBeLessThan(10_000);
  if (await video.evaluate((element) => element.paused)) {
    await page.getByRole("button", { name: "Play", exact: true }).click();
  }
  const start = await video.evaluate((element) => element.currentTime);
  await expect
    .poll(() => video.evaluate((element) => element.currentTime), {
      timeout: 15_000,
    })
    .toBeGreaterThan(start + 3);
  await expect(page.getByRole("alert")).toHaveCount(0);
});
