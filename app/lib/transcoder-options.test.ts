import { describe, expect, it } from "vitest";
import {
  audioSyncOptions,
  selectedStreamIndex,
  subtitleTimelineOptions,
  videoOutputOptions,
} from "../../scripts/transcoder-options.mjs";

describe("compatible playback transcoder options", () => {
  it("copies browser-safe H.264 without spending CPU on a re-encode", () => {
    expect(videoOutputOptions("h264")).toEqual(["-c:v", "copy"]);
  });

  it.each(["hevc", "h265", "mpeg4", "vc1", "av1", ""])(
    "converts %s video to broadly-supported H.264",
    (codec) => {
      expect(videoOutputOptions(codec)).toContain("libx264");
      expect(videoOutputOptions(codec)).toContain("yuv420p");
    },
  );

  it("bounds expensive 4K compatibility transcodes to a streamable size", () => {
    expect(videoOutputOptions("hevc", 1600)).toEqual(
      expect.arrayContaining(["-vf", "scale=-2:480", "-preset", "ultrafast"]),
    );
  });

  it("keeps 1080p compatibility transcodes fast enough for real-time playback", () => {
    expect(videoOutputOptions("hevc", 1080)).toEqual(
      expect.arrayContaining(["-vf", "scale=-2:480"]),
    );
  });

  it("preserves HEVC quality when the client advertises hardware support", () => {
    expect(videoOutputOptions("hevc", 1600, true)).toEqual([
      "-c:v",
      "copy",
      "-tag:v",
      "hvc1",
    ]);
  });

  it("decodes through an exact seek instead of copying from an earlier keyframe", () => {
    expect(videoOutputOptions("h264", 1080, false, "original", true)).toEqual(
      expect.arrayContaining(["-c:v", "libx264"]),
    );
    expect(videoOutputOptions("hevc", 1080, true, "original", true)).toEqual(
      expect.arrayContaining(["-c:v", "libx264"]),
    );
  });

  it.each([
    ["bootstrap", "scale=-2:240", "280k"],
    ["480", "scale=-2:480", "900k"],
    ["720", "scale=-2:720", "2200k"],
    ["1080", "scale=-2:1080", "4500k"],
  ])("builds a bounded %s adaptive profile", (quality, scale, bitrate) => {
    const options = videoOutputOptions("h264", 2160, false, quality);
    expect(options).toEqual(expect.arrayContaining(["-vf", scale, "-b:v", bitrate]));
    expect(options).not.toContain("copy");
  });

  it("never upscales a lower resolution source", () => {
    expect(videoOutputOptions("h264", 480, false, "1080")).toEqual(
      expect.arrayContaining(["-vf", "scale=-2:480"]),
    );
  });

  it("preserves audio stream zero and safely defaults invalid selections", () => {
    expect(selectedStreamIndex("0")).toBe(0);
    expect(selectedStreamIndex("3.8")).toBe(3);
    expect(selectedStreamIndex(null)).toBe(1);
    expect(selectedStreamIndex("not-a-stream")).toBe(1);
  });

  it("continuously reconciles audio timestamps and composes manual corrections", () => {
    expect(audioSyncOptions("0")).toEqual([
      "-af",
      "aresample=async=1000:first_pts=0",
    ]);
    expect(audioSyncOptions("0.5")).toEqual([
      "-af",
      "aresample=async=1000:first_pts=0,adelay=500:all=1",
    ]);
    expect(audioSyncOptions("-0.4")).toEqual([
      "-af",
      "aresample=async=1000:first_pts=0,atrim=start=0.4,asetpts=PTS-STARTPTS",
    ]);
    expect(audioSyncOptions("20")).toEqual([
      "-af",
      "aresample=async=1000:first_pts=0,adelay=5000:all=1",
    ]);
    expect(audioSyncOptions("invalid")).toEqual([
      "-af",
      "aresample=async=1000:first_pts=0",
    ]);
  });

  it("fast-seeks subtitles while preserving and rebasing their source timestamps", () => {
    expect(subtitleTimelineOptions(0)).toEqual({ input: [], output: [] });
    expect(subtitleTimelineOptions(125.5)).toEqual({
      input: ["-ss", "125.5", "-copyts"],
      output: [],
    });
  });
});
