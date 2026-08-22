"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Captions,
  Languages,
  Maximize,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Settings,
  SkipForward,
  Volume2,
  VolumeX,
} from "lucide-react";
import {
  findWatchProgress,
  nextInQueue,
  parseWatchProgress,
  PlaybackQueueItem,
  resumePosition,
  serializeWatchProgress,
  updateWatchProgress,
} from "./lib/watch-progress";
import {
  availableQualities,
  needsCompatiblePlayback,
  nextAutoQuality,
  QualityMode,
  RenditionQuality,
} from "./lib/playback";
import { Route } from "./routing";

type MediaInfo = {
  duration: number;
  format: string;
  video: Array<{ index: number; codec: string; width: number; height: number }>;
  audio: Array<{
    index: number;
    codec: string;
    language: string;
    title: string;
    channels: number;
    default: boolean;
  }>;
  subtitles: Array<{
    index: number;
    codec: string;
    language: string;
    title: string;
    supported: boolean;
  }>;
};
const PROGRESS_KEY = "kheyflix:progress:v1",
  QUEUE_KEY = "kheyflix:playback-queue:v1";
const formatTime = (value: number) =>
  Number.isFinite(value)
    ? `${Math.floor(value / 3600) ? `${Math.floor(value / 3600)}:` : ""}${Math.floor(
        (value % 3600) / 60,
      )
        .toString()
        .padStart(value >= 3600 ? 2 : 1, "0")}:${Math.floor(value % 60)
        .toString()
        .padStart(2, "0")}`
    : "0:00";
const languageName = (code: string, title = "") =>
  title ||
  {
    eng: "English",
    fra: "Français",
    fre: "Français",
    ita: "Italiano",
    spa: "Español",
    deu: "Deutsch",
    ger: "Deutsch",
    und: "Original",
  }[code.toLowerCase()] ||
  code.toUpperCase();
function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      className="icon-button"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export default function StreamingPlayer({
  route,
  onBack,
  navigate,
}: {
  route: Route;
  onBack: () => void;
  navigate: (route: Route) => void;
}) {
  const id = Number(route.id),
    file = Number(route.file),
    video = useRef<HTMLVideoElement>(null),
    shell = useRef<HTMLElement>(null),
    hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    lastSaved = useRef(0),
    lastQualitySwitch = useRef(0);
  const queue = useMemo<PlaybackQueueItem[]>(() => {
      try {
        return JSON.parse(sessionStorage.getItem(QUEUE_KEY) || "[]");
      } catch {
        return [];
      }
    }, []),
    currentQueue = queue.find(
      (item) => item.magnetId === id && item.file === file,
    ),
    identity = useMemo(
      () => ({
        titleId: currentQueue?.titleId || `stream-${id}`,
        magnetId: id,
        file,
      }),
      [currentQueue, file, id],
    ),
    next = nextInQueue(queue, identity);
  const [info, setInfo] = useState<MediaInfo>(),
    [mediaReady, setMediaReady] = useState(false),
    [compatible, setCompatible] = useState(Boolean(route.compat)),
    [copyCompatibleVideo, setCopyCompatibleVideo] = useState(false),
    [qualityMode, setQualityMode] = useState<QualityMode>("auto"),
    [rendition, setRendition] = useState<RenditionQuality>("480"),
    [offset, setOffset] = useState(0),
    [session, setSession] = useState(() => crypto.randomUUID()),
    [audio, setAudio] = useState<number>(),
    [subtitle, setSubtitle] = useState<number>(),
    [subtitleSize, setSubtitleSize] = useState<"small" | "medium" | "large">(
      "medium",
    ),
    [menu, setMenu] = useState<"audio" | "subtitles" | "settings" | null>(null),
    [playing, setPlaying] = useState(false),
    [localTime, setLocalTime] = useState(0),
    [scrub, setScrub] = useState<number>(),
    [nativeDuration, setNativeDuration] = useState(0),
    [volume, setVolume] = useState(1),
    [loading, setLoading] = useState(true),
    [controls, setControls] = useState(true),
    [intro, setIntro] = useState(true);
  const transcoded = compatible || rendition !== "original",
    sourceHeight = info?.video[0]?.height || 0,
    duration = info?.duration || nativeDuration,
    absoluteTime = transcoded ? offset + localTime : localTime,
    displayTime = scrub ?? absoluteTime;
  const source = mediaReady
    ? transcoded
      ? `/api/debrid/transcode/${id}/${file}?session=${session}&start=${offset}&quality=${rendition}${audio !== undefined ? `&audio=${audio}` : ""}${copyCompatibleVideo && rendition === "original" ? "&video=copy" : ""}`
      : `/api/debrid/stream/${id}/${file}`
    : undefined;
  const playbackTitle = currentQueue?.seriesTitle
    ? `${currentQueue.seriesTitle} · S${String(currentQueue.season).padStart(2, "0")} E${String(currentQueue.episode).padStart(2, "0")} · ${currentQueue.label}`
    : route.title || currentQueue?.label || "Kheyflix video";
  const stop = useCallback(
    (token = session) => {
      const url = `/api/debrid/transcode/${id}/${file}?session=${token}`;
      if (navigator.sendBeacon) navigator.sendBeacon(url);
      else void fetch(url, { method: "POST", keepalive: true });
    },
    [file, id, session],
  );
  const persist = useCallback(
    (position = absoluteTime) => {
      try {
        const store = parseWatchProgress(localStorage.getItem(PROGRESS_KEY));
        localStorage.setItem(
          PROGRESS_KEY,
          serializeWatchProgress(
            updateWatchProgress(store, { ...identity, position, duration }),
          ),
        );
      } catch {}
    },
    [absoluteTime, duration, identity],
  );
  const persistRef = useRef(persist),
    stopRef = useRef(stop);
  const showControls = useCallback(() => {
    setControls(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (playing) hideTimer.current = setTimeout(() => setControls(false), 2800);
  }, [playing]);
  const toggle = useCallback(() => {
    const element = video.current;
    if (!element) return;
    if (element.paused) void element.play().catch(() => undefined);
    else element.pause();
  }, []);
  const restart = useCallback(
    (at: number, nextAudio = audio, nextQuality = rendition) => {
      const target = Math.max(0, Math.min(duration || at, at));
      persist(target);
      stop();
      setLocalTime(0);
      setOffset(target);
      setAudio(nextAudio);
      setRendition(nextQuality);
      lastQualitySwitch.current = Date.now();
      setSession(crypto.randomUUID());
    },
    [audio, duration, persist, rendition, stop],
  );
  const seek = useCallback(
    (at: number) => {
      const target = Math.max(0, Math.min(duration || at, at));
      setScrub(undefined);
      if (transcoded) restart(target);
      else if (video.current) {
        video.current.currentTime = target;
        setLocalTime(target);
        persist(target);
      }
    },
    [duration, persist, restart, transcoded],
  );
  const safeBack = useCallback(() => {
    persist();
    if (transcoded) stop();
    onBack();
  }, [onBack, persist, stop, transcoded]);
  const playNext = useCallback(() => {
    if (!next) return;
    persist();
    if (transcoded) stop();
    navigate({
      section: "stream",
      id: String(next.magnetId),
      file: next.file,
      title: next.seriesId
        ? `${next.seriesTitle || "Series"} · S${String(next.season).padStart(2, "0")} E${String(next.episode).padStart(2, "0")} · ${next.label}`
        : next.label,
      compat: transcoded,
    });
  }, [navigate, next, persist, stop, transcoded]);

  const adaptQuality = useCallback(
    (direction: "up" | "down") => {
      if (qualityMode !== "auto" || Date.now() - lastQualitySwitch.current < 12_000)
        return;
      const nextQuality = nextAutoQuality(rendition, direction, sourceHeight);
      if (nextQuality !== rendition) restart(absoluteTime, audio, nextQuality);
    },
    [absoluteTime, audio, qualityMode, rendition, restart, sourceHeight],
  );
  useEffect(() => {
    const timer = setTimeout(() => setIntro(false), 1800);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    persistRef.current = persist;
    stopRef.current = stop;
  }, [persist, stop]);
  useEffect(() => {
    if (!transcoded) return;
    const token = session,
      touch = () =>
        void fetch(`/api/debrid/transcode/${id}/${file}?session=${token}`, {
          method: "PATCH",
          keepalive: true,
        }).catch(() => undefined);
    touch();
    const timer = setInterval(touch, 20_000);
    return () => {
      clearInterval(timer);
      stop(token);
    };
  }, [file, id, session, stop, transcoded]);
  useEffect(() => {
    let active = true;
    void fetch(`/api/debrid/media/${id}/${file}`)
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((value: MediaInfo) => {
        if (!active) return;
        setInfo(value);
        const selected =
          value.audio.find((track) => track.default) || value.audio[0];
        setAudio(selected?.index);
        if (
          value.video[0]?.codec.toLowerCase() === "hevc" &&
          document
            .createElement("video")
            .canPlayType('video/mp4; codecs="hvc1"')
        )
          setCopyCompatibleVideo(true);
        if (needsCompatiblePlayback(value.format, selected?.codec))
          setCompatible(true);
        const saved = resumePosition(
          findWatchProgress(
            parseWatchProgress(localStorage.getItem(PROGRESS_KEY)),
            identity,
          ),
        );
        if (saved > 0) setOffset(saved);
        setMediaReady(true);
      })
      .catch(() => setMediaReady(true));
    return () => {
      active = false;
    };
  }, [file, id, identity, route.compat]);
  useEffect(() => {
    if (qualityMode !== "auto" || !playing || loading) return;
    const timer = setTimeout(() => adaptQuality("up"), 25_000);
    return () => clearTimeout(timer);
  }, [adaptQuality, loading, playing, qualityMode, rendition]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLSelectElement
      )
        return;
      if (event.key === "Escape") {
        if (menu) setMenu(null);
        else safeBack();
      }
      if (event.code === "Space") {
        event.preventDefault();
        toggle();
      }
      if (event.key === "ArrowRight") seek(displayTime + 10);
      if (event.key === "ArrowLeft") seek(displayTime - 10);
      if (event.key.toLowerCase() === "m" && video.current) {
        video.current.muted = !video.current.muted;
        setVolume(video.current.muted ? 0 : video.current.volume);
      }
      if (event.key.toLowerCase() === "n" && next) playNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [displayTime, menu, next, playNext, safeBack, seek, toggle]);
  useEffect(() => {
    const leave = () => persistRef.current();
    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("pagehide", leave);
      persistRef.current();
      stopRef.current();
    };
  }, []);
  return (
    <main
      className={`player-shell ${controls || !playing ? "controls-visible" : ""} subtitle-${subtitleSize}`}
      ref={shell}
      onMouseMove={showControls}
      onClick={showControls}
    >
      <video
        key={source}
        ref={video}
        src={source}
        autoPlay
        playsInline
        preload="auto"
        onLoadedMetadata={(event) => {
          if (!transcoded && offset > 0) event.currentTarget.currentTime = offset;
          event.currentTarget.muted = false;
          event.currentTarget.volume = volume;
          void event.currentTarget.play().catch(() => {
            // Browsers may require a tap before audible playback. Keep audio
            // enabled so that the first user-initiated play starts with sound.
            setPlaying(false);
            setControls(true);
          });
        }}
        onClick={toggle}
        onPlay={() => {
          setPlaying(true);
          showControls();
        }}
        onPause={() => {
          setPlaying(false);
          persist();
        }}
        onTimeUpdate={(event) => {
          const value = event.currentTarget.currentTime;
          setLocalTime(value);
          if (Date.now() - lastSaved.current > 5000) {
            lastSaved.current = Date.now();
            persist(transcoded ? offset + value : value);
          }
        }}
        onDurationChange={(event) => {
          if (!info?.duration && !transcoded)
            setNativeDuration(event.currentTarget.duration);
        }}
        onCanPlay={() => setLoading(false)}
        onWaiting={() => {
          setLoading(true);
          adaptQuality("down");
        }}
        onPlaying={() => {
          setPlaying(true);
          setLoading(false);
        }}
        onEnded={() => {
          persist(duration);
          setPlaying(false);
        }}
        onError={() => {
          if (!transcoded) {
            setCompatible(true);
            setSession(crypto.randomUUID());
          } else if (qualityMode === "auto" && rendition === "480" && !compatible) {
            restart(absoluteTime, audio, "original");
          }
        }}
      >
        {subtitle !== undefined && (
          <track
            key={subtitle}
            kind="subtitles"
            src={`/api/debrid/subtitle/${id}/${file}/${subtitle}?start=${transcoded ? offset : 0}`}
            srcLang={
              info?.subtitles.find((track) => track.index === subtitle)
                ?.language || "en"
            }
            default
          />
        )}
      </video>
      {intro && (
        <div className="kheyflix-intro" aria-label="Kheyflix">
          <span>K</span>
          <strong>KHEYFLIX</strong>
        </div>
      )}
      {loading && (
        <div className="buffering" role="status">
          <span />
          <p>Loading video…</p>
        </div>
      )}
      <div className="player-top">
        <IconButton label="Back to browsing" onClick={safeBack}>
          <ArrowLeft />
        </IconButton>
        <div>
          <strong>{playbackTitle}</strong>
          <span>
            {info?.video[0]
              ? `${qualityMode === "auto" ? `Auto · ${rendition === "original" ? "Original" : `${rendition}p`}` : rendition === "original" ? "Original" : `${rendition}p`} · ${info.video[0].codec.toUpperCase()}`
              : "Kheyflix Streaming"}
          </span>
        </div>
      </div>
      <div
        className="player-controls"
        onClick={(event) => event.stopPropagation()}
      >
        <input
          aria-label="Seek video"
          className="timeline"
          type="range"
          min="0"
          max={duration || 1}
          step="1"
          value={Math.min(displayTime, duration || 1)}
          onChange={(event) => setScrub(Number(event.target.value))}
          onPointerUp={(event) => seek(Number(event.currentTarget.value))}
          onKeyDown={(event) => {
            if (
              event.key === "Home" ||
              event.key === "End" ||
              event.key === "ArrowLeft" ||
              event.key === "ArrowRight"
            ) {
              event.preventDefault();
              seek(
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? duration
                    : event.key === "ArrowLeft"
                      ? displayTime - 10
                      : displayTime + 10,
              );
            }
          }}
          style={
            {
              "--progress": `${duration ? (displayTime / duration) * 100 : 0}%`,
            } as React.CSSProperties
          }
        />
        <div className="controls-row">
          <IconButton
            label="Back 10 seconds"
            onClick={() => seek(displayTime - 10)}
          >
            <RotateCcw />
          </IconButton>
          <IconButton label={playing ? "Pause" : "Play"} onClick={toggle}>
            {playing ? (
              <Pause fill="currentColor" />
            ) : (
              <Play fill="currentColor" />
            )}
          </IconButton>
          <IconButton
            label="Forward 10 seconds"
            onClick={() => seek(displayTime + 10)}
          >
            <RotateCw />
          </IconButton>
          <IconButton
            label={volume ? "Mute" : "Unmute"}
            onClick={() => {
              if (video.current) {
                const value = volume ? 0 : 1;
                video.current.muted = value === 0;
                video.current.volume = value;
                setVolume(value);
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
            onChange={(event) => {
              const value = Number(event.target.value);
              if (video.current) {
                video.current.volume = value;
                video.current.muted = value === 0;
              }
              setVolume(value);
            }}
          />
          <span className="time">
            {formatTime(displayTime)} /{" "}
            {duration ? formatTime(duration) : "—:—"}
          </span>
          <span className="player-title">{route.title}</span>
          {next && (
            <IconButton label="Next episode" onClick={playNext}>
              <SkipForward />
            </IconButton>
          )}
          {info?.audio.length ? (
            <IconButton
              label="Audio languages"
              onClick={() => setMenu(menu === "audio" ? null : "audio")}
            >
              <Languages />
            </IconButton>
          ) : null}
          {info?.subtitles.length ? (
            <IconButton
              label="Subtitles"
              onClick={() => setMenu(menu === "subtitles" ? null : "subtitles")}
            >
              <Captions />
            </IconButton>
          ) : null}
          <IconButton
            label="Playback settings"
            onClick={() => setMenu(menu === "settings" ? null : "settings")}
          >
            <Settings />
          </IconButton>
          <IconButton
            label="Fullscreen"
            onClick={() => void shell.current?.requestFullscreen?.()}
          >
            <Maximize />
          </IconButton>
        </div>
        {menu && (
          <div
            className="track-menu"
            role="dialog"
            aria-label={menu === "audio" ? "Audio languages" : menu === "settings" ? "Playback settings" : "Subtitles"}
          >
            {menu === "audio" ? (
              <>
                <h3>Audio</h3>
                {info?.audio.map((track) => (
                  <button
                    className={audio === track.index ? "active" : ""}
                    key={track.index}
                    onClick={() => {
                      setMenu(null);
                      setCompatible(true);
                      restart(absoluteTime, track.index);
                    }}
                  >
                    {languageName(track.language, track.title)}{" "}
                    <small>
                      {track.codec.toUpperCase()} · {track.channels || 2} ch
                    </small>
                  </button>
                ))}
              </>
            ) : menu === "settings" ? (
              <>
                <h3>Video quality</h3>
                <p className="quality-hint">
                  Auto starts light and raises quality while playback stays smooth.
                </p>
                {(["auto", ...availableQualities(sourceHeight)] as QualityMode[]).map(
                  (value) => (
                    <button
                      className={qualityMode === value ? "active" : ""}
                      key={value}
                      onClick={() => {
                        const nextQuality = value === "auto" ? "480" : value;
                        setQualityMode(value);
                        setMenu(null);
                        restart(absoluteTime, audio, nextQuality);
                      }}
                    >
                      <span>
                        {value === "auto"
                          ? "Auto"
                          : value === "original"
                            ? "Original"
                            : `${value}p`}
                      </span>
                      <small>
                        {value === "auto"
                          ? `Now ${rendition === "original" ? "Original" : `${rendition}p`}`
                          : value === "original"
                            ? "Best source quality"
                            : value === "480"
                              ? "Data saver"
                              : value === "720"
                                ? "HD"
                                : "Full HD"}
                      </small>
                    </button>
                  ),
                )}
              </>
            ) : (
              <>
                <h3>Subtitles</h3>
                <button
                  className={subtitle === undefined ? "active" : ""}
                  onClick={() => setSubtitle(undefined)}
                >
                  Off
                </button>
                {info?.subtitles.map((track) => (
                  <button
                    key={track.index}
                    disabled={!track.supported}
                    className={subtitle === track.index ? "active" : ""}
                    onClick={() => track.supported && setSubtitle(track.index)}
                  >
                    {languageName(track.language, track.title)}
                    <small>
                      {track.supported ? "" : "Image subtitles unsupported"}
                    </small>
                  </button>
                ))}
                <h3>Subtitle size</h3>
                <div className="subtitle-size">
                  {(["small", "medium", "large"] as const).map((value) => (
                    <button
                      className={subtitleSize === value ? "active" : ""}
                      key={value}
                      onClick={() => setSubtitleSize(value)}
                    >
                      {value}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
