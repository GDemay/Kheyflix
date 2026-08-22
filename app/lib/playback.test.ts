import { describe, expect, it } from "vitest";
import {
  availableQualities,
  needsCompatibleAudio,
  needsCompatiblePlayback,
  nextAutoQuality,
} from "./playback";

describe("playback compatibility", () => {
  it.each(["aac", "MP3", "opus", "vorbis"])(
    "keeps browser-safe %s audio on the direct stream",
    (codec) => expect(needsCompatibleAudio(codec)).toBe(false),
  );

  it("uses compatibility playback for the selected unsupported audio codec", () => {
    expect(needsCompatibleAudio("dts")).toBe(true);
    expect(needsCompatibleAudio("eac3")).toBe(true);
  });

  it("does not force compatibility before metadata is available", () => {
    expect(needsCompatibleAudio()).toBe(false);
  });

  it("uses compatibility playback for Matroska even with browser-safe codecs", () => {
    expect(needsCompatiblePlayback("matroska,webm", "aac")).toBe(true);
  });

  it("keeps an MP4 with AAC on the direct stream", () => {
    expect(needsCompatiblePlayback("mov,mp4,m4a,3gp,3g2,mj2", "aac")).toBe(
      false,
    );
  });

  it("builds a quality ladder without upscaling the source", () => {
    expect(availableQualities(720)).toEqual(["480", "720", "original"]);
    expect(availableQualities(2160)).toEqual(["480", "720", "1080", "original"]);
  });

  it("adapts one rung at a time and stays inside the source ladder", () => {
    expect(nextAutoQuality("480", "up", 1080)).toBe("720");
    expect(nextAutoQuality("720", "down", 1080)).toBe("480");
    expect(nextAutoQuality("1080", "up", 1080)).toBe("original");
    expect(nextAutoQuality("480", "down", 1080)).toBe("480");
  });
});
