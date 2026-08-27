"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Film,
  Heart,
  Info,
  Play,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import {
  CatalogTitle,
  DebridMagnetRecord,
  cleanEpisodeName,
  groupDebridCatalog,
} from "./lib/media-parser";
import { EnrichedMetadata } from "./lib/metadata";
import { parseWatchProgress, PlaybackQueueItem } from "./lib/watch-progress";
import { Route } from "./routing";
import { useDialogFocus } from "./lib/use-dialog-focus";
import { playKheyflixSting } from "./lib/brand-sting";
import { FAVORITES_KEY, friendsFirst, parseFavorites, toggleFavorite } from "./lib/favorites";
import { findNextMissingEpisode } from "./lib/episode-acquisition";
import {
  createCatalogSectionQueries,
  episodeCountLabel,
  normalizeSearchQuery,
  updateCatalogSectionQuery,
} from "./catalog-ux";

const CATALOG_KEY = "kheyflix:catalog:v4",
  METADATA_PREFIX = "kheyflix:metadata:v2:",
  QUEUE_KEY = "kheyflix:playback-queue:v1";
let catalogMemory: CatalogTitle[] | undefined,
  catalogRequest: Promise<CatalogTitle[]> | undefined;
const metadataMemory = new Map<string, EnrichedMetadata | null>(),
  metadataRequests = new Map<string, Promise<EnrichedMetadata | null>>();
function cachedCatalog() {
  if (catalogMemory) return catalogMemory;
  if (typeof sessionStorage === "undefined") return [];
  try {
    const stored = JSON.parse(
      sessionStorage.getItem(CATALOG_KEY) || "[]",
    ) as CatalogTitle[];
    if (Array.isArray(stored) && stored.length) catalogMemory = stored;
  } catch {}
  return catalogMemory || [];
}
async function requestCatalog(force = false) {
  if (catalogRequest && !force) return catalogRequest;
  catalogRequest = (async () => {
    const response = await fetch(
      `/api/debrid/magnets${force ? "?refresh=1" : ""}`,
    );
    const data = await response.json();
    if (!response.ok)
      throw new Error(
        data.error?.code === "ALLDEBRID_NOT_CONFIGURED"
          ? "The Kheyflix streaming catalog is not configured on this server."
          : data.error?.message || "Kheyflix catalog is unavailable.",
      );
    if (!Array.isArray(data.magnets))
      throw new Error("Kheyflix received an invalid catalog response.");
    const titles = groupDebridCatalog(data.magnets as DebridMagnetRecord[]);
    catalogMemory = titles;
    try {
      sessionStorage.setItem(CATALOG_KEY, JSON.stringify(titles));
    } catch {}
    return titles;
  })().finally(() => {
    catalogRequest = undefined;
  });
  return catalogRequest;
}
function useDebridCatalog() {
  const initial = cachedCatalog();
  const [titles, setTitles] = useState(initial),
    [loading, setLoading] = useState(!initial.length),
    [refreshing, setRefreshing] = useState(false),
    [error, setError] = useState("");
  const load = useCallback(
    async (force = false) => {
      if (titles.length) setRefreshing(true);
      else setLoading(true);
      setError("");
      try {
        setTitles(await requestCatalog(force));
      } catch (reason) {
        setError(
          reason instanceof Error
            ? reason.message
            : "Kheyflix catalog is unavailable.",
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [titles.length],
  );
  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);
  return { titles, loading, refreshing, error, load };
}
const metadataKey = (item: CatalogTitle) =>
  `${item.category}:${item.title}:${item.year || ""}`;
function readMetadata(key: string) {
  if (metadataMemory.has(key)) return metadataMemory.get(key);
  if (typeof sessionStorage === "undefined") return undefined;
  try {
    const raw = sessionStorage.getItem(METADATA_PREFIX + key);
    if (raw) {
      const value = JSON.parse(raw) as EnrichedMetadata | null;
      metadataMemory.set(key, value);
      return value;
    }
  } catch {}
  return undefined;
}
async function requestMetadata(item: CatalogTitle) {
  const key = metadataKey(item);
  if (metadataRequests.has(key)) return metadataRequests.get(key)!;
  const task = fetch(
    `/api/metadata?title=${encodeURIComponent(item.title)}&kind=${item.category}${item.year ? `&year=${item.year}` : ""}`,
  )
    .then(async (response) => {
      const data = (await response.json()) as {
        metadata: EnrichedMetadata | null;
      };
      const value = data.metadata || null;
      if (value) {
        metadataMemory.set(key, value);
        try {
          sessionStorage.setItem(METADATA_PREFIX + key, JSON.stringify(value));
        } catch {}
      }
      return value;
    })
    .catch(() => null)
    .finally(() => metadataRequests.delete(key));
  metadataRequests.set(key, task);
  return task;
}
function useMetadata(item: CatalogTitle | undefined, eager = false) {
  const key = item ? metadataKey(item) : "";
  const [metadata, setMetadata] = useState<EnrichedMetadata | null | undefined>(
    () => (item ? readMetadata(key) : undefined),
  );
  useEffect(() => {
    if (!item) return;
    const cached = readMetadata(key);
    if (cached !== undefined) {
      let active = true;
      void Promise.resolve(cached).then((value) => {
        if (active) setMetadata(value);
      });
      return () => {
        active = false;
      };
    }
    if (!eager) return;
    let active = true;
    void requestMetadata(item).then((value) => {
      if (active) setMetadata(value);
    });
    return () => {
      active = false;
    };
  }, [eager, item, key]);
  return metadata;
}
const size = (bytes: number) =>
    bytes ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : "Video",
  palette = ["#58151d", "#172a50", "#51411a", "#183e37", "#49235a", "#57301b"];
const displayTitle = (item: CatalogTitle, metadata?: EnrichedMetadata | null) =>
  metadata?.canonicalTitle || item.title;
const shortOverview = (overview?: string) => {
  if (!overview) return undefined;
  const firstTwoSentences = overview.match(/^.*?[.!?](?:\s+.*?[.!?])?/)?.[0];
  const summary = firstTwoSentences || overview;
  return summary.length > 220 ? `${summary.slice(0, 217).trim()}…` : summary;
};
const TRAILER_PROGRESS_PREFIX = "kheyflix:trailer-progress:";
const youtubeId = (url?: string) => {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "youtu.be") return parsed.pathname.slice(1) || undefined;
    if (parsed.hostname.endsWith("youtube.com"))
      return parsed.searchParams.get("v") || parsed.pathname.split("/").pop();
  } catch {}
  return undefined;
};
function TrailerPreview({ item, url }: { item: CatalogTitle; url: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const id = youtubeId(url);
  const storageKey = `${TRAILER_PROGRESS_PREFIX}${item.id}`;
  const [start] = useState(() => {
    try {
      return Math.max(0, Number(sessionStorage.getItem(storageKey)) || 0);
    } catch {
      return 0;
    }
  });
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      try {
        const message =
          typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        const currentTime = Number(message?.info?.currentTime);
        if (Number.isFinite(currentTime))
          sessionStorage.setItem(storageKey, String(currentTime));
      } catch {}
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [storageKey]);
  if (!id) return null;
  const source = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&mute=1&controls=0&playsinline=1&rel=0&enablejsapi=1&start=${Math.floor(start)}`;
  return (
    <iframe
      ref={frame}
      className="catalog-trailer"
      src={source}
      title={`${displayTitle(item)} trailer`}
      allow="autoplay; encrypted-media; picture-in-picture"
      onLoad={() =>
        frame.current?.contentWindow?.postMessage(
          JSON.stringify({ event: "listening", id: item.id }),
          "*",
        )
      }
    />
  );
}
function saveQueue(item: CatalogTitle) {
  const queue: PlaybackQueueItem[] = item.episodes.map((episode) => ({
    titleId: item.id,
    magnetId: episode.magnetId,
    file: episode.file,
    label: cleanEpisodeName(episode.name, episode.episode),
    seriesId: item.category === "series" ? item.id : undefined,
    seriesTitle: item.category === "series" ? item.title : undefined,
    season: episode.season,
    episode: episode.episode,
  }));
  try {
    sessionStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {}
}
function play(
  item: CatalogTitle,
  episode: CatalogTitle["episodes"][number],
  navigate: (route: Route) => void,
) {
  saveQueue(item);
  playKheyflixSting();
  const episodeTitle = cleanEpisodeName(episode.name, episode.episode);
  navigate({
    section: "stream",
    id: String(episode.magnetId),
    file: episode.file,
    title:
      item.category === "series"
        ? `${item.title} · S${String(episode.season).padStart(2, "0")} E${String(episode.episode).padStart(2, "0")} · ${episodeTitle}`
        : item.title,
    compat: episode.needsAudioCompatibility,
  });
}
function Artwork({
  item,
  metadata,
  index = 0,
  kind = "card",
}: {
  item: CatalogTitle;
  metadata?: EnrichedMetadata | null;
  index?: number;
  kind?: "card" | "hero" | "detail";
}) {
  const remoteSource =
    kind === "card"
      ? metadata?.poster || metadata?.backdrop
      : metadata?.backdrop || metadata?.poster;
  const accent = palette[index % palette.length];
  const safeTitle = item.title
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  const fallbackSource = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 675" role="img" aria-label="Generated artwork for ${safeTitle}"><defs><radialGradient id="g" cx="72%" cy="24%" r="85%"><stop stop-color="${accent}"/><stop offset="1" stop-color="#08090d"/></radialGradient></defs><rect width="1200" height="675" fill="url(#g)"/><circle cx="940" cy="150" r="260" fill="none" stroke="white" stroke-opacity=".12" stroke-width="3"/><circle cx="940" cy="150" r="165" fill="white" fill-opacity=".035"/><text x="64" y="82" fill="white" fill-opacity=".72" font-family="Arial,sans-serif" font-size="22" font-weight="700" letter-spacing="8">KHEYFLIX</text><text x="64" y="535" fill="white" font-family="Arial,sans-serif" font-size="54" font-weight="800">${safeTitle.slice(0, 34)}</text><text x="64" y="586" fill="white" fill-opacity=".65" font-family="Arial,sans-serif" font-size="22" letter-spacing="5">${item.category === "series" ? `${item.seasonCount} SEASONS · ${item.episodes.length} EPISODES` : `FILM${item.year ? ` · ${item.year}` : ""}`}</text></svg>`,
  )}`;
  const source = remoteSource || fallbackSource;
  const portraitBackdrop =
    kind !== "card" && !metadata?.backdrop && Boolean(metadata?.poster);
  return (
    <div
      role="img"
      aria-label={remoteSource ? `Artwork for ${item.title}` : `Generated artwork for ${item.title}`}
      className={`catalog-art catalog-art-${kind}${portraitBackdrop ? " portrait-backdrop" : ""}`}
      style={{
        backgroundImage: `linear-gradient(0deg,rgba(0,0,0,.35),transparent 55%),url("${source}")`,
        backgroundSize: portraitBackdrop ? "auto 94%" : undefined,
        backgroundRepeat: portraitBackdrop ? "no-repeat" : undefined,
        backgroundPosition: portraitBackdrop ? "72% center" : undefined,
      }}
    >
    </div>
  );
}
function CatalogCard({
  item,
  index,
  navigate,
  favorite,
  onToggleFavorite,
}: {
  item: CatalogTitle;
  index: number;
  navigate: (route: Route) => void;
  favorite: boolean;
  onToggleFavorite: (id: string) => void;
}) {
  const card = useRef<HTMLButtonElement>(null);
  const [visible, setVisible] = useState(index < 8);
  const [previewing, setPreviewing] = useState(false);
  useEffect(() => {
    if (visible || !card.current || typeof IntersectionObserver === "undefined")
      return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "300px" },
    );
    observer.observe(card.current);
    return () => observer.disconnect();
  }, [visible]);
  const metadata = useMetadata(item, visible || previewing);
  const trailer = metadata?.trailerUrl;
  return (
    <div className="library-card">
    <button
      ref={card}
      className="library-card-main"
      onMouseEnter={() => setPreviewing(true)}
      onMouseLeave={() => setPreviewing(false)}
      onFocus={() => setPreviewing(true)}
      onBlur={() => setPreviewing(false)}
      onClick={() =>
        navigate({
          section: "debrid",
          id: item.id,
          title: displayTitle(item, metadata),
        })
      }
    >
      <span className="library-card-art">
        <Artwork item={item} metadata={metadata} index={index} />
        {previewing && trailer && <TrailerPreview item={item} url={trailer} />}
        <em>
          {item.category === "series"
            ? `${item.seasonCount} ${item.seasonCount === 1 ? "SEASON" : "SEASONS"}`
            : "FILM"}
        </em>
        <i>
          <Play fill="currentColor" />
        </i>
      </span>
      <strong>{displayTitle(item, metadata)}</strong>
      <small>
        {item.category === "series"
          ? episodeCountLabel(item.episodes.length)
          : item.year || "Movie"}{" "}
        · Ready to stream
      </small>
    </button>
    <button
      className={`favorite-button${favorite ? " active" : ""}`}
      aria-label={`${favorite ? "Remove" : "Add"} ${displayTitle(item, metadata)} ${favorite ? "from" : "to"} favorites`}
      aria-pressed={favorite}
      onClick={() => onToggleFavorite(item.id)}
    >
      <Heart fill={favorite ? "currentColor" : "none"} />
    </button>
    </div>
  );
}
function Rail({
  title,
  items,
  navigate,
  favorites,
  onToggleFavorite,
}: {
  title: string;
  items: CatalogTitle[];
  navigate: (route: Route) => void;
  favorites: string[];
  onToggleFavorite: (id: string) => void;
}) {
  const rail = useRef<HTMLDivElement>(null);
  if (!items.length) return null;
  const scroll = (direction: number) =>
    rail.current?.scrollBy({
      left: direction * (rail.current.clientWidth * 0.82),
      behavior: "smooth",
    });
  return (
    <section className="media-rail-section">
      <div className="section-title">
        <h2>{title}</h2>
        <span>Explore the Kheyflix catalog</span>
      </div>
      <div className="rail-frame">
        <button
          className="rail-arrow previous"
          aria-label={`Previous ${title}`}
          onClick={() => scroll(-1)}
        >
          <ChevronLeft />
        </button>
        <div className="media-rail" ref={rail} tabIndex={0}>
          {items.slice(0, 24).map((item, index) => (
            <CatalogCard
              key={`${item.id}-${index}`}
              item={item}
              index={index}
              navigate={navigate}
              favorite={favorites.includes(item.id)}
              onToggleFavorite={onToggleFavorite}
            />
          ))}
        </div>
        <button
          className="rail-arrow next"
          aria-label={`Next ${title}`}
          onClick={() => scroll(1)}
        >
          <ChevronRight />
        </button>
      </div>
    </section>
  );
}
function CatalogSkeleton() {
  return (
    <section className="catalog-skeleton" aria-label="Loading Kheyflix catalog">
      <div className="skeleton-hero" />
      <div className="skeleton-row">
        {Array.from({ length: 7 }, (_, index) => (
          <span key={index} />
        ))}
      </div>
    </section>
  );
}

export function DebridExperience({
  section,
  navigate,
  searchQuery = "",
}: {
  section: "home" | "movies" | "series" | "search";
  navigate: (route: Route) => void;
  searchQuery?: string;
}) {
  const { titles, loading, refreshing, error, load } = useDebridCatalog();
  const [sectionQueries, setSectionQueries] = useState(
    createCatalogSectionQueries,
  );
  const [favorites, setFavorites] = useState(() =>
    typeof localStorage === "undefined"
      ? []
      : parseFavorites(localStorage.getItem(FAVORITES_KEY)),
  );
  const updateFavorite = (id: string) => {
    setFavorites((current) => {
      const next = toggleFavorite(current, id);
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
      return next;
    });
  };
  const [progress] = useState(() =>
    typeof localStorage === "undefined"
      ? parseWatchProgress(null)
      : parseWatchProgress(localStorage.getItem("kheyflix:progress:v1")),
  );
  const movies = titles.filter((item) => item.category === "movie"),
    series = friendsFirst(titles.filter((item) => item.category === "series")),
    favoriteTitles = favorites
      .map((id) => titles.find((item) => item.id === id))
      .filter((item): item is CatalogTitle => Boolean(item)),
    continueWatching = titles.filter((item) =>
      progress.entries.some(
        (entry) => entry.titleId === item.id && !entry.completed,
      ),
    );
  const featured =
    series.find((item) => /\bfriends\b/i.test(item.title)) ||
    series.find((item) => /mentalist/i.test(item.title)) ||
    series[0] ||
    movies[0];
  const featuredMetadata = useMetadata(featured, true);
  const term = normalizeSearchQuery(
    section === "search"
      ? searchQuery
      : section === "movies" || section === "series"
        ? sectionQueries[section]
        : "",
  );
  const base =
    section === "movies" ? movies : section === "series" ? series : titles;
  const filtered = base.filter((item) =>
    item.title.toLowerCase().includes(term.toLowerCase()),
  );
  if (loading && !titles.length) return <CatalogSkeleton />;
  if (error && !titles.length)
    return (
      <section className="catalog-loading error">
        <Film />
        <h1>Kheyflix needs its catalog</h1>
        <p>{error}</p>
        <button onClick={() => void load(true)}>Try again</button>
      </section>
    );
  if (section === "home" && featured) {
    const first = featured.episodes[0];
    return (
      <>
        <section className="debrid-hero">
          <Artwork item={featured} metadata={featuredMetadata} kind="hero" />
          <div className="hero-vignette" />
          <div className="featured-copy">
            <p className="k-original">
              <b>K</b> {featured.category === "series" ? "SERIES" : "FILM"}
            </p>
            <h1>{displayTitle(featured, featuredMetadata)}</h1>
            <p className="featured-meta">
              <strong>
                {featuredMetadata?.rating
                  ? `${featuredMetadata.rating.toFixed(1)} Rated`
                  : "Recently added"}
              </strong>
              <span>{featuredMetadata?.year || featured.year || "HD"}</span>
              <b>{featured.category === "series" ? "SERIES" : "MOVIE"}</b>
              <span>
                {featured.category === "series"
                  ? `${featured.seasonCount} seasons`
                  : "Ready"}
              </span>
            </p>
            <p className="featured-description">
              {shortOverview(featuredMetadata?.overview) ||
                (featured.category === "series"
                  ? `${featured.episodes.length} episodes across ${featured.seasonCount} seasons, ready to stream now on Kheyflix.`
                  : "Available to stream now from your Kheyflix catalog.")}
            </p>
            <div className="featured-actions">
              <button
                className="primary-action"
                onClick={() => play(featured, first, navigate)}
              >
                <Play fill="currentColor" />
                Play
              </button>
              <button
                className="secondary-action"
                onClick={() =>
                  navigate({
                    section: "debrid",
                    id: featured.id,
                    title: displayTitle(featured, featuredMetadata),
                  })
                }
              >
                <Info />
                More Info
              </button>
            </div>
          </div>
        </section>
        <div className="rails-container debrid-rails">
          {refreshing && (
            <span className="quiet-refresh">
              <RefreshCw className="spin" /> Refreshing
            </span>
          )}
          <Rail
            title="My Favorites"
            items={favoriteTitles}
            navigate={navigate}
            favorites={favorites}
            onToggleFavorite={updateFavorite}
          />
          <Rail
            title="Continue Watching"
            items={continueWatching}
            navigate={navigate}
            favorites={favorites}
            onToggleFavorite={updateFavorite}
          />
          <Rail
            title="Trending on Kheyflix"
            items={titles.slice(0, 30)}
            navigate={navigate}
            favorites={favorites}
            onToggleFavorite={updateFavorite}
          />
          <Rail
            title="Binge-worthy Series"
            items={series}
            navigate={navigate}
            favorites={favorites}
            onToggleFavorite={updateFavorite}
          />
          <Rail title="Movies for Tonight" items={movies} navigate={navigate} favorites={favorites} onToggleFavorite={updateFavorite} />
          <Rail
            title="More Like This"
            items={[...titles].reverse()}
            navigate={navigate}
            favorites={favorites}
            onToggleFavorite={updateFavorite}
          />
        </div>
      </>
    );
  }
  const heading =
    section === "movies"
      ? "Movies"
      : section === "series"
        ? "Series"
        : term
          ? `Results for “${term}”`
          : "Search Kheyflix";
  return (
    <section className="library-page">
      <div className="catalog-page-title">
        <div>
          <p>KHEYFLIX CATALOG</p>
          <h1>{heading}</h1>
          <span>
            {filtered.length} titles from your streaming catalog
            {refreshing ? " · Refreshing…" : ""}
          </span>
        </div>
        {section !== "search" && (
          <input
            aria-label={`Search ${section}`}
            placeholder={`Search ${section}…`}
            value={
              section === "movies" || section === "series"
                ? sectionQueries[section]
                : ""
            }
            onChange={(event) => {
              if (section === "movies" || section === "series")
                setSectionQueries((queries) =>
                  updateCatalogSectionQuery(queries, section, event.target.value),
                );
            }}
          />
        )}
      </div>
      <div className="library-grid">
        {filtered.map((item, index) => (
          <CatalogCard
            key={`${item.id}-${index}`}
            item={item}
            index={index}
            navigate={navigate}
            favorite={favorites.includes(item.id)}
            onToggleFavorite={updateFavorite}
          />
        ))}
      </div>
      {!filtered.length && (
        <div className="debrid-status">
          <Film />
          <span>
            <strong>No matching titles</strong>Try another search.
          </span>
        </div>
      )}
    </section>
  );
}

export function DebridDetails({
  route,
  navigate,
  onClose,
}: {
  route: Route;
  navigate: (route: Route) => void;
  onClose: () => void;
}) {
  const { titles, loading, error } = useDebridCatalog();
  const item = titles.find((title) => title.id === route.id);
  const metadata = useMetadata(item, true);
  const [favorites, setFavorites] = useState(() =>
    typeof localStorage === "undefined"
      ? []
      : parseFavorites(localStorage.getItem(FAVORITES_KEY)),
  );
  const favorite = Boolean(item && favorites.includes(item.id));
  const updateFavorite = () => {
    if (!item) return;
    setFavorites((current) => {
      const next = toggleFavorite(current, item.id);
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
      return next;
    });
  };
  const seasons = useMemo(
    () =>
      item ? [...new Set(item.episodes.map((episode) => episode.season))] : [],
    [item],
  );
  const [season, setSeason] = useState<number>();
  const dialog = useDialogFocus<HTMLElement>(onClose, {
    active: Boolean(item && !loading && !error),
    initialFocus: "button[aria-label='Close title details']",
    restoreFocus: false,
  });
  if (loading && !item)
    return (
      <div className="modal-backdrop">
        <div className="detail-modal detail-wait">
          <RefreshCw className="spin" />
          Loading title…
        </div>
      </div>
    );
  if (error || !item)
    return (
      <div className="modal-backdrop">
        <div className="detail-modal detail-wait">
          <Film />
          <h2>Title unavailable</h2>
          <p>{error || "This title is no longer in the catalog."}</p>
          <button onClick={onClose}>Back</button>
        </div>
      </div>
    );
  const episodes = item.episodes.filter(
      (episode) =>
        item.category === "movie" || episode.season === (season ?? seasons[0]),
    ),
    first = episodes[0] || item.episodes[0],
    missingEpisode = findNextMissingEpisode(item.episodes, metadata?.episodeNames);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <article
        className="detail-modal debrid-detail"
        role="dialog"
        aria-modal="true"
        aria-labelledby="catalog-detail-title"
        ref={dialog}
        tabIndex={-1}
      >
        <button
          className="icon-button modal-close"
          onClick={onClose}
          aria-label="Close title details"
        >
          <X />
        </button>
        <div className="detail-art">
          <Artwork item={item} metadata={metadata} kind="detail" />
          <div className="detail-gradient" />
          <div className="detail-title-overlay">
            <p className="k-original">
              <b>K</b> {item.category === "series" ? "SERIES" : "FILM"}
            </p>
            <h2 id="catalog-detail-title">{displayTitle(item, metadata)}</h2>
            <div className="detail-actions">
            <button
              className="primary-action"
              onClick={() => play(item, first, navigate)}
            >
              <Play fill="currentColor" />
              Play
            </button>
            <button
              className={`secondary-action${favorite ? " favorite-active" : ""}`}
              onClick={updateFavorite}
              aria-pressed={favorite}
            >
              <Heart fill={favorite ? "currentColor" : "none"} />
              {favorite ? "Liked" : "Like"}
            </button>
            </div>
          </div>
        </div>
        <div className="detail-content">
          <div className="detail-grid">
            <p className="detail-description">
              {metadata?.overview ||
                (item.category === "series"
                  ? `${item.episodes.length} episodes across ${item.seasonCount} seasons.`
                  : "Available now on Kheyflix.")}
            </p>
            <dl>
              <div>
                <dt>Type: </dt>
                <dd>{item.category === "series" ? "Series" : "Movie"}</dd>
              </div>
              {metadata?.genres.length ? (
                <div>
                  <dt>Genres: </dt>
                  <dd>{metadata.genres.join(", ")}</dd>
                </div>
              ) : null}
              <div>
                <dt>Availability: </dt>
                <dd>Ready to stream</dd>
              </div>
            </dl>
          </div>
          {item.category === "series" && (
            <section className="episodes">
              <div className="episodes-heading">
                <h3>Episodes</h3>
                <label>
                  Season
                  <select
                    aria-label="Season"
                    value={season ?? seasons[0]}
                    onChange={(event) => setSeason(Number(event.target.value))}
                  >
                    {seasons.map((value) => (
                      <option key={value} value={value}>
                        Season {value}
                      </option>
                    ))}
                  </select>
                  <ChevronDown />
                </label>
              </div>
              {missingEpisode && (
                <div className="missing-episode-callout" role="status">
                  <span>
                    <small>UP NEXT</small>
                    <strong>{missingEpisode.title}</strong>
                    <em>S{String(missingEpisode.season).padStart(2, "0")}E{String(missingEpisode.episode).padStart(2, "0")} is not in your library yet.</em>
                  </span>
                  <button
                    type="button"
                    onClick={() => navigate({ section: "discover", query: displayTitle(item, metadata), kind: "series", season: missingEpisode.season, episode: missingEpisode.episode, returnId: item.id, returnTitle: displayTitle(item, metadata) })}
                    aria-label={`Find S${String(missingEpisode.season).padStart(2, "0")}E${String(missingEpisode.episode).padStart(2, "0")}`}
                  >
                    <Search /> Find episode
                  </button>
                </div>
              )}
              {episodes.map((episode) => {
                const key = `${episode.season}:${episode.episode}`,
                  title =
                    metadata?.episodeNames?.[key] ||
                    cleanEpisodeName(episode.name, episode.episode);
                return (
                  <button
                    key={`${episode.magnetId}-${episode.file}`}
                    onClick={() => play(item, episode, navigate)}
                  >
                    <b>{episode.episode}</b>
                    <span
                      className="episode-thumb"
                      style={
                        metadata?.episodeImages?.[key]
                          ? {
                              backgroundImage: `url("${metadata.episodeImages[key]}")`,
                            }
                          : undefined
                      }
                    >
                      <Play fill="currentColor" />
                    </span>
                    <span>
                      <strong>{title}</strong>
                      <small>
                        {size(episode.size)}
                        {episode.needsAudioCompatibility
                          ? " · Compatible audio"
                          : ""}
                      </small>
                    </span>
                    <Play className="episode-play" fill="currentColor" />
                  </button>
                );
              })}
            </section>
          )}
          <p className="metadata-credit">
            {metadata?.provider === "tvmaze" ? (
              <>
                Series metadata provided by{" "}
                <a href={metadata.providerUrl} target="_blank" rel="noreferrer">
                  TVmaze
                </a>{" "}
                under CC BY-SA.
              </>
            ) : metadata?.provider === "tmdb" ? (
              <>
                Metadata provided by TMDB. This product uses the TMDB API but is
                not endorsed or certified by TMDB.
              </>
            ) : metadata?.provider === "wikipedia" ? (
              <>
                Artwork and description provided by{" "}
                <a href={metadata.providerUrl} target="_blank" rel="noreferrer">
                  Wikipedia
                </a>
                .
              </>
            ) : null}
          </p>
        </div>
      </article>
    </div>
  );
}
