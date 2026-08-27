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
      addEventListener: vi.fn(),
      matchMedia: vi.fn(() => ({ matches: true })),
      removeEventListener: vi.fn(),
    });
    vi.spyOn(globalThis, "setTimeout").mockImplementation(
      (() => 0) as typeof setTimeout,
    );

    playKheyflixSting();

    expect(AudioContext).toHaveBeenCalledOnce();
    expect(resume).toHaveBeenCalledOnce();
    expect(oscillator.start).toHaveBeenCalledTimes(6);
  });

  it("waits for one trusted gesture when Web Audio starts suspended", async () => {
    const listeners = new Map<string, EventListener>();
    const addEventListener = vi.fn((type: string, listener: EventListener) => {
      listeners.set(type, listener);
    });
    const removeEventListener = vi.fn(
      (type: string, listener: EventListener) => {
        if (listeners.get(type) === listener) listeners.delete(type);
      },
    );
    const context = {
      currentTime: 0,
      destination: {},
      state: "suspended",
      resume: vi.fn(async () => {
        context.state = "running";
      }),
      close: vi.fn(() => Promise.resolve()),
      createDynamicsCompressor: vi.fn(() => ({
        threshold: { value: 0 },
        knee: { value: 0 },
        ratio: { value: 0 },
        connect() {
          return this;
        },
      })),
      createGain: vi.fn(() => ({
        gain: {
          setValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
        },
        connect() {
          return this;
        },
      })),
      createOscillator: vi.fn(() => ({
        type: "sine",
        frequency: {
          setValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
        },
        connect() {
          return this;
        },
        start: vi.fn(),
        stop: vi.fn(),
      })),
    };
    const AudioContext = vi.fn(function () {
      return context;
    });
    vi.stubGlobal("window", {
      AudioContext,
      addEventListener,
      removeEventListener,
    });
    vi.spyOn(globalThis, "setTimeout").mockImplementation(
      (() => 0) as typeof setTimeout,
    );

    playKheyflixSting();

    expect(context.resume).not.toHaveBeenCalled();
    expect(context.createOscillator).not.toHaveBeenCalled();
    expect(addEventListener).toHaveBeenCalledTimes(2);

    listeners.get("pointerdown")?.(new Event("pointerdown"));
    await Promise.resolve();
    await Promise.resolve();

    expect(context.resume).toHaveBeenCalledOnce();
    expect(context.createOscillator).toHaveBeenCalledTimes(6);
    expect(removeEventListener).toHaveBeenCalledTimes(2);

    listeners.get("keydown")?.(new Event("keydown"));
    await Promise.resolve();
    expect(context.createOscillator).toHaveBeenCalledTimes(6);
  });

  it("keeps startup non-fatal when Web Audio is unavailable", () => {
    const AudioContext = vi.fn(function () {
      throw new Error("Web Audio unavailable");
    });
    vi.stubGlobal("window", { AudioContext });

    const cleanup = playKheyflixSting();

    expect(AudioContext).toHaveBeenCalledOnce();
    expect(cleanup).toBeTypeOf("function");
    expect(() => cleanup()).not.toThrow();
  });
});
