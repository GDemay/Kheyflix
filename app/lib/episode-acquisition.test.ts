import { describe, expect, it } from "vitest";
import { findNextMissingEpisode } from "./episode-acquisition";

describe("next missing series episode", () => {
  const metadata = {
    "1:1": "Pilot",
    "1:2": "The second one",
    "1:3": "The third one",
    "2:1": "Season two premiere",
  };

  it("returns the earliest metadata episode missing from a partial library", () => {
    expect(findNextMissingEpisode([
      { season: 1, episode: 1 },
      { season: 1, episode: 3 },
    ], metadata)).toEqual({ season: 1, episode: 2, title: "The second one" });
  });

  it("moves into the next season after the available season is complete", () => {
    expect(findNextMissingEpisode([
      { season: 1, episode: 1 },
      { season: 1, episode: 2 },
      { season: 1, episode: 3 },
    ], metadata)).toEqual({ season: 2, episode: 1, title: "Season two premiere" });
  });

  it("does not guess when metadata is absent or the known series is complete", () => {
    expect(findNextMissingEpisode([{ season: 1, episode: 1 }], undefined)).toBeUndefined();
    expect(findNextMissingEpisode([
      { season: 1, episode: 1 },
      { season: 1, episode: 2 },
      { season: 1, episode: 3 },
      { season: 2, episode: 1 },
    ], metadata)).toBeUndefined();
  });
});
