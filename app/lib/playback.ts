import { showCentralTransportOverlay } from "./player-controls";

const BROWSER_AUDIO_CODECS = new Set(["aac", "mp3", "opus", "vorbis"]);

export type QualityMode = "auto" | "original" | "1080" | "720" | "480";
export type RenditionQuality = Exclude<QualityMode, "auto">;

const QUALITY_LADDER: RenditionQuality[] = ["480", "720", "1080", "original"];

export const availableQualities = (sourceHeight = 0): RenditionQuality[] =>
  QUALITY_LADDER.filter((quality) =>
    quality === "original" ? true : !sourceHeight || Number(quality) <= sourceHeight,
  );

export const bestAutoQuality = (sourceHeight = 0): RenditionQuality =>
  sourceHeight > 0 ? "original" : "480";

// Keep the bootstrap brief: it exists to make the first decoded frame fast,
// not to leave someone watching a low-bitrate rendition for a whole scene.
export const BOOTSTRAP_PROMOTION_DELAY_MS = 6_000;

// Bootstrap is a short rendition beginning at the exact requested position.
// It is not a fixed 30-second cache block, so rounding would rewind resumes
// during its handoff to the sustained rendition.
export const bootstrapStartOffset = (offset: number) =>
  Number.isFinite(offset) ? Math.max(0, offset) : 0;

export const autoQualityUpgradeTarget = ({
  bootstrap,
  nativeHlsPlayback,
  sustainedCompatibility,
  loading,
  playing,
  qualityMode,
  rendition,
  sourceHeight = 0,
  transcoded,
}: {
  bootstrap: boolean;
  nativeHlsPlayback: boolean;
  sustainedCompatibility?: boolean;
  loading: boolean;
  playing: boolean;
  qualityMode: QualityMode;
  rendition: RenditionQuality;
  sourceHeight?: number;
  transcoded: boolean;
}) => {
  if (
    !transcoded ||
    qualityMode !== "auto" ||
    !playing
  )
    return null;
  // A progressive MP4 cannot switch to a cold full-quality process without a
  // visible interruption. Known compatibility titles therefore keep their
  // fixed 480p stream until a user explicitly changes quality; future
  // multi-variant HLS can make this adaptive without a source replacement.
  if (sustainedCompatibility) return null;
  // Apple native HLS cannot switch a live single-variant playlist without a
  // visible source replacement. Keep Auto on its fast, compatible 480p
  // transport until a multi-variant manifest exists; a user can still choose
  // a different quality deliberately from the player settings.
  if (nativeHlsPlayback) return null;
  // Do not let an early, probe-free bootstrap decision pin the user at 480p.
  // As soon as metadata arrives, the desktop path can move from its startup
  // rendition to the best viable source quality.
  if (sourceHeight > 0 && rendition === "480")
    return bestAutoQuality(sourceHeight);
  // Only the metadata-unknown fallback needs a settled startup state. Once
  // metadata exists, do not leave Auto pinned at 480p because the interim
  // stream is still reporting a loading transition.
  if (loading) return null;
  // Desktop bootstrap is deliberately finite. If metadata is still pending,
  // replace it with a sustained 480p stream; this same decision will promote
  // it again when metadata eventually arrives.
  if (!nativeHlsPlayback && bootstrap && rendition === "480") return "480";
  return null;
};

export const nextAutoQuality = (
  current: RenditionQuality,
  direction: "up" | "down",
  sourceHeight = 0,
): RenditionQuality => {
  const ladder = availableQualities(sourceHeight),
    index = Math.max(0, ladder.indexOf(current));
  return ladder[
    direction === "up"
      ? Math.min(ladder.length - 1, index + 1)
      : Math.max(0, index - 1)
  ];
};

export const needsCompatibleAudio = (codec?: string) =>
  Boolean(codec && !BROWSER_AUDIO_CODECS.has(codec.toLowerCase()));

export const needsCompatiblePlayback = (
  format = "",
  audioCodec?: string,
) =>
  /(?:^|,)matroska(?:,|$)|(?:^|,)webm(?:,|$)/i.test(format) ||
  needsCompatibleAudio(audioCodec);

export const requiresMutedAutoplay = (userAgent = "") =>
  /(?:iPhone|iPad|iPod)/i.test(userAgent) ||
  (/Macintosh/i.test(userAgent) && /Mobile/i.test(userAgent));

export const usesBootstrapStream = (nativeHlsPlayback: boolean, bootstrap: boolean) =>
  bootstrap && !nativeHlsPlayback;

export const supportsNativeAppleHls = (
  vendor = "",
  canPlayHls = "",
) => /Apple/i.test(vendor) && Boolean(canPlayHls);

export const canStartPlaybackSource = ({
  effectiveBootstrap,
  fixedProfilePlayback = false,
  nativeHlsPlayback,
  mediaReady,
  transcoded,
}: {
  effectiveBootstrap: boolean;
  fixedProfilePlayback?: boolean;
  nativeHlsPlayback: boolean;
  mediaReady: boolean;
  transcoded: boolean;
}) =>
  mediaReady ||
  (transcoded &&
    (effectiveBootstrap || nativeHlsPlayback || fixedProfilePlayback));

// Native Apple HLS can start a bounded profile before ffprobe returns. A
// probe failure must not hide that already-playable recovery path.
export const shouldSurfaceMediaInfoError = (
  effectiveBootstrap: boolean,
  nativeHlsPlayback: boolean,
  status?: number,
) => {
  // Native HLS has an independent fixed-profile source and can start before
  // this optional metadata probe. A transient probe error must not prevent
  // iPhone Safari from attempting that source; its own request is the
  // authoritative playback result and has bounded recovery/error handling.
  if (nativeHlsPlayback) return false;
  // Other playback paths depend on this probe to select a safe source, so a
  // provider/server failure must not leave the viewer staring at a loader.
  if (status !== undefined && status >= 500) return true;
  return !effectiveBootstrap;
};

type PlaybackFetcher = (
  input: string,
  init: RequestInit,
) => Promise<Response>;

export type TranscoderSessionRelease =
  | { released: true }
  | { released: false; retryAfterMs: number };

export type TranscoderSessionReleaseWaiter = (
  retryAfterMs: number,
  signal?: AbortSignal,
) => Promise<boolean>;

const releaseRetryAfterMs = (value: string | null) => {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 1 && seconds <= 10
    ? Math.round(seconds * 1_000)
    : 3_000;
};

export const releaseTranscoderSession = async (
  fetcher: PlaybackFetcher,
  id: string,
  file: number,
  session: string,
  signal?: AbortSignal,
): Promise<TranscoderSessionRelease> => {
  const response = await fetcher(`/api/debrid/transcode/${id}/${file}?session=${session}`, {
    method: "POST",
    keepalive: true,
    signal,
  });
  if (response.status === 204) return { released: true };
  if (response.status === 202)
    return {
      released: false,
      retryAfterMs: releaseRetryAfterMs(response.headers.get("retry-after")),
    };
  throw new Error("The previous stream could not be released.");
};

// A successful stop acknowledgement is deliberately distinct from a request
// that merely began encoder teardown. Starting a replacement before the latter
// becomes a confirmed close can race the server's bounded playback capacity.
export const awaitTranscoderSessionRelease = async (
  fetcher: PlaybackFetcher,
  id: string,
  file: number,
  session: string,
  signal: AbortSignal,
  waitForRetry: TranscoderSessionReleaseWaiter,
): Promise<boolean> => {
  while (!signal.aborted) {
    const outcome = await releaseTranscoderSession(
      fetcher,
      id,
      file,
      session,
      signal,
    );
    if (outcome.released) return true;
    if (!(await waitForRetry(outcome.retryAfterMs, signal))) return false;
  }
  return false;
};

export type PlaybackSurfaceInput = {
  controls: boolean;
  error: boolean;
  finePointer?: boolean;
  iosPlayback: boolean;
  iosSourceActivated?: boolean;
  loading: boolean;
  pausedByUser: boolean;
  playing: boolean;
  startedPlayback: boolean;
};

export const playbackSurfaceState = ({
  controls,
  error,
  finePointer = false,
  iosPlayback,
  iosSourceActivated = false,
  loading,
  pausedByUser,
  playing,
  startedPlayback,
}: PlaybackSurfaceInput) => {
  const showError = error,
    showIosPrompt =
      iosPlayback &&
      !iosSourceActivated &&
      !startedPlayback &&
      !showError,
    // Keep the cinematic loader visible underneath the first iPhone tap. A
    // native HLS player may defer segment retrieval until a user gesture even
    // when muted autoplay is requested, so hiding the activation affordance
    // behind a never-ending loader strands the viewer before the first frame.
    // An opaque full-screen loader prevents WebKit from promoting an inline
    // HLS element to its native decoder. Once the viewer has tapped, keep the
    // video unobscured and use the lightweight buffering indicator instead.
    showInitialLoader =
      !startedPlayback &&
      !showError &&
      loading &&
      !(iosPlayback && iosSourceActivated),
    showBuffering =
      (startedPlayback || (iosPlayback && iosSourceActivated)) &&
      loading &&
      !showError,
    showCentralControls =
      !loading &&
      !showError &&
      !showIosPrompt &&
      showCentralTransportOverlay({
        controlsVisible: controls,
        finePointer,
        pausedByUser,
        playing,
      });

  return {
    dimVideo: showCentralControls,
    showBuffering,
    showCentralControls,
    showError,
    showInitialLoader,
    showIosPrompt,
  };
};
