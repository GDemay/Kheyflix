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
import { DebridMagnetRecord, directPlayMovieFiles, groupDebridCatalog } from "./lib/media-parser";
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
  phase: "adding" | "preparing" | "ready" | "failed";
  progress: number;
  status: string;
  record?: DebridMagnetRecord;
};

const formatSize = (bytes: number) =>
  bytes > 0 ? `${(bytes / 1024 ** 3).toFixed(bytes > 10 * 1024 ** 3 ? 0 : 1)} GB` : "Size pending";
export const DISCOVERY_SEARCH_TIMEOUT_MS = 15_000;

export default function DiscoveryPage({
  navigate,
}: {
  navigate: (route: Route) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [preparations, setPreparations] = useState<Record<string, Preparation>>({});
  const [searchKind, setSearchKind] = useState<"movie" | "series">("movie");
  const [requestedSeason, setRequestedSeason] = useState("");
  const [requestedEpisode, setRequestedEpisode] = useState("");
  const [seasonFilter, setSeasonFilter] = useState("all");
  const [episodeFilter, setEpisodeFilter] = useState("all");
  const [qualityFilter, setQualityFilter] = useState("all");
  const [subtitleFilter, setSubtitleFilter] = useState("all");

  const filterOptions = useMemo(() => ({
    seasons: [...new Set(results.map((result) => result.metadata.season).filter((value): value is number => Boolean(value)))].sort((a, b) => a - b),
    episodes: [...new Set(results.filter((result) => seasonFilter === "all" || result.metadata.season === Number(seasonFilter)).map((result) => result.metadata.episode).filter((value): value is number => Boolean(value)))].sort((a, b) => a - b),
    qualities: [...new Set(results.map((result) => result.metadata.resolution).filter((value): value is NonNullable<Result["metadata"]["resolution"]> => Boolean(value)))],
    subtitles: [...new Set(results.flatMap((result) => result.metadata.subtitleLanguages))].sort(),
  }), [results, seasonFilter]);

  const visibleResults = useMemo(() => results.filter((result) =>
    (seasonFilter === "all" || result.metadata.season === Number(seasonFilter)) &&
    (episodeFilter === "all" || (result.metadata.episode !== undefined && Number(episodeFilter) >= result.metadata.episode && Number(episodeFilter) <= (result.metadata.episodeEnd || result.metadata.episode))) &&
    (qualityFilter === "all" || result.metadata.resolution === qualityFilter) &&
    (subtitleFilter === "all" || result.metadata.subtitleLanguages.includes(subtitleFilter)),
  ), [results, seasonFilter, episodeFilter, qualityFilter, subtitleFilter]);

  const activeIds = useMemo(
    () =>
      Object.values(preparations)
        .filter((item) => item.phase === "adding" || item.phase === "preparing")
        .map((item) => item.magnetId)
        .filter(Boolean),
    [preparations],
  );

  const runSearch = async (term: string) => {
    if (term.length < 2) return;
    setSearching(true);
    setError("");
    try {
      const parameters = new URLSearchParams({ q: term, kind: searchKind });
      if (searchKind === "series" && requestedSeason) parameters.set("season", requestedSeason);
      if (searchKind === "series" && requestedEpisode) parameters.set("episode", requestedEpisode);
      const response = await fetchWithTimeout(
        `/api/discovery/search?${parameters}`,
        {},
        DISCOVERY_SEARCH_TIMEOUT_MS,
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || "Search is unavailable.");
      setResults(data.results || []);
      setSeasonFilter("all");
      setEpisodeFilter("all");
      setQualityFilter("all");
      setSubtitleFilter("all");
    } catch (reason) {
      setResults([]);
      setError(
        reason instanceof RequestTimeoutError
          ? "Search timed out. Check your connection and try again."
          : reason instanceof Error ? reason.message : "Search is unavailable.",
      );
    } finally {
      setSearching(false);
    }
  };

  const search = (event: FormEvent) => {
    event.preventDefault();
    void runSearch(query.trim());
  };

  const prepare = async (result: Result) => {
    if (!rightsConfirmed) return;
    setError("");
    setPreparations((current) => ({
      ...current,
      [result.id]: { magnetId: 0, phase: "adding", progress: 2, status: "Adding to Kheyflix…" },
    }));
    try {
      const response = await fetch("/api/debrid/magnets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ magnet: result.magnet, rightsConfirmed: true }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || "Kheyflix could not prepare this title.");
      setPreparations((current) => ({
        ...current,
        [result.id]: {
          magnetId: Number(data.magnet.id),
          phase: data.magnet.ready ? "preparing" : "preparing",
          progress: data.magnet.ready ? 95 : 5,
          status: data.magnet.ready ? "Checking playable files…" : "Preparing…",
        },
      }));
    } catch (reason) {
      setPreparations((current) => ({
        ...current,
        [result.id]: {
          magnetId: current[result.id]?.magnetId || 0,
          phase: "failed",
          progress: 0,
          status: reason instanceof Error ? reason.message : "Preparation failed.",
        },
      }));
    }
  };

  const refreshProgress = useCallback(async () => {
    if (!activeIds.length) return;
    try {
      const response = await fetch("/api/debrid/magnets?refresh=1", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) return;
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
            ? directPlayMovieFiles(record.videoFiles, record.filename)
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
            status: ready ? "Ready to watch" : incompatibleMovie ? "This release needs conversion and is not available for direct playback." : failed ? record.status || "Preparation failed" : record.status || "Preparing…",
            record: ready ? { ...record, videoFiles: playableFiles } : record,
          };
        }
        return next;
      });
    } catch {}
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
          <button type="button" className={searchKind === "movie" ? "active" : ""} onClick={() => { setSearchKind("movie"); setRequestedSeason(""); setRequestedEpisode(""); }}><Film /> Movies</button>
          <button type="button" className={searchKind === "series" ? "active" : ""} onClick={() => setSearchKind("series")}><Tv /> Series</button>
        </div>
        <form onSubmit={search} className="discovery-search">
          <Search />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
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
      {!searching && !error && results.length === 0 && query && (
        <div className="discovery-message"><Search />Search to see available releases.</div>
      )}
      {results.length > 0 && (
        <div className="discovery-filters" aria-label="Result filters">
          {searchKind === "series" && <div><span>Season</span><select aria-label="Filter by season" value={seasonFilter} onChange={(event) => { setSeasonFilter(event.target.value); setEpisodeFilter("all"); }}><option value="all">Any season</option>{filterOptions.seasons.map((season) => <option value={season} key={season}>Season {season}</option>)}</select></div>}
          {searchKind === "series" && <div><span>Episode</span><select aria-label="Filter by episode" value={episodeFilter} onChange={(event) => setEpisodeFilter(event.target.value)}><option value="all">Any episode</option>{filterOptions.episodes.map((episode) => <option value={episode} key={episode}>Episode {episode}</option>)}</select></div>}
          <div><span>Quality</span><select aria-label="Filter by quality" value={qualityFilter} onChange={(event) => setQualityFilter(event.target.value)}><option value="all">Any quality</option>{filterOptions.qualities.map((quality) => <option value={quality} key={quality}>{quality}</option>)}</select></div>
          <div><span>Subtitles</span><select aria-label="Filter by subtitles" value={subtitleFilter} onChange={(event) => setSubtitleFilter(event.target.value)}><option value="all">Any subtitles</option>{filterOptions.subtitles.map((language) => <option value={language} key={language}>{language}</option>)}</select></div>
          <strong>{visibleResults.length} result{visibleResults.length === 1 ? "" : "s"}</strong>
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
                  {result.metadata.audioLanguages.map((language) => <span key={`audio-${language}`}>{language} audio</span>)}
                  {result.metadata.subtitleLanguages.map((language) => <span className="subtitle-tag" key={`sub-${language}`}>{language} subtitles</span>)}
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
                <button className="watch-action" onClick={() => watch(preparation)}>
                  <Play fill="currentColor" /> Watch
                </button>
              ) : (
                <span className="preparing-label"><LoaderCircle className="spin" /> Preparing</span>
              )}
              {ready && <Check className="ready-check" aria-hidden="true" />}
            </article>
          );
        })}
      </div>
    </section>
  );
}
