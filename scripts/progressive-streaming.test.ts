import { describe, expect, it } from "vitest";
import {
  hasPlayableHlsWindow,
  hlsSegmentSeconds,
  hlsStartupBurstSeconds,
  hlsStartupSegments,
  hlsRetentionOptions,
  hlsProgramDateTimeLeadMs,
  hlsEventPruneBefore,
  hlsNativeVodOptions,
  normalizeHlsPlaylist,
  isCompleteHlsVodPlaylist,
  reclaimablePlaybackJob,
  remoteMediaInput,
} from "./progressive-streaming.mjs";

describe("progressive compatibility streaming", () => {
  it("uses fractional HLS cadence that leaves room for encoder timestamp drift", () => {
    expect(hlsSegmentSeconds(true)).toBe(0.75);
    expect(hlsSegmentSeconds(false)).toBe(1.5);
    expect(hlsStartupSegments(true)).toBe(1);
    expect(hlsStartupSegments(false)).toBe(6);
    expect(hlsStartupBurstSeconds(false)).toBe(9);
  });

  it("accepts only a standards-valid HLS startup window", () => {
    expect(
      hasPlayableHlsWindow(
        "#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-PROGRAM-DATE-TIME:2026-08-30T00:00:00.000Z\n#EXTINF:1.502,\nsegment00000.ts\n#EXT-X-PROGRAM-DATE-TIME:2026-08-30T00:00:01.502Z\n#EXTINF:1.501,\nsegment00001.ts\n",
        2,
        true,
      ),
    ).toBe(true);
    expect(
      hasPlayableHlsWindow(
        "#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXTINF:2.002,\nsegment00000.ts\n",
      ),
    ).toBe(false);
    expect(
      hasPlayableHlsWindow(
        "#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXTINF:1.5,\nsegment00000.ts\n",
        1,
        true,
      ),
    ).toBe(false);
  });

  it("moves FFmpeg program timestamps ahead of their media segments", () => {
    const ffmpegPlaylist =
      "#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-PLAYLIST-TYPE:EVENT\n#EXT-X-INDEPENDENT-SEGMENTS\n#EXTINF:1.5,\n#EXT-X-PROGRAM-DATE-TIME:2026-08-30T00:00:00.000Z\nsegment00000.ts\n";
    expect(hasPlayableHlsWindow(ffmpegPlaylist, 1, true)).toBe(false);
    expect(normalizeHlsPlaylist(ffmpegPlaylist)).toBe(
      "#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-PLAYLIST-TYPE:EVENT\n#EXT-X-INDEPENDENT-SEGMENTS\n#EXT-X-START:TIME-OFFSET=0,PRECISE=YES\n#EXT-X-PROGRAM-DATE-TIME:2026-08-30T00:00:00.000Z\n#EXTINF:1.5,\nsegment00000.ts\n",
    );
    expect(hasPlayableHlsWindow(normalizeHlsPlaylist(ffmpegPlaylist), 1, true)).toBe(true);
    expect(normalizeHlsPlaylist(ffmpegPlaylist, 0, false)).not.toContain(
      "#EXT-X-START:",
    );
  });

  it("anchors a burst-generated live window at the current clock", () => {
    const playlist =
      "#EXTM3U\n#EXT-X-PROGRAM-DATE-TIME:2026-08-30T00:00:04.000Z\n#EXTINF:1.5,\nsegment00000.ts\n#EXT-X-PROGRAM-DATE-TIME:2026-08-30T00:00:05.500Z\n#EXTINF:1.5,\nsegment00001.ts\n";
    const now = Date.parse("2026-08-30T00:00:04.000Z");
    const lead = hlsProgramDateTimeLeadMs(playlist, now);
    expect(lead).toBe(3_000);
    expect(normalizeHlsPlaylist(playlist, lead)).toContain(
      "#EXT-X-PROGRAM-DATE-TIME:2026-08-30T00:00:01.000Z",
    );
  });

  it("feeds FFmpeg from the authenticated remote stream route", () => {
    expect(remoteMediaInput("http://localhost:3000", "42", "7")).toBe(
      "http://localhost:3000/api/debrid/stream/42/7",
    );
  });

  it("uses an append-only event playlist with live program timestamps", () => {
    const options = hlsRetentionOptions(false);
    expect(options).toContain("event");
    expect(options.join(" ")).toContain("program_date_time");
    expect(options).toContain("0");
    expect(hlsRetentionOptions(false).join(" ")).not.toContain("discont_start");
  });

  it("builds a bounded immutable native VOD playlist", () => {
    expect(hlsNativeVodOptions().join(" ")).toContain("vod");
    expect(hlsNativeVodOptions().join(" ")).not.toContain("program_date_time");
    expect(hlsNativeVodOptions().join(" ")).not.toContain("discont_start");
    expect(
      isCompleteHlsVodPlaylist(
        "#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXTINF:1.5,\nsegment00000.ts\n#EXT-X-ENDLIST\n",
      ),
    ).toBe(true);
    expect(
      isCompleteHlsVodPlaylist(
        "#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXTINF:1.5,\nsegment00000.ts\n",
      ),
    ).toBe(false);
  });

  it("keeps the short reusable bootstrap playlist complete", () => {
    expect(hlsRetentionOptions(true)).toContain("event");
  });

  it("keeps actively touched bootstrap playback protected from eviction", () => {
    const now = Date.now();
    expect(reclaimablePlaybackJob(true, now, now)).toBe(false);
    expect(reclaimablePlaybackJob(false, Date.now(), Date.now())).toBe(false);
    expect(reclaimablePlaybackJob(false, 0, 31_000)).toBe(true);
    expect(reclaimablePlaybackJob(true, 0, 31_000)).toBe(true);
  });

  it("keeps a generous bounded event replay cushion after delivered segments", () => {
    expect(hlsEventPruneBefore(320, 320)).toBe(0);
    expect(hlsEventPruneBefore(321, 320)).toBe(1);
    expect(hlsEventPruneBefore(12, 8)).toBe(4);
  });
});
