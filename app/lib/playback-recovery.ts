export const NATIVE_STARTUP_TIMEOUT_MS = 12_000;
export const COMPATIBLE_STARTUP_TIMEOUT_MS = 35_000;

export type StartupRecovery = "fallback" | "retry" | "fail";

export const startupRecovery = (
  compatible: boolean,
  compatibleRetries: number,
): StartupRecovery => {
  if (!compatible) return "fallback";
  return compatibleRetries < 1 ? "retry" : "fail";
};
