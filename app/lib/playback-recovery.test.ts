import { describe, expect, it } from "vitest";
import {
  COMPATIBLE_STARTUP_TIMEOUT_MS,
  NATIVE_STARTUP_TIMEOUT_MS,
  startupRecovery,
} from "./playback-recovery";

describe("playback startup recovery", () => {
  it("falls back from a stalled native source to compatible playback", () => {
    expect(startupRecovery(false, 0)).toBe("fallback");
  });

  it("retries a stalled compatible source once, then stops spinning", () => {
    expect(startupRecovery(true, 0)).toBe("retry");
    expect(startupRecovery(true, 1)).toBe("fail");
  });

  it("allows the server startup window but keeps every wait bounded", () => {
    expect(NATIVE_STARTUP_TIMEOUT_MS).toBeLessThan(
      COMPATIBLE_STARTUP_TIMEOUT_MS,
    );
    expect(COMPATIBLE_STARTUP_TIMEOUT_MS).toBeLessThanOrEqual(35_000);
  });
});
