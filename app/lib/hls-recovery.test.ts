import { describe, expect, it } from "vitest";

import {
  hlsRecoveryAction,
  nativeHlsRecoveryAction,
  nativeHlsResumeAction,
  nativeHlsSeekAction,
  nativeVodChunkEndAction,
} from "./hls-recovery";

describe("iPhone HLS recovery", () => {
  it("recovers a first network failure in-place", () => {
    expect(hlsRecoveryAction(true, "network", 0)).toBe("restart-load");
  });

  it("recovers a first media failure without discarding the player", () => {
    expect(hlsRecoveryAction(true, "media", 0)).toBe("recover-media");
  });

  it("rotates one failed session, then presents a bounded failure", () => {
    expect(hlsRecoveryAction(true, "other", 0)).toBe("rotate-session");
    expect(hlsRecoveryAction(true, "network", 1)).toBe("rotate-session");
    expect(hlsRecoveryAction(true, "other", 2)).toBe("fail");
  });

  it("leaves nonfatal HLS events alone", () => {
    expect(hlsRecoveryAction(false, "network", 0)).toBe("ignore");
  });

  it("gives native iPhone HLS one fresh session before a clear failure", () => {
    expect(nativeHlsRecoveryAction(0)).toBe("rotate-session");
    expect(nativeHlsRecoveryAction(1)).toBe("fail");
  });

  it("rotates a materially seeked native HLS session instead of rereading stale media", () => {
    expect(
      nativeHlsSeekAction({
        nativeHlsPlayback: true,
        startedPlayback: true,
        transcoded: true,
        current: 12,
        target: 45,
      }),
    ).toBe("rotate-session");
    expect(
      nativeHlsSeekAction({
        nativeHlsPlayback: true,
        startedPlayback: true,
        transcoded: true,
        current: 12,
        target: 13,
      }),
    ).toBe("ignore");
  });

  it("refreshes a paused native HLS window but keeps ordinary resumes instant", () => {
    expect(
      nativeHlsResumeAction({
        nativeHlsPlayback: true,
        startedPlayback: true,
        transcoded: true,
      }),
    ).toBe("rotate-session");
    expect(
      nativeHlsResumeAction({
        nativeHlsPlayback: false,
        startedPlayback: true,
        transcoded: true,
      }),
    ).toBe("play");
    expect(
      nativeHlsResumeAction({
        nativeHlsPlayback: true,
        startedPlayback: false,
        transcoded: true,
      }),
    ).toBe("play");
    expect(
      nativeHlsResumeAction({
        nativeHlsPlayback: true,
        startedPlayback: true,
        transcoded: false,
      }),
    ).toBe("play");
  });

  it("continues a finite native VOD chunk without marking the title complete", () => {
    expect(
      nativeVodChunkEndAction({
        nativeHlsPlayback: true,
        transcoded: true,
        absolutePosition: 215,
        actualChunkDuration: 15,
        titleDuration: 1_200,
      }),
    ).toBe("next-chunk");
    expect(
      nativeVodChunkEndAction({
        nativeHlsPlayback: true,
        transcoded: true,
        absolutePosition: 1_199.8,
        actualChunkDuration: 15,
        titleDuration: 1_200,
      }),
    ).toBe("complete");
    expect(
      nativeVodChunkEndAction({
        nativeHlsPlayback: false,
        transcoded: true,
        absolutePosition: 215,
        actualChunkDuration: 15,
        titleDuration: 1_200,
      }),
    ).toBe("complete");
  });
});
