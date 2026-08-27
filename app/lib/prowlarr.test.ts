import { afterEach, describe, expect, it, vi } from "vitest";
import { ProwlarrError, searchProwlarr } from "./prowlarr";

afterEach(() => {
  delete process.env.PROWLARR_URL;
  delete process.env.PROWLARR_API_KEY;
  vi.unstubAllGlobals();
});

describe("Prowlarr discovery", () => {
  it("requires server-side configuration", async () => {
    await expect(searchProwlarr("Ubuntu")).rejects.toBeInstanceOf(ProwlarrError);
  });

  it("returns only deduplicated magnet-backed results", async () => {
    process.env.PROWLARR_URL = "https://prowlarr.test";
    process.env.PROWLARR_API_KEY = "server-only-key";
    const magnet = "magnet:?xt=urn:btih:ABC123&dn=Ubuntu";
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json([
        {
          title: "Ubuntu Desktop",
          guid: magnet,
          size: 1024,
          seeders: 20,
          indexer: "Open source",
          categories: [{ id: 2000, name: "Movies" }],
        },
        { title: "Duplicate", magnetUrl: magnet, seeders: 2 },
        { title: "No magnet", guid: "https://example.test/file" },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(searchProwlarr("Ubuntu")).resolves.toEqual([
      expect.objectContaining({
        id: "abc123",
        title: "Ubuntu Desktop",
        seeders: 20,
        category: "movie",
        magnet,
        metadata: expect.objectContaining({ displayTitle: "Ubuntu Desktop" }),
      }),
    ]);
    expect(fetchMock.mock.calls[0][0].searchParams.get("query")).toBe("Ubuntu");
    expect(fetchMock.mock.calls[0][1].headers["X-Api-Key"]).toBe("server-only-key");
  });

  it("rejects a remote non-HTTPS server", async () => {
    process.env.PROWLARR_URL = "http://prowlarr.test";
    process.env.PROWLARR_API_KEY = "key";
    await expect(searchProwlarr("Ubuntu")).rejects.toMatchObject({
      code: "PROWLARR_INSECURE_URL",
    });
  });

  it("allows HTTP over Railway private networking", async () => {
    process.env.PROWLARR_URL = "http://prowlarr.railway.internal:9696";
    process.env.PROWLARR_API_KEY = "key";
    const fetchMock = vi.fn().mockResolvedValue(Response.json([]));
    vi.stubGlobal("fetch", fetchMock);

    await expect(searchProwlarr("Shrek")).resolves.toEqual([]);
    expect(fetchMock.mock.calls[0][0]).toMatchObject({
      hostname: "prowlarr.railway.internal",
      port: "9696",
    });
  });

  it("scopes series searches to a selected season and episode", async () => {
    process.env.PROWLARR_URL = "https://prowlarr.test";
    process.env.PROWLARR_API_KEY = "key";
    const fetchMock = vi.fn().mockResolvedValue(Response.json([
      { title: "Example.Show.S02E03-E04.1080p", magnetUrl: "magnet:?xt=urn:btih:ABC123", categories: [{ id: 5000, name: "TV" }] },
      { title: "Example.Show.S01E03.1080p", magnetUrl: "magnet:?xt=urn:btih:DEF456", categories: [{ id: 5000, name: "TV" }] },
      { title: "Example.Movie.2025.1080p", magnetUrl: "magnet:?xt=urn:btih:ABC789", categories: [{ id: 2000, name: "Movies" }] },
    ]));
    vi.stubGlobal("fetch", fetchMock);

    const results = await searchProwlarr("Example Show", { kind: "series", season: 2, episode: 4 });
    expect(results).toHaveLength(1);
    expect(results[0].metadata).toMatchObject({ season: 2, episode: 3, episodeEnd: 4 });
    const requestedUrl = fetchMock.mock.calls[0][0] as URL;
    expect(requestedUrl.searchParams.get("query")).toBe("Example Show S02E04");
    expect(requestedUrl.searchParams.get("categories")).toBe("5000");
  });

  it("requests movie sources and rejects explicitly non-video releases", async () => {
    process.env.PROWLARR_URL = "https://prowlarr.test";
    process.env.PROWLARR_API_KEY = "key";
    const fetchMock = vi.fn().mockResolvedValue(Response.json([
      {
        title: "Pokemon Legends Z-A [FitGirl Repack]",
        magnetUrl: "magnet:?xt=urn:btih:GAME001",
        categories: [{ id: 4050, name: "PC Games" }],
      },
      {
        title: "Pokemon Detective Pikachu 2019 1080p x264",
        magnetUrl: "magnet:?xt=urn:btih:MOVIE01",
        categories: [{ id: 2000, name: "Movies" }],
      },
    ]));
    vi.stubGlobal("fetch", fetchMock);

    const results = await searchProwlarr("Pokemon", { kind: "movie" });

    expect(results.map((result) => result.title)).toEqual([
      "Pokemon Detective Pikachu 2019 1080p x264",
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestedUrl = fetchMock.mock.calls[0][0] as URL;
    expect(requestedUrl.searchParams.get("categories")).toBe("2000");
  });

  it("falls back from an empty scoped movie search to compatible year-bearing movie releases", async () => {
    process.env.PROWLARR_URL = "https://prowlarr.test";
    process.env.PROWLARR_API_KEY = "key";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json([]))
      .mockResolvedValueOnce(Response.json([
        {
          title: "Star Wars Episode IV A New Hope 1977 1080p BluRay x264",
          magnetUrl: "magnet:?xt=urn:btih:MOVIE01",
          categories: [{ id: 8000, name: "Other" }],
        },
        {
          title: "Star Wars Andor 2022 S01E01 1080p WEB-DL x264",
          magnetUrl: "magnet:?xt=urn:btih:SERIES1",
          categories: [{ id: 8000, name: "Other" }],
        },
        {
          title: "Star Wars Game 2024 FitGirl Repack",
          magnetUrl: "magnet:?xt=urn:btih:GAME001",
          categories: [{ id: 4050, name: "PC Games" }],
        },
        {
          title: "Star Wars Episode V 1980 1080p BluRay x265 HEVC",
          magnetUrl: "magnet:?xt=urn:btih:HEVC001",
          categories: [{ id: 8000, name: "Other" }],
        },
        {
          title: "Star Wars Jedi Survivor 2023 FitGirl Repack",
          magnetUrl: "magnet:?xt=urn:btih:GAME002",
          categories: [{ id: 8000, name: "Other" }],
        },
        {
          title: "Star Wars Rebels Complete Series 2014 1080p x264",
          magnetUrl: "magnet:?xt=urn:btih:SERIES2",
          categories: [{ id: 8000, name: "Other" }],
        },
        {
          title: "Star Wars Jedi Survivor FitGirl Repack",
          magnetUrl: "magnet:?xt=urn:btih:GAME003",
        },
        {
          title: "Star Wars Outlaws 2024 RUNE",
          magnetUrl: "magnet:?xt=urn:btih:GAME004",
          categories: [{ id: 8000, name: "Other" }],
        },
        {
          title: "Star Wars Empire at War 2006 PC ISO",
          magnetUrl: "magnet:?xt=urn:btih:GAME005",
          categories: [{ id: 8000, name: "Other" }],
        },
        {
          title: "Star Wars Rebels Complete Collection 2014 1080p BluRay x264",
          magnetUrl: "magnet:?xt=urn:btih:SERIES3",
          categories: [{ id: 8000, name: "Other" }],
        },
        {
          title: "Star Wars Original Soundtrack 1977 FLAC",
          magnetUrl: "magnet:?xt=urn:btih:AUDIO01",
          categories: [{ id: 8000, name: "Other" }],
        },
        {
          title: "Star Wars Rebels TV Series 2014 1080p WEB-DL x264",
          magnetUrl: "magnet:?xt=urn:btih:SERIES4",
          categories: [{ id: 8000, name: "Other" }],
        },
        {
          title: "Star Wars Rebels All Episodes 2014 1080p WEB-DL x264",
          magnetUrl: "magnet:?xt=urn:btih:SERIES5",
          categories: [{ id: 8000, name: "Other" }],
        },
        {
          title: "Star Wars Battlefront II Gameplay 2017 1080p x264",
          magnetUrl: "magnet:?xt=urn:btih:GAME006",
          categories: [{ id: 8000, name: "Other" }],
        },
        {
          title: "Star Wars Original Soundtrack 1977 1080p BluRay Audio FLAC",
          magnetUrl: "magnet:?xt=urn:btih:AUDIO02",
          categories: [{ id: 8000, name: "Other" }],
        },
        {
          title: "Star Wars Episode IV Original Soundtrack 1977 1080p BluRay Audio FLAC",
          magnetUrl: "magnet:?xt=urn:btih:AUDIO03",
          categories: [{ id: 8000, name: "Other" }],
        },
        {
          title: "Obi-Wan Kenobi Miniseries 2022 1080p WEB-DL x264",
          magnetUrl: "magnet:?xt=urn:btih:SERIES6",
          categories: [{ id: 8000, name: "Other" }],
        },
        {
          title: "Star Wars Rebels Series 1 2014 1080p WEB-DL x264",
          magnetUrl: "magnet:?xt=urn:btih:SERIES7",
          categories: [{ id: 8000, name: "Other" }],
        },
        {
          title: "Star Wars Jedi Survivor Walkthrough 2023 1080p x264",
          magnetUrl: "magnet:?xt=urn:btih:GAME007",
          categories: [{ id: 8000, name: "Other" }],
        },
        {
          title: "Ahsoka Limited Series 2023 1080p WEB-DL x264",
          magnetUrl: "magnet:?xt=urn:btih:SERIES8",
          categories: [{ id: 8000, name: "Other" }],
        },
        {
          title: "Star Wars Rebels Season One 2014 1080p WEB-DL x264",
          magnetUrl: "magnet:?xt=urn:btih:SERIES9",
          categories: [{ id: 8000, name: "Other" }],
        },
        {
          title: "Star Wars Jedi Survivor Longplay 2023 1080p x264",
          magnetUrl: "magnet:?xt=urn:btih:GAME008",
          categories: [{ id: 8000, name: "Other" }],
        },
        {
          title: "Star Wars Rebels Series One 2014 1080p WEB-DL x264",
          magnetUrl: "magnet:?xt=urn:btih:SERIES10",
          categories: [{ id: 8000, name: "Other" }],
        },
        {
          title: "Star Wars Jedi Survivor Full Game 2023 1080p x264",
          magnetUrl: "magnet:?xt=urn:btih:GAME009",
          categories: [{ id: 8000, name: "Other" }],
        },
      ]))
      .mockImplementation(async (input) => {
        const requestedUrl = new URL(String(input));
        if (requestedUrl.pathname.endsWith("/movie/11-star-wars/titles"))
          return new Response(`
            <table><tr><td>Star Wars Episode IV A New Hope</td><td>reissue title</td></tr></table>
          `);
        const searchedTitle = requestedUrl.searchParams.get("query");
        if (
          searchedTitle !== "Star Wars Episode IV A New Hope y:1977" &&
          searchedTitle !== "Star Wars Original Soundtrack y:1977" &&
          searchedTitle !== "Star Wars Episode IV Original Soundtrack y:1977"
        )
          return new Response("No movie result");
        return new Response(`
          <div class="comp:media-card">
            <a data-media-type="movie" href="/movie/11-star-wars">
              <img alt="Star Wars" src="https://media.themoviedb.org/t/p/w94_and_h141_face/poster.jpg" />
            </a>
            <h2><span>Star Wars</span></h2>
            <span class="release_date">October 19, 1977</span>
          </div>
        `);
      });
    vi.stubGlobal("fetch", fetchMock);

    const results = await searchProwlarr("Star wars", { kind: "movie" });

    expect(results.map((result) => result.title)).toEqual([
      "Star Wars Episode IV A New Hope 1977 1080p BluRay x264",
    ]);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(3);
    expect((fetchMock.mock.calls[0][0] as URL).searchParams.get("categories")).toBe("2000");
    expect((fetchMock.mock.calls[1][0] as URL).searchParams.get("categories")).toBeNull();
    expect(fetchMock.mock.calls.slice(2).some(([input]) =>
      String(input).includes("themoviedb.org/search/movie?query=Star+Wars+Episode+IV+A+New+Hope+y%3A1977"),
    )).toBe(true);
  });

  it("deduplicates and bounds authoritative fallback validation", async () => {
    process.env.PROWLARR_URL = "https://prowlarr.test";
    process.env.PROWLARR_API_KEY = "key";
    const releases = Array.from({ length: 14 }, (_, index) => ({
      title: index < 2
        ? "Repeated Movie 2020 1080p WEB-DL x264"
        : `Candidate Movie ${2009 + index} 1080p WEB-DL x264`,
      magnetUrl: `magnet:?xt=urn:btih:BOUND${String(index).padStart(2, "0")}`,
      seeders: 100 - index,
      categories: [{ id: 8000, name: "Other" }],
    }));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json([]))
      .mockResolvedValueOnce(Response.json(releases))
      .mockImplementation(async (input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/titles"))
          return new Response("<table><tr><td>No matching alias</td></tr></table>");
        const query = url.searchParams.get("query") || "";
        const year = query.match(/y:(\d{4})/)?.[1] || "2020";
        return new Response(`
          <div class="comp:media-card">
            <a data-media-type="movie" href="/movie/${year}-provider-title">
              <img alt="Provider Title" />
            </a>
            <span class="release_date">January 1, ${year}</span>
          </div>
          <div class="comp:media-card">
            <a data-media-type="movie" href="/movie/${year}-another-title">
              <img alt="Another Provider Title" />
            </a>
            <span class="release_date">February 1, ${year}</span>
          </div>
        `);
      });
    vi.stubGlobal("fetch", fetchMock);

    await searchProwlarr("Candidate Movie", { kind: "movie" });

    const validationRequests = fetchMock.mock.calls.slice(2).map(([input]) =>
      new URL(String(input)),
    );
    const validationQueries = validationRequests
      .filter((url) => url.pathname === "/search/movie")
      .map((url) => url.searchParams.get("query"));
    expect(validationRequests.length).toBeLessThanOrEqual(12);
    expect(validationQueries).toHaveLength(6);
    expect(validationQueries.filter((query) => query === "Repeated Movie y:2020")).toHaveLength(1);
  });

  it("accepts an exact authoritative alternate movie title", async () => {
    process.env.PROWLARR_URL = "https://prowlarr.test";
    process.env.PROWLARR_API_KEY = "key";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json([]))
      .mockResolvedValueOnce(Response.json([{
        title: "Star Wars A New Hope 1977 1080p BluRay x264",
        magnetUrl: "magnet:?xt=urn:btih:ALIAS01",
        categories: [{ id: 8000, name: "Other" }],
      }]))
      .mockResolvedValueOnce(new Response(`
        <div class="comp:media-card">
          <a data-media-type="movie" href="/movie/11-star-wars">
            <img alt="Star Wars" />
          </a>
          <span class="release_date">October 19, 1977</span>
        </div>
      `))
      .mockResolvedValueOnce(new Response(`
        <table><tr><td>Star Wars: A New Hope</td><td>reissue title</td></tr></table>
      `));
    vi.stubGlobal("fetch", fetchMock);

    const results = await searchProwlarr("Star wars", { kind: "movie" });

    expect(results.map((result) => result.title)).toEqual([
      "Star Wars A New Hope 1977 1080p BluRay x264",
    ]);
    expect(String(fetchMock.mock.calls[3][0])).toContain("/movie/11-star-wars/titles");
  });

  it("surfaces authoritative movie validation outages", async () => {
    process.env.PROWLARR_URL = "https://prowlarr.test";
    process.env.PROWLARR_API_KEY = "key";
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(Response.json([]))
        .mockResolvedValueOnce(Response.json([{
          title: "Candidate Movie 2020 1080p WEB-DL x264",
          magnetUrl: "magnet:?xt=urn:btih:OUTAGE1",
          categories: [{ id: 8000, name: "Other" }],
        }]))
        .mockResolvedValueOnce(new Response("Unavailable", { status: 503 })),
    );

    await expect(searchProwlarr("Candidate Movie", { kind: "movie" })).rejects.toMatchObject({
      code: "MOVIE_VALIDATION_UNAVAILABLE",
      status: 502,
    });
  });

  it("uses the requested kind when Prowlarr omits category metadata", async () => {
    process.env.PROWLARR_URL = "https://prowlarr.test";
    process.env.PROWLARR_API_KEY = "key";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json([
          {
            title: "Example.Movie.2025.1080p",
            magnetUrl: "magnet:?xt=urn:btih:ABC789",
          },
        ]),
      ),
    );

    const results = await searchProwlarr("Example Movie", { kind: "movie" });
    expect(results).toHaveLength(1);
    expect(results[0].category).toBe("movie");
  });

  it("omits movie releases that explicitly require compatibility conversion", async () => {
    process.env.PROWLARR_URL = "https://prowlarr.test";
    process.env.PROWLARR_API_KEY = "key";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json([
      { title: "Direct.Movie.2026.1080p.WEB-DL.x264", magnetUrl: "magnet:?xt=urn:btih:DIRECT1" },
      { title: "Converted.Movie.2026.1080p.HEVC.x265", magnetUrl: "magnet:?xt=urn:btih:HEVC001" },
      { title: "Matroska.Movie.2026.1080p.mkv", magnetUrl: "magnet:?xt=urn:btih:MKV0001" },
    ])));

    const results = await searchProwlarr("Movie", { kind: "movie" });
    expect(results.map((result) => result.title)).toEqual([
      "Direct.Movie.2026.1080p.WEB-DL.x264",
    ]);
  });
});
