import { afterEach, describe, expect, it, vi } from "vitest";
import { playKheyflixSting } from "./brand-sting";

describe("playKheyflixSting", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("resumes Web Audio and schedules the sting", () => {
    const resume = vi.fn(() => Promise.resolve());
    const connect = vi.fn(function (this: unknown) {
      return this;
    });
    const gain = {
      gain: {
        setValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      },
      connect,
    };
    const oscillator = {
      type: "sine",
      frequency: {
        setValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      },
      connect,
      start: vi.fn(),
      stop: vi.fn(),
    };
    const compressor = {
      threshold: { value: 0 },
      knee: { value: 0 },
      ratio: { value: 0 },
      connect,
    };
    const AudioContext = vi.fn(function () {
      return {
        currentTime: 0,
        destination: {},
        resume,
        close: vi.fn(),
        createDynamicsCompressor: vi.fn(() => compressor),
        createGain: vi.fn(() => gain),
        createOscillator: vi.fn(() => oscillator),
      };
    });
    vi.stubGlobal("window", {
      AudioContext,
      matchMedia: vi.fn(() => ({ matches: true })),
    });
    vi.spyOn(globalThis, "setTimeout").mockImplementation(
      (() => 0) as typeof setTimeout,
    );

    playKheyflixSting();

    expect(AudioContext).toHaveBeenCalledOnce();
    expect(resume).toHaveBeenCalledOnce();
    expect(oscillator.start).toHaveBeenCalledTimes(6);
  });
});
