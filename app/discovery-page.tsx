"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  CircleAlert,
  Clock3,
  Film,
  LoaderCircle,
  Play,
  Search,
  ShieldCheck,
  Sparkles,
  Tv,
} from "lucide-react";
import { DebridMagnetRecord, groupDebridCatalog, streamableMovieFiles } from "./lib/media-parser";
import type { ReleaseMetadata } from "./lib/release-parser";
import { fetchWithTimeout, RequestTimeoutError } from "./lib/fetch-with-timeout";
import { Route } from "./routing";

type Result = {
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
type Preparation = {
  magnetId: number;
  phase: "adding" | "preparing" | "retrying" | "ready" | "failed";
  progress: number;
  status: string;
  record?: DebridMagnetRecord;
};

const formatSize = (bytes: number) =>
  bytes > 0 ? `${(bytes / 1024 ** 3).toFixed(bytes > 10 * 1024 ** 3 ? 0 : 1)} GB` : "Size pending";
export const DISCOVERY_SEARCH_TIMEOUT_MS = 15_000;

type ApiErrorPayload = {
  error?: { code?: string; message?: string; requestId?: string };
};

const apiFailure = (
  response: Response,
  payload: ApiErrorPayload,
  fallback: string,
) => {
  const requestId = response.headers.get("x-request-id") || payload.error?.requestId;
  const message = payload.error?.message || fallback;
  return {
    message: requestId ? `${message} Reference: ${requestId}.` : message,
    requestId,
    code: payload.error?.code || "REQUEST_FAILED",
    status: response.status,
  };
};

const reportApiFailure = (operation: string, failure: ReturnType<typeof apiFailure>) => {
  console.error(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: "error",
    event: "api.request.failed",
    operation,
    ...failure,
  }));
};

class ApiRequestError extends Error {
  constructor(public failure: ReturnType<typeof apiFailure>) {
    super(failure.message);
    this.name = "ApiRequestError";
  }
}

const reportUnexpectedClientFailure = (operation: string, reason: unknown, requestId: string) => {
  const failure = {
    message: reason instanceof RequestTimeoutError
      ? "The request timed out. Check your connection and try again."
      : "The request could not be completed. Check your connection and try again.",
    requestId,
    code: reason instanceof RequestTimeoutError ? "REQUEST_TIMEOUT" : "NETWORK_ERROR",
    status: 0,
    errorType: reason instanceof Error ? reason.name : "UnknownError",
  };
  console.error(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: "error",
    event: "api.request.failed",
    operation,
    ...failure,
  }));
  return failure;
};

const clientRequestId = () => crypto.randomUUID();

const reportClientEvent = (event: string, context: Record<string, unknown>) => {
  console.info(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: "info",
    event,
    ...context,
  }));
};

export default function DiscoveryPage({
  navigate,
  route,
}: {
  navigate: (route: Route) => void;
  route: Route;
}) {
  const [query, setQuery] = useState(route.query || "");
  const [results, setResults] = useState<Result[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchCompleted, setSearchCompleted] = useState(false);
  const [error, setError] = useState("");
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [preparations, setPreparations] = useState<Record<string, Preparation>>({});
  const [searchKind, setSearchKind] = useState<"movie" | "series">(route.kind || "movie");
  const [requestedSeason, setRequestedSeason] = useState(route.season ? String(route.season) : "");
  const [requestedEpisode, setRequestedEpisode] = useState(route.episode ? String(route.episode) : "");
  const [contextSearchPending, setContextSearchPending] = useState(Boolean(route.query && route.kind));
  const [seasonFilter, setSeasonFilter] = useState("all");
  const [episodeFilter, setEpisodeFilter] = useState("all");
  const [qualityFilter, setQualityFilter] = useState("all");
  const [audioFilter, setAudioFilter] = useState("all");
  const [subtitleFilter, setSubtitleFilter] = useState("all");

  const filterOptions = useMemo(() => ({
    seasons: [...new Set(results.map((result) => result.metadata.season).filter((value): value is number => Boolean(value)))].sort((a, b) => a - b),
    episodes: [...new Set(results.filter((result) => seasonFilter === "all" || result.metadata.season === Number(seasonFilter)).map((result) => result.metadata.episode).filter((value): value is number => Boolean(value)))].sort((a, b) => a - b),
    qualities: [...new Set(results.map((result) => result.metadata.resolution).filter((value): value is NonNullable<Result["metadata"]["resolution"]> => Boolean(value)))],
    audio: [...new Set(results.flatMap((result) => result.metadata.audioLanguages))].sort(),
    subtitles: [...new Set(results.flatMap((result) => result.metadata.subtitleLanguages))].sort(),
  }), [results, seasonFilter]);

  const languageCounts = useMemo(() => ({
    audio: Object.fromEntries(filterOptions.audio.map((language) => [language, results.filter((result) => result.metadata.audioLanguages.includes(language)).length])),
    subtitles: Object.fromEntries(filterOptions.subtitles.map((language) => [language, results.filter((result) => result.metadata.subtitleLanguages.includes(language)).length])),
  }), [filterOptions.audio, filterOptions.subtitles, results]);

  const visibleResults = useMemo(() => results.filter((result) =>
    (seasonFilter === "all" || result.metadata.season === Number(seasonFilter)) &&
    (episodeFilter === "all" || (result.metadata.episode !== undefined && Number(episodeFilter) >= result.metadata.episode && Number(episodeFilter) <= (result.metadata.episodeEnd || result.metadata.episode))) &&
    (qualityFilter === "all" || result.metadata.resolution === qualityFilter) &&
    (audioFilter === "all" || result.metadata.audioLanguages.includes(audioFilter)) &&
    (subtitleFilter === "all" || result.metadata.subtitleLanguages.includes(subtitleFilter)),
  ), [results, seasonFilter, episodeFilter, qualityFilter, audioFilter, subtitleFilter]);

  const filtersActive = seasonFilter !== "all" || episodeFilter !== "all" || qualityFilter !== "all" || audioFilter !== "all" || subtitleFilter !== "all";
  const clearFilters = () => {
    setSeasonFilter("all");
    setEpisodeFilter("all");
    setQualityFilter("all");
    setAudioFilter("all");
    setSubtitleFilter("all");
  };

  const activeIds = useMemo(
    () =>
      Object.values(preparations)
        .filter(
          (item) =>
            item.phase === "adding" ||
            item.phase === "preparing" ||
            item.phase === "retrying",
        )
        .map((item) => item.magnetId)
        .filter(Boolean),
    [preparations],
  );

  const runSearch = useCallback(async (term: string) => {
    if (term.length < 2) return;
    const requestId = clientRequestId();
    setSearching(true);
    setSearchCompleted(false);
    setError("");
    try {
      const parameters = new URLSearchParams({ q: term, kind: searchKind });
      if (searchKind === "series" && requestedSeason) parameters.set("season", requestedSeason);
      if (searchKind === "series" && requestedEpisode) parameters.set("episode", requestedEpisode);
      const response = await fetchWithTimeout(
        `/api/discovery/search?${parameters}`,
        { headers: { "x-request-id": requestId } },
        DISCOVERY_SEARCH_TIMEOUT_MS,
      );
      const data = await response.json() as ApiErrorPayload & { results?: Result[] };
      if (!response.ok) {
        const failure = apiFailure(response, data, "Search is unavailable.");
        reportApiFailure("discovery.search", failure);
        throw new ApiRequestError(failure);
      }
      setResults(data.results || []);
      setSearchCompleted(true);
      reportClientEvent("discovery.search.completed", {
        kind: searchKind,
        resultCount: data.results?.length || 0,
        requestId: response.headers.get("x-request-id"),
      });
      setSeasonFilter("all");
      setEpisodeFilter("all");
      setQualityFilter("all");
      setAudioFilter("all");
      setSubtitleFilter("all");
    } catch (reason) {
      const unexpected = reason instanceof ApiRequestError
        ? undefined
        : reportUnexpectedClientFailure("discovery.search", reason, requestId);
      setResults([]);
      setSearchCompleted(false);
      const message = reason instanceof RequestTimeoutError
          ? "Search timed out. Check your connection and try again."
          : reason instanceof Error ? reason.message : "Search is unavailable.";
      setError(unexpected ? `${message} Reference: ${requestId}.` : message);
    } finally {
      setSearching(false);
    }
  }, [requestedEpisode, requestedSeason, searchKind]);

  const search = (event: FormEvent) => {
    event.preventDefault();
    void runSearch(query.trim());
  };

  useEffect(() => {
    if (!contextSearchPending) return;
    setContextSearchPending(false);
    void runSearch(query.trim());
  }, [contextSearchPending, query, runSearch]);

  const prepare = async (result: Result) => {
    if (!rightsConfirmed) return;
    const requestId = clientRequestId();
    reportClientEvent("discovery.prepare.started", { releaseId: result.id, requestId });
    setError("");
    setPreparations((current) => ({
      ...current,
      [result.id]: { magnetId: 0, phase: "adding", progress: 2, status: "Adding to Kheyflix…" },
    }));
    try {
      const response = await fetch("/api/debrid/magnets", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-request-id": requestId },
        body: JSON.stringify({ magnet: result.magnet, rightsConfirmed: true }),
      });
      const data = await response.json() as ApiErrorPayload & { magnet: { id: number; ready?: boolean } };
      if (!response.ok) {
        const failure = apiFailure(response, data, "Kheyflix could not prepare this title.");
        reportApiFailure("discovery.prepare", failure);
        throw new ApiRequestError(failure);
      }
      setPreparations((current) => ({
        ...current,
        [result.id]: {
          magnetId: Number(data.magnet.id),
          phase: data.magnet.ready ? "preparing" : "preparing",
          progress: data.magnet.ready ? 95 : 5,
          status: data.magnet.ready ? "Checking playable files…" : "Preparing…",
        },
      }));
      reportClientEvent("discovery.prepare.accepted", {
        releaseId: result.id,
        magnetId: Number(data.magnet.id),
        requestId: response.headers.get("x-request-id"),
      });
    } catch (reason) {
      const unexpected = reason instanceof ApiRequestError
        ? undefined
        : reportUnexpectedClientFailure("discovery.prepare", reason, requestId);
      setPreparations((current) => ({
        ...current,
        [result.id]: {
          magnetId: current[result.id]?.magnetId || 0,
          phase: "failed",
          progress: 0,
          status: unexpected
            ? `${unexpected.message} Reference: ${requestId}.`
            : reason instanceof Error ? reason.message : "Preparation failed.",
        },
      }));
    }
  };

  const refreshProgress = useCallback(async () => {
    if (!activeIds.length) return;
    const requestId = clientRequestId();
    try {
      const response = await fetch("/api/debrid/magnets?refresh=1", {
        cache: "no-store",
        headers: { "x-request-id": requestId },
      });
      const data = await response.json() as ApiErrorPayload & { magnets?: Array<
        DebridMagnetRecord & { size?: number; downloaded?: number; status?: string }
      > };
      if (!response.ok) {
        const failure = apiFailure(response, data, "Media preparation is temporarily unavailable.");
        reportApiFailure("discovery.prepare.refresh", failure);
        setPreparations((current) => Object.fromEntries(
          Object.entries(current).map(([resultId, preparation]) =>
            activeIds.includes(preparation.magnetId)
              ? [
                  resultId,
                  {
                    ...preparation,
                    phase: "retrying",
                    status: `${failure.message} Retrying the existing preparation…`,
                  },
                ]
              : [resultId, preparation],
          ),
        ));
        return;
      }
      const records = (data.magnets || []) as Array<
        DebridMagnetRecord & { size?: number; downloaded?: number; status?: string }
      >;
      setPreparations((current) => {
        const next = { ...current };
        for (const [resultId, preparation] of Object.entries(current)) {
          if (!activeIds.includes(preparation.magnetId)) continue;
          const record = records.find((item) => item.id === preparation.magnetId);
          if (!record) continue;
          const result = results.find((item) => item.id === resultId);
          const playableFiles = result?.category === "movie"
            ? streamableMovieFiles(record.videoFiles, record.filename)
            : record.videoFiles;
          const incompatibleMovie = record.statusCode === 4 && result?.category === "movie" && playableFiles.length === 0;
          const ready = record.statusCode === 4 && playableFiles.length > 0;
          const failed = record.statusCode > 4;
          const progress = ready
            ? 100
            : record.size && record.downloaded
              ? Math.max(5, Math.min(99, Math.round((record.downloaded / record.size) * 100)))
              : Math.min(92, preparation.progress + 3);
          next[resultId] = {
            magnetId: preparation.magnetId,
            phase: ready ? "ready" : failed || incompatibleMovie ? "failed" : "preparing",
            progress,
            status: ready ? "Ready to watch" : incompatibleMovie ? "This release format is not supported for playback." : failed ? record.status || "Preparation failed" : record.status || "Preparing…",
            record: ready ? { ...record, videoFiles: playableFiles } : record,
          };
        }
        return next;
      });
    } catch (reason) {
      const failure = {
        message: `Unable to check preparation progress. Check your connection and try again. Reference: ${requestId}.`,
        requestId,
        code: "NETWORK_ERROR",
        status: 0,
      };
      console.error(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "error",
        event: "api.request.failed",
        operation: "discovery.prepare.refresh",
        ...failure,
        errorType: reason instanceof Error ? reason.name : "UnknownError",
      }));
      setPreparations((current) => Object.fromEntries(
        Object.entries(current).map(([resultId, preparation]) =>
          activeIds.includes(preparation.magnetId)
            ? [
                resultId,
                {
                  ...preparation,
                  phase: "retrying",
                  status: `${failure.message} Retrying the existing preparation…`,
                },
              ]
            : [resultId, preparation],
        ),
      ));
    }
  }, [activeIds, results]);

  useEffect(() => {
    if (!activeIds.length) return;
    const initial = window.setTimeout(() => void refreshProgress(), 600);
    const interval = window.setInterval(() => void refreshProgress(), 3500);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, [activeIds.length, refreshProgress]);

  const watch = (preparation: Preparation) => {
    if (!preparation.record) return;
    const title = groupDebridCatalog([preparation.record])[0];
    const first = title?.episodes[0];
    if (!title || !first) return;
    navigate({
      section: "stream",
      id: String(first.magnetId),
      file: first.file,
      title: title.category === "series" ? `${title.title} · Episode 1` : title.title,
      compat: first.needsAudioCompatibility,
    });
  };

  return (
    <section className="discovery-page">
      <div className="discovery-hero">
        <p><Sparkles /> KHEYFLIX DISCOVERY</p>
        <h1>Find it. Get it ready. Press play.</h1>
        <span>Search connected sources and prepare authorized titles for your Kheyflix library.</span>
        <div className="discovery-kind" role="group" aria-label="Content type">
          <button type="button" className={searchKind === "movie" ? "active" : ""} onClick={() => { setSearchKind("movie"); setSearchCompleted(false); setRequestedSeason(""); setRequestedEpisode(""); }}><Film /> Movies</button>
          <button type="button" className={searchKind === "series" ? "active" : ""} onClick={() => { setSearchKind("series"); setSearchCompleted(false); }}><Tv /> Series</button>
        </div>
        <form onSubmit={search} className="discovery-search">
          <Search />
          <input
            autoFocus
            value={query}
            onChange={(event) => { setQuery(event.target.value); setSearchCompleted(false); }}
            placeholder="Search a movie, series, season or episode"
            aria-label="Search connected sources"
          />
          <button
            disabled={searching || query.trim().length < 2}
            aria-label={searching ? "Searching…" : undefined}
          >
            {searching ? <><LoaderCircle className="spin" aria-hidden="true" /><span className="sr-only">Searching…</span></> : "Search"}
          </button>
        </form>
        {searchKind === "series" && (
          <div className="discovery-episode-picker">
            <label><span>Season <small>(optional)</small></span><input aria-label="Season to search" type="number" inputMode="numeric" min="1" max="99" placeholder="Any" value={requestedSeason} onChange={(event) => { const value = event.target.value; setRequestedSeason(value); if (!value) setRequestedEpisode(""); }} /></label>
            <label><span>Episode <small>(optional)</small></span><input aria-label="Episode to search" type="number" inputMode="numeric" min="1" max="999" placeholder={requestedSeason ? "Any" : "Choose season first"} disabled={!requestedSeason} value={requestedEpisode} onChange={(event) => setRequestedEpisode(event.target.value)} /></label>
          </div>
        )}
        <label className="discovery-rights">
          <input
            type="checkbox"
            checked={rightsConfirmed}
            onChange={(event) => setRightsConfirmed(event.target.checked)}
          />
          <ShieldCheck />
          <span>I confirm I’m authorized to access the content I prepare.</span>
        </label>
      </div>

      {error && <div className="discovery-message error" role="alert"><CircleAlert aria-hidden="true" /><span>{error}</span><button type="button" onClick={() => void runSearch(query.trim())} disabled={query.trim().length < 2}>Try again</button></div>}
      {!searching && !error && results.length === 0 && query && !searchCompleted && (
        <div className="discovery-message"><Search />Search to see available releases.</div>
      )}
      {!searching && !error && results.length === 0 && searchCompleted && (
        <div className="discovery-message" role="status">
          <Search />
          <span>No playable {searchKind} releases were found.</span>
          <span>Try another title or switch to {searchKind === "movie" ? "Series" : "Movies"}.</span>
        </div>
      )}
      {results.length > 0 && (
        <div className="discovery-filters" aria-label="Result filters">
          {searchKind === "series" && <div><span>Season</span><select aria-label="Filter by season" value={seasonFilter} onChange={(event) => { setSeasonFilter(event.target.value); setEpisodeFilter("all"); }}><option value="all">Any season</option>{filterOptions.seasons.map((season) => <option value={season} key={season}>Season {season}</option>)}</select></div>}
          {searchKind === "series" && <div><span>Episode</span><select aria-label="Filter by episode" value={episodeFilter} onChange={(event) => setEpisodeFilter(event.target.value)}><option value="all">Any episode</option>{filterOptions.episodes.map((episode) => <option value={episode} key={episode}>Episode {episode}</option>)}</select></div>}
          <div><span>Quality</span><select aria-label="Filter by quality" value={qualityFilter} onChange={(event) => setQualityFilter(event.target.value)}><option value="all">Any quality</option>{filterOptions.qualities.map((quality) => <option value={quality} key={quality}>{quality}</option>)}</select></div>
          <div className="discovery-language-filter"><span>Audio</span><select aria-label="Filter by audio" value={audioFilter} disabled={filterOptions.audio.length === 0} onChange={(event) => setAudioFilter(event.target.value)}><option value="all">{filterOptions.audio.length ? "Any audio" : "No audio details"}</option>{filterOptions.audio.map((language) => <option value={language} key={language}>{language} ({languageCounts.audio[language]})</option>)}</select>{filterOptions.audio.length === 0 && <small>No audio languages advertised by sources</small>}</div>
          <div className="discovery-language-filter"><span>Subtitles</span><select aria-label="Filter by subtitles" value={subtitleFilter} disabled={filterOptions.subtitles.length === 0} onChange={(event) => setSubtitleFilter(event.target.value)}><option value="all">{filterOptions.subtitles.length ? "Any subtitles" : "No subtitle details"}</option>{filterOptions.subtitles.map((language) => <option value={language} key={language}>{language} ({languageCounts.subtitles[language]})</option>)}</select>{filterOptions.subtitles.length === 0 && <small>No subtitle languages advertised by sources</small>}</div>
          <div className="discovery-filter-summary"><strong>Showing {visibleResults.length} of {results.length} releases</strong>{filtersActive && <button type="button" onClick={clearFilters}>Clear filters</button>}</div>
        </div>
      )}
      {results.length > 0 && visibleResults.length === 0 && (
        <div className="discovery-message"><Search />No releases match these filters.</div>
      )}
      <div className="discovery-results">
        {visibleResults.map((result) => {
          const preparation = preparations[result.id];
          const ready = preparation?.phase === "ready";
          return (
            <article className={`discovery-result ${preparation ? `is-${preparation.phase}` : ""}`} key={result.id}>
              <div className="discovery-result-icon">
                {result.category === "series" ? <Tv /> : <Film />}
              </div>
              <div className="discovery-result-copy">
                <small>{result.category === "series" ? "SERIES" : result.category === "movie" ? "MOVIE" : "VIDEO"} · {result.source}</small>
                <h2>{result.metadata.displayTitle}{result.metadata.year ? ` (${result.metadata.year})` : ""}</h2>
                <div className="release-tags">
                  {result.metadata.season && <b>Season {result.metadata.season}</b>}
                  {result.metadata.episode && <b>Episode {result.metadata.episode}{result.metadata.episodeEnd ? `–${result.metadata.episodeEnd}` : ""}</b>}
                  {result.metadata.seasonPack && <b>Complete season</b>}
                  {result.metadata.resolution && <span>{result.metadata.resolution}</span>}
                  {result.metadata.sourceType && <span>{result.metadata.sourceType}</span>}
                  {result.metadata.videoCodec && <span>{result.metadata.videoCodec}</span>}
                </div>
                <div className="release-languages" aria-label="Advertised languages">
                  <span>Audio: <strong>{result.metadata.audioLanguages.join(", ") || "Not specified"}</strong></span>
                  <span>Subtitles: <strong>{result.metadata.subtitleLanguages.join(", ") || "Not specified"}</strong></span>
                </div>
                <p>{formatSize(result.size)} · {result.seeders} sources available</p>
                <details className="release-details"><summary>Release details</summary>{result.title}</details>
                {preparation && (
                  <div className="preparation-status" aria-live="polite">
                    <div><span>{preparation.status}</span><b>{preparation.progress}%</b></div>
                    <progress max="100" value={preparation.progress} />
                  </div>
                )}
              </div>
              {!preparation || preparation.phase === "failed" ? (
                <button
                  className="prepare-action"
                  disabled={!rightsConfirmed}
                  onClick={() => void prepare(result)}
                  title={rightsConfirmed ? "Prepare in Kheyflix" : "Confirm authorization first"}
                >
                  {preparation?.phase === "failed" ? <Clock3 /> : <Sparkles />}
                  {preparation?.phase === "failed" ? "Try again" : "Prepare"}
                </button>
              ) : ready ? (
                <div className="ready-actions">
                  <button className="watch-action" onClick={() => watch(preparation)}>
                    <Play fill="currentColor" /> Watch
                  </button>
                  {route.returnId && (
                    <button className="return-action" onClick={() => navigate({ section: "debrid", id: route.returnId, title: route.returnTitle || route.query || "Kheyflix series" })}>
                      Back to {route.returnTitle || route.query || "series"}
                    </button>
                  )}
                </div>
              ) : (
                <span className="preparing-label">
                  <LoaderCircle className="spin" />
                  {preparation?.phase === "retrying" ? "Retrying status" : "Preparing"}
                </span>
              )}
              {ready && <Check className="ready-check" aria-hidden="true" />}
            </article>
          );
        })}
      </div>
    </section>
  );
}
