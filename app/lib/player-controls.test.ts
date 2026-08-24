import { describe, expect, it } from "vitest";
import { showCentralTransportOverlay } from "./player-controls";

describe("central player transport overlay", () => {
  it("stays out of the picture during active fine-pointer playback", () => {
    expect(
      showCentralTransportOverlay({
        pausedByUser: false,
        controlsVisible: true,
        playing: true,
        finePointer: true,
      }),
    ).toBe(false);
  });

  it("appears after the user explicitly pauses", () => {
    expect(
      showCentralTransportOverlay({
        pausedByUser: true,
        controlsVisible: true,
        playing: false,
        finePointer: true,
      }),
    ).toBe(true);
  });

  it("preserves active-playback quick controls on coarse pointers", () => {
    expect(
      showCentralTransportOverlay({
        pausedByUser: false,
        controlsVisible: true,
        playing: true,
        finePointer: false,
      }),
    ).toBe(true);
  });
});
