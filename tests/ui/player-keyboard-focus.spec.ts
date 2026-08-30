import { expect, test, type Page } from "@playwright/test";

const installSyntheticPlayback = (page: Page) =>
  page.addInitScript(() => {
    const canPlayType = HTMLMediaElement.prototype.canPlayType;
    HTMLMediaElement.prototype.canPlayType = function (type) {
      // Keyboard/focus tests use a synthetic media element. Keep them on the
      // deterministic direct-source path; native-HLS transport has its own
      // dedicated recovery/playback coverage.
      if (/application\/(?:vnd\.apple\.mpegurl|x-mpegurl)/i.test(type)) return "";
      return canPlayType.call(this, type);
    };
    window.addEventListener(
      "error",
      (event) => {
        if (event.target instanceof HTMLMediaElement) event.stopImmediatePropagation();
      },
      true,
    );
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
      this.dispatchEvent(new Event("pause", { bubbles: true }));
    };
  });

const configurePlayableTitle = async (page: Page) => {
  await page.route("**/api/debrid/media/**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        duration: 600,
        format: "mp4",
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
      }),
    }),
  );
  await page.route("**/api/debrid/stream/**", (route) =>
    route.fulfill({ status: 204 }),
  );
  await page.route("**/api/debrid/transcode/**", (route) =>
    route.fulfill({ status: 204 }),
  );
  await page.route("**/api/debrid/subtitle/**", (route) =>
    route.fulfill({ status: 204 }),
  );
  await page.route("**/api/debrid/magnets**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: "[]",
    }),
  );
};

const configureNextEpisode = (page: Page) =>
  page.addInitScript(() => {
    sessionStorage.setItem(
      "kheyflix:playback-queue:v1",
      JSON.stringify([
        {
          titleId: "keyboard-focus",
          magnetId: 42,
          file: 0,
          label: "Episode 1",
          seriesId: "keyboard-focus",
          seriesTitle: "Keyboard Focus",
          season: 1,
          episode: 1,
        },
        {
          titleId: "keyboard-focus",
          magnetId: 43,
          file: 0,
          label: "Episode 2",
          seriesId: "keyboard-focus",
          seriesTitle: "Keyboard Focus",
          season: 1,
          episode: 2,
        },
      ]),
    );
  });

test("opening global search moves keyboard focus to its input", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const openSearch = page.getByRole("button", { name: "Open search" });
  await openSearch.focus();
  await expect(openSearch).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(/\/search$/);
  const searchInput = page.getByLabel("Search titles");
  await expect(searchInput).toBeVisible();
  await expect(searchInput).toBeFocused();
});

test("direct search routes focus the title field", async ({ page }) => {
  await page.goto("/search?q=friends", { waitUntil: "domcontentloaded" });

  const searchInput = page.getByLabel("Search titles");
  await expect(searchInput).toHaveValue("friends");
  await expect(searchInput).toBeFocused();

  await page.getByRole("button", { name: "Kheyflix home" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/search\?q=friends$/);
  await expect(searchInput).toBeFocused();
});

test("focused player controls receive native Space and Enter activation", async ({ page }) => {
  await installSyntheticPlayback(page);
  await configurePlayableTitle(page);
  await page.goto("/stream/42/0/keyboard-focus", {
    waitUntil: "domcontentloaded",
  });

  const audioControl = page.getByRole("button", { name: "Audio languages" });
  await expect(audioControl).toBeVisible();
  await audioControl.focus();
  await page.keyboard.press("Space");

  const audioMenu = page.getByRole("dialog", { name: "Audio languages" });
  await expect(audioMenu).toBeVisible();

  const frenchAudio = audioMenu.getByRole("button", { name: /Français/ });
  await frenchAudio.focus();
  await page.keyboard.press("Escape");
  await expect(audioMenu).toHaveCount(0);

  await audioControl.focus();
  await page.keyboard.press("Space");
  await expect(audioMenu).toBeVisible();
  await frenchAudio.focus();
  await page.keyboard.press("Space");
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("kheyflix:audio-language:v1")))
    .toBe("fra");
  await expect(audioMenu).toHaveCount(0);

  const subtitlesControl = page.getByRole("button", { name: "Subtitles" });
  await subtitlesControl.focus();
  await page.keyboard.press("Space");
  const subtitlesMenu = page.getByRole("dialog", { name: "Subtitles" });
  await expect(subtitlesMenu).toBeVisible();
  const englishSubtitle = subtitlesMenu.getByRole("button", { name: "English" });
  await englishSubtitle.focus();
  await page.keyboard.press("Space");
  await expect(englishSubtitle).toHaveClass(/active/);
  await page.keyboard.press("Escape");
  await expect(subtitlesMenu).toHaveCount(0);

  const settingsControl = page.getByRole("button", {
    name: "Playback settings",
  });
  await settingsControl.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("dialog", { name: "Playback settings" }),
  ).toBeVisible();
});

test("bare player-surface shortcuts remain available", async ({ page }) => {
  await installSyntheticPlayback(page);
  await configureNextEpisode(page);
  await configurePlayableTitle(page);
  await page.goto("/stream/42/0/keyboard-focus", {
    waitUntil: "domcontentloaded",
  });

  const video = page.locator("video");
  await expect(video).toBeVisible();
  await video.evaluate((element) => element.play());
  await expect.poll(() => video.evaluate((element) => element.paused)).toBe(false);
  await video.focus();

  await page.keyboard.press("Space");
  await expect.poll(() => video.evaluate((element) => element.paused)).toBe(true);
  await page.keyboard.press("Space");
  await expect.poll(() => video.evaluate((element) => element.paused)).toBe(false);

  const mutedBeforeShortcut = await video.evaluate((element) => element.muted);
  await page.keyboard.press("m");
  await expect
    .poll(() => video.evaluate((element) => element.muted))
    .toBe(!mutedBeforeShortcut);

  const sourceBeforeArrow = await video.getAttribute("src");
  expect(sourceBeforeArrow).toBeTruthy();
  await page.keyboard.press("ArrowRight");
  await expect(video).not.toHaveAttribute("src", sourceBeforeArrow!);

  await page.keyboard.press("n");
  await expect(page).toHaveURL(/\/stream\/43\/0\/keyboard-focus-s01-e02-episode-2/);
});

test("focused controls preserve their own range behavior without global seeks", async ({ page }) => {
  await installSyntheticPlayback(page);
  await configurePlayableTitle(page);
  await page.goto("/stream/42/0/keyboard-focus", {
    waitUntil: "domcontentloaded",
  });

  const timeline = page.getByRole("slider", { name: "Seek video" });
  await expect(timeline).toHaveValue("0");
  await timeline.focus();
  await page.keyboard.press("ArrowRight");
  await expect(timeline).toHaveValue("10");

  await page.getByRole("button", { name: "Audio languages" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(timeline).toHaveValue("10");
});

test("bare Escape exits the player after preserving menu Escape", async ({ page }) => {
  await installSyntheticPlayback(page);
  await configurePlayableTitle(page);
  await page.goto("/stream/42/0/keyboard-focus", {
    waitUntil: "domcontentloaded",
  });

  const video = page.locator("video");
  await expect(video).toBeVisible();
  await video.focus();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL("/");
});

test("keyboard focus restores auto-hidden player chrome", async ({ page }, testInfo) => {
  await installSyntheticPlayback(page);
  await configurePlayableTitle(page);
  await page.clock.install();
  await page.goto("/stream/42/0/keyboard-focus", {
    waitUntil: "domcontentloaded",
  });

  const shell = page.locator("main.player-shell");
  const video = page.locator("video");
  await expect(video).toBeVisible();
  await video.evaluate((element) => element.play());
  await page.clock.fastForward(3_000);
  await expect(shell).not.toHaveClass(/controls-visible/);

  const backButton = page.getByRole("button", { name: "Back to browsing" });
  if (testInfo.project.name === "webkit") {
    // Headless WebKit honors macOS's system-level Full Keyboard Access
    // preference, which is disabled in its test host. Focusing the button
    // still exercises WebKit's focus-visible event path deterministically.
    await backButton.focus();
  } else {
    await page.evaluate(() => document.body.focus());
    await page.keyboard.press("Tab");
  }
  await expect(backButton).toBeFocused();
  await expect
    .poll(() => backButton.evaluate((element) => element.matches(":focus-visible")))
    .toBe(true);
  await expect(shell).toHaveClass(/controls-visible/);
  await page.clock.fastForward(3_000);
  await expect(shell).toHaveClass(/controls-visible/);
});
