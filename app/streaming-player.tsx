"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Hls from "hls.js";
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
  bestAutoQuality,
  needsCompatiblePlayback,
  QualityMode,
  RenditionQuality,
  requiresMutedAutoplay,
} from "./lib/playback";
import {
  COMPATIBLE_STARTUP_TIMEOUT_MS,
  NATIVE_STARTUP_TIMEOUT_MS,
  startupRecovery,
} from "./lib/playback-recovery";
import {
  defaultPlaybackPreferences,
  chooseAudioTrack,
  parsePlaybackPreferences,
  PlaybackPreferences,
  serializePlaybackPreferences,
} from "./lib/playback-preferences";
import { Route } from "./routing";
import {
  classifyProviderPreflightFailure,
  ProviderPreflightHttpError,
} from "./lib/provider-preflight";
import { PlaybackRequestGate } from "./lib/player-navigation";

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
  QUEUE_KEY = "kheyflix:playback-queue:v1",
  PREFERENCES_KEY = "kheyflix:playback-preferences:v1",
  AUDIO_LANGUAGE_KEY = "kheyflix:audio-language:v1";
const newSessionToken = () => {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
};
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
    en: "English",
    eng: "English",
    pt: "Português",
    por: "Português",
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

const SHARDS = Array.from({ length: 48 }, (_, index) => {
  const column = index % 6;
  const row = Math.floor(index / 6);
  const x = 200 + column * 46;
  const y = 75 + row * 48;
  const points =
    index % 2
      ? [x, y, x + 42, y + 7, x + 31, y + 43, x + 5, y + 32]
      : [x + 8, y, x + 42, y + 18, x + 18, y + 44, x, y + 17];
  return { points: points.join(" "), order: (index * 11) % 48 };
});

function ShardPortalLoader({
  active,
  compatible,
}: {
  active: boolean;
  compatible: boolean;
}) {
  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(true);
  const started = useRef(0);
  const progressRef = useRef(0);

  useEffect(() => {
    let frame = 0;
    let finishStarted = 0;
    if (active) {
      started.current = 0;
      progressRef.current = 0;
    }
    const update = (now: number) => {
      if (active) {
        if (!started.current) {
          started.current = now;
          setProgress(0);
          setVisible(true);
        }
        const elapsed = now - started.current;
        const next = Math.min(0.94, elapsed / (elapsed + 700));
        progressRef.current = Math.max(progressRef.current, next);
        setProgress(progressRef.current);
      } else if (visible) {
        if (!finishStarted) finishStarted = now;
        const completion = Math.min(1, (now - finishStarted) / 420);
        const next =
          progressRef.current + (1 - progressRef.current) * completion;
        setProgress(next);
        if (completion === 1 && now - finishStarted > 980) setVisible(false);
      }
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [active, visible]);

  const phase = Math.min(4, Math.floor(progress * 5));
  const labels = ["SEEKING", "CONNECTING", "FORGING", "FUSING", "READY"];
  const threshold = progress * SHARDS.length;
  return (
    <div
      className={`shard-portal-loader ${visible ? "is-visible" : ""} ${progress >= 0.999 ? "is-complete" : ""}`}
      role="status"
      aria-live="polite"
      aria-label={`${labels[phase]} ${Math.round(progress * 100)}%`}
      style={{ "--loader-progress": progress } as React.CSSProperties}
    >
      <svg viewBox="0 0 620 520" aria-hidden="true">
        <defs>
          <clipPath id="player-loader-k">
            <path d="M217 84h67v128L382 84h79L356 227l108 211h-82l-72-148-26 34v114h-67z" />
          </clipPath>
          <radialGradient id="player-portal-core">
            <stop stopColor="#ff514a" stopOpacity=".85" />
            <stop offset=".42" stopColor="#a50912" stopOpacity=".5" />
            <stop offset="1" stopColor="#070000" stopOpacity="0" />
          </radialGradient>
        </defs>
        <ellipse className="loader-portal-disc" cx="310" cy="402" rx="190" ry="59" />
        <ellipse className="loader-ring ring-one" cx="310" cy="402" rx="150" ry="38" />
        <ellipse className="loader-ring ring-two" cx="310" cy="402" rx="188" ry="52" />
        <ellipse className="loader-ring ring-three" cx="310" cy="402" rx="112" ry="25" />
        <circle className="loader-orbit-spark spark-one" r="5" />
        <circle className="loader-orbit-spark spark-two" r="3" />
        <path
          className="loader-forged-k"
          d="M217 84h67v128L382 84h79L356 227l108 211h-82l-72-148-26 34v114h-67z"
        />
        <g clipPath="url(#player-loader-k)">
          {SHARDS.map((shard, index) => (
            <polygon
              key={index}
              className={`loader-shard ${shard.order <= threshold ? "is-placed" : ""} ${shard.order <= threshold && shard.order > threshold - 4 ? "is-active" : ""}`}
              points={shard.points}
            />
          ))}
        </g>
        <g className="loader-halo">
          <circle cx="310" cy="245" r="105" />
          <circle cx="310" cy="245" r="74" />
        </g>
        <g className="loader-rays" strokeLinecap="round">
          <path d="M310 12v74M310 438v70M20 245h102M498 245h102M77 39l80 80M463 371l80 80M543 39l-80 80M157 371l-80 80" />
          <path d="M164 9l39 91M456 9l-39 91M14 100l104 57M606 100l-104 57M14 390l104-57M606 390l-104-57M164 501l39-91M456 501l-39-91" />
        </g>
      </svg>
      <div className="loader-copy">
        <span>{labels[phase]}</span>
        <strong>{Math.round(progress * 100)}%</strong>
      </div>
      <div className="loader-steps" aria-hidden="true">
        {labels.map((label, index) => (
          <i key={label} className={index <= phase ? "is-on" : ""} />
        ))}
      </div>
      <p>
        {progress >= 0.999
          ? "READY TO PLAY"
          : `Preparing ${compatible ? "compatible " : ""}playback`}
      </p>
    </div>
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
    startupRetries = useRef(0),
    playbackRequestedAt = useRef(0),
    firstFrameRecorded = useRef(false),
    autoUpgradeRequested = useRef(false),
    userPaused = useRef(false),
    pendingSwitchTime = useRef<number | undefined>(undefined),
    mediaRequests = useRef(new PlaybackRequestGate());
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
    next = nextInQueue(queue, identity),
    preferenceKey =
      currentQueue?.seriesId || currentQueue?.titleId || identity.titleId;
  const [info, setInfo] = useState<MediaInfo>(),
    [iosPlayback] = useState(() =>
      typeof navigator !== "undefined" &&
      requiresMutedAutoplay(navigator.userAgent) &&
      /Apple/i.test(navigator.vendor) &&
      Boolean(
        document
          .createElement("video")
          .canPlayType("application/vnd.apple.mpegurl"),
      ),
    ),
    [mediaReady, setMediaReady] = useState(false),
    [compatible, setCompatible] = useState(Boolean(route.compat)),
    [copyCompatibleVideo, setCopyCompatibleVideo] = useState(false),
    [qualityMode, setQualityMode] = useState<QualityMode>("auto"),
    [rendition, setRendition] = useState<RenditionQuality>("480"),
    [offset, setOffset] = useState(() => {
      try {
        return resumePosition(
          findWatchProgress(
            parseWatchProgress(localStorage.getItem(PROGRESS_KEY)),
            identity,
          ),
        );
      } catch {
        return 0;
      }
    }),
    [session, setSession] = useState(newSessionToken),
    [upgradeSession] = useState(newSessionToken),
    [bootstrap, setBootstrap] = useState(true),
    [firstFrameMs, setFirstFrameMs] = useState<number>(),
    [audio, setAudio] = useState<number>(),
    [subtitle, setSubtitle] = useState<number>(),
    [subtitleSize, setSubtitleSize] = useState<"small" | "medium" | "large">(
      "medium",
    ),
    [preferences, setPreferences] = useState(defaultPlaybackPreferences),
    [menu, setMenu] = useState<
      "audio" | "subtitles" | "settings" | null
    >(null),
    [playing, setPlaying] = useState(false),
    [pausedByUser, setPausedByUser] = useState(false),
    [startedPlayback, setStartedPlayback] = useState(false),
    [localTime, setLocalTime] = useState(0),
    [scrub, setScrub] = useState<number>(),
    [nativeDuration, setNativeDuration] = useState(0),
    [volume, setVolume] = useState(() =>
      typeof navigator !== "undefined" &&
      requiresMutedAutoplay(navigator.userAgent)
        ? 0
        : 1,
    ),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(false),
    [errorMessage, setErrorMessage] = useState(""),
    [providerReady, setProviderReady] = useState(false),
    [preflightAttempt, setPreflightAttempt] = useState(0),
    [controls, setControls] = useState(true);
  const transcoded = compatible || rendition !== "original",
    activeQuality = bootstrap ? "bootstrap" : rendition,
    playbackOffset = bootstrap ? Math.floor(offset / 30) * 30 : offset,
    activeSession = bootstrap
      ? `bootstrap-${id}-${file}-${playbackOffset}`
      : session,
    sourceHeight = info?.video[0]?.height || 0,
    duration = info?.duration || nativeDuration,
    absoluteTime = transcoded ? playbackOffset + localTime : localTime,
    displayTime = scrub ?? absoluteTime;
  const source = providerReady && (mediaReady || (iosPlayback && bootstrap))
    ? iosPlayback && transcoded
      ? `/api/debrid/hls/${id}/${file}/${activeSession}/master.m3u8?start=${playbackOffset}&quality=${activeQuality}${!bootstrap && audio !== undefined ? `&audio=${audio}` : ""}${bootstrap ? "" : `&sync=${preferences.audioSync}`}`
      : transcoded
      ? `/api/debrid/transcode/${id}/${file}?session=${activeSession}&start=${offset}&quality=${activeQuality}${audio !== undefined ? `&audio=${audio}` : ""}${compatible && subtitle !== undefined ? `&subtitle=${subtitle}` : ""}&sync=${preferences.audioSync}${copyCompatibleVideo && rendition === "original" ? "&video=copy" : ""}`
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
  const updatePreferences = useCallback(
    (change: Partial<PlaybackPreferences>) => {
      setPreferences((current) => {
        const next = { ...current, ...change };
        try {
          localStorage.setItem(
            `${PREFERENCES_KEY}:${preferenceKey}`,
            serializePlaybackPreferences(next),
          );
        } catch {}
        return next;
      });
    },
    [preferenceKey],
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
    if (video.current && !video.current.paused)
      hideTimer.current = setTimeout(() => setControls(false), 2800);
  }, []);
  useEffect(() => {
    if (!controls || !playing || pausedByUser) return;
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setControls(false), 2800);
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [controls, pausedByUser, playing]);
  const toggle = useCallback(() => {
    const element = video.current;
    if (!element) return;
    if (element.paused) {
      userPaused.current = false;
      setPausedByUser(false);
      void element.play().catch(() => undefined);
    } else {
      userPaused.current = true;
      setPausedByUser(true);
      element.pause();
    }
  }, []);
  const restart = useCallback(
    (at: number, nextAudio = audio, nextQuality = rendition) => {
      const target = Math.max(0, Math.min(duration || at, at));
      persist(target);
      stop();
      setLoading(true);
      setError(false);
      setErrorMessage("");
      setLocalTime(0);
      setOffset(target);
      setAudio(nextAudio);
      setRendition(nextQuality);
      setSession(newSessionToken());
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

  const restartRef = useRef(restart),
    absoluteTimeRef = useRef(absoluteTime);
  useEffect(() => {
    playbackRequestedAt.current = performance.now();
  }, []);
  useEffect(() => {
    restartRef.current = restart;
    absoluteTimeRef.current = absoluteTime;
  }, [absoluteTime, restart]);
  useEffect(() => {
    if ((!mediaReady && !bootstrap) || !loading || error) return;
    const timer = setTimeout(
      () => {
        const recovery = startupRecovery(transcoded, startupRetries.current);
        console.warn("[playback] startup timeout", {
          id,
          file,
          transcoded,
          rendition,
          recovery,
          readyState: video.current?.readyState,
          networkState: video.current?.networkState,
        });
        if (recovery === "fallback") {
          setCompatible(true);
          setSession(newSessionToken());
        } else if (recovery === "retry") {
          startupRetries.current += 1;
          restartRef.current(absoluteTimeRef.current);
        } else {
          setLoading(false);
          setError(true);
        }
      },
      iosPlayback
        ? 90_000
        : transcoded
        ? COMPATIBLE_STARTUP_TIMEOUT_MS
        : NATIVE_STARTUP_TIMEOUT_MS,
    );
    return () => clearTimeout(timer);
  }, [bootstrap, error, file, id, iosPlayback, loading, mediaReady, rendition, session, transcoded]);
  useEffect(() => {
    persistRef.current = persist;
    stopRef.current = stop;
  }, [persist, stop]);
  useEffect(() => {
    if (!transcoded) return;
    const token = activeSession,
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
  }, [activeSession, file, id, stop, transcoded]);
  useEffect(() => {
    if (!transcoded) return;
    const stopOnPageHide = () => stop(activeSession);
    window.addEventListener("pagehide", stopOnPageHide);
    return () => window.removeEventListener("pagehide", stopOnPageHide);
  }, [activeSession, stop, transcoded]);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/debrid/stream/${id}/${file}`, {
      method: "HEAD",
      cache: "no-store",
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok)
          throw new ProviderPreflightHttpError(response.status);
        setProviderReady(true);
      })
      .catch((reason) => {
        const failure = classifyProviderPreflightFailure(
          reason,
          controller.signal.aborted,
        );
        if (failure.action === "ignore") return;
        if (failure.action === "continue") {
          console.warn("[playback] provider preflight unavailable; continuing", {
            id,
            file,
            reason,
          });
          setProviderReady(true);
          return;
        }
        console.error("[playback] provider preflight failed", { id, file, reason });
        setLoading(false);
        setErrorMessage(failure.message);
        setError(true);
      });
    return () => controller.abort();
  }, [file, id, preflightAttempt]);
  useEffect(() => {
    const request = mediaRequests.current.begin();
    const controller = new AbortController();
    void fetch(`/api/debrid/media/${id}/${file}`, {
      signal: controller.signal,
    })
      .then((response) =>
        response.ok
          ? (response.json() as Promise<MediaInfo>)
          : Promise.reject(),
      )
      .then((value) => {
        if (!request.isCurrent()) return;
        setInfo(value);
        const savedPreferences = parsePlaybackPreferences(
          localStorage.getItem(`${PREFERENCES_KEY}:${preferenceKey}`),
        );
        const savedAudioLanguage =
          localStorage.getItem(AUDIO_LANGUAGE_KEY) ||
          savedPreferences.audioLanguage ||
          "eng";
        savedPreferences.audioLanguage = savedAudioLanguage;
        setPreferences(savedPreferences);
        const selected = chooseAudioTrack(value.audio, savedAudioLanguage);
        setAudio(selected?.index);
        const preferredSubtitleLanguage =
            savedPreferences.subtitleLanguage === undefined
              ? "eng"
              : savedPreferences.subtitleLanguage,
          preferredSubtitle = preferredSubtitleLanguage
            ? value.subtitles.find(
                (track) =>
                  track.supported &&
                  (track.language.toLowerCase() ===
                    preferredSubtitleLanguage.toLowerCase() ||
                    (preferredSubtitleLanguage === "eng" &&
                      track.language.toLowerCase() === "en")),
              )
            : undefined;
        setSubtitle(preferredSubtitle?.index);
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
      request.cancel();
      controller.abort();
    };
  }, [file, id, identity, preferenceKey, route.compat]);
  useEffect(() => {
    if (video.current)
      video.current.playbackRate = preferences.playbackRate;
  }, [preferences.playbackRate, source]);
  useEffect(() => {
    if (!iosPlayback || !bootstrap || !playing || !mediaReady) return;
    const token = upgradeSession;
    const targetQuality = bestAutoQuality(sourceHeight);
    const standardSource = `/api/debrid/hls/${id}/${file}/${token}/master.m3u8?start=${offset}&quality=${targetQuality}${audio !== undefined ? `&audio=${audio}` : ""}&sync=${preferences.audioSync}`;
    let cancelled = false;
    console.info("[playback] preparing standard stream", {
      id,
      file,
      rendition: targetQuality,
    });
    void fetch(standardSource)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      })
      .then(() => {
        if (cancelled || !video.current) return;
        pendingSwitchTime.current = Math.max(
          0,
          playbackOffset + video.current.currentTime - offset,
        );
        console.info("[playback] switching from bootstrap", {
          elapsed: pendingSwitchTime.current,
          rendition: targetQuality,
        });
        setSession(token);
        setRendition(targetQuality);
        setBootstrap(false);
      })
      .catch((reason) =>
        console.warn("[playback] standard stream prewarm failed", reason),
      );
    return () => {
      cancelled = true;
    };
  }, [audio, bootstrap, file, id, iosPlayback, mediaReady, offset, playbackOffset, playing, preferences.audioSync, sourceHeight, upgradeSession]);
  useEffect(() => {
    const element = video.current;
    if (!iosPlayback || !source || !element || !Hls.isSupported()) return;
    const hls = new Hls({
      enableWorker: true,
      lowLatencyMode: false,
      backBufferLength: 30,
    });
    hls.loadSource(source);
    hls.attachMedia(element);
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      if (bootstrap && offset > playbackOffset)
        element.currentTime = offset - playbackOffset;
      if (!bootstrap && pendingSwitchTime.current !== undefined) {
        element.currentTime = pendingSwitchTime.current;
        pendingSwitchTime.current = undefined;
      }
      element.muted = true;
      element.volume = 0;
      void element.play().catch(() => setControls(true));
    });
    hls.on(Hls.Events.ERROR, (_event, data) => {
      console.error("[playback] iOS HLS error", {
        type: data.type,
        details: data.details,
        fatal: data.fatal,
      });
    });
    return () => hls.destroy();
  }, [bootstrap, iosPlayback, offset, playbackOffset, source]);
  useEffect(() => {
    if (!requiresMutedAutoplay(navigator.userAgent)) return;
    if (video.current) {
      video.current.muted = true;
      video.current.volume = 0;
    }
    const frame = requestAnimationFrame(() => setVolume(0));
    return () => cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    if (iosPlayback || qualityMode !== "auto" || !playing || loading) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const target = bestAutoQuality(sourceHeight);
      if (target === rendition || autoUpgradeRequested.current) return;
      autoUpgradeRequested.current = true;
      const targetAt = absoluteTimeRef.current;
      const targetSession = newSessionToken();
      const prewarm = `/api/debrid/transcode/${id}/${file}?session=${targetSession}&start=${targetAt}&quality=${target}${audio !== undefined ? `&audio=${audio}` : ""}&sync=${preferences.audioSync}${copyCompatibleVideo && target === "original" ? "&video=copy" : ""}`;
      try {
        const response = await fetch(prewarm, {
          headers: { Range: "bytes=0-1048575" },
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        await response.body?.cancel();
        if (cancelled || !playing) return;
        persistRef.current(targetAt);
        stopRef.current();
        setLoading(true);
        setError(false);
        setErrorMessage("");
        setLocalTime(0);
        setOffset(targetAt);
        setCompatible(true);
        setBootstrap(false);
        setRendition(target);
        setSession(targetSession);
      } catch (reason) {
        autoUpgradeRequested.current = false;
        console.warn("[playback] maximum quality prewarm failed", reason);
      }
    }, 4_000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [audio, copyCompatibleVideo, file, id, iosPlayback, loading, playing, preferences.audioSync, qualityMode, rendition, sourceHeight]);
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
    const requests = mediaRequests.current;
    const leave = () => persistRef.current();
    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("pagehide", leave);
      requests.invalidate();
      persistRef.current();
      stopRef.current();
    };
  }, []);
  return (
    <main
      className={`player-shell ${controls || !playing ? "controls-visible" : ""} subtitle-${subtitleSize}`}
      data-playback-phase={bootstrap ? "bootstrap" : "standard"}
      data-playback-quality={activeQuality}
      data-first-frame-ms={firstFrameMs === undefined ? undefined : Math.round(firstFrameMs)}
      ref={shell}
      onMouseMove={showControls}
      onClick={showControls}
    >
      <video
        ref={video}
        src={iosPlayback && Hls.isSupported() ? undefined : source}
        autoPlay
        muted={volume === 0}
        playsInline
        preload="auto"
        onLoadedMetadata={(event) => {
          if (!transcoded && offset > 0) event.currentTarget.currentTime = offset;
          const mobileAutoplay = requiresMutedAutoplay(navigator.userAgent);
          event.currentTarget.muted = mobileAutoplay || volume === 0;
          event.currentTarget.volume = mobileAutoplay ? 0 : volume;
          event.currentTarget.playbackRate = preferences.playbackRate;
          for (const track of event.currentTarget.textTracks)
            track.mode = "showing";
          if (userPaused.current) {
            event.currentTarget.pause();
            return;
          }
          void event.currentTarget.play().catch(() => {
            // Browsers may require a tap before audible playback. Keep audio
            // enabled so that the first user-initiated play starts with sound.
            setPlaying(false);
            setControls(true);
          });
        }}
        onClick={toggle}
        onPlay={() => {
          if (userPaused.current) {
            video.current?.pause();
            return;
          }
          userPaused.current = false;
          setPausedByUser(false);
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
        onLoadedData={() => setLoading(false)}
        onCanPlay={(event) => {
          startupRetries.current = 0;
          setLoading(false);
          if (!requiresMutedAutoplay(navigator.userAgent)) return;
          event.currentTarget.muted = true;
          event.currentTarget.volume = 0;
          void event.currentTarget.play().catch(() => {
            setPlaying(false);
            setControls(true);
          });
        }}
        onWaiting={() => {
          setLoading(true);
        }}
        onPlaying={() => {
          startupRetries.current = 0;
          setPlaying(true);
          setLoading(false);
          setStartedPlayback(true);
          const element = video.current;
          if (!firstFrameRecorded.current && element) {
            const record = () => {
              if (firstFrameRecorded.current) return;
              firstFrameRecorded.current = true;
              const elapsed = performance.now() - playbackRequestedAt.current;
              setFirstFrameMs(elapsed);
              console.info("[playback] first frame", {
                milliseconds: Math.round(elapsed),
                phase: bootstrap ? "bootstrap" : "standard",
                quality: activeQuality,
              });
            };
            if ("requestVideoFrameCallback" in element)
              element.requestVideoFrameCallback(record);
            else requestAnimationFrame(record);
          }
        }}
        onEnded={() => {
          persist(duration);
          setPlaying(false);
        }}
        onError={(event) => {
          const element = event.currentTarget;
          console.error("[playback] media error", {
            id,
            file,
            transcoded,
            rendition,
            code: element.error?.code,
            message: element.error?.message,
            readyState: element.readyState,
            networkState: element.networkState,
          });
          if (!transcoded) {
            setCompatible(true);
            setSession(newSessionToken());
          } else if (qualityMode === "auto" && rendition === "480" && !compatible) {
            restart(absoluteTime, audio, "original");
          } else {
            setLoading(false);
            setError(true);
          }
        }}
      >
        {!compatible && !iosPlayback && subtitle !== undefined && (
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
      {iosPlayback && !playing && !loading && !error && (
        <button
          className="ios-play-prompt"
          onClick={(event) => {
            event.stopPropagation();
            const element = video.current;
            if (!element) return;
            element.muted = true;
            element.volume = 0;
            void element.play().catch(() => setControls(true));
          }}
        >
          <Play />
          Tap to play
        </button>
      )}
      {(pausedByUser || (controls && playing)) && !error && (
        <div
          className="pause-overlay"
          role="group"
          aria-label={pausedByUser ? "Playback paused" : "Playback quick controls"}
        >
          <button
            aria-label="Back 10 seconds"
            onClick={() => seek(displayTime - 10)}
          >
            <RotateCcw />
            <span>10</span>
          </button>
          <button
            className="pause-overlay-play"
            aria-label={playing ? "Pause" : "Play"}
            onClick={toggle}
          >
            {playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}
          </button>
          <button
            aria-label="Forward 10 seconds"
            onClick={() => seek(displayTime + 10)}
          >
            <RotateCw />
            <span>10</span>
          </button>
        </div>
      )}
      {!error && (
        startedPlayback ? (
          loading && <div className="buffering-indicator" role="status" aria-label="Buffering" />
        ) : (
          <ShardPortalLoader active={loading} compatible={compatible} />
        )
      )}
      {error && (
        <div className="playback-error" role="alert">
          <h1>We couldn’t start playback</h1>
          <p>
            {errorMessage ||
              "The stream did not become playable. Your place has been saved."}
          </p>
          <div>
            <button
              onClick={() => {
                setProviderReady(false);
                setPreflightAttempt((attempt) => attempt + 1);
                restart(absoluteTime);
              }}
            >
              <RotateCcw />
              Retry
            </button>
            <button onClick={safeBack}>
              <ArrowLeft />
              Back
            </button>
          </div>
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
            aria-label={
              menu === "audio"
                ? "Audio languages"
                : menu === "subtitles"
                  ? "Subtitles"
                  : "Playback settings"
            }
          >
            {menu === "audio" ? (
              <>
                <h3>Audio</h3>
                {info?.audio.map((track) => (
                  <button
                    className={audio === track.index ? "active" : ""}
                    key={track.index}
                    onClick={() => {
                      const audioLanguage = track.language.toLowerCase();
                      localStorage.setItem(AUDIO_LANGUAGE_KEY, audioLanguage);
                      updatePreferences({ audioLanguage });
                      setMenu(null);
                      setCompatible(true);
                      restart(absoluteTime, track.index);
                    }}
                  >
                    {languageName(track.language)}{" "}
                    <small>
                      {track.codec.toUpperCase()} · {track.channels || 2} ch
                    </small>
                  </button>
                ))}
              </>
            ) : menu === "subtitles" ? (
              <>
                <h3>Subtitles</h3>
                <button
                  className={subtitle === undefined ? "active" : ""}
                  onClick={() => {
                    setSubtitle(undefined);
                    updatePreferences({ subtitleLanguage: null });
                  }}
                >
                  Off
                </button>
                {info?.subtitles.map((track) => (
                  <button
                    key={track.index}
                    disabled={!track.supported}
                    className={subtitle === track.index ? "active" : ""}
                    onClick={() => {
                      if (!track.supported) return;
                      setSubtitle(track.index);
                      updatePreferences({
                        subtitleLanguage: track.language.toLowerCase(),
                      });
                    }}
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
            ) : (
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
                        setBootstrap(false);
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
                <h3>Playback speed</h3>
                <div className="playback-speeds">
                  {[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => (
                    <button
                      className={
                        preferences.playbackRate === rate ? "active" : ""
                      }
                      key={rate}
                      onClick={() => updatePreferences({ playbackRate: rate })}
                    >
                      {rate}×
                    </button>
                  ))}
                </div>
                <h3>Audio synchronization</h3>
                <p className="sync-help">
                  Adjust the voice if it arrives before or after the picture.
                  This choice is saved for the whole series.
                </p>
                <output className="sync-value" aria-live="polite">
                  {preferences.audioSync === 0
                    ? "Synchronized"
                    : `Audio ${preferences.audioSync > 0 ? "later" : "earlier"} by ${Math.abs(preferences.audioSync).toFixed(1)}s`}
                </output>
                <div className="sync-controls">
                  <button
                    onClick={() => {
                      const audioSync = Math.max(
                        -5,
                        Math.round((preferences.audioSync - 0.1) * 10) / 10,
                      );
                      updatePreferences({ audioSync });
                      setCompatible(true);
                      restart(absoluteTime);
                    }}
                  >
                    Voice earlier
                  </button>
                  <button
                    onClick={() => {
                      updatePreferences({ audioSync: 0 });
                      setCompatible(true);
                      restart(absoluteTime);
                    }}
                  >
                    Reset
                  </button>
                  <button
                    onClick={() => {
                      const audioSync = Math.min(
                        5,
                        Math.round((preferences.audioSync + 0.1) * 10) / 10,
                      );
                      updatePreferences({ audioSync });
                      setCompatible(true);
                      restart(absoluteTime);
                    }}
                  >
                    Voice later
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
