import { describe, expect, it, vi } from "vitest";
import {
  BOOTSTRAP_PROMOTION_DELAY_MS,
  availableQualities,
  awaitTranscoderSessionRelease,
  bestAutoQuality,
  autoQualityUpgradeTarget,
  bootstrapStartOffset,
  canStartPlaybackSource,
  needsCompatibleAudio,
  needsCompatiblePlayback,
  nextAutoQuality,
  playbackSurfaceState,
  releaseTranscoderSession,
  requiresMutedAutoplay,
  shouldSurfaceMediaInfoError,
  supportsNativeAppleHls,
  usesBootstrapStream,
} from "./playback";

describe("playback compatibility", () => {
  it.each(["aac", "MP3", "opus", "vorbis"])(
    "keeps browser-safe %s audio on the direct stream",
    (codec) => expect(needsCompatibleAudio(codec)).toBe(false),
  );

  it("uses compatibility playback for the selected unsupported audio codec", () => {
    expect(needsCompatibleAudio("dts")).toBe(true);
    expect(needsCompatibleAudio("eac3")).toBe(true);
  });

  it("never replaces an active iPhone Safari stream with a bootstrap source", () => {
    expect(usesBootstrapStream(true, true)).toBe(false);
    expect(usesBootstrapStream(false, true)).toBe(true);
    expect(usesBootstrapStream(false, false)).toBe(false);
  });

  it("recognizes native Apple HLS independently of iPhone autoplay rules", () => {
    expect(supportsNativeAppleHls("Apple Computer, Inc.", "maybe")).toBe(true);
    expect(supportsNativeAppleHls("Google Inc.", "probably")).toBe(false);
  });

  it("lets native Apple HLS start a fixed profile while metadata is still probing", () => {
    expect(
      canStartPlaybackSource({
        effectiveBootstrap: false,
        fixedProfilePlayback: false,
        nativeHlsPlayback: true,
        mediaReady: false,
        transcoded: true,
      }),
    ).toBe(true);
    expect(shouldSurfaceMediaInfoError(false, true)).toBe(false);
    expect(shouldSurfaceMediaInfoError(false, true, 502)).toBe(false);
    expect(shouldSurfaceMediaInfoError(true, false, 502)).toBe(true);
  });

  it("starts a known fixed transcoded profile without waiting for metadata", () => {
    expect(
      canStartPlaybackSource({
        effectiveBootstrap: false,
        fixedProfilePlayback: true,
        nativeHlsPlayback: false,
        mediaReady: false,
        transcoded: true,
      }),
    ).toBe(true);
  });

  it("keeps direct browser playback gated on metadata and surfaces its probe failure", () => {
    expect(
      canStartPlaybackSource({
        effectiveBootstrap: false,
        nativeHlsPlayback: false,
        mediaReady: false,
        transcoded: false,
      }),
    ).toBe(false);
    expect(shouldSurfaceMediaInfoError(false, false)).toBe(true);
  });

  it("does not force compatibility before metadata is available", () => {
    expect(needsCompatibleAudio()).toBe(false);
  });

  it("uses compatibility playback for Matroska even with browser-safe codecs", () => {
    expect(needsCompatiblePlayback("matroska,webm", "aac")).toBe(true);
  });

  it("keeps an MP4 with AAC on the direct stream", () => {
    expect(needsCompatiblePlayback("mov,mp4,m4a,3gp,3g2,mj2", "aac")).toBe(
      false,
    );
  });

  it.each([
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X)",
    "Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X)",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Mobile/15E148",
  ])("uses muted autoplay on iOS WebKit", (userAgent) => {
    expect(requiresMutedAutoplay(userAgent)).toBe(true);
  });

  it("does not mute autoplay on desktop browsers", () => {
    expect(
      requiresMutedAutoplay(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/140",
      ),
    ).toBe(false);
  });

  it("builds a quality ladder without upscaling the source", () => {
    expect(availableQualities(720)).toEqual(["480", "720", "original"]);
    expect(availableQualities(2160)).toEqual(["480", "720", "1080", "original"]);
  });

  it("adapts one rung at a time and stays inside the source ladder", () => {
    expect(nextAutoQuality("480", "up", 1080)).toBe("720");
    expect(nextAutoQuality("720", "down", 1080)).toBe("480");
    expect(nextAutoQuality("1080", "up", 1080)).toBe("original");
    expect(nextAutoQuality("480", "down", 1080)).toBe("480");
  });

  it("upgrades Auto directly from startup quality to the best source quality", () => {
    expect(bestAutoQuality(2160)).toBe("original");
    expect(bestAutoQuality(720)).toBe("original");
    expect(bestAutoQuality(0)).toBe("480");
  });

  it("keeps resumed bootstrap playback at the exact saved position", () => {
    expect(bootstrapStartOffset(59)).toBe(59);
    expect(bootstrapStartOffset(0)).toBe(0);
  });

  it("promotes startup quality promptly after stable playback without a competing prewarm", () => {
    expect(BOOTSTRAP_PROMOTION_DELAY_MS).toBeGreaterThanOrEqual(5_000);
    expect(BOOTSTRAP_PROMOTION_DELAY_MS).toBeLessThanOrEqual(8_000);
    expect(
      autoQualityUpgradeTarget({
        bootstrap: true,
        nativeHlsPlayback: false,
        loading: false,
        playing: true,
        qualityMode: "auto",
        rendition: "480",
        sourceHeight: 2160,
        transcoded: true,
      }),
    ).toBe("original");
    expect(
      autoQualityUpgradeTarget({
        bootstrap: false,
        nativeHlsPlayback: false,
        sustainedCompatibility: true,
        loading: false,
        playing: true,
        qualityMode: "auto",
        rendition: "480",
        sourceHeight: 2160,
        transcoded: true,
      }),
    ).toBeNull();
    expect(
      autoQualityUpgradeTarget({
        bootstrap: true,
        nativeHlsPlayback: false,
        loading: false,
        playing: true,
        qualityMode: "auto",
        rendition: "480",
        sourceHeight: 0,
        transcoded: true,
      }),
    ).toBe("480");
    expect(
      autoQualityUpgradeTarget({
        bootstrap: true,
        nativeHlsPlayback: true,
        loading: false,
        playing: true,
        qualityMode: "auto",
        rendition: "480",
        sourceHeight: 2160,
        transcoded: true,
      }),
    ).toBeNull();
    expect(
      autoQualityUpgradeTarget({
        bootstrap: false,
        nativeHlsPlayback: false,
        loading: true,
        playing: true,
        qualityMode: "auto",
        rendition: "480",
        sourceHeight: 720,
        transcoded: true,
      }),
    ).toBe("original");
  });

  it("releases a quality prewarm session before the upgraded stream starts", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));

    await expect(
      releaseTranscoderSession(fetcher, "72935164", 0, "prewarm-123"),
    ).resolves.toEqual({ released: true });

    expect(fetcher).toHaveBeenCalledWith(
      "/api/debrid/transcode/72935164/0?session=prewarm-123",
      { method: "POST", keepalive: true, signal: undefined },
    );
  });

  it("keeps a replacement gated while a session is still closing", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(null, { status: 202, headers: { "Retry-After": "3" } }),
    );

    await expect(
      releaseTranscoderSession(fetcher, "72935164", 0, "closing-123"),
    ).resolves.toEqual({ released: false, retryAfterMs: 3_000 });
  });

  it("does not release a replacement gate until a pending stop confirms closure", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, { status: 202, headers: { "Retry-After": "3" } }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const waitForRetry = vi.fn().mockResolvedValue(true);
    const controller = new AbortController();

    await expect(
      awaitTranscoderSessionRelease(
        fetcher,
        "72935164",
        0,
        "closing-then-closed",
        controller.signal,
        waitForRetry,
      ),
    ).resolves.toBe(true);
    expect(waitForRetry).toHaveBeenCalledWith(3_000, controller.signal);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("keeps the replacement gate closed when its bounded stop wait is aborted", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(null, { status: 202, headers: { "Retry-After": "3" } }),
    );
    const controller = new AbortController();
    const waitForRetry = vi.fn().mockImplementation(async () => {
      controller.abort();
      return false;
    });

    await expect(
      awaitTranscoderSessionRelease(
        fetcher,
        "72935164",
        0,
        "closing-never-confirmed",
        controller.signal,
        waitForRetry,
      ),
    ).resolves.toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      name: "initial loading",
      input: {
        controls: true,
        error: false,
        iosPlayback: false,
        loading: true,
        pausedByUser: false,
        playing: true,
        startedPlayback: false,
      },
      expected: {
        dimVideo: false,
        showBuffering: false,
        showCentralControls: false,
        showError: false,
        showInitialLoader: true,
        showIosPrompt: false,
      },
    },
    {
      name: "rebuffering after playback started",
      input: {
        controls: true,
        error: false,
        iosPlayback: false,
        loading: true,
        pausedByUser: true,
        playing: true,
        startedPlayback: true,
      },
      expected: {
        dimVideo: false,
        showBuffering: true,
        showCentralControls: false,
        showError: false,
        showInitialLoader: false,
        showIosPrompt: false,
      },
    },
    {
      name: "playback error",
      input: {
        controls: true,
        error: true,
        iosPlayback: false,
        loading: false,
        pausedByUser: true,
        playing: false,
        startedPlayback: true,
      },
      expected: {
        dimVideo: false,
        showBuffering: false,
        showCentralControls: false,
        showError: true,
        showInitialLoader: false,
        showIosPrompt: false,
      },
    },
    {
      name: "iOS autoplay prompt",
      input: {
        controls: true,
        error: false,
        iosPlayback: true,
        loading: false,
        pausedByUser: true,
        playing: false,
        startedPlayback: false,
      },
      expected: {
        dimVideo: false,
        showBuffering: false,
        showCentralControls: false,
        showError: false,
        showInitialLoader: false,
        showIosPrompt: true,
      },
    },
    {
      name: "iOS initial loading keeps a tap-to-start affordance",
      input: {
        controls: true,
        error: false,
        iosPlayback: true,
        loading: true,
        pausedByUser: false,
        playing: false,
        startedPlayback: false,
      },
      expected: {
        dimVideo: false,
        showBuffering: false,
        showCentralControls: false,
        showError: false,
        showInitialLoader: true,
        showIosPrompt: true,
      },
    },
    {
      name: "iOS keeps its activation affordance until the first decoded frame",
      input: {
        controls: true,
        error: false,
        iosPlayback: true,
        loading: true,
        pausedByUser: false,
        playing: true,
        startedPlayback: false,
      },
      expected: {
        dimVideo: false,
        showBuffering: false,
        showCentralControls: false,
        showError: false,
        showInitialLoader: true,
        showIosPrompt: true,
      },
    },
    {
      name: "iOS reveals the native video after its activation tap",
      input: {
        controls: true,
        error: false,
        iosPlayback: true,
        iosSourceActivated: true,
        loading: true,
        pausedByUser: false,
        playing: true,
        startedPlayback: false,
      },
      expected: {
        dimVideo: false,
        showBuffering: true,
        showCentralControls: false,
        showError: false,
        showInitialLoader: false,
        showIosPrompt: false,
      },
    },
    {
      name: "iOS user pause after playback started",
      input: {
        controls: true,
        error: false,
        iosPlayback: true,
        loading: false,
        pausedByUser: true,
        playing: false,
        startedPlayback: true,
      },
      expected: {
        dimVideo: true,
        showBuffering: false,
        showCentralControls: true,
        showError: false,
        showInitialLoader: false,
        showIosPrompt: false,
      },
    },
    {
      name: "user pause",
      input: {
        controls: true,
        error: false,
        iosPlayback: false,
        loading: false,
        pausedByUser: true,
        playing: false,
        startedPlayback: true,
      },
      expected: {
        dimVideo: true,
        showBuffering: false,
        showCentralControls: true,
        showError: false,
        showInitialLoader: false,
        showIosPrompt: false,
      },
    },
    {
      name: "playing with quick controls visible",
      input: {
        controls: true,
        error: false,
        iosPlayback: false,
        loading: false,
        pausedByUser: false,
        playing: true,
        startedPlayback: true,
      },
      expected: {
        dimVideo: true,
        showBuffering: false,
        showCentralControls: true,
        showError: false,
        showInitialLoader: false,
        showIosPrompt: false,
      },
    },
    {
      name: "fine-pointer playback with chrome visible",
      input: {
        controls: true,
        error: false,
        finePointer: true,
        iosPlayback: false,
        loading: false,
        pausedByUser: false,
        playing: true,
        startedPlayback: true,
      },
      expected: {
        dimVideo: false,
        showBuffering: false,
        showCentralControls: false,
        showError: false,
        showInitialLoader: false,
        showIosPrompt: false,
      },
    },
  ])("keeps $name surfaces mutually exclusive", ({ input, expected }) => {
    expect(playbackSurfaceState(input)).toEqual(expected);
  });
});
