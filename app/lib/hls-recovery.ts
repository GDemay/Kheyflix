export type HlsRecoveryAction =
  | "ignore"
  | "restart-load"
  | "recover-media"
  | "rotate-session"
  | "fail";

export const NATIVE_VOD_CHUNK_DURATION_SECONDS = 15;
const NATIVE_VOD_TITLE_END_EPSILON_SECONDS = 0.5;

export const nativeVodChunkEndAction = ({
  absolutePosition,
  actualChunkDuration,
  nativeHlsPlayback,
  titleDuration,
  transcoded,
}: {
  absolutePosition: number;
  actualChunkDuration: number;
  nativeHlsPlayback: boolean;
  titleDuration: number;
  transcoded: boolean;
}) => {
  if (!nativeHlsPlayback || !transcoded) return "complete" as const;
  if (Number.isFinite(titleDuration) && titleDuration > 0)
    return absolutePosition < titleDuration - NATIVE_VOD_TITLE_END_EPSILON_SECONDS
      ? "next-chunk"
      : "complete";
  // Metadata is normally available long before a finite chunk ends. If an
  // upstream probe is still pending, a short final chunk is the only reliable
  // completion signal; a full chunk gets one bounded continuation attempt.
  return actualChunkDuration <
    NATIVE_VOD_CHUNK_DURATION_SECONDS - NATIVE_VOD_TITLE_END_EPSILON_SECONDS
    ? "complete"
    : "next-chunk";
};

export const hlsRecoveryAction = (
  fatal: boolean,
  type: "network" | "media" | "other",
  attempts: number,
): HlsRecoveryAction => {
  if (!fatal) return "ignore";
  if (attempts === 0 && type === "network") return "restart-load";
  if (attempts === 0 && type === "media") return "recover-media";
  return attempts < 2 ? "rotate-session" : "fail";
};

// Native iPhone Safari does not use hls.js, so its media error event needs its
// own tightly bounded recovery path. One fresh session avoids a stale HLS
// playlist without turning an outage into an endless reload loop.
export const nativeHlsRecoveryAction = (attempts: number): HlsRecoveryAction =>
  attempts < 1 ? "rotate-session" : "fail";

export const nativeHlsSeekAction = ({
  current,
  nativeHlsPlayback,
  startedPlayback,
  target,
  transcoded,
}: {
  current: number;
  nativeHlsPlayback: boolean;
  startedPlayback: boolean;
  target: number;
  transcoded: boolean;
}) =>
  nativeHlsPlayback &&
  startedPlayback &&
  transcoded &&
  Math.abs(target - current) >= 3
    ? "rotate-session"
    : "ignore";

// Native Apple players can retain an old media sequence across a pause, then
// wait forever for that stale sequence after resume. A fresh session at the
// saved position is the reliable native-HLS resume path; desktop MSE and
// direct media sources retain their normal in-place resume behavior.
export const nativeHlsResumeAction = ({
  nativeHlsPlayback,
  startedPlayback,
  transcoded,
}: {
  nativeHlsPlayback: boolean;
  startedPlayback: boolean;
  transcoded: boolean;
}) =>
  nativeHlsPlayback && startedPlayback && transcoded
    ? "rotate-session"
    : "play";
