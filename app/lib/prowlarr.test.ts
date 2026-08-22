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
});
