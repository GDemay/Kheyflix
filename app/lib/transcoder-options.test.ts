import { describe, expect, it } from "vitest";
import {
  audioSyncOptions,
  selectedStreamIndex,
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

  it("preserves audio stream zero and safely defaults invalid selections", () => {
    expect(selectedStreamIndex("0")).toBe(0);
    expect(selectedStreamIndex("3.8")).toBe(3);
    expect(selectedStreamIndex(null)).toBe(1);
    expect(selectedStreamIndex("not-a-stream")).toBe(1);
  });

  it("moves audio later or earlier with bounded VLC-style corrections", () => {
    expect(audioSyncOptions("0.5")).toEqual([
      "-af",
      "adelay=500:all=1",
    ]);
    expect(audioSyncOptions("-0.4")).toEqual([
      "-af",
      "atrim=start=0.4,asetpts=PTS-STARTPTS",
    ]);
    expect(audioSyncOptions("20")).toEqual([
      "-af",
      "adelay=5000:all=1",
    ]);
    expect(audioSyncOptions("invalid")).toEqual([]);
  });
});
