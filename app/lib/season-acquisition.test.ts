import { describe, expect, it } from "vitest";
import { findNextMissingSeason } from "./season-acquisition";

describe("next missing series season", () => {
  const metadata = {
    "1:1": "Pilot",
    "1:2": "The second one",
    "2:1": "Season two premiere",
    "3:1": "Season three premiere",
  };

  it("returns the earliest metadata season absent from the library", () => {
    expect(findNextMissingSeason([
      { season: 1 },
      { season: 2 },
    ], metadata)).toEqual({ season: 3 });
  });

  it("fills a season gap instead of advancing past it", () => {
    expect(findNextMissingSeason([
      { season: 1 },
      { season: 3 },
    ], metadata)).toEqual({ season: 2 });
  });

  it("does not treat missing episodes within an available season as a missing season", () => {
    expect(findNextMissingSeason([{ season: 1 }], {
      "1:1": "Pilot",
      "1:2": "Second",
    })).toBeUndefined();
  });

  it("does not guess without metadata or after all known seasons are present", () => {
    expect(findNextMissingSeason([{ season: 1 }], undefined)).toBeUndefined();
    expect(findNextMissingSeason([
      { season: 1 },
      { season: 2 },
      { season: 3 },
    ], metadata)).toBeUndefined();
  });
});
