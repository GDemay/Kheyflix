import { describe, expect, it } from "vitest";
import {
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

  it("keeps regular HD compatibility transcodes at 720p", () => {
    expect(videoOutputOptions("hevc", 1080)).toEqual(
      expect.arrayContaining(["-vf", "scale=-2:720"]),
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
});
