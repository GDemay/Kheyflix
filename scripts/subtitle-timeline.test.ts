import { describe, expect, it } from "vitest";

import { rebaseWebVtt } from "./subtitle-timeline.mjs";

describe("WebVTT playback timeline", () => {
  it("clips a cue active at the seek and rebases future cues exactly", () => {
    expect(
      rebaseWebVtt(
        "WEBVTT\n\n00:02.000 --> 00:03.000\nfirst cue\n\n00:07.000 --> 00:08.000 align:start\nsecond cue\n",
        2.5,
      ),
    ).toBe(
      "WEBVTT\n\n00:00.000 --> 00:00.500\nfirst cue\n\n00:04.500 --> 00:05.500 align:start\nsecond cue\n",
    );
  });

  it("drops cues that ended at or before the seek point", () => {
    expect(
      rebaseWebVtt(
        "WEBVTT\n\n00:02.000 --> 00:03.000\nexpired\n\n00:07.000 --> 00:08.000\nremaining\n",
        5,
      ),
    ).toBe("WEBVTT\n\n00:02.000 --> 00:03.000\nremaining\n");
  });
});
