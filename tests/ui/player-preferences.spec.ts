import { expect, test } from "@playwright/test";

const preferencesKey = "kheyflix:playback-preferences:v1:series-42";

test("Next episode reapplies every saved player configuration choice", async ({
  page,
}) => {
  await page.addInitScript(
    ({ key }) => {
      sessionStorage.setItem(
        "kheyflix:playback-queue:v1",
        JSON.stringify([
          {
            titleId: "series-42",
            seriesId: "series-42",
            seriesTitle: "A Real Series",
            magnetId: 101,
            file: 0,
            season: 1,
            episode: 1,
            label: "Episode 1",
          },
          {
            titleId: "series-42",
            seriesId: "series-42",
            seriesTitle: "A Real Series",
            magnetId: 102,
            file: 1,
            season: 1,
            episode: 2,
            label: "Episode 2",
          },
        ]),
      );
      localStorage.setItem("kheyflix:audio-language:v1", "eng");
      localStorage.setItem(
        key,
        JSON.stringify({
          audioLanguage: "eng",
          playbackRate: 1,
          audioSync: 0,
        }),
      );
    },
    { key: preferencesKey },
  );
  await page.route("**/api/debrid/media/**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        duration: 1200,
        format: "mp4",
        video: [{ index: 0, codec: "h264", width: 1920, height: 1080 }],
        audio: [
          { index: 1, codec: "aac", language: "eng", title: "", channels: 2, default: true },
          { index: 2, codec: "aac", language: "fra", title: "", channels: 2, default: false },
        ],
        subtitles: [
          { index: 3, codec: "subrip", language: "eng", title: "", supported: true },
          { index: 4, codec: "subrip", language: "fra", title: "", supported: true },
        ],
      }),
    });
  });
  await page.route("**/api/debrid/transcode/**", (route) =>
    route.fulfill({ status: 204 }),
  );
  await page.route("**/api/debrid/stream/**", (route) =>
    route.fulfill({ status: 204 }),
  );
  await page.route("**/api/debrid/subtitle/**", (route) =>
    route.fulfill({ status: 204 }),
  );

  await page.goto("/stream/101/0/a-real-series-episode-1", {
    waitUntil: "domcontentloaded",
  });
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("kheyflix:audio-language:v1")))
    .toBe("eng");
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), preferencesKey))
    .not.toBeNull();
  await expect(page.getByRole("button", { name: "Next episode" })).toBeVisible();
  await page.getByRole("button", { name: "Audio languages" }).evaluate((button: HTMLButtonElement) => button.click());
  await page
    .getByRole("dialog", { name: "Audio languages" })
    .getByRole("button", { name: /Français/ })
    .evaluate((button: HTMLButtonElement) => button.click());
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("kheyflix:audio-language:v1")))
    .toBe("fra");
  await page.getByRole("button", { name: "Subtitles" }).evaluate((button: HTMLButtonElement) => button.click());
  const initialSubtitles = page.getByRole("dialog", { name: "Subtitles" });
  await initialSubtitles.getByRole("button", { name: "English" }).evaluate((button: HTMLButtonElement) => button.click());
  await initialSubtitles.getByRole("button", { name: "large" }).evaluate((button: HTMLButtonElement) => button.click());
  await page.getByRole("button", { name: "Subtitles" }).evaluate((button: HTMLButtonElement) => button.click());
  await page.getByRole("button", { name: "Playback settings" }).evaluate((button: HTMLButtonElement) => button.click());
  const initialSettings = page.getByRole("dialog", { name: "Playback settings" });
  await initialSettings.getByRole("button", { name: "720p HD" }).evaluate((button: HTMLButtonElement) => button.click());
  await initialSettings.getByRole("button", { name: "1.25×" }).evaluate((button: HTMLButtonElement) => button.click());
  for (let step = 0; step < 4; step += 1)
    await initialSettings.getByRole("button", { name: "Voice earlier" }).evaluate((button: HTMLButtonElement) => button.click());
  await page.getByRole("button", { name: "Playback settings" }).evaluate((button: HTMLButtonElement) => button.click());

  const assertPreferences = async () => {
    await expect(page.getByRole("button", { name: "Audio languages" })).toBeVisible();
    await page.getByRole("button", { name: "Audio languages" }).evaluate((button: HTMLButtonElement) => button.click());
    await expect(
      page.getByRole("dialog", { name: "Audio languages" }).getByRole("button", { name: /Français/ }),
    ).toHaveClass(/active/);
    await page.getByRole("button", { name: "Audio languages" }).evaluate((button: HTMLButtonElement) => button.click());

    await page.getByRole("button", { name: "Subtitles" }).evaluate((button: HTMLButtonElement) => button.click());
    const subtitles = page.getByRole("dialog", { name: "Subtitles" });
    await expect(subtitles.getByRole("button", { name: "English" })).toHaveClass(/active/);
    await expect(subtitles.getByRole("button", { name: "large" })).toHaveClass(/active/);
    await page.getByRole("button", { name: "Subtitles" }).evaluate((button: HTMLButtonElement) => button.click());

    await page.getByRole("button", { name: "Playback settings" }).evaluate((button: HTMLButtonElement) => button.click());
    const settings = page.getByRole("dialog", { name: "Playback settings" });
    await expect(settings.getByRole("button", { name: "720p HD" })).toHaveClass(/active/);
    await expect(settings.getByRole("button", { name: "1.25×" })).toHaveClass(/active/);
    await expect(settings.getByText("Audio earlier by 0.4s")).toBeVisible();
    await page.getByRole("button", { name: "Playback settings" }).evaluate((button: HTMLButtonElement) => button.click());
  };

  await assertPreferences();
  await page.getByRole("button", { name: "Next episode" }).evaluate((button: HTMLButtonElement) => button.click());
  await expect(page).toHaveURL(/\/stream\/102\/1\//);
  await assertPreferences();
});
