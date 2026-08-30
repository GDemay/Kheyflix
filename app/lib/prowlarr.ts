import { parseReleaseTitle, ReleaseMetadata } from "./release-parser";

const DEFAULT_LIMIT = 30;
const MAX_MOVIE_VALIDATION_REQUESTS = 12;
const MAX_MOVIE_CANDIDATES = Math.floor(MAX_MOVIE_VALIDATION_REQUESTS / 2);
const MOVIE_VALIDATION_CONCURRENCY = 3;
const PROWLARR_REQUEST_TIMEOUT_MS = 15_000;
const PROWLARR_RETRY_DELAY_MS = 200;
const PROWLARR_REQUEST_ATTEMPT_MAX_MS = 7_300;
const MOVIE_VALIDATION_REQUEST_MAX_MS = 7_000;
const DEFAULT_DISCOVERY_SEARCH_TIMEOUT_MS = 14_000;
const PROWLARR_HEALTH_TIMEOUT_MS = 2_000;
const PROWLARR_HEALTH_FRESH_MS = 60_000;

type ProwlarrHealthCacheEntry = { value: boolean; updatedAt: number };
const shared = globalThis as typeof globalThis & {
  __kheyflixProwlarrHealth?: ProwlarrHealthCacheEntry;
  __kheyflixProwlarrHealthRequest?: Promise<boolean>;
};

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

export type DiscoverySearchControl = {
  signal?: AbortSignal;
  timeoutMs?: number;
};

export const prowlarrAttemptTimeout = (
  startedAt: number,
  now = performance.now(),
  budgetMs = PROWLARR_REQUEST_TIMEOUT_MS,
) => {
  const remaining = budgetMs - (now - startedAt);
  if (remaining <= 0) return 0;
  return Math.max(
    1,
    Math.floor(Math.min(PROWLARR_REQUEST_ATTEMPT_MAX_MS, remaining)),
  );
};

type DiscoveryProviderResponse = {
  response: Response;
  read: <T>(body: Promise<T>) => Promise<T>;
  release: () => void;
};

type DiscoverySearchExecution = {
  startedAt: number;
  timeoutMs: number;
  signal: AbortSignal;
  dispose: () => void;
  remainingMs: () => number;
  throwIfStopped: () => void;
  wait: (milliseconds: number) => Promise<void>;
  request: (
    input: RequestInfo | URL,
    init: RequestInit,
    maximumMs: number,
  ) => Promise<DiscoveryProviderResponse>;
};

const discoveryStopped = (cancelled: boolean) =>
  new ProwlarrError(
    cancelled
      ? "Discovery search was cancelled."
      : "Search timed out. Please try again.",
    cancelled ? "DISCOVERY_CANCELLED" : "DISCOVERY_TIMEOUT",
    cancelled ? 499 : 504,
  );

const normalizedSearchTimeout = (timeoutMs: number | undefined) => {
  if (timeoutMs === undefined) return DEFAULT_DISCOVERY_SEARCH_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs)) return DEFAULT_DISCOVERY_SEARCH_TIMEOUT_MS;
  return Math.max(0, Math.floor(timeoutMs));
};

const createDiscoverySearchExecution = (
  control: DiscoverySearchControl,
): DiscoverySearchExecution => {
  const startedAt = performance.now();
  const timeoutMs = normalizedSearchTimeout(control.timeoutMs);
  const deadline = new AbortController();
  const deadlineTimer = setTimeout(() => deadline.abort(), timeoutMs);
  const signal = control.signal
    ? AbortSignal.any([control.signal, deadline.signal])
    : deadline.signal;
  const remainingMs = () =>
    Math.max(0, Math.floor(timeoutMs - (performance.now() - startedAt)));
  const stopped = () => discoveryStopped(Boolean(control.signal?.aborted));
  const throwIfStopped = () => {
    if (signal.aborted || remainingMs() <= 0) throw stopped();
  };
  const responseBody = <T>(body: Promise<T>, providerSignal?: AbortSignal) => {
    throwIfStopped();
    return new Promise<T>((resolve, reject) => {
      const signals = providerSignal ? [signal, providerSignal] : [signal];
      const finish = () => {
        for (const candidate of signals)
          candidate.removeEventListener("abort", abort);
      };
      const abort = () => {
        finish();
        reject(
          signal.aborted || remainingMs() <= 0
            ? stopped()
            : new DOMException("Provider request timed out.", "AbortError"),
        );
      };
      for (const candidate of signals)
        candidate.addEventListener("abort", abort, { once: true });
      body.then(
        (value) => {
          finish();
          try {
            throwIfStopped();
            if (providerSignal?.aborted)
              throw new DOMException("Provider request timed out.", "AbortError");
            resolve(value);
          } catch (error) {
            reject(error);
          }
        },
        (error) => {
          finish();
          try {
            throwIfStopped();
          } catch (stoppedError) {
            reject(stoppedError);
            return;
          }
          reject(error);
        },
      );
    });
  };
  const wait = (milliseconds: number) => {
    throwIfStopped();
    return new Promise<void>((resolve, reject) => {
      const finish = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
      };
      const abort = () => {
        finish();
        reject(stopped());
      };
      const timer = setTimeout(() => {
        finish();
        try {
          throwIfStopped();
          resolve();
        } catch (error) {
          reject(error);
        }
      }, milliseconds);
      signal.addEventListener("abort", abort, { once: true });
    });
  };
  const request = async (
    input: RequestInfo | URL,
    init: RequestInit,
    maximumMs: number,
  ) => {
    throwIfStopped();
    const providerRequest = new AbortController();
    const requestTimer = setTimeout(
      () => providerRequest.abort(),
      Math.max(1, Math.min(maximumMs, remainingMs())),
    );
    const providerSignal = AbortSignal.any([signal, providerRequest.signal]);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      clearTimeout(requestTimer);
      providerRequest.abort();
    };
    try {
      const response = await responseBody(
        globalThis.fetch(input, {
          ...init,
          signal: providerSignal,
        }),
        providerSignal,
      );
      return {
        response,
        read: async <T>(body: Promise<T>) => {
          try {
            return await responseBody(body, providerSignal);
          } finally {
            release();
          }
        },
        release,
      };
    } catch (error) {
      release();
      throw error;
    }
  };
  return {
    startedAt,
    timeoutMs,
    signal,
    dispose: () => {
      clearTimeout(deadlineTimer);
      deadline.abort();
    },
    remainingMs,
    throwIfStopped,
    wait,
    request,
  };
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
  if (!process.env.PROWLARR_URL?.trim() || !process.env.PROWLARR_API_KEY?.trim())
    return false;
  const now = Date.now(), cached = shared.__kheyflixProwlarrHealth;
  if (
    process.env.NODE_ENV !== "test" &&
    cached &&
    now - cached.updatedAt < PROWLARR_HEALTH_FRESH_MS
  )
    return cached.value;
  if (shared.__kheyflixProwlarrHealthRequest)
    return shared.__kheyflixProwlarrHealthRequest;
  const healthRequest = (async () => {
    try {
      const { baseUrl, apiKey } = configuration();
      const response = await fetch(new URL(`${baseUrl}/api/v1/health`), {
        headers: { "X-Api-Key": apiKey, Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(PROWLARR_HEALTH_TIMEOUT_MS),
      });
      return response.ok;
    } catch {
      return false;
    }
  })()
    .then((value) => {
      shared.__kheyflixProwlarrHealth = { value, updatedAt: Date.now() };
      return value;
    })
    .finally(() => {
      shared.__kheyflixProwlarrHealthRequest = undefined;
    });
  shared.__kheyflixProwlarrHealthRequest = healthRequest;
  return healthRequest;
}

export const clearProwlarrHealthForTests = () => {
  shared.__kheyflixProwlarrHealth = undefined;
  shared.__kheyflixProwlarrHealthRequest = undefined;
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

const isMkvRelease = (title: string) =>
  /\.mkv(?:$|[ ._[\](),-]|[?#])/i.test(title);

const explicitlyRequiresCompatibility = (title: string) =>
  !isMkvRelease(title) &&
  (/(?:^|[ ._[\]()-])(?:x265|h[ ._-]?265|hevc|av1|xvid)(?=$|[ ._[\]()-])/i.test(title) ||
    /\.(?:webm|avi|mov|m2?ts)(?:$|[?#])/i.test(title));

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
  execution: DiscoverySearchExecution,
): Promise<MovieIdentity[]> => {
  try {
    execution.throwIfStopped();
    const url = new URL("https://www.themoviedb.org/search/movie");
    url.searchParams.set("query", `${title} y:${year}`);
    const provider = await execution.request(
      url,
      {
        headers: { "Accept-Language": "en-US,en;q=0.9" },
        cache: "no-store",
      },
      MOVIE_VALIDATION_REQUEST_MAX_MS,
    );
    try {
      if (!provider.response.ok)
        throw new ProwlarrError(
          "Movie validation is temporarily unavailable.",
          "MOVIE_VALIDATION_UNAVAILABLE",
          502,
        );
      const html = await provider.read(provider.response.text());
      execution.throwIfStopped();
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
    } finally {
      provider.release();
    }
  } catch (error) {
    if (error instanceof ProwlarrError) throw error;
    throw new ProwlarrError(
      "Movie validation is temporarily unavailable.",
      "MOVIE_VALIDATION_UNAVAILABLE",
      502,
    );
  }
};

const movieAliases = async (
  identity: MovieIdentity,
  execution: DiscoverySearchExecution,
) => {
  if (!/^\/movie\/\d+[a-z0-9/_-]*$/i.test(identity.path)) return [];
  try {
    execution.throwIfStopped();
    const provider = await execution.request(
      `https://www.themoviedb.org${identity.path}/titles`,
      {
        headers: { "Accept-Language": "en-US,en;q=0.9" },
        cache: "no-store",
      },
      MOVIE_VALIDATION_REQUEST_MAX_MS,
    );
    try {
      if (!provider.response.ok)
        throw new ProwlarrError(
          "Movie validation is temporarily unavailable.",
          "MOVIE_VALIDATION_UNAVAILABLE",
          502,
        );
      const html = await provider.read(provider.response.text());
      execution.throwIfStopped();
      return [...html.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
        .map((match) => decodeHtml(match[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim())
        .filter(Boolean);
    } finally {
      provider.release();
    }
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
  execution: DiscoverySearchExecution,
) => {
  if (!metadata.year) return false;
  const releaseTitle = normalizeIdentity(metadata.displayTitle);
  for (const identity of identities) {
    execution.throwIfStopped();
    if (identity.year !== metadata.year) continue;
    const movieTitle = normalizeIdentity(identity.title);
    if (releaseTitle === movieTitle) return true;
    const aliases = await aliasesFor(identity);
    execution.throwIfStopped();
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

const validateFallbackMovies = async (
  releases: ProwlarrRelease[],
  execution: DiscoverySearchExecution,
) => {
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
    execution.throwIfStopped();
    if (!aliasRequests.has(identity.path)) {
      if (remainingAliasRequests <= 0) return Promise.resolve([]);
      remainingAliasRequests -= 1;
      aliasRequests.set(identity.path, movieAliases(identity, execution));
    }
    return aliasRequests.get(identity.path)!;
  };
  for (let offset = 0; offset < entries.length; offset += MOVIE_VALIDATION_CONCURRENCY) {
    execution.throwIfStopped();
    const batch = entries.slice(offset, offset + MOVIE_VALIDATION_CONCURRENCY);
    const results = await Promise.all(batch.map(async ([key, metadata]) => ({
      key,
      matches: await matchesMovieIdentity(
        metadata,
        await searchMovieIdentities(metadata.displayTitle, metadata.year!, execution),
        aliasesFor,
        execution,
      ),
    })));
    execution.throwIfStopped();
    for (const result of results) if (result.matches) verified.add(result.key);
  }
  return verified;
};

export async function searchProwlarr(
  query: string,
  options: DiscoverySearchOptions = {},
  control: DiscoverySearchControl = {},
): Promise<DiscoveryResult[]> {
  const term = query.trim().replace(/\s+/g, " ").slice(0, 120);
  if (term.length < 2) return [];
  const execution = createDiscoverySearchExecution(control);
  try {
    execution.throwIfStopped();
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
      for (let attempt = 0; attempt < 2; attempt += 1) {
        execution.throwIfStopped();
        const timeout = prowlarrAttemptTimeout(
          execution.startedAt,
          performance.now(),
          execution.timeoutMs,
        );
        if (!timeout) break;
        try {
          const provider = await execution.request(
            requestUrl,
            {
              headers: { "X-Api-Key": apiKey, Accept: "application/json" },
              cache: "no-store",
            },
            timeout,
          );
          try {
            if (provider.response.ok)
              return await provider.read(provider.response.json()) as ProwlarrRelease[];
            const unauthorized = provider.response.status === 401 || provider.response.status === 403,
              transient = provider.response.status === 429 || provider.response.status >= 500;
            if (
              transient &&
              attempt === 0 &&
              execution.remainingMs() > PROWLARR_RETRY_DELAY_MS
            ) {
              provider.release();
              await execution.wait(PROWLARR_RETRY_DELAY_MS);
              continue;
            }
            throw new ProwlarrError(
              unauthorized
                ? "Discovery credentials were rejected."
                : "Discovery is temporarily unavailable.",
              unauthorized ? "PROWLARR_UNAUTHORIZED" : "PROWLARR_UNAVAILABLE",
              unauthorized ? 503 : 502,
            );
          } finally {
            provider.release();
          }
        } catch (error) {
          if (error instanceof ProwlarrError) throw error;
          execution.throwIfStopped();
          if (
            attempt === 0 &&
            execution.remainingMs() > PROWLARR_RETRY_DELAY_MS
          ) {
            await execution.wait(PROWLARR_RETRY_DELAY_MS);
            continue;
          }
        }
      }
      execution.throwIfStopped();
      throw new ProwlarrError(
        "Discovery is temporarily unavailable.",
        "PROWLARR_UNAVAILABLE",
        502,
      );
    };
    const seen = new Set<string>();
    const normalize = async (
      releases: ProwlarrRelease[],
      verifiedFallbackMovies?: Set<string>,
    ) => {
      const normalized = await Promise.all(releases.map(async (release): Promise<DiscoveryResult | null> => {
        execution.throwIfStopped();
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
      execution.throwIfStopped();
      return normalized
      .filter((result): result is DiscoveryResult => result !== null)
      .sort((a, b) => b.seeders - a.seeders || a.title.localeCompare(b.title))
      .slice(0, DEFAULT_LIMIT);
    };

    const scopedResults = await normalize(await requestReleases(url));
    execution.throwIfStopped();
    if (scopedResults.length || options.kind !== "movie") return scopedResults;

    const fallbackUrl = new URL(url);
    fallbackUrl.searchParams.delete("categories");
    const fallbackReleases = await requestReleases(fallbackUrl);
    execution.throwIfStopped();
    if (!fallbackReleases.length) return [];
    const verifiedFallbackMovies = await validateFallbackMovies(fallbackReleases, execution);
    execution.throwIfStopped();
    return await normalize(fallbackReleases, verifiedFallbackMovies);
  } finally {
    execution.dispose();
  }
}
