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
import { DebridMagnetRecord, groupDebridCatalog } from "./lib/media-parser";
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

  const activeIds = useMemo(
    () =>
      Object.values(preparations)
        .filter((item) => item.phase === "adding" || item.phase === "preparing")
        .map((item) => item.magnetId)
        .filter(Boolean),
    [preparations],
  );

  const search = async (event: FormEvent) => {
    event.preventDefault();
    const term = query.trim();
    if (term.length < 2) return;
    setSearching(true);
    setError("");
    try {
      const response = await fetch(`/api/discovery/search?q=${encodeURIComponent(term)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || "Search is unavailable.");
      setResults(data.results || []);
    } catch (reason) {
      setResults([]);
      setError(reason instanceof Error ? reason.message : "Search is unavailable.");
    } finally {
      setSearching(false);
    }
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
          const ready = record.statusCode === 4 && record.videoFiles.length > 0;
          const failed = record.statusCode > 4;
          const progress = ready
            ? 100
            : record.size && record.downloaded
              ? Math.max(5, Math.min(99, Math.round((record.downloaded / record.size) * 100)))
              : Math.min(92, preparation.progress + 3);
          next[resultId] = {
            magnetId: preparation.magnetId,
            phase: ready ? "ready" : failed ? "failed" : "preparing",
            progress,
            status: ready ? "Ready to watch" : failed ? record.status || "Preparation failed" : record.status || "Preparing…",
            record,
          };
        }
        return next;
      });
    } catch {}
  }, [activeIds]);

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
        <form onSubmit={search} className="discovery-search">
          <Search />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search a movie, series, season or episode"
            aria-label="Search connected sources"
          />
          <button disabled={searching || query.trim().length < 2}>
            {searching ? <LoaderCircle className="spin" /> : "Search"}
          </button>
        </form>
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

      {error && <div className="discovery-message error"><CircleAlert />{error}</div>}
      {!searching && !error && results.length === 0 && query && (
        <div className="discovery-message"><Search />Search to see available releases.</div>
      )}
      <div className="discovery-results">
        {results.map((result) => {
          const preparation = preparations[result.id];
          const ready = preparation?.phase === "ready";
          return (
            <article className={`discovery-result ${preparation ? `is-${preparation.phase}` : ""}`} key={result.id}>
              <div className="discovery-result-icon">
                {result.category === "series" ? <Tv /> : <Film />}
              </div>
              <div className="discovery-result-copy">
                <small>{result.category === "series" ? "SERIES" : result.category === "movie" ? "MOVIE" : "VIDEO"} · {result.source}</small>
                <h2>{result.title}</h2>
                <p>{formatSize(result.size)} · {result.seeders} sources available</p>
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
