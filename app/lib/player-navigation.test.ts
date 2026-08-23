import { describe, expect, it } from "vitest";
import { PlaybackRequestGate, playbackReturnRoute } from "./player-navigation";

describe("player navigation races", () => {
  it("keeps the browsing destination while advancing between episodes", () => {
    const details = { section: "debrid", id: "mentalist" } as const;
    const episode1 = { section: "stream", id: "1", file: 0 } as const;
    const episode2 = { section: "stream", id: "2", file: 0 } as const;

    const afterOpening = playbackReturnRoute(
      { section: "home" },
      details,
      episode1,
    );
    const afterNext = playbackReturnRoute(afterOpening, episode1, episode2);

    expect(afterNext).toEqual(details);
  });

  it("invalidates playback preparation when navigation leaves the player", () => {
    const requests = new PlaybackRequestGate();
    const pending = requests.begin();

    requests.invalidate();

    expect(pending.isCurrent()).toBe(false);
  });

  it("ignores stale episode requests that resolve out of order", () => {
    const requests = new PlaybackRequestGate();
    const episode1 = requests.begin();
    const episode2 = requests.begin();

    expect(episode2.isCurrent()).toBe(true);
    expect(episode1.isCurrent()).toBe(false);
  });
});
