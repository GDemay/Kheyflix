import { parseReleaseTitle, ReleaseMetadata } from "./release-parser";

const DEFAULT_LIMIT = 30;

export class ProwlarrError extends Error {
  constructor(
    message: string,
    public code = "PROWLARR_ERROR",
    public status = 502,
  ) {
    super(message);
  }
}

type ProwlarrRelease = {
  guid?: string;
  magnetUrl?: string;
  title?: string;
  size?: number;
  seeders?: number;
  peers?: number;
  indexer?: string;
  publishDate?: string;
  categories?: Array<{ id?: number; name?: string }>;
};

export type DiscoveryResult = {
  id: string;
  title: string;
  size: number;
  seeders: number;
  peers: number;
  source: string;
  publishedAt?: string;
  category: "movie" | "series" | "other";
  magnet: string;
  metadata: ReleaseMetadata;
};

const configuration = () => {
  const rawUrl = process.env.PROWLARR_URL?.trim();
  const apiKey = process.env.PROWLARR_API_KEY?.trim();
  if (!rawUrl || !apiKey)
    throw new ProwlarrError(
      "Discovery is not configured on this server.",
      "PROWLARR_NOT_CONFIGURED",
      503,
    );
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ProwlarrError(
      "Discovery has an invalid server URL.",
      "PROWLARR_INVALID_URL",
      503,
    );
  }
  const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:"))
    throw new ProwlarrError(
      "Discovery requires HTTPS.",
      "PROWLARR_INSECURE_URL",
      503,
    );
  return { baseUrl: url.toString().replace(/\/$/, ""), apiKey };
};

const categoryFor = (release: ProwlarrRelease) => {
  const categories = release.categories || [];
  if (categories.some((category) => Math.floor(Number(category.id) / 1000) === 5 || /\btv\b/i.test(category.name || "")))
    return "series" as const;
  if (categories.some((category) => Math.floor(Number(category.id) / 1000) === 2 || /movie/i.test(category.name || "")))
    return "movie" as const;
  return /\bS\d{1,2}E\d{1,3}\b|\bseason\s*\d+/i.test(release.title || "")
    ? ("series" as const)
    : ("other" as const);
};

const stableId = (magnet: string) => {
  const hash = magnet.match(/urn:btih:([^&]+)/i)?.[1] || magnet;
  return hash.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 64);
};

export async function searchProwlarr(query: string): Promise<DiscoveryResult[]> {
  const term = query.trim().replace(/\s+/g, " ").slice(0, 120);
  if (term.length < 2) return [];
  const { baseUrl, apiKey } = configuration();
  const url = new URL(`${baseUrl}/api/v1/search`);
  url.searchParams.set("query", term);
  url.searchParams.set("type", "search");
  url.searchParams.set("limit", String(DEFAULT_LIMIT));
  const response = await fetch(url, {
    headers: { "X-Api-Key": apiKey, Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok)
    throw new ProwlarrError(
      response.status === 401 || response.status === 403
        ? "Discovery credentials were rejected."
        : "Discovery is temporarily unavailable.",
      response.status === 401 || response.status === 403
        ? "PROWLARR_UNAUTHORIZED"
        : "PROWLARR_UNAVAILABLE",
      response.status === 401 || response.status === 403 ? 503 : 502,
    );
  const releases = (await response.json()) as ProwlarrRelease[];
  const seen = new Set<string>();
  return releases
    .flatMap((release): DiscoveryResult[] => {
      const magnet = [release.magnetUrl, release.guid].find((value) =>
        /^magnet:\?xt=urn:btih:[a-z0-9]+/i.test(value || ""),
      );
      const title = release.title?.trim();
      if (!magnet || !title) return [];
      const id = stableId(magnet);
      if (!id || seen.has(id)) return [];
      seen.add(id);
      return [
        {
          id,
          title,
          size: Number(release.size) || 0,
          seeders: Math.max(0, Number(release.seeders) || 0),
          peers: Math.max(0, Number(release.peers) || 0),
          source: release.indexer || "Kheyflix discovery",
          publishedAt: release.publishDate,
          category: categoryFor(release),
          magnet,
          metadata: parseReleaseTitle(title),
        },
      ];
    })
    .sort((a, b) => b.seeders - a.seeders || a.title.localeCompare(b.title))
    .slice(0, DEFAULT_LIMIT);
}
