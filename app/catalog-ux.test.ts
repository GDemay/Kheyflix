import { describe, expect, it } from "vitest";
import {
  createCatalogSectionQueries,
  episodeCountLabel,
  normalizeSearchQuery,
  updateCatalogSectionQuery,
} from "./catalog-ux";

describe("catalog UX formatting", () => {
  it("trims searches and collapses every kind of internal whitespace", () => {
    expect(normalizeSearchQuery("   ")).toBe("");
    expect(normalizeSearchQuery("  Star\t\n Wars  ")).toBe("Star Wars");
    expect(normalizeSearchQuery("Shrek")).toBe("Shrek");
  });

  it("pluralizes episode counts", () => {
    expect(episodeCountLabel(0)).toBe("0 episodes");
    expect(episodeCountLabel(1)).toBe("1 episode");
    expect(episodeCountLabel(2)).toBe("2 episodes");
  });

  it("keeps movie and series filters independent", () => {
    const initial = createCatalogSectionQueries();
    const moviesSearched = updateCatalogSectionQuery(initial, "movies", "Shrek");
    expect(moviesSearched).toEqual({ movies: "Shrek", series: "" });
    expect(initial).toEqual({ movies: "", series: "" });

    const seriesSearched = updateCatalogSectionQuery(
      moviesSearched,
      "series",
      "Friends",
    );
    expect(seriesSearched).toEqual({ movies: "Shrek", series: "Friends" });
  });
});
