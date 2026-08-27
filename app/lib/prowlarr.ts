import { parseReleaseTitle, ReleaseMetadata } from "./release-parser";

const DEFAULT_LIMIT = 30;
const MAX_MOVIE_VALIDATION_REQUESTS = 12;
const MAX_MOVIE_CANDIDATES = Math.floor(MAX_MOVIE_VALIDATION_REQUESTS / 2);
const MOVIE_VALIDATION_CONCURRENCY = 3;

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

export type DiscoverySearchOptions = {
  kind?: "movie" | "series";
  season?: number;
  episode?: number;
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
  const privateHttp =
    url.hostname === "127.0.0.1" ||
    url.hostname === "localhost" ||
    url.hostname.endsWith(".railway.internal");
  if (url.protocol !== "https:" && !(privateHttp && url.protocol === "http:"))
    throw new ProwlarrError(
      "Discovery requires HTTPS.",
      "PROWLARR_INSECURE_URL",
      503,
    );
  return { baseUrl: url.toString().replace(/\/$/, ""), apiKey };
};

export async function isProwlarrReady() {
  try {
    const { baseUrl, apiKey } = configuration();
    const response = await fetch(new URL(`${baseUrl}/api/v1/health`), {
      headers: { "X-Api-Key": apiKey, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(2_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

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

const explicitlyRequiresCompatibility = (title: string) =>
  /(?:^|[ ._[\]()-])(?:x265|h[ ._-]?265|hevc|av1|xvid)(?=$|[ ._[\]()-])/i.test(title) ||
  /\.(?:mkv|webm|avi|mov|m2?ts)(?:$|[?#])/i.test(title);

const isOtherCategory = (release: ProwlarrRelease) =>
  Boolean(release.categories?.length) &&
  release.categories!.every((category) =>
    Math.floor(Number(category.id) / 1000) === 8 || /\bother\b/i.test(category.name || ""),
  );

type MovieIdentity = { path: string; title: string; year: number };

const normalizeIdentity = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const decodeHtml = (value: string) =>
  value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ");

const searchMovieIdentities = async (
  title: string,
  year: number,
): Promise<MovieIdentity[]> => {
  try {
    const url = new URL("https://www.themoviedb.org/search/movie");
    url.searchParams.set("query", `${title} y:${year}`);
    const response = await fetch(url, {
      headers: { "Accept-Language": "en-US,en;q=0.9" },
      cache: "no-store",
      signal: AbortSignal.timeout(7_000),
    });
    if (!response.ok)
      throw new ProwlarrError(
        "Movie validation is temporarily unavailable.",
        "MOVIE_VALIDATION_UNAVAILABLE",
        502,
      );
    const html = await response.text();
    const identities: MovieIdentity[] = [];
    const seen = new Set<string>();
    const cards = html.split(/class="comp:media-card[^"]*"/i).slice(1);
    for (const card of cards) {
      const body = card.slice(0, 5_000);
      const path = body.match(/data-media-type="movie"[^>]*href="(\/movie\/[^"]+)"/i)?.[1];
      const title = decodeHtml(body.match(/<img[^>]*alt="([^"]+)"/i)?.[1] || "").trim();
      const year = Number(
        body.match(/class="release_date[^"]*"[^>]*>[^<]*((?:19|20)\d{2})/i)?.[1],
      );
      if (!path || !title || !year || seen.has(path)) continue;
      seen.add(path);
      identities.push({ path, title, year });
    }
    return identities;
  } catch (error) {
    if (error instanceof ProwlarrError) throw error;
    throw new ProwlarrError(
      "Movie validation is temporarily unavailable.",
      "MOVIE_VALIDATION_UNAVAILABLE",
      502,
    );
  }
};

const movieAliases = async (identity: MovieIdentity) => {
  if (!/^\/movie\/\d+[a-z0-9/_-]*$/i.test(identity.path)) return [];
  try {
    const response = await fetch(`https://www.themoviedb.org${identity.path}/titles`, {
      headers: { "Accept-Language": "en-US,en;q=0.9" },
      cache: "no-store",
      signal: AbortSignal.timeout(7_000),
    });
    if (!response.ok)
      throw new ProwlarrError(
        "Movie validation is temporarily unavailable.",
        "MOVIE_VALIDATION_UNAVAILABLE",
        502,
      );
    const html = await response.text();
    return [...html.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
      .map((match) => decodeHtml(match[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim())
      .filter(Boolean);
  } catch (error) {
    if (error instanceof ProwlarrError) throw error;
    throw new ProwlarrError(
      "Movie validation is temporarily unavailable.",
      "MOVIE_VALIDATION_UNAVAILABLE",
      502,
    );
  }
};

const matchesMovieIdentity = async (
  metadata: ReleaseMetadata,
  identities: MovieIdentity[],
  aliasesFor: (identity: MovieIdentity) => Promise<string[]>,
) => {
  if (!metadata.year) return false;
  const releaseTitle = normalizeIdentity(metadata.displayTitle);
  for (const identity of identities) {
    if (identity.year !== metadata.year) continue;
    const movieTitle = normalizeIdentity(identity.title);
    if (releaseTitle === movieTitle) return true;
    const aliases = await aliasesFor(identity);
    if (aliases.some((alias) => normalizeIdentity(alias) === releaseTitle)) return true;
  }
  return false;
};

const fallbackMovieKey = (metadata: ReleaseMetadata) =>
  `${normalizeIdentity(metadata.displayTitle)}:${metadata.year || ""}`;

const isFallbackMovieCandidate = (
  release: ProwlarrRelease,
  metadata: ReleaseMetadata,
) => {
  const inferredCategory = categoryFor(release);
  return (
    (inferredCategory === "movie" || isOtherCategory(release)) &&
    metadata.year !== undefined &&
    metadata.resolution !== undefined &&
    (metadata.sourceType !== undefined || metadata.videoCodec === "H.264") &&
    metadata.season === undefined &&
    metadata.episode === undefined &&
    !metadata.seasonPack &&
    !explicitlyRequiresCompatibility(release.title || "")
  );
};

const validateFallbackMovies = async (releases: ProwlarrRelease[]) => {
  const unique = new Map<string, ReleaseMetadata>();
  for (const release of [...releases].sort(
    (a, b) => Math.max(0, Number(b.seeders) || 0) - Math.max(0, Number(a.seeders) || 0),
  )) {
    const metadata = parseReleaseTitle(release.title || "");
    if (!isFallbackMovieCandidate(release, metadata)) continue;
    const key = fallbackMovieKey(metadata);
    if (!unique.has(key)) unique.set(key, metadata);
    if (unique.size >= MAX_MOVIE_CANDIDATES) break;
  }
  const entries = [...unique.entries()];
  const verified = new Set<string>();
  const aliasRequests = new Map<string, Promise<string[]>>();
  let remainingAliasRequests = Math.max(
    0,
    MAX_MOVIE_VALIDATION_REQUESTS - entries.length,
  );
  const aliasesFor = (identity: MovieIdentity) => {
    if (!aliasRequests.has(identity.path)) {
      if (remainingAliasRequests <= 0) return Promise.resolve([]);
      remainingAliasRequests -= 1;
      aliasRequests.set(identity.path, movieAliases(identity));
    }
    return aliasRequests.get(identity.path)!;
  };
  for (let offset = 0; offset < entries.length; offset += MOVIE_VALIDATION_CONCURRENCY) {
    const batch = entries.slice(offset, offset + MOVIE_VALIDATION_CONCURRENCY);
    const results = await Promise.all(batch.map(async ([key, metadata]) => ({
      key,
      matches: await matchesMovieIdentity(
        metadata,
        await searchMovieIdentities(metadata.displayTitle, metadata.year!),
        aliasesFor,
      ),
    })));
    for (const result of results) if (result.matches) verified.add(result.key);
  }
  return verified;
};

export async function searchProwlarr(query: string, options: DiscoverySearchOptions = {}): Promise<DiscoveryResult[]> {
  const term = query.trim().replace(/\s+/g, " ").slice(0, 120);
  if (term.length < 2) return [];
  const { baseUrl, apiKey } = configuration();
  const url = new URL(`${baseUrl}/api/v1/search`);
  const season = options.kind === "series" && Number.isInteger(options.season) && Number(options.season) > 0
    ? Math.min(99, Number(options.season)) : undefined;
  const episode = season && Number.isInteger(options.episode) && Number(options.episode) > 0
    ? Math.min(999, Number(options.episode)) : undefined;
  const episodeSuffix = season ? ` S${String(season).padStart(2, "0")}${episode ? `E${String(episode).padStart(2, "0")}` : ""}` : "";
  url.searchParams.set("query", `${term}${episodeSuffix}`);
  url.searchParams.set("type", "search");
  url.searchParams.set("limit", String(DEFAULT_LIMIT));
  if (options.kind) url.searchParams.set("categories", options.kind === "movie" ? "2000" : "5000");
  const requestReleases = async (requestUrl: URL) => {
    const response = await fetch(requestUrl, {
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
    return (await response.json()) as ProwlarrRelease[];
  };
  const seen = new Set<string>();
  const normalize = async (
    releases: ProwlarrRelease[],
    verifiedFallbackMovies?: Set<string>,
  ) => {
    const normalized = await Promise.all(releases.map(async (release): Promise<DiscoveryResult | null> => {
      const magnet = [release.magnetUrl, release.guid].find((value) =>
        /^magnet:\?xt=urn:btih:[a-z0-9]+/i.test(value || ""),
      );
      const title = release.title?.trim();
      if (!magnet || !title) return null;
      const metadata = parseReleaseTitle(title);
      const inferredCategory = categoryFor(release);
      if (verifiedFallbackMovies && options.kind === "movie") {
        if (
          !isFallbackMovieCandidate(release, metadata) ||
          !verifiedFallbackMovies.has(fallbackMovieKey(metadata))
        ) return null;
      } else if (
        options.kind &&
        release.categories?.length &&
        inferredCategory !== options.kind
      ) return null;
      const category = options.kind || inferredCategory;
      if (category === "movie" && explicitlyRequiresCompatibility(title)) return null;
      if (season && metadata.season !== season) return null;
      if (episode && (metadata.episode === undefined || episode < metadata.episode || episode > (metadata.episodeEnd || metadata.episode))) return null;
      const id = stableId(magnet);
      if (!id || seen.has(id)) return null;
      seen.add(id);
      return {
        id,
        title,
        size: Number(release.size) || 0,
        seeders: Math.max(0, Number(release.seeders) || 0),
        peers: Math.max(0, Number(release.peers) || 0),
        source: release.indexer || "Kheyflix discovery",
        publishedAt: release.publishDate,
        category,
        magnet,
        metadata,
      };
    }));
    return normalized
    .filter((result): result is DiscoveryResult => result !== null)
    .sort((a, b) => b.seeders - a.seeders || a.title.localeCompare(b.title))
    .slice(0, DEFAULT_LIMIT);
  };

  const scopedResults = await normalize(await requestReleases(url));
  if (scopedResults.length || options.kind !== "movie") return scopedResults;

  const fallbackUrl = new URL(url);
  fallbackUrl.searchParams.delete("categories");
  const fallbackReleases = await requestReleases(fallbackUrl);
  if (!fallbackReleases.length) return [];
  return normalize(fallbackReleases, await validateFallbackMovies(fallbackReleases));
}
