import { describe, expect, it } from "vitest";
import { friendsFirst, parseFavorites, toggleFavorite } from "./favorites";

describe("favorites", () => {
  it("parses and de-duplicates persisted title ids", () => {
    expect(parseFavorites('["series-friends","series-friends","movie-up"]')).toEqual(["series-friends", "movie-up"]);
    expect(parseFavorites("not json")).toEqual([]);
  });

  it("adds new favorites first and removes existing favorites", () => {
    expect(toggleFavorite(["a"], "b")).toEqual(["b", "a"]);
    expect(toggleFavorite(["a", "b"], "a")).toEqual(["b"]);
  });

  it("places Friends first without disturbing the remaining order", () => {
    expect(friendsFirst([{ title: "Lost" }, { title: "Friends" }, { title: "Dark" }])).toEqual([
      { title: "Friends" }, { title: "Lost" }, { title: "Dark" },
    ]);
  });
});
