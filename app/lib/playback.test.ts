import { describe, expect, it, vi } from "vitest";
import {
  availableQualities,
  bestAutoQuality,
  needsCompatibleAudio,
  needsCompatiblePlayback,
  nextAutoQuality,
  playbackSurfaceState,
  releaseTranscoderSession,
  requiresMutedAutoplay,
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

  it("releases a quality prewarm session before the upgraded stream starts", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));

    await releaseTranscoderSession(fetcher, "72935164", 0, "prewarm-123");

    expect(fetcher).toHaveBeenCalledWith(
      "/api/debrid/transcode/72935164/0?session=prewarm-123",
      { method: "POST", keepalive: true },
    );
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
