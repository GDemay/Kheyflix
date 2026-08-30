import type { Page } from "@playwright/test";

type ActivePlaybackSession = {
  file: string;
  id: string;
  session: string;
};

const retryAfterMilliseconds = (value: string | null) => {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 1 && seconds <= 10
    ? Math.round(seconds * 1_000)
    : 3_000;
};

const activePlaybackSession = (page: Page) =>
  page.evaluate(() => {
    const source =
      document.querySelector<HTMLVideoElement>("video")?.currentSrc ||
      document.querySelector<HTMLVideoElement>("video")?.src;
    if (!source) return;
    const url = new URL(source, window.location.href),
      transcode = url.pathname.match(/^\/api\/debrid\/transcode\/(\d+)\/(\d+)$/),
      hls = url.pathname.match(/^\/api\/debrid\/hls\/(\d+)\/(\d+)\/([^/]+)\//);
    if (transcode) {
      const session = url.searchParams.get("session");
      if (session) return { id: transcode[1], file: transcode[2], session };
    }
    if (hls) return { id: hls[1], file: hls[2], session: hls[3] };
  });

// Route transitions only offer a best-effort beacon. Production playback
// suites wait for the same stop contract used by in-player replacements, so a
// later test never competes with an encoder that is merely still closing.
export const releaseActivePlaybackSession = async (page: Page) => {
  if (page.isClosed()) return;
  const active = await activePlaybackSession(page);
  if (!active) return;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const result = await page.evaluate(async (session: ActivePlaybackSession) => {
      const response = await fetch(
        "/api/debrid/transcode/" +
          session.id +
          "/" +
          session.file +
          "?session=" +
          encodeURIComponent(session.session),
        { method: "POST", cache: "no-store" },
      );
      return {
        status: response.status,
        retryAfter: response.headers.get("retry-after"),
      };
    }, active);
    if (result.status === 204) return;
    if (result.status !== 202)
      throw new Error(
        "Playback session cleanup failed with HTTP " + result.status + ".",
      );
    await page.waitForTimeout(retryAfterMilliseconds(result.retryAfter));
  }
  throw new Error("Playback session cleanup did not confirm encoder closure.");
};
