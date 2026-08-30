"use client";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  BOOTSTRAP_PROMOTION_DELAY_MS,
  bootstrapStartOffset,
  autoQualityUpgradeTarget,
  canStartPlaybackSource,
  needsCompatiblePlayback,
  playbackSurfaceState,
  QualityMode,
  releaseTranscoderSession,
  RenditionQuality,
  requiresMutedAutoplay,
  shouldSurfaceMediaInfoError,
  supportsNativeAppleHls,
  usesBootstrapStream,
} from "./lib/playback";
import {
  COMPATIBLE_STARTUP_TIMEOUT_MS,
  NATIVE_STARTUP_TIMEOUT_MS,
  shouldArmStartupRecoveryTimer,
  startupRecovery,
} from "./lib/playback-recovery";
import {
  nativeHlsRecoveryAction,
  nativeHlsResumeAction,
  nativeHlsSeekAction,
  nativeVodChunkEndAction,
} from "./lib/hls-recovery";
import {
  defaultPlaybackPreferences,
  chooseAudioTrack,
  parsePlaybackPreferences,
  PlaybackPreferences,
  serializePlaybackPreferences,
} from "./lib/playback-preferences";
import { Route } from "./routing";
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

type TranscoderSessionReplacement = {
  audio: number | undefined;
  bootstrap: boolean;
  compatible: boolean;
  copyCompatibleVideo: boolean;
  rendition: RenditionQuality;
  subtitle: number | undefined;
  sync: number;
};

type TranscoderSessionConfiguration = TranscoderSessionReplacement & {
  start: number;
};

type TranscoderSessionTransition = {
  session?: string;
  skipCurrentStop?: boolean;
};

type NativeVodPrewarm = {
  session: string;
  source: string;
  start: number;
};

const RELEASED_TRANSCODER_SESSION_LIMIT = 256;

const rememberReleasedTranscoderSession = (sessions: Set<string>, token: string) => {
  sessions.add(token);
  while (sessions.size > RELEASED_TRANSCODER_SESSION_LIMIT) {
    const oldest = sessions.values().next().value;
    if (!oldest) break;
    sessions.delete(oldest);
  }
};

class MediaInfoHttpError extends Error {
  constructor(readonly status: number) {
    super(`Media information is unavailable (HTTP ${status}).`);
  }
}
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

const isInteractiveKeyboardTarget = (target: EventTarget | null) => {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      "button, a[href], input, select, textarea, [contenteditable], [role=button], [role=link], [role=menuitem], [role=option], [role=slider], [role=textbox], [role=combobox], [role=spinbutton]",
    ),
  );
};

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
    lastPointer = useRef<{ x: number; y: number } | undefined>(undefined),
    lastSaved = useRef(0),
    startupRetries = useRef(0),
    playbackRequestedAt = useRef(0),
    startupDeadline = useRef(0),
    startupTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    startupSettled = useRef(false),
    firstFrameRecorded = useRef(false),
    sourceGeneration = useRef(0),
    bufferingStartedAt = useRef(0),
    rebufferCount = useRef(0),
    sourceAttempt = useRef(0),
    hlsRecoveryAttempts = useRef(0),
    nativeHlsRecoverySession = useRef<string>(),
    nativeHlsSeekRotation = useRef(false),
    nativeVodChunkTransition = useRef(false),
    nativeVodExpectedHandoff = useRef(false),
    nativeVodPrewarm = useRef<NativeVodPrewarm>(),
    nativeVodPrewarmGeneration = useRef(0),
    nativeVodPrewarmPending = useRef(false),
    releasedTranscoderSessions = useRef(new Set<string>()),
    bestEffortStoppedTranscoderSessions = useRef(new Set<string>()),
    releasingTranscoderSessions = useRef(new Map<string, Promise<void>>()),
    autoUpgradeRequested = useRef<RenditionQuality | null>(null),
    // Metadata failures that are safe to surface are authoritative. A media
    // element can report its own error in the same event turn while a
    // bootstrap replacement is releasing; that recovery must never erase the
    // actionable provider error or attach a new source behind its alert.
    terminalPlaybackFailure = useRef(false),
    terminalPlaybackFailureEpoch = useRef(0),
    transcoderSessionReplacementPending = useRef(false),
    queuedTranscoderSessionReplacement = useRef<
      | { position: number; replacement: TranscoderSessionReplacement }
      | undefined
    >(undefined),
    nextEpisodeNavigationPending = useRef(false),
    navigationGeneration = useRef(0),
    userPaused = useRef(false),
    attachedIosSource = useRef<string>(),
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
  const [initialPlaybackPreferences] = useState(() => {
      try {
        return parsePlaybackPreferences(
          localStorage.getItem(`${PREFERENCES_KEY}:${preferenceKey}`),
        );
      } catch {
        return defaultPlaybackPreferences();
      }
    }),
    initialQuality: RenditionQuality =
      initialPlaybackPreferences.qualityMode === "auto"
        ? "480"
        : initialPlaybackPreferences.qualityMode,
    initialBootstrap =
      !route.compat && initialPlaybackPreferences.qualityMode === "auto";
  const [info, setInfo] = useState<MediaInfo>(),
    [nativeHlsPlayback] = useState(() => {
      if (typeof navigator === "undefined") return false;
      const video = document.createElement("video");
      return supportsNativeAppleHls(
        navigator.vendor,
        video.canPlayType("application/vnd.apple.mpegurl") ||
          video.canPlayType("application/x-mpegURL"),
      );
    }),
    [iosPlayback] = useState(() =>
      typeof navigator !== "undefined" &&
      nativeHlsPlayback &&
      requiresMutedAutoplay(navigator.userAgent),
    ),
    [finePointer] = useState(() =>
      typeof window !== "undefined" &&
      !window.matchMedia("(pointer: coarse)").matches,
    ),
    [mediaReady, setMediaReady] = useState(false),
    [compatible, setCompatible] = useState(Boolean(route.compat)),
    [copyCompatibleVideo, setCopyCompatibleVideo] = useState(false),
    [qualityMode, setQualityMode] = useState<QualityMode>(
      initialPlaybackPreferences.qualityMode,
    ),
    [rendition, setRendition] = useState<RenditionQuality>(initialQuality),
    [initialOffset] = useState(() => {
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
    // Discovery already knows that `compat=1` needs a browser-safe rendition.
    // Start that fixed profile directly instead of using a 30-second bootstrap
    // followed by a visibly disruptive source replacement.
    [bootstrap, setBootstrap] = useState(initialBootstrap),
    [sessionConfiguration, setSessionConfiguration] =
      useState<TranscoderSessionConfiguration>(() => ({
        audio: undefined,
        bootstrap: initialBootstrap,
        compatible: Boolean(route.compat),
        copyCompatibleVideo: false,
        rendition: initialQuality,
        start: initialOffset,
        subtitle: undefined,
        sync: initialPlaybackPreferences.audioSync,
      })),
    [firstFrameMs, setFirstFrameMs] = useState<number>(),
    [audio, setAudio] = useState<number>(),
    [subtitle, setSubtitle] = useState<number>(),
    [subtitleSize, setSubtitleSize] = useState<"small" | "medium" | "large">("medium"),
    [preferences, setPreferences] = useState(initialPlaybackPreferences),
    [menu, setMenu] = useState<
      "audio" | "subtitles" | "settings" | null
    >(null),
    [playing, setPlaying] = useState(false),
    [pausedByUser, setPausedByUser] = useState(false),
    [startedPlayback, setStartedPlayback] = useState(false),
    [iosSourceActivated, setIosSourceActivated] = useState(false),
    [localTime, setLocalTime] = useState(0),
    [nativeVodChunkDuration, setNativeVodChunkDuration] = useState(0),
    [nativeVodMetadataSource, setNativeVodMetadataSource] = useState<string>(),
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
    [mediaInfoAttempt, setMediaInfoAttempt] = useState(0),
    [controls, setControls] = useState(true),
    [keyboardFocusWithin, setKeyboardFocusWithin] = useState(false),
    [transcoderSessionTransition, setTranscoderSessionTransition] = useState(false);
  const viewerPlaybackRequestedAt = useRef<number>();
  const transcoded =
      sessionConfiguration.compatible ||
      sessionConfiguration.rendition !== "original",
    effectiveBootstrap = usesBootstrapStream(
      nativeHlsPlayback,
      sessionConfiguration.bootstrap,
    ),
    activeQuality = !transcoded
      ? "original"
      : effectiveBootstrap
        ? "bootstrap"
        : sessionConfiguration.rendition,
    playbackOffset = effectiveBootstrap
      ? bootstrapStartOffset(sessionConfiguration.start)
      : sessionConfiguration.start,
    activeSession = session,
    sourceHeight = info?.video[0]?.height || 0,
    duration = info?.duration || nativeDuration,
    absoluteTime = transcoded ? playbackOffset + localTime : localTime,
    displayTime = scrub ?? absoluteTime,
    sustainedCompatibility =
      sessionConfiguration.compatible && !effectiveBootstrap,
    fixedProfilePlayback =
      transcoded &&
      !effectiveBootstrap &&
      sessionConfiguration.rendition !== "original",
    activeSubtitle =
      nativeHlsPlayback && transcoded && !startedPlayback
        ? undefined
        : subtitle;
  const playbackMode = useRef({ effectiveBootstrap, nativeHlsPlayback });
  useLayoutEffect(() => {
    // Desktop playback begins as soon as the player route is entered, so the
    // viewer metric includes metadata and provider-resolution latency before a
    // source can be attached. iPhone begins at its explicit trusted tap below.
    if (!iosPlayback && viewerPlaybackRequestedAt.current === undefined)
      viewerPlaybackRequestedAt.current = performance.now();
  }, [iosPlayback]);
  useEffect(() => {
    playbackMode.current = { effectiveBootstrap, nativeHlsPlayback };
  }, [effectiveBootstrap, nativeHlsPlayback]);
  const nativeHlsSource = useCallback(
    (token: string, start: number, prewarm = false) =>
      `/api/debrid/hls/${id}/${file}/${token}/master.m3u8?start=${start}&quality=${activeQuality}&mode=${prewarm ? "native-vod-warm" : "native-vod"}${sessionConfiguration.audio !== undefined ? `&audio=${sessionConfiguration.audio}` : ""}&sync=${sessionConfiguration.sync}`,
    [activeQuality, file, id, sessionConfiguration.audio, sessionConfiguration.sync],
  );
  const recordNativeVodMetadata = useCallback(
    (currentSource: string | undefined, element: HTMLVideoElement) => {
      if (!nativeHlsPlayback || !transcoded || !currentSource) return;
      const chunkDuration = element.duration;
      if (!Number.isFinite(chunkDuration) || chunkDuration <= 0) return;
      // Consecutive prepared chunks both have a 30-second duration. Keep the
      // source identity in React state as well as the duration so an equal
      // duration still re-arms the next prewarm after a WebKit source swap.
      setNativeVodMetadataSource(currentSource);
      setNativeVodChunkDuration(chunkDuration);
    },
    [nativeHlsPlayback, transcoded],
  );
  const resolvedSource = !transcoderSessionTransition && canStartPlaybackSource({
    effectiveBootstrap,
    fixedProfilePlayback,
    nativeHlsPlayback,
    mediaReady,
    transcoded,
  })
    ? nativeHlsPlayback && transcoded
      ? nativeHlsSource(activeSession, playbackOffset)
      : transcoded
      ? `/api/debrid/transcode/${id}/${file}?session=${activeSession}&start=${sessionConfiguration.start}&quality=${activeQuality}${!effectiveBootstrap && sessionConfiguration.audio !== undefined ? `&audio=${sessionConfiguration.audio}` : ""}&sync=${sessionConfiguration.sync}${sessionConfiguration.copyCompatibleVideo && sessionConfiguration.rendition === "original" ? "&video=copy" : ""}`
      : `/api/debrid/stream/${id}/${file}`
    : undefined;
  // iPhone Safari may fetch and parse a playlist before the viewer has
  // interacted, then never advance to a segment. Attach its native HLS source
  // in the first explicit tap so playlist, decoder, and audio-policy state are
  // established in one trusted gesture. Later session rotations keep that
  // activation and remain hands-free.
  const source =
    iosPlayback && !iosSourceActivated ? undefined : resolvedSource;
  const surfaces = playbackSurfaceState({
    controls,
    error,
    finePointer,
    iosPlayback,
    iosSourceActivated,
    loading,
    pausedByUser,
    playing,
    startedPlayback,
  });
  const playbackTitle = currentQueue?.seriesTitle
    ? `${currentQueue.seriesTitle} · S${String(currentQueue.season).padStart(2, "0")} E${String(currentQueue.episode).padStart(2, "0")} · ${currentQueue.label}`
    : route.title || currentQueue?.label || "Kheyflix video";
  const stop = useCallback(
    (token = session) => {
      if (
        releasedTranscoderSessions.current.has(token) ||
        bestEffortStoppedTranscoderSessions.current.has(token) ||
        releasingTranscoderSessions.current.has(token)
      )
        return;
      // A beacon has no response to await. Keep it distinct from an awaited
      // release so a later source replacement can still make an explicit,
      // capacity-safe stop request if this best-effort send was lost.
      rememberReleasedTranscoderSession(
        bestEffortStoppedTranscoderSessions.current,
        token,
      );
      const url = `/api/debrid/transcode/${id}/${file}?session=${token}`;
      if (navigator.sendBeacon?.(url)) return;
      void fetch(url, { method: "POST", keepalive: true });
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
  const reportPlayback = useCallback(
    (
      event:
        | "first_frame"
        | "bootstrap_eof_before_frame"
        | "native_vod_handoff"
        | "rebuffer"
        | "startup_timeout"
        | "startup_retry"
        | "failure",
      elapsedMs: number,
      details: { sourceElapsedMs?: number } = {},
    ) => {
      const payload = JSON.stringify({
        event,
        elapsedMs: Math.max(0, Math.round(elapsedMs)),
        rebufferCount: rebufferCount.current,
        attempt: Math.max(1, sourceAttempt.current),
        phase: effectiveBootstrap ? "bootstrap" : "standard",
        quality: activeQuality,
        ...(details.sourceElapsedMs === undefined
          ? {}
          : {
              sourceElapsedMs: Math.max(
                0,
                Math.round(details.sourceElapsedMs),
              ),
            }),
      });
      try {
        if (
          navigator.sendBeacon &&
          navigator.sendBeacon(
            "/api/playback/telemetry",
            new Blob([payload], { type: "application/json" }),
          )
        )
          return;
        void fetch("/api/playback/telemetry", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
          keepalive: true,
        }).catch(() => undefined);
      } catch {
        // Diagnostics never interrupt playback.
      }
    },
    [activeQuality, effectiveBootstrap],
  );
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
  const stopSessionBeforeReplacement = useCallback(
    async (token: string) => {
      if (releasedTranscoderSessions.current.has(token)) return;
      const existingRelease = releasingTranscoderSessions.current.get(token);
      if (existingRelease) {
        await existingRelease;
        return;
      }
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 3_000);
      const release = Promise.resolve()
        .then(() =>
          releaseTranscoderSession(
            fetch,
            String(id),
            file,
            token,
            controller.signal,
          ),
        )
        .then(() => {
          rememberReleasedTranscoderSession(releasedTranscoderSessions.current, token);
        })
        .catch(() => {
          // The replacement still has bounded server-side admission. A
          // best-effort stop must not strand the viewer on a paused frame.
        })
        .finally(() => {
          window.clearTimeout(timeout);
          releasingTranscoderSessions.current.delete(token);
        });
      releasingTranscoderSessions.current.set(token, release);
      await release;
    },
    [file, id],
  );
  const replaceTranscoderSession = useCallback(
    async (
      position: number,
      replacement: TranscoderSessionReplacement,
      transition: TranscoderSessionTransition = {},
    ): Promise<TranscoderSessionReplacement | false> => {
      if (terminalPlaybackFailure.current) return false;
      if (transcoderSessionReplacementPending.current) {
        // Preserve the latest deliberate player adjustment while the prior
        // job is releasing. This keeps capacity bounded without discarding a
        // quick audio or quality correction.
        queuedTranscoderSessionReplacement.current = { position, replacement };
        return false;
      }
      transcoderSessionReplacementPending.current = true;
      const failureEpoch = terminalPlaybackFailureEpoch.current;
      const prepared = nativeVodPrewarm.current;
      // A manual seek, pause/resume, quality change, or failed recovery makes
      // any prepared successor stale. Release it before allocating another
      // bounded playback session. The one exception is the exact successor
      // selected at a finite VOD boundary below.
      if (prepared && prepared.session !== transition.session) {
        nativeVodPrewarm.current = undefined;
        nativeVodPrewarmGeneration.current += 1;
        void stopSessionBeforeReplacement(prepared.session);
      }
      let selected = { position, replacement };
      let target = Math.max(0, Math.min(duration || position, position));
      persistRef.current(target);
      // With a maximum of two transcoder jobs, every in-player replacement
      // must make its new source wait for the old one to be released. The
      // source gate also prevents Safari from retaining a stale rolling HLS
      // playlist while the handoff is in progress.
      setTranscoderSessionTransition(true);
      setLoading(true);
      setError(false);
      setErrorMessage("");
      try {
        if (transcoded && !transition.skipCurrentStop)
          await stopSessionBeforeReplacement(activeSession);
        // A provider metadata error may have arrived while the prior source
        // was being released. Do not let that older recovery publish a fresh
        // session after the viewer has been shown a terminal, retryable error.
        if (
          terminalPlaybackFailure.current ||
          failureEpoch !== terminalPlaybackFailureEpoch.current
        )
          return false;
        selected = queuedTranscoderSessionReplacement.current || selected;
        queuedTranscoderSessionReplacement.current = undefined;
        target = Math.max(
          0,
          Math.min(duration || selected.position, selected.position),
        );
        persistRef.current(target);
        const next = selected.replacement;
        setLocalTime(0);
        setAudio(next.audio);
        setCompatible(next.compatible);
        setCopyCompatibleVideo(next.copyCompatibleVideo);
        setBootstrap(next.bootstrap);
        setRendition(next.rendition);
        setSubtitle(next.subtitle);
        setSessionConfiguration({ ...next, start: target });
        setSession(transition.session || newSessionToken());
        if (transcoded && transition.skipCurrentStop)
          void stopSessionBeforeReplacement(activeSession);
        autoUpgradeRequested.current = null;
        return next;
      } finally {
        const queued = queuedTranscoderSessionReplacement.current;
        queuedTranscoderSessionReplacement.current = undefined;
        transcoderSessionReplacementPending.current = false;
        // A Retry can be pressed while a failed replacement is still
        // releasing. Start its latest requested source only after the stale
        // replacement has been invalidated, without briefly reopening the
        // old source gate.
        if (queued && !terminalPlaybackFailure.current)
          void replaceTranscoderSession(queued.position, queued.replacement);
        else setTranscoderSessionTransition(false);
      }
    },
    [activeSession, duration, stopSessionBeforeReplacement, transcoded],
  );
  const replaceNativeHlsSession = useCallback(
    (position: number, transition?: TranscoderSessionTransition) =>
      replaceTranscoderSession(position, {
        audio,
        bootstrap,
        compatible,
        copyCompatibleVideo,
        rendition,
        subtitle,
        sync: preferences.audioSync,
      }, transition),
    [
      audio,
      bootstrap,
      compatible,
      copyCompatibleVideo,
      preferences.audioSync,
      rendition,
      replaceTranscoderSession,
      subtitle,
    ],
  );
  const prewarmNativeVodChunk = useCallback(
    (start: number) => {
      if (
        !nativeHlsPlayback ||
        !transcoded ||
        !Number.isFinite(duration) ||
        duration <= 0 ||
        start >= duration - 0.5 ||
        nativeVodPrewarmPending.current
      )
        return;
      const existing = nativeVodPrewarm.current;
      if (existing && Math.abs(existing.start - start) < 0.5) return;
      if (existing) {
        nativeVodPrewarm.current = undefined;
        nativeVodPrewarmGeneration.current += 1;
        void stopSessionBeforeReplacement(existing.session);
      }
      const session = newSessionToken();
      const prepared: NativeVodPrewarm = {
        session,
        start,
        source: nativeHlsSource(session, start, true),
      };
      const generation = ++nativeVodPrewarmGeneration.current;
      nativeVodPrewarmPending.current = true;
      void fetch(prepared.source, { cache: "no-store" })
        .then(async (response) => {
          if (!response.ok) throw new Error("Native VOD prewarm was rejected.");
          await response.text();
          if (generation !== nativeVodPrewarmGeneration.current) {
            void stopSessionBeforeReplacement(prepared.session);
            return;
          }
          nativeVodPrewarm.current = prepared;
        })
        .catch(() => {
          // EOF still has the ordinary bounded native-session replacement as
          // a fallback. A speculative prewarm must never surface an error.
        })
        .finally(() => {
          if (generation === nativeVodPrewarmGeneration.current)
            nativeVodPrewarmPending.current = false;
        });
    },
    [duration, nativeHlsPlayback, nativeHlsSource, stopSessionBeforeReplacement, transcoded],
  );
  const toggle = useCallback(() => {
    const element = video.current;
    if (!element) return;
    if (element.paused) {
      userPaused.current = false;
      setPausedByUser(false);
      if (
        nativeHlsResumeAction({
          nativeHlsPlayback,
          startedPlayback,
          transcoded,
        }) === "rotate-session"
      ) {
        const currentTime = Number.isFinite(element.currentTime)
          ? element.currentTime
          : 0;
        void replaceNativeHlsSession(playbackOffset + currentTime);
        return;
      }
      void element.play().catch(() => undefined);
    } else {
      userPaused.current = true;
      setPausedByUser(true);
      element.pause();
    }
  }, [nativeHlsPlayback, playbackOffset, replaceNativeHlsSession, startedPlayback, transcoded]);
  const restart = useCallback(
    (
      at: number,
      nextAudio = audio,
      nextQuality = rendition,
      options: Partial<
        Omit<TranscoderSessionReplacement, "audio" | "rendition">
      > = {},
    ) => {
      void replaceTranscoderSession(at, {
        audio: nextAudio,
        bootstrap: options.bootstrap ?? bootstrap,
        compatible: options.compatible ?? compatible,
        copyCompatibleVideo:
          options.copyCompatibleVideo ?? copyCompatibleVideo,
        rendition: nextQuality,
        subtitle: options.subtitle ?? subtitle,
        sync: options.sync ?? preferences.audioSync,
      });
    },
    [
      audio,
      bootstrap,
      compatible,
      copyCompatibleVideo,
      preferences.audioSync,
      rendition,
      replaceTranscoderSession,
      subtitle,
    ],
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
    navigationGeneration.current += 1;
    persist();
    if (transcoded) stop();
    onBack();
  }, [onBack, persist, stop, transcoded]);
  const playNext = useCallback(() => {
    if (!next || nextEpisodeNavigationPending.current) return;
    nextEpisodeNavigationPending.current = true;
    const generation = ++navigationGeneration.current;
    persist();
    const navigateToNext = () => {
      if (generation !== navigationGeneration.current) return;
      navigate({
        section: "stream",
        id: String(next.magnetId),
        file: next.file,
        title: next.seriesId
          ? `${next.seriesTitle || "Series"} · S${String(next.season).padStart(2, "0")} E${String(next.episode).padStart(2, "0")} · ${next.label}`
          : next.label,
        compat: transcoded,
      });
    };
    if (!transcoded) {
      navigateToNext();
      return;
    }
    // Do not send the next episode into a saturated two-slot service while
    // this episode is still being stopped. The source gate keeps the current
    // player quiet during the bounded release request.
    setTranscoderSessionTransition(true);
    void stopSessionBeforeReplacement(activeSession).finally(navigateToNext);
  }, [activeSession, navigate, next, persist, stopSessionBeforeReplacement, transcoded]);

  const absoluteTimeRef = useRef(absoluteTime),
    sessionConfigurationRef = useRef(sessionConfiguration),
    replaceTranscoderSessionRef = useRef(replaceTranscoderSession);
  useLayoutEffect(() => {
    if (startupTimer.current !== undefined) {
      clearTimeout(startupTimer.current);
      startupTimer.current = undefined;
    }
    // A source gate or replacement invalidates any frame callback queued by
    // the prior decoder. The current source owns the next decoded-frame
    // measurement, even when the browser reuses the same video element.
    sourceGeneration.current += 1;
    if (!source) return;
    sourceAttempt.current += 1;
    playbackRequestedAt.current = performance.now();
    if (viewerPlaybackRequestedAt.current === undefined)
      viewerPlaybackRequestedAt.current = playbackRequestedAt.current;
    startupDeadline.current =
      playbackRequestedAt.current +
      (nativeHlsPlayback
        ? NATIVE_STARTUP_TIMEOUT_MS
        : transcoded
          ? COMPATIBLE_STARTUP_TIMEOUT_MS
          : NATIVE_STARTUP_TIMEOUT_MS);
    startupSettled.current = false;
    bufferingStartedAt.current = 0;
  }, [nativeHlsPlayback, source, transcoded]);
  useEffect(() => {
    absoluteTimeRef.current = absoluteTime;
    sessionConfigurationRef.current = sessionConfiguration;
    replaceTranscoderSessionRef.current = replaceTranscoderSession;
  }, [absoluteTime, replaceTranscoderSession, sessionConfiguration]);
  useEffect(() => {
    const clearActiveStartupTimer = () => {
      if (startupTimer.current === undefined) return;
      clearTimeout(startupTimer.current);
      startupTimer.current = undefined;
    };
    if (
      !source ||
      !shouldArmStartupRecoveryTimer({
        effectiveBootstrap,
        error,
        loading,
        mediaReady,
        nativeHlsPlayback,
        startupSettled: startupSettled.current,
      })
    ) {
      clearActiveStartupTimer();
      return;
    }
    // Metadata and preference updates may re-render a native HLS player while
    // its playlist is still stalled. Always count from the source's original
    // request, rather than silently granting each render a fresh timeout.
    const deadline =
      startupDeadline.current ||
      performance.now() +
        (nativeHlsPlayback
          ? NATIVE_STARTUP_TIMEOUT_MS
          : transcoded
            ? COMPATIBLE_STARTUP_TIMEOUT_MS
            : NATIVE_STARTUP_TIMEOUT_MS);
    const timer = setTimeout(
      () => {
        if (startupTimer.current === timer)
          startupTimer.current = undefined;
        if (terminalPlaybackFailure.current) return;
        const recovery = startupRecovery(transcoded, startupRetries.current);
        reportPlayback(
          recovery === "retry" ? "startup_retry" : "startup_timeout",
          performance.now() - playbackRequestedAt.current,
        );
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
          const configuration = sessionConfigurationRef.current;
          void replaceTranscoderSessionRef.current(
            absoluteTimeRef.current,
            {
              ...configuration,
              bootstrap: false,
              compatible: true,
              rendition: "480",
            },
          );
        } else if (recovery === "retry") {
          startupRetries.current += 1;
          const configuration = sessionConfigurationRef.current;
          void replaceTranscoderSessionRef.current(
            absoluteTimeRef.current,
            configuration,
          );
        } else {
          setLoading(false);
          setError(true);
          stopRef.current();
        }
      },
      Math.max(0, deadline - performance.now()),
    );
    startupTimer.current = timer;
    return () => {
      clearTimeout(timer);
      if (startupTimer.current === timer) startupTimer.current = undefined;
    };
  }, [effectiveBootstrap, error, file, id, loading, mediaReady, nativeHlsPlayback, rendition, reportPlayback, session, source, transcoded]);
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
    const request = mediaRequests.current.begin();
    const controller = new AbortController();
    void fetch(`/api/debrid/media/${id}/${file}`, {
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new MediaInfoHttpError(response.status);
        return response.json() as Promise<MediaInfo>;
      })
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
        setSubtitleSize(savedPreferences.subtitleSize);
        const savedQuality = savedPreferences.qualityMode;
        const hasSavedQuality =
          savedQuality !== "auto" &&
          availableQualities(value.video[0]?.height || 0).includes(savedQuality);
        if (hasSavedQuality) {
          setQualityMode(savedQuality);
          setRendition(savedQuality);
          setBootstrap(false);
        } else {
          setQualityMode("auto");
          setRendition("480");
        }
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
        // Sidecar WebVTT keeps subtitle preference changes independent from
        // the active audio/video session. Embedding the track in a running
        // progressive transcode required a visibly disruptive source restart.
        setSubtitle(preferredSubtitle?.index);
        if (
          value.video[0]?.codec.toLowerCase() === "hevc" &&
          document
            .createElement("video")
            .canPlayType('video/mp4; codecs="hvc1"')
        )
          setCopyCompatibleVideo(true);
        const requiresCompatibility = needsCompatiblePlayback(
          value.format,
          selected?.codec,
        );
        if (requiresCompatibility)
          setCompatible(true);
        // This metadata request runs concurrently with a bootstrap or known
        // compatible source. It may update the controls' desired settings,
        // but it must never alter the URL/configuration for the token that is
        // currently decoding. Explicit user choices and planned quality
        // changes create a fresh session only after its predecessor stops.
        setMediaReady(true);
      })
      .catch((reason) => {
        if (controller.signal.aborted) return;
        const currentPlaybackMode = playbackMode.current;
        if (
          reason instanceof MediaInfoHttpError &&
          shouldSurfaceMediaInfoError(
            currentPlaybackMode.effectiveBootstrap,
            currentPlaybackMode.nativeHlsPlayback,
            reason.status,
          )
        ) {
          terminalPlaybackFailure.current = true;
          terminalPlaybackFailureEpoch.current += 1;
          setLoading(false);
          setErrorMessage(reason.message);
          setError(true);
          stopRef.current();
          return;
        }
        setMediaReady(true);
      });
    return () => {
      request.cancel();
      controller.abort();
    };
  }, [file, id, identity, mediaInfoAttempt, nativeHlsPlayback, preferenceKey, route.compat]);
  useEffect(() => {
    if (video.current)
      video.current.playbackRate = preferences.playbackRate;
  }, [preferences.playbackRate, source]);
  useEffect(() => {
    if (!iosPlayback || !iosSourceActivated || !video.current) return;
    const element = video.current;
    if (!source) {
      if (!attachedIosSource.current) return;
      element.removeAttribute("src");
      element.load();
      attachedIosSource.current = undefined;
      return;
    }
    if (attachedIosSource.current === source) return;
    // Initial activation assigns the source synchronously in the tap handler.
    // This effect is only for later session rotations, where React must not
    // overwrite the native element in the same trusted interaction.
    element.src = source;
    element.load();
    attachedIosSource.current = source;
    element.muted = true;
    element.volume = 0;
    void element.play().catch(() => setControls(true));
  }, [iosPlayback, iosSourceActivated, source]);
  useEffect(() => {
    // The master request is deliberately withheld until the finite VOD chunk
    // is complete. Starting its successor at loadedmetadata (rather than
    // waiting for the first decoded frame) gives the encoder the entire
    // playable chunk as headroom without competing with the initial encoder.
    if (
      !source ||
      nativeVodMetadataSource !== source ||
      !nativeHlsPlayback ||
      !transcoded ||
      !duration ||
      !Number.isFinite(nativeVodChunkDuration) ||
      nativeVodChunkDuration <= 0
    )
      return;
    prewarmNativeVodChunk(playbackOffset + nativeVodChunkDuration);
  }, [
    duration,
    nativeHlsPlayback,
    nativeVodChunkDuration,
    nativeVodMetadataSource,
    playbackOffset,
    prewarmNativeVodChunk,
    source,
    transcoded,
  ]);
  useEffect(
    () => () => {
      nativeVodPrewarmGeneration.current += 1;
      nativeVodPrewarmPending.current = false;
      const prepared = nativeVodPrewarm.current;
      nativeVodPrewarm.current = undefined;
      if (prepared) void stopSessionBeforeReplacement(prepared.session);
    },
    [stopSessionBeforeReplacement],
  );
  const promoteAutoQuality = useCallback(
    (target: RenditionQuality, position = absoluteTimeRef.current) => {
      if (autoUpgradeRequested.current === target) return;
      const targetAt = Math.max(0, position);
      void replaceTranscoderSession(targetAt, {
        audio,
        bootstrap: false,
        compatible,
        copyCompatibleVideo,
        rendition: target,
        subtitle,
        sync: preferences.audioSync,
      }).then((applied) => {
        if (applied && applied.rendition === target && !applied.bootstrap)
          autoUpgradeRequested.current = target;
      });
    },
    [
      audio,
      compatible,
      copyCompatibleVideo,
      preferences.audioSync,
      replaceTranscoderSession,
      subtitle,
    ],
  );
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
    // Auto quality changes are intentionally deferred until the viewer has a
    // real frame. `play` alone only means a browser accepted the request; it
    // is not evidence that bootstrap actually reached the decoder.
    if (firstFrameMs === undefined) return;
    const target = autoQualityUpgradeTarget({
      bootstrap: sessionConfiguration.bootstrap,
      nativeHlsPlayback,
      sustainedCompatibility,
      loading,
      playing,
      qualityMode,
      rendition: sessionConfiguration.rendition,
      sourceHeight,
      transcoded,
    });
    if (!target || autoUpgradeRequested.current === target) return;
    const timer = setTimeout(() => {
      promoteAutoQuality(target);
    }, BOOTSTRAP_PROMOTION_DELAY_MS);
    return () => clearTimeout(timer);
  }, [firstFrameMs, loading, nativeHlsPlayback, playing, promoteAutoQuality, qualityMode, sessionConfiguration.bootstrap, sessionConfiguration.rendition, sourceHeight, sustainedCompatibility, transcoded]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (menu) setMenu(null);
        else safeBack();
        return;
      }
      if (isInteractiveKeyboardTarget(event.target)) return;
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
      if (event.key.toLowerCase() === "n" && next) void playNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [displayTime, menu, next, playNext, safeBack, seek, toggle]);
  useEffect(() => {
    const requests = mediaRequests.current;
    const leave = () => persistRef.current();
    window.addEventListener("pagehide", leave);
    return () => {
      navigationGeneration.current += 1;
      window.removeEventListener("pagehide", leave);
      requests.invalidate();
      persistRef.current();
      stopRef.current();
    };
  }, []);
  return (
    <main
      className={`player-shell ${controls || !playing || keyboardFocusWithin ? "controls-visible" : ""} ${surfaces.dimVideo ? "video-dimmed" : ""} subtitle-${subtitleSize}`}
      data-playback-phase={effectiveBootstrap ? "bootstrap" : "standard"}
      data-playback-quality={activeQuality}
      data-playback-state={error ? "error" : loading ? "loading" : playing ? "playing" : "paused"}
      data-source-height={sourceHeight || undefined}
      data-playback-surface={
        surfaces.showError
          ? "error"
          : surfaces.showBuffering
            ? "buffering"
            : surfaces.showIosPrompt
              ? "ios-prompt"
              : surfaces.showCentralControls
                ? pausedByUser
                  ? "paused-controls"
                  : "quick-controls"
                : surfaces.showInitialLoader && loading
                  ? "initial-loading"
                  : "video"
      }
      data-first-frame-ms={firstFrameMs === undefined ? undefined : Math.round(firstFrameMs)}
      ref={shell}
      onFocusCapture={(event) => {
        if (
          event.target instanceof Element &&
          event.target.matches(":focus-visible")
        ) {
          setKeyboardFocusWithin(true);
          showControls();
        }
      }}
      onBlurCapture={(event) => {
        if (
          !(event.relatedTarget instanceof Node) ||
          !event.currentTarget.contains(event.relatedTarget)
        )
          setKeyboardFocusWithin(false);
      }}
      onPointerDownCapture={() => setKeyboardFocusWithin(false)}
      onMouseMove={(event) => {
        const pointer = { x: event.clientX, y: event.clientY };
        if (
          lastPointer.current?.x === pointer.x &&
          lastPointer.current?.y === pointer.y
        )
          return;
        lastPointer.current = pointer;
        showControls();
      }}
      onClick={showControls}
    >
      <video
        ref={video}
        // React must not reassign a native iOS HLS source after the activation
        // handler sets it. WebKit treats that second assignment as a new,
        // non-gesture load and can stall before its first segment.
        src={iosPlayback ? undefined : source}
        autoPlay={!iosPlayback}
        // Finite native-VOD chunks expose only their short local duration to
        // WebKit's built-in scrubber. Kheyflix's accessible controls use the
        // full title duration and route every seek through a fresh immutable
        // session, so they are the sole control surface on iPhone as well.
        controls={false}
        muted={volume === 0}
        playsInline
        preload="auto"
        onLoadedMetadata={(event) => {
          recordNativeVodMetadata(source, event.currentTarget);
          if (!transcoded && playbackOffset > 0)
            event.currentTarget.currentTime = playbackOffset;
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
          // iPhone source assignment and play happen synchronously in the
          // explicit activation handler. Replaying here is outside that
          // trusted gesture and can make WebKit retain metadata without
          // advancing to a media segment.
          if (iosPlayback) return;
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
        onSeeking={(event) => {
          if (nativeHlsSeekRotation.current) return;
          const target = playbackOffset + event.currentTarget.currentTime;
          if (
            nativeHlsSeekAction({
              current: absoluteTimeRef.current,
              nativeHlsPlayback,
              startedPlayback,
              target,
              transcoded,
            }) !== "rotate-session"
          )
            return;
          nativeHlsSeekRotation.current = true;
          event.currentTarget.pause();
          void replaceNativeHlsSession(target).then((applied) => {
            if (!applied) nativeHlsSeekRotation.current = false;
          });
        }}
        onTimeUpdate={(event) => {
          const value = event.currentTarget.currentTime;
          setLocalTime(value);
          if (Date.now() - lastSaved.current > 5000) {
            lastSaved.current = Date.now();
            persist(transcoded ? playbackOffset + value : value);
          }
        }}
        onDurationChange={(event) => {
          if (!info?.duration && !transcoded)
            setNativeDuration(event.currentTarget.duration);
        }}
        onLoadedData={(event) => {
          // Native Safari can finish a source handoff with loadeddata but no
          // fresh duration state update. Treat either ready event as enough
          // evidence to prepare the next immutable VOD window.
          recordNativeVodMetadata(source, event.currentTarget);
          setLoading(false);
        }}
        onCanPlay={(event) => {
          recordNativeVodMetadata(source, event.currentTarget);
          startupRetries.current = 0;
          setLoading(false);
          if (!requiresMutedAutoplay(navigator.userAgent)) return;
          event.currentTarget.muted = true;
          event.currentTarget.volume = 0;
          if (iosPlayback) return;
          void event.currentTarget.play().catch(() => {
            setPlaying(false);
            setControls(true);
          });
        }}
        onWaiting={() => {
          if (startedPlayback && !bufferingStartedAt.current)
            bufferingStartedAt.current = performance.now();
          setLoading(true);
        }}
        onPlaying={() => {
          if (video.current) recordNativeVodMetadata(source, video.current);
          const expectedNativeVodHandoff = nativeVodExpectedHandoff.current;
          nativeVodExpectedHandoff.current = false;
          nativeHlsSeekRotation.current = false;
          nativeVodChunkTransition.current = false;
          startupRetries.current = 0;
          startupSettled.current = true;
          if (startupTimer.current !== undefined) {
            clearTimeout(startupTimer.current);
            startupTimer.current = undefined;
          }
          hlsRecoveryAttempts.current = 0;
          nativeHlsRecoverySession.current = undefined;
          setPlaying(true);
          setLoading(false);
          setStartedPlayback(true);
          if (bufferingStartedAt.current) {
            const elapsed = performance.now() - bufferingStartedAt.current;
            bufferingStartedAt.current = 0;
            if (expectedNativeVodHandoff)
              reportPlayback("native_vod_handoff", elapsed);
            else {
              rebufferCount.current += 1;
              reportPlayback("rebuffer", elapsed);
            }
          }
          const element = video.current;
          if (!firstFrameRecorded.current && element) {
            const generation = sourceGeneration.current,
              currentSource = element.currentSrc;
            const record = () => {
              if (
                firstFrameRecorded.current ||
                generation !== sourceGeneration.current ||
                currentSource !== element.currentSrc
              )
                return;
              firstFrameRecorded.current = true;
              const sourceElapsed = performance.now() - playbackRequestedAt.current,
                elapsed =
                  performance.now() -
                  (viewerPlaybackRequestedAt.current ?? playbackRequestedAt.current);
              setFirstFrameMs(elapsed);
              reportPlayback("first_frame", elapsed, {
                sourceElapsedMs: sourceElapsed,
              });
              console.info("[playback] first frame", {
                milliseconds: Math.round(elapsed),
                sourceMilliseconds: Math.round(sourceElapsed),
                phase: effectiveBootstrap ? "bootstrap" : "standard",
                quality: activeQuality,
              });
            };
            if ("requestVideoFrameCallback" in element)
              element.requestVideoFrameCallback(record);
            else requestAnimationFrame(record);
          }
        }}
        onEnded={(event) => {
          if (terminalPlaybackFailure.current) return;
          if (effectiveBootstrap && transcoded) {
            // Bootstrap is intentionally capped at 30 seconds, so its EOF is
            // never evidence that the title finished. Promote from the exact
            // current position rather than recording a false completion.
            if (!firstFrameRecorded.current) {
              const elapsed = performance.now() - playbackRequestedAt.current;
              reportPlayback("bootstrap_eof_before_frame", elapsed);
              console.warn("[playback] bootstrap ended before a decoded frame", {
                id,
                file,
                milliseconds: Math.round(elapsed),
              });
            }
            promoteAutoQuality(
              bestAutoQuality(sourceHeight),
              playbackOffset + event.currentTarget.currentTime,
            );
            return;
          }
          const currentTime = Number.isFinite(event.currentTarget.currentTime)
            ? event.currentTarget.currentTime
            : 0;
          const actualChunkDuration = Number.isFinite(event.currentTarget.duration)
            ? event.currentTarget.duration
            : currentTime;
          const absolutePosition = playbackOffset + currentTime;
          if (
            nativeVodChunkEndAction({
              absolutePosition,
              actualChunkDuration,
              nativeHlsPlayback,
              titleDuration: duration,
              transcoded,
            }) === "next-chunk"
          ) {
            if (nativeVodChunkTransition.current) return;
            nativeVodChunkTransition.current = true;
            nativeVodExpectedHandoff.current = true;
            const prepared = nativeVodPrewarm.current;
            const transition =
              prepared && Math.abs(prepared.start - absolutePosition) < 0.5
                ? { session: prepared.session, skipCurrentStop: true }
                : undefined;
            if (transition) {
              nativeVodPrewarm.current = undefined;
              nativeVodPrewarmGeneration.current += 1;
              nativeVodPrewarmPending.current = false;
            }
            void replaceNativeHlsSession(absolutePosition, transition).then((applied) => {
              if (!applied) nativeVodChunkTransition.current = false;
            });
            return;
          }
          persist(duration);
          setPlaying(false);
          if (transcoded) stop();
        }}
        onError={(event) => {
          if (terminalPlaybackFailure.current) return;
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
          reportPlayback("failure", performance.now() - playbackRequestedAt.current);
          if (!transcoded) {
            restart(absoluteTime, audio, "480", {
              bootstrap: false,
              compatible: true,
            });
          } else if (nativeHlsPlayback) {
            // A source handoff can finish with an immediate error before
            // WebKit emits `playing`. Suppress duplicate errors only for the
            // exact failed session, not for its replacement.
            if (nativeHlsRecoverySession.current === activeSession) return;
            const recovery = nativeHlsRecoveryAction(hlsRecoveryAttempts.current);
            if (recovery === "rotate-session") {
              hlsRecoveryAttempts.current += 1;
              nativeHlsRecoverySession.current = activeSession;
              nativeVodChunkTransition.current = true;
              nativeVodExpectedHandoff.current = false;
              const position = absoluteTimeRef.current;
              void replaceNativeHlsSession(position).then((applied) => {
                if (!applied) nativeVodChunkTransition.current = false;
              });
              return;
            }
            setLoading(false);
            setErrorMessage("The Apple-compatible stream could not recover. Your place has been saved.");
            setError(true);
            stop();
          } else if (
            qualityMode === "auto" &&
            rendition === "480" &&
            effectiveBootstrap
          ) {
            // A bootstrap decode failure is not a reason to keep reissuing
            // bootstrap. Move to the direct source when possible, or to a
            // sustained compatible rendition for media that already requires
            // transcoding.
            restart(absoluteTime, audio, compatible ? "480" : "original", {
              bootstrap: false,
            });
          } else {
            setLoading(false);
            setError(true);
            if (transcoded) stop();
          }
        }}
      >
        {activeSubtitle !== undefined && (
          <track
            key={activeSubtitle}
            kind="subtitles"
            src={`/api/debrid/subtitle/${id}/${file}/${activeSubtitle}?start=${transcoded ? playbackOffset : 0}`}
            srcLang={
              info?.subtitles.find((track) => track.index === activeSubtitle)
                ?.language || "en"
            }
            default
          />
        )}
      </video>
      {surfaces.showIosPrompt && (
        <button
          className="ios-play-prompt"
          onClick={(event) => {
            event.stopPropagation();
            const element = video.current;
            if (!element || !resolvedSource) return;
            if (viewerPlaybackRequestedAt.current === undefined)
              viewerPlaybackRequestedAt.current = performance.now();
            element.muted = true;
            element.volume = 0;
            if (iosPlayback && !iosSourceActivated) {
              // Do not defer this assignment to React's next render: WebKit
              // preserves the user activation only for this synchronous
              // handler, and native HLS needs the source attached inside it.
              element.src = resolvedSource;
              element.load();
              attachedIosSource.current = resolvedSource;
              setIosSourceActivated(true);
            }
            void element.play().catch(() => setControls(true));
          }}
        >
          <Play />
          Tap to play
        </button>
      )}
      {surfaces.showCentralControls && (
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
      {surfaces.showBuffering && (
        <div className="buffering-indicator" role="status" aria-label="Buffering" />
      )}
      {surfaces.showInitialLoader && (
        <ShardPortalLoader active={loading} compatible={compatible} />
      )}
      {surfaces.showError && (
        <div className="playback-error" role="alert">
          <h1>We couldn’t start playback</h1>
          <p>
            {errorMessage ||
              "The stream did not become playable. Your place has been saved."}
          </p>
          <div>
            <button
              onClick={() => {
                terminalPlaybackFailure.current = false;
                hlsRecoveryAttempts.current = 0;
                nativeHlsRecoverySession.current = undefined;
                nativeVodChunkTransition.current = false;
                setError(false);
                setErrorMessage("");
                setLoading(true);
                setMediaInfoAttempt((attempt) => attempt + 1);
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
              ? `${effectiveBootstrap ? "Starting · 360p" : qualityMode === "auto" ? `Auto · ${rendition === "original" ? "Original" : `${rendition}p`}` : rendition === "original" ? "Original" : `${rendition}p`} · ${info.video[0].codec.toUpperCase()}`
              : effectiveBootstrap
                ? "Starting · 360p"
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
                      setAudio(track.index);
                      restart(absoluteTime, track.index, rendition, {
                        compatible: true,
                      });
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
                      onClick={() => {
                        setSubtitleSize(value);
                        updatePreferences({ subtitleSize: value });
                      }}
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
                  {nativeHlsPlayback
                    ? "Auto prioritizes uninterrupted Apple playback at 480p."
                    : "Auto starts light and raises quality while playback stays smooth."}
                </p>
                {(["auto", ...availableQualities(sourceHeight)] as QualityMode[]).map(
                  (value) => (
                    <button
                      className={qualityMode === value ? "active" : ""}
                      key={value}
                      onClick={() => {
                        const nextQuality = value === "auto" ? "480" : value;
                        setQualityMode(value);
                        updatePreferences({ qualityMode: value });
                        setBootstrap(false);
                        setRendition(nextQuality);
                        restart(absoluteTime, audio, nextQuality, {
                          bootstrap: false,
                        });
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
                      restart(absoluteTime, audio, rendition, {
                        compatible: true,
                        sync: audioSync,
                      });
                    }}
                  >
                    Voice earlier
                  </button>
                  <button
                    onClick={() => {
                      updatePreferences({ audioSync: 0 });
                      restart(absoluteTime, audio, rendition, {
                        compatible: true,
                        sync: 0,
                      });
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
                      restart(absoluteTime, audio, rendition, {
                        compatible: true,
                        sync: audioSync,
                      });
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
