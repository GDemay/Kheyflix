import { describe, expect, it } from "vitest";
import {
  chooseAudioTrack,
  defaultPlaybackPreferences,
  parsePlaybackPreferences,
  serializePlaybackPreferences,
} from "./playback-preferences";

const audioTracks = [
  { index: 2, language: "por", default: true },
  { index: 4, language: "eng", default: false },
  { index: 8, language: "fra", default: false },
];

describe("playback preferences", () => {
  it("defaults to English audio, normal speed, and neutral audio sync", () => {
    expect(defaultPlaybackPreferences()).toEqual({
      audioLanguage: "eng",
      subtitleSize: "medium",
      qualityMode: "auto",
      playbackRate: 1,
      audioSync: 0,
    });
  });

  it("preserves every player configuration choice used by the next episode", () => {
    const saved = serializePlaybackPreferences({
      audioLanguage: "fra",
      subtitleLanguage: "eng",
      subtitleSize: "large",
      qualityMode: "720",
      playbackRate: 1.25,
      audioSync: -0.4,
    });
    expect(parsePlaybackPreferences(saved)).toEqual({
      audioLanguage: "fra",
      subtitleLanguage: "eng",
      subtitleSize: "large",
      qualityMode: "720",
      playbackRate: 1.25,
      audioSync: -0.4,
    });
  });

  it("rejects unsafe speeds and clamps sync corrections", () => {
    expect(
      parsePlaybackPreferences(
        JSON.stringify({
          subtitleSize: "giant",
          qualityMode: "cinema",
          playbackRate: 9,
          audioSync: 100,
        }),
      ),
    ).toEqual({
      audioLanguage: "eng",
      subtitleSize: "medium",
      qualityMode: "auto",
      playbackRate: 1,
      audioSync: 5,
    });
  });

  it("selects English ahead of a non-English source default", () => {
    expect(chooseAudioTrack(audioTracks, "eng")?.index).toBe(4);
    expect(chooseAudioTrack(audioTracks, "en")?.index).toBe(4);
  });

  it("restores a saved language and safely falls back", () => {
    expect(chooseAudioTrack(audioTracks, "fra")?.index).toBe(8);
    expect(chooseAudioTrack(audioTracks, "deu")?.index).toBe(2);
  });
});
