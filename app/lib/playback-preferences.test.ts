import { describe, expect, it } from "vitest";
import {
  defaultPlaybackPreferences,
  parsePlaybackPreferences,
  serializePlaybackPreferences,
} from "./playback-preferences";

describe("playback preferences", () => {
  it("defaults to normal speed and neutral audio sync", () => {
    expect(defaultPlaybackPreferences()).toEqual({
      playbackRate: 1,
      audioSync: 0,
    });
  });

  it("preserves series-wide subtitle, speed, and sync choices", () => {
    const saved = serializePlaybackPreferences({
      subtitleLanguage: "eng",
      playbackRate: 1.25,
      audioSync: -0.4,
    });
    expect(parsePlaybackPreferences(saved)).toEqual({
      subtitleLanguage: "eng",
      playbackRate: 1.25,
      audioSync: -0.4,
    });
  });

  it("rejects unsafe speeds and clamps sync corrections", () => {
    expect(
      parsePlaybackPreferences(
        JSON.stringify({ playbackRate: 9, audioSync: 100 }),
      ),
    ).toEqual({ playbackRate: 1, audioSync: 5 });
  });
});
