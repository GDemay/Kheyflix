// Cold native HLS startup includes both manifest delivery and the first media
// segment decode. A 12-second watchdog cut off healthy iPhone Safari starts
// under real provider latency; twenty seconds remains materially bounded and
// still well below the compatible transcoder's 35-second recovery budget.
export const NATIVE_STARTUP_TIMEOUT_MS = 20_000;
export const COMPATIBLE_STARTUP_TIMEOUT_MS = 35_000;

export type StartupRecovery = "fallback" | "retry" | "fail";

export const startupRecovery = (
  compatible: boolean,
  compatibleRetries: number,
): StartupRecovery => {
  if (!compatible) return "fallback";
  return compatibleRetries < 1 ? "retry" : "fail";
};

// Apple HLS deliberately begins from a fixed compatible profile before the
// metadata probe completes. A pending probe must therefore never postpone the
// startup watchdog: a stalled playlist still needs recovery within the same
// bounded playback budget as every other source.
export const shouldArmStartupRecoveryTimer = ({
  effectiveBootstrap,
  error,
  loading,
  mediaReady,
  nativeHlsPlayback,
  startupSettled = false,
}: {
  effectiveBootstrap: boolean;
  error: boolean;
  loading: boolean;
  mediaReady: boolean;
  nativeHlsPlayback: boolean;
  startupSettled?: boolean;
}) =>
  !startupSettled &&
  loading &&
  !error &&
  (mediaReady || effectiveBootstrap || nativeHlsPlayback);
