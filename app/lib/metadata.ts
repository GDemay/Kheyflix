export type EnrichedMetadata = {
  provider: "tmdb" | "tvmaze";
  providerUrl: string;
  canonicalTitle: string;
  year?: number;
  overview?: string;
  poster?: string;
  backdrop?: string;
  genres: string[];
  rating?: number;
  trailerUrl?: string;
  episodeNames?: Record<string, string>;
  episodeImages?: Record<string, string>;
};

type Entry = { value: EnrichedMetadata | null; updatedAt: number };
const shared = globalThis as typeof globalThis & {
  __kheyflixMetadata?: Map<string, Entry>;
  __kheyflixMetadataRequests?: Map<string, Promise<EnrichedMetadata | null>>;
};
const cache = (shared.__kheyflixMetadata ??= new Map());
const requests = (shared.__kheyflixMetadataRequests ??= new Map());
const TTL = 30 * 24 * 60 * 60_000;
const NEGATIVE_TTL = 24 * 60 * 60_000;
const normalize = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const score = (
  candidate: string,
  wanted: string,
  candidateYear?: number,
  wantedYear?: number,
) => {
  const a = normalize(candidate),
    b = normalize(wanted);
  let value = a === b ? 100 : a.includes(b) || b.includes(a) ? 72 : 0;
  if (candidateYear && wantedYear)
    value += Math.abs(candidateYear - wantedYear) <= 1 ? 20 : -25;
  return value;
};
const image = (path?: string | null, size = "w780") =>
  path ? `https://image.tmdb.org/t/p/${size}${path}` : undefined;

async function fetchJson<T>(url: string, headers?: HeadersInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    if (!response.ok)
      throw new Error(`Metadata provider returned ${response.status}`);
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

async function fromTmdb(
  title: string,
  kind: "movie" | "series",
  year?: number,
): Promise<EnrichedMetadata | null> {
  const token = process.env.TMDB_READ_ACCESS_TOKEN;
  if (!token) return null;
  const media = kind === "series" ? "tv" : "movie";
  const params = new URLSearchParams({ query: title, include_adult: "false" });
  if (year)
    params.set(
      kind === "series" ? "first_air_date_year" : "year",
      String(year),
    );
  type Result = {
    id: number;
    title?: string;
    name?: string;
    release_date?: string;
    first_air_date?: string;
    overview?: string;
    poster_path?: string;
    backdrop_path?: string;
    vote_average?: number;
  };
  const search = await fetchJson<{ results: Result[] }>(
    `https://api.themoviedb.org/3/search/${media}?${params}`,
    { Authorization: `Bearer ${token}`, Accept: "application/json" },
  );
  const ranked = search.results
    .map((item) => ({
      item,
      value: score(
        item.title || item.name || "",
        title,
        Number((item.release_date || item.first_air_date || "").slice(0, 4)) ||
          undefined,
        year,
      ),
    }))
    .sort((a, b) => b.value - a.value);
  if (!ranked[0] || ranked[0].value < 72) return null;
  const chosen = ranked[0].item;
  const details = await fetchJson<{
    genres?: Array<{ name: string }>;
    videos?: {
      results: Array<{
        site: string;
        type: string;
        key: string;
        official?: boolean;
      }>;
    };
  }>(
    `https://api.themoviedb.org/3/${media}/${chosen.id}?append_to_response=videos`,
    { Authorization: `Bearer ${token}`, Accept: "application/json" },
  );
  const trailer =
    details.videos?.results.find(
      (item) =>
        item.site === "YouTube" && item.type === "Trailer" && item.official,
    ) ||
    details.videos?.results.find(
      (item) => item.site === "YouTube" && item.type === "Trailer",
    );
  return {
    provider: "tmdb",
    providerUrl: `https://www.themoviedb.org/${media}/${chosen.id}`,
    canonicalTitle: chosen.title || chosen.name || title,
    year:
      Number(
        (chosen.release_date || chosen.first_air_date || "").slice(0, 4),
      ) || year,
    overview: chosen.overview,
    poster: image(chosen.poster_path, "w500"),
    backdrop: image(chosen.backdrop_path, "original"),
    genres: details.genres?.map((item) => item.name) || [],
    rating: chosen.vote_average,
    trailerUrl: trailer
      ? `https://www.youtube.com/watch?v=${trailer.key}`
      : undefined,
  };
}

async function fromTvmaze(
  title: string,
  year?: number,
): Promise<EnrichedMetadata | null> {
  type Search = {
    score: number;
    show: {
      id: number;
      name: string;
      premiered?: string;
      summary?: string;
      genres: string[];
      rating?: { average?: number };
      image?: { medium?: string; original?: string };
    };
  };
  const results = await fetchJson<Search[]>(
    `https://api.tvmaze.com/search/shows?q=${encodeURIComponent(title)}`,
  );
  const ranked = results
    .map((result) => ({
      result,
      value: score(
        result.show.name,
        title,
        Number(result.show.premiered?.slice(0, 4)) || undefined,
        year,
      ),
    }))
    .sort((a, b) => b.value - a.value);
  if (!ranked[0] || ranked[0].value < 72) return null;
  const show = ranked[0].result.show;
  type Episode = {
    season: number;
    number: number;
    name: string;
    image?: { medium?: string; original?: string };
  };
  const episodes = await fetchJson<Episode[]>(
    `https://api.tvmaze.com/shows/${show.id}/episodes`,
  );
  const names: Record<string, string> = {},
    images: Record<string, string> = {};
  for (const item of episodes) {
    const key = `${item.season}:${item.number}`;
    names[key] = item.name;
    if (item.image?.original || item.image?.medium)
      images[key] = item.image.original || item.image.medium || "";
  }
  return {
    provider: "tvmaze",
    providerUrl: `https://www.tvmaze.com/shows/${show.id}`,
    canonicalTitle: show.name,
    year: Number(show.premiered?.slice(0, 4)) || year,
    overview: show.summary?.replace(/<[^>]+>/g, ""),
    poster: show.image?.original || show.image?.medium,
    backdrop: show.image?.original,
    genres: show.genres,
    rating: show.rating?.average,
    episodeNames: names,
    episodeImages: images,
  };
}

export async function getMetadata(
  title: string,
  kind: "movie" | "series",
  year?: number,
  force = false,
) {
  const key = `${kind}:${normalize(title)}:${year || ""}`;
  const previous = cache.get(key);
  const ttl = previous?.value ? TTL : NEGATIVE_TTL;
  if (!force && previous && Date.now() - previous.updatedAt < ttl)
    return { metadata: previous.value, cached: true };
  if (!requests.has(key))
    requests.set(
      key,
      (async () => {
        try {
          const tmdb = await fromTmdb(title, kind, year);
          const value =
            tmdb || (kind === "series" ? await fromTvmaze(title, year) : null);
          cache.set(key, { value, updatedAt: Date.now() });
          return value;
        } catch (error) {
          if (previous) return previous.value;
          throw error;
        } finally {
          requests.delete(key);
        }
      })(),
    );
  return { metadata: await requests.get(key)!, cached: false };
}
