import { describe, expect, it } from "vitest";
import { needsCompatibleAudio } from "./playback";

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
});
