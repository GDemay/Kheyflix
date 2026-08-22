export type EnrichedMetadata = {
  provider: "tmdb" | "tvmaze" | "wikipedia";
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

async function fetchText(url: string, headers?: HeadersInit): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    if (!response.ok)
      throw new Error(`Metadata provider returned ${response.status}`);
    return await response.text();
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

async function fromTmdbWebsite(
  title: string,
  kind: "movie" | "series",
  year?: number,
): Promise<EnrichedMetadata | null> {
  const media = kind === "series" ? "tv" : "movie";
  const query = year ? `${title} y:${year}` : title;
  const html = await fetchText(
    `https://www.themoviedb.org/search?query=${encodeURIComponent(query)}`,
    { "Accept-Language": "en-US,en;q=0.9" },
  );
  const result = html.match(
    new RegExp(
      `href="(\/${media}\/[^\"]+)"[\\s\\S]{0,700}?src="https:\/\/(?:media|image)\\.themoviedb\\.org\/t\/p\/[^\"]+\/([^\"/?]+\\.(?:jpg|png))"`,
      "i",
    ),
  );
  if (!result) return null;
  const poster = `https://image.tmdb.org/t/p/w780/${result[2]}`;
  return {
    provider: "tmdb",
    providerUrl: `https://www.themoviedb.org${result[1]}`,
    canonicalTitle: title,
    year,
    poster,
    backdrop: poster,
    genres: [],
  };
}

async function fromWikipedia(
  title: string,
  kind: "movie" | "series",
  year?: number,
): Promise<EnrichedMetadata | null> {
  type Page = {
    pageid: number;
    title: string;
    extract?: string;
    fullurl?: string;
    thumbnail?: { source?: string };
    original?: { source?: string };
  };
  const qualifier = kind === "series" ? "television series" : "film";
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    origin: "*",
    generator: "search",
    gsrnamespace: "0",
    gsrlimit: "8",
    gsrsearch: `intitle:"${title}" ${year || ""} ${qualifier}`,
    prop: "pageimages|extracts|info",
    piprop: "thumbnail|original",
    pithumbsize: "1200",
    exintro: "1",
    explaintext: "1",
    inprop: "url",
    redirects: "1",
  });
  const result = await fetchJson<{ query?: { pages?: Record<string, Page> } }>(
    `https://en.wikipedia.org/w/api.php?${params}`,
    { "Api-User-Agent": "Kheyflix/1.0 (catalog artwork lookup)" },
  );
  const pages = Object.values(result.query?.pages || {})
    .filter((page) => page.thumbnail?.source || page.original?.source)
    .map((page) => ({
      page,
      value:
        score(page.title.replace(/\s*\([^)]*\)\s*$/, ""), title) +
        (page.extract?.includes(String(year)) ? 10 : 0),
    }))
    .sort((a, b) => b.value - a.value);
  if (!pages[0] || pages[0].value < 72) return null;
  const chosen = pages[0].page;
  const artwork = chosen.thumbnail?.source || chosen.original?.source;
  return {
    provider: "wikipedia",
    providerUrl:
      chosen.fullurl ||
      `https://en.wikipedia.org/?curid=${chosen.pageid}`,
    canonicalTitle: title,
    year,
    overview: chosen.extract,
    poster: artwork,
    backdrop: artwork,
    genres: [],
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
          const attempt = async (
            provider: () => Promise<EnrichedMetadata | null>,
          ) => {
            try {
              return await provider();
            } catch {
              return null;
            }
          };
          const tmdb = await attempt(() => fromTmdb(title, kind, year));
          const secondary =
            kind === "series"
              ? await attempt(() => fromTvmaze(title, year))
              : null;
          const publicTmdb = await attempt(() =>
            fromTmdbWebsite(title, kind, year),
          );
          const value =
            tmdb ||
            secondary ||
            publicTmdb ||
            (await attempt(() => fromWikipedia(title, kind, year)));
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
