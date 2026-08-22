import { afterEach, describe, expect, it, vi } from "vitest";
import { getMetadata } from "./metadata";

afterEach(() => {
  delete process.env.TMDB_READ_ACCESS_TOKEN;
  vi.unstubAllGlobals();
});

describe("catalog metadata artwork", () => {
  it("uses Wikipedia artwork for films when TMDB is not configured", async () => {
    const wikipediaResponse = new Response(
      JSON.stringify({
        query: {
          pages: {
            "123": {
              pageid: 123,
              title: "Artwork Test Film (film)",
              extract: "Artwork Test Film is a 2024 feature film.",
              fullurl: "https://en.wikipedia.org/wiki/Artwork_Test_Film",
              thumbnail: {
                source: "https://upload.wikimedia.org/test-poster.jpg",
              },
            },
          },
        },
      }),
    );
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response("No TMDB result"))
        .mockResolvedValueOnce(wikipediaResponse),
    );

    const result = await getMetadata("Artwork Test Film", "movie", 2024, true);

    expect(result.metadata).toMatchObject({
      provider: "wikipedia",
      canonicalTitle: "Artwork Test Film",
      poster: "https://upload.wikimedia.org/test-poster.jpg",
      backdrop: "https://upload.wikimedia.org/test-poster.jpg",
    });
  });

  it("continues to Wikipedia when a series provider is unavailable", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("TVmaze unavailable"))
      .mockResolvedValueOnce(new Response("No TMDB result"))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            query: {
              pages: {
                "456": {
                  pageid: 456,
                  title: "Fallback Artwork Show (TV series)",
                  thumbnail: {
                    source: "https://upload.wikimedia.org/test-series.jpg",
                  },
                },
              },
            },
          }),
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await getMetadata(
      "Fallback Artwork Show",
      "series",
      2025,
      true,
    );

    expect(result.metadata?.provider).toBe("wikipedia");
    expect(result.metadata?.poster).toContain("test-series.jpg");
  });

  it("uses public TMDB search artwork without credentials", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          '<a data-media-type="movie" href="/movie/123-example"><img src="https://media.themoviedb.org/t/p/w94_and_h141_face/poster123.jpg" /></a>',
        ),
      ),
    );

    const result = await getMetadata("Public Artwork Film", "movie", 2026, true);

    expect(result.metadata).toMatchObject({
      provider: "tmdb",
      providerUrl: "https://www.themoviedb.org/movie/123-example",
      poster: "https://image.tmdb.org/t/p/w780/poster123.jpg",
    });
  });
});
