"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Info,
  Maximize,
  Menu,
  Pause,
  Play,
  RotateCcw,
  Search,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { catalog, getTitle, MediaTitle } from "./catalog";
import ProfilePage from "./profile-page";
import { DebridDetails, DebridExperience } from "./debrid-library";
import DiscoveryPage from "./discovery-page";
import { parseRoute, Route, routePath } from "./routing";
import StreamingPlayer from "./streaming-player";
import { normalizeSearchQuery } from "./catalog-ux";
import {
  playbackExitRoute,
  playbackReturnRoute,
} from "./lib/player-navigation";
import { useDialogFocus } from "./lib/use-dialog-focus";
import { playKheyflixSting } from "./lib/brand-sting";

const subscribeToNothing = () => () => undefined;
let startupStingRequested = false;

function IconButton({
  label,
  children,
  onClick,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      className={`icon-button ${className}`}
      aria-label={label}
      title={label}
      type="button"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function StartupIntro() {
  useEffect(() => {
    if (startupStingRequested) return;
    startupStingRequested = true;
    playKheyflixSting();
  }, []);
  return (
    <div className="app-startup-intro" aria-hidden="true">
      <div className="app-startup-intro__tunnel" />
      <div className="app-startup-intro__flare" />
      <div className="app-startup-intro__brand">
        <svg
          className="app-startup-intro__mark"
          viewBox="0 0 180 280"
          focusable="false"
        >
          <defs>
            <linearGradient id="startup-k-stem" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#ff4a4f" />
              <stop offset="0.45" stopColor="#e50914" />
              <stop offset="1" stopColor="#7a0209" />
            </linearGradient>
            <linearGradient id="startup-k-ribbon" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#7a0209" />
              <stop offset="0.52" stopColor="#ff1d2a" />
              <stop offset="1" stopColor="#8d0710" />
            </linearGradient>
            <clipPath id="startup-k-clip">
              <path d="M28 12h48v88l50-88h57l-76 120 79 136h-58L76 170v98H28z" />
            </clipPath>
          </defs>
          <path
            className="startup-k-silhouette"
            d="M28 12h48v88l50-88h57l-76 120 79 136h-58L76 170v98H28z"
          />
          <g clipPath="url(#startup-k-clip)" aria-hidden="true">
            <path
              className="startup-k-facet startup-k-facet--upper"
              d="M76 100 126 12h35L91 136z"
            />
            <path
              className="startup-k-facet startup-k-facet--lower"
              d="m91 128 73 140h-36L76 170z"
            />
          </g>
        </svg>
        <strong>KHEYFLIX</strong>
      </div>
    </div>
  );
}

export function Header({
  route,
  navigate,
}: {
  route: Route;
  navigate: (route: Route, replace?: boolean) => void;
}) {
  const [menu, setMenu] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const searchOpen = route.section === "search";
  const query = route.query ?? "";
  const searchInput = useRef<HTMLInputElement>(null);
  const submittedQuery = useRef(query);
  useEffect(() => {
    if (query !== submittedQuery.current && searchInput.current)
      searchInput.current.value = query;
    submittedQuery.current = query;
  }, [query]);
  const submit = (value: string) => {
    if (searchInput.current) searchInput.current.value = value;
    const normalized = normalizeSearchQuery(value);
    submittedQuery.current = normalized;
    navigate({ section: "search", query: normalized }, true);
  };
  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 24);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);
  return (
    <header className={`app-header${scrolled ? " scrolled" : ""}`}>
      <button
        className="brand"
        type="button"
        onClick={() => navigate({ section: "home" })}
        aria-label="Kheyflix home"
      >
        KHEYFLIX
      </button>
      <button
        className="mobile-menu"
        type="button"
        aria-label="Toggle navigation"
        aria-expanded={menu}
        onClick={() => setMenu(!menu)}
      >
        <Menu />
      </button>
      <nav className={menu ? "open" : ""} aria-label="Primary navigation">
        {(
          [
            ["home", "Home"],
            ["series", "Series"],
            ["movies", "Movies"],
            ["discover", "Discover"],
          ] as const
        ).map(([section, label]) => (
          <button
            key={section}
            type="button"
            className={route.section === section ? "active" : ""}
            aria-current={route.section === section ? "page" : undefined}
            onClick={() => {
              navigate({ section });
              setMenu(false);
            }}
          >
            {label}
          </button>
        ))}
      </nav>
      {searchOpen && <div className="header-search open">
        <Search size={19} />
        <input
          ref={searchInput}
          aria-label="Search titles"
          placeholder="Movies and series"
          defaultValue={query}
          onChange={(e) => submit(e.target.value)}
          onFocus={() => {
            if (route.section !== "search")
              navigate({ section: "search", query }, true);
          }}
        />
        {query && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => submit("")}
          >
            <X size={17} />
          </button>
        )}
      </div>}
      {!searchOpen && (
        <IconButton
          label="Open search"
          onClick={() => navigate({ section: "search", query: "" })}
        >
          <Search />
        </IconButton>
      )}
      <button
        className="profile"
        type="button"
        aria-label="Open Kheyflix profile"
        onClick={() => navigate({ section: "profile" })}
      >
        <span>K</span>
        <ChevronDown size={14} />
      </button>
    </header>
  );
}

function Hero({
  item,
  onInfo,
  onPlay,
}: {
  item: MediaTitle;
  onInfo: () => void;
  onPlay: () => void;
}) {
  return (
    <section className={`featured-hero tone-${item.tone}`}>
      <div className="hero-atmosphere">
        <span />
        <span />
        <span />
      </div>
      <div className="hero-vignette" />
      <div className="featured-copy">
        <p className="k-original">
          <b>K</b> KHEYFLIX OPEN FILM
        </p>
        <h1>
          {item.title.split(" ").slice(0, 2).join(" ")}
          <em>{item.title.split(" ").slice(2).join(" ")}</em>
        </h1>
        <p className="featured-meta">
          <strong>{item.match}% Match</strong>
          <span>{item.year}</span>
          <b>{item.rating}</b>
          <span>{item.duration}</span>
          <span className="quality">HD</span>
        </p>
        <p className="featured-description">{item.description}</p>
        <div className="featured-actions">
          <button className="primary-action" type="button" onClick={onPlay}>
            <Play fill="currentColor" /> Play
          </button>
          <button className="secondary-action" type="button" onClick={onInfo}>
            <Info /> More Info
          </button>
        </div>
      </div>
      <div className="hero-license">
        CC <span>BY</span> · LEGAL OPEN MOVIE
      </div>
    </section>
  );
}

function Details({
  item,
  onClose,
  onPlay,
}: {
  item: MediaTitle;
  onClose: () => void;
  onPlay: () => void;
}) {
  const dialog = useDialogFocus<HTMLElement>(onClose, {
    initialFocus: "button[aria-label='Close details']",
    restoreFocus: false,
  });
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <article
        className={`detail-modal tone-${item.tone}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="detail-title"
        ref={dialog}
        tabIndex={-1}
      >
        <IconButton
          label="Close details"
          className="modal-close"
          onClick={onClose}
        >
          <X />
        </IconButton>
        <div className="detail-art">
          <span className="detail-monogram">{item.title.slice(0, 1)}</span>
        </div>
        <div className="detail-gradient" />
        <div className="detail-content">
          <p className="k-original">
            <b>K</b>{" "}
            {item.category === "series" ? "KHEYFLIX SERIES" : "KHEYFLIX FILM"}
          </p>
          <h2 id="detail-title">{item.title}</h2>
          <div className="detail-actions">
            {item.playable ? (
              <button className="primary-action" type="button" onClick={onPlay}>
                <Play fill="currentColor" /> Play
              </button>
            ) : (
              <span className="coming-label">
                <Check /> Included in the Kheyflix showcase
              </span>
            )}
          </div>
          <div className="detail-grid">
            <div>
              <p className="featured-meta">
                <strong>{item.match}% Match</strong>
                <span>{item.year}</span>
                <b>{item.rating}</b>
                <span>{item.duration}</span>
                <span className="quality">HD</span>
              </p>
              <p className="detail-description">{item.description}</p>
            </div>
            <dl>
              <div>
                <dt>Cast:</dt>
                <dd>{item.cast.join(", ")}</dd>
              </div>
              <div>
                <dt>Genres:</dt>
                <dd>{item.genres.join(", ")}</dd>
              </div>
              <div>
                <dt>Director:</dt>
                <dd>{item.director}</dd>
              </div>
            </dl>
          </div>
          {item.source && (
            <p className="license-note">
              Streaming legally under Creative Commons.{" "}
              <a href={item.source.licenseUrl} target="_blank" rel="noreferrer">
                {item.source.attribution}
              </a>
            </p>
          )}
        </div>
      </article>
    </div>
  );
}

const formatTime = (value: number) =>
  Number.isFinite(value)
    ? `${Math.floor(value / 60)}:${Math.floor(value % 60)
        .toString()
        .padStart(2, "0")}`
    : "0:00";

function Player({ item, onBack }: { item: MediaTitle; onBack: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const shell = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [streamSession] = useState(() => crypto.randomUUID());
  const compatibilityUrl = item.source?.url.includes("/transcode/")
    ? `${item.source.url}?session=${streamSession}`
    : undefined;
  const [playing, setPlaying] = useState(false),
    [time, setTime] = useState(0),
    [duration, setDuration] = useState(0),
    [volume, setVolume] = useState(1),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(false),
    [controls, setControls] = useState(true);
  const showControls = useCallback(() => {
    setControls(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (playing) hideTimer.current = setTimeout(() => setControls(false), 2600);
  }, [playing]);
  const toggle = useCallback(() => {
    const el = video.current;
    if (!el) return;
    if (el.paused) {
      void el.play().catch(() => setError(true));
    } else {
      el.pause();
    }
  }, []);
  const seek = (value: number) => {
    if (video.current) {
      video.current.currentTime = value;
      setTime(value);
    }
  };
  const retry = () => {
    setError(false);
    setLoading(true);
    video.current?.load();
  };
  const stopCompatibility = useCallback(() => {
    if (compatibilityUrl) {
      if (navigator.sendBeacon) navigator.sendBeacon(compatibilityUrl);
      else void fetch(compatibilityUrl, { method: "POST", keepalive: true });
    }
  }, [compatibilityUrl]);
  const safeBack = useCallback(() => {
    stopCompatibility();
    onBack();
  }, [onBack, stopCompatibility]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === "Escape") safeBack();
      if (e.code === "Space") {
        e.preventDefault();
        toggle();
      }
      if (e.key === "ArrowRight")
        seek(Math.min(duration, (video.current?.currentTime ?? 0) + 10));
      if (e.key === "ArrowLeft")
        seek(Math.max(0, (video.current?.currentTime ?? 0) - 10));
      if (e.key.toLowerCase() === "m" && video.current) {
        video.current.muted = !video.current.muted;
        setVolume(video.current.muted ? 0 : video.current.volume);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [duration, safeBack, toggle]);
  useEffect(() => {
    window.addEventListener("pagehide", stopCompatibility);
    return () => {
      window.removeEventListener("pagehide", stopCompatibility);
      stopCompatibility();
    };
  }, [stopCompatibility]);
  if (!item.source)
    return (
      <main className="player-error">
        <h1>Preview only</h1>
        <p>
          This title is part of the Kheyflix visual catalog and does not
          advertise playback.
        </p>
        <button onClick={onBack}>Back to browsing</button>
      </main>
    );
  return (
    <main
      className={`player-shell ${controls ? "controls-visible" : ""}`}
      ref={shell}
      onMouseMove={showControls}
      onClick={showControls}
    >
      <video
        ref={video}
        autoPlay
        playsInline
        preload="auto"
        onLoadedMetadata={(event) => {
          event.currentTarget.muted = false;
          event.currentTarget.volume = volume;
          void event.currentTarget.play().catch(() => {
            // Preserve audible playback as the default. If autoplay with sound
            // is blocked, leave the controls ready for a user-initiated play.
            setPlaying(false);
            setControls(true);
          });
        }}
        onClick={toggle}
        onPlay={() => {
          setPlaying(true);
          showControls();
        }}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onDurationChange={(e) => setDuration(e.currentTarget.duration)}
        onCanPlay={() => setLoading(false)}
        onWaiting={() => setLoading(true)}
        onPlaying={() => setLoading(false)}
        onError={() => {
          setLoading(false);
          setError(true);
        }}
      >
        <source
          src={compatibilityUrl || item.source.url}
          type={item.source.type}
        />
      </video>
      {loading && !error && (
        <div className="buffering" role="status">
          <span />
          <p>Loading your film…</p>
        </div>
      )}
      {error && (
        <div className="playback-error" role="alert">
          <h1>We couldn’t start this film</h1>
          <p>Check your connection, then try the legal stream again.</p>
          <div>
            <button onClick={retry}>
              <RotateCcw /> Retry
            </button>
            <button onClick={safeBack}>
              <ArrowLeft /> Back
            </button>
          </div>
        </div>
      )}
      <div className="player-top">
        <IconButton label="Back to browsing" onClick={safeBack}>
          <ArrowLeft />
        </IconButton>
        <div>
          <strong>{item.title}</strong>
          <span>Kheyflix Streaming</span>
        </div>
      </div>
      <div className="player-controls" onClick={(e) => e.stopPropagation()}>
        <input
          aria-label="Seek video"
          className="timeline"
          type="range"
          min="0"
          max={duration || 1}
          step=".1"
          value={time}
          onChange={(e) => seek(Number(e.target.value))}
          style={
            {
              "--progress": `${duration ? (time / duration) * 100 : 0}%`,
            } as React.CSSProperties
          }
        />
        <div className="controls-row">
          <IconButton label={playing ? "Pause" : "Play"} onClick={toggle}>
            {playing ? (
              <Pause fill="currentColor" />
            ) : (
              <Play fill="currentColor" />
            )}
          </IconButton>
          <IconButton
            label={volume ? "Mute" : "Unmute"}
            onClick={() => {
              if (video.current) {
                const next = volume ? 0 : 1;
                video.current.muted = next === 0;
                video.current.volume = next;
                setVolume(next);
              }
            }}
          >
            {volume ? <Volume2 /> : <VolumeX />}
          </IconButton>
          <input
            aria-label="Volume"
            className="volume"
            type="range"
            min="0"
            max="1"
            step=".05"
            value={volume}
            onChange={(e) => {
              const next = Number(e.target.value);
              if (video.current) {
                video.current.volume = next;
                video.current.muted = next === 0;
              }
              setVolume(next);
            }}
          />
          <span className="time">
            {formatTime(time)} / {formatTime(duration)}
          </span>
          <span className="player-title">{item.title}</span>
          <IconButton
            label="Fullscreen"
            onClick={() => shell.current?.requestFullscreen?.()}
          >
            <Maximize />
          </IconButton>
        </div>
      </div>
      <p className="player-attribution">{item.source.attribution}</p>
    </main>
  );
}

export default function KheyflixApp() {
  const hydrated = useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );
  const routeLocation = useSyncExternalStore(
    (notify) => {
      window.addEventListener("popstate", notify);
      window.addEventListener("kheyflix:navigate", notify);
      return () => {
        window.removeEventListener("popstate", notify);
        window.removeEventListener("kheyflix:navigate", notify);
      };
    },
    () => window.location.pathname + window.location.search,
    () => "/",
  );
  const route = parseRoute(routeLocation);
  const previousRoute = useRef<Route>({ section: "home" });
  const playerReturnRoute = useRef<Route>({ section: "home" });
  useEffect(() => {
    document.title =
      route.section === "stream"
        ? `${route.title || "Now playing"} | Kheyflix`
        : "Kheyflix — Stories worth streaming";
  }, [route.section, route.title]);
  const navigate = useCallback(
    (next: Route, replace = false) => {
      if (next.section === "title" || next.section === "watch")
        previousRoute.current = route;
      playerReturnRoute.current = playbackReturnRoute(
        playerReturnRoute.current,
        route,
        next,
      );
      const path = routePath(next);
      const currentReturn = window.history.state?.kheyflixReturn;
      window.history[replace ? "replaceState" : "pushState"](
        {
          kheyflixReturn:
            next.section === "title" || next.section === "debrid"
              ? routePath(route)
              : currentReturn,
        },
        "",
        path,
      );
      window.dispatchEvent(new Event("kheyflix:navigate"));
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [route],
  );
  const closeDetails = useCallback(() => {
    const returnPath = window.history.state?.kheyflixReturn;
    navigate(
      typeof returnPath === "string"
        ? parseRoute(returnPath)
        : previousRoute.current.section === "title" ||
            previousRoute.current.section === "watch"
          ? { section: "home" }
          : previousRoute.current,
      true,
    );
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const target =
          document.querySelector<HTMLElement>(
            "input[aria-label='Search titles']",
          ) ||
          document.querySelector<HTMLElement>("[aria-current='page']") ||
          document.querySelector<HTMLElement>(
            "button[aria-label='Kheyflix home']",
          );
        target?.focus();
      });
    });
  }, [navigate]);
  const openTitle = (item: MediaTitle) =>
    navigate({ section: "title", id: item.id });
  const item = route.id ? getTitle(route.id) : undefined;
  const remoteItem: MediaTitle | undefined =
    route.section === "stream" &&
    route.id !== undefined &&
    route.file !== undefined
      ? {
          id: `stream-${route.id}-${route.file}`,
          title: route.title || "Kheyflix video",
          category: "movie",
          year: new Date().getFullYear(),
          rating: "HD",
          duration: "On demand",
          match: 100,
          genres: ["Kheyflix"],
          description: "Available to stream now on Kheyflix.",
          cast: [],
          director: "Kheyflix",
          tone: "space",
          playable: true,
          source: {
            url: route.compat
              ? `/api/debrid/transcode/${route.id}/${route.file}`
              : `/api/debrid/stream/${route.id}/${route.file}`,
            type: route.compat ? "video/mp4" : "video/x-matroska",
            attribution: route.compat
              ? "Kheyflix compatible streaming · AAC audio"
              : "Kheyflix secure streaming",
            licenseUrl: "#",
          },
        }
      : undefined;
  if (!hydrated)
    return (
      <main className="app-shell" aria-label="Loading Kheyflix">
        <StartupIntro />
      </main>
    );
  if (route.section === "watch" && item)
    return (
      <Player
        item={item}
        onBack={() => {
          if (window.history.length > 1) window.history.back();
          else navigate({ section: "title", id: item.id }, true);
        }}
      />
    );
  if (route.section === "stream" && remoteItem)
    return (
      <StreamingPlayer
        key={`${route.id}-${route.file}`}
        route={route}
        navigate={navigate}
        onBack={() =>
          navigate(
            playbackExitRoute(
              window.history.state?.kheyflixReturn,
              playerReturnRoute.current,
            ),
            true,
          )
        }
      />
    );
  const modalOpen =
    route.section === "debrid" || (route.section === "title" && Boolean(item));
  return (
    <main className="app-shell">
      <StartupIntro />
      <div
        className="app-background"
        inert={modalOpen || undefined}
        aria-hidden={modalOpen ? "true" : undefined}
      >
        <Header route={route} navigate={navigate} />
      {route.section === "home" && (
        <DebridExperience section="home" navigate={navigate} />
      )}
      {(route.section === "movies" || route.section === "series") && (
        <DebridExperience section={route.section} navigate={navigate} />
      )}
      {route.section === "search" && (
        <DebridExperience
          section="search"
          searchQuery={route.query}
          navigate={navigate}
        />
      )}
      {route.section === "discover" && <DiscoveryPage navigate={navigate} />}
      {route.section === "profile" && <ProfilePage navigate={navigate} />}
      {route.section === "debrid" && (
        <div className="background-page catalog-backdrop" />
      )}
      {route.section === "title" && item && (
        <div className="background-page">
          <Hero
            item={catalog[0]}
            onInfo={() => openTitle(catalog[0])}
            onPlay={() => navigate({ section: "watch", id: catalog[0].id })}
          />
        </div>
      )}
      {(route.section === "title" || route.section === "watch") && !item && (
        <section className="not-found">
          <h1>Title not found</h1>
          <button onClick={() => navigate({ section: "home" })}>
            Return home
          </button>
        </section>
      )}
      <footer>
        <button
          className="brand footer-brand"
          onClick={() => navigate({ section: "home" })}
        >
          KHEYFLIX
        </button>
        <p>Movies and series, ready when you are.</p>
        <p>© 2026 Kheyflix · Proof of concept</p>
      </footer>
      </div>
      {route.section === "debrid" && (
        <DebridDetails
          route={route}
          navigate={navigate}
          onClose={closeDetails}
        />
      )}
      {route.section === "title" && item && (
        <Details
          item={item}
          onClose={closeDetails}
          onPlay={() => navigate({ section: "watch", id: item.id })}
        />
      )}
    </main>
  );
}
