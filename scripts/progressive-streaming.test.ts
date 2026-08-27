import { describe, expect, it } from "vitest";
import {
  hlsRetentionOptions,
  reclaimablePlaybackJob,
  remoteMediaInput,
} from "./progressive-streaming.mjs";

describe("progressive compatibility streaming", () => {
  it("feeds FFmpeg from the authenticated remote stream route", () => {
    expect(remoteMediaInput("http://localhost:3000", "42", "7")).toBe(
      "http://localhost:3000/api/debrid/stream/42/7",
    );
  });

  it("bounds normal HLS storage instead of accumulating the full title", () => {
    const options = hlsRetentionOptions(false);
    expect(options.join(" ")).toContain("delete_segments");
    expect(options).toContain("8");
    expect(options).not.toContain("event");
  });

  it("keeps the short reusable bootstrap playlist complete", () => {
    expect(hlsRetentionOptions(true)).toContain("event");
  });

  it("reclaims bootstrap capacity immediately for the promoted stream", () => {
    expect(reclaimablePlaybackJob(true, Date.now(), Date.now())).toBe(true);
    expect(reclaimablePlaybackJob(false, Date.now(), Date.now())).toBe(false);
    expect(reclaimablePlaybackJob(false, 0, 31_000)).toBe(true);
  });
});
