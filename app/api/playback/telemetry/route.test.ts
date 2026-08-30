import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

afterEach(() => {
  delete process.env.KHEYFLIX_ACCESS_TOKEN;
  delete process.env.KHEYFLIX_SESSION_SECRET;
  vi.restoreAllMocks();
});

describe("playback telemetry", () => {
  it("records bounded startup and rebuffer measurements without client content data", async () => {
    const output = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const response = await POST(
      new Request("https://kheyflix.test/api/playback/telemetry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "first_frame",
          elapsedMs: 842,
          rebufferCount: 0,
          attempt: 2,
          phase: "bootstrap",
          quality: "bootstrap",
          title: "must not be persisted",
        }),
      }),
    );

    expect(response.status).toBe(204);
    const entry = JSON.parse(String(output.mock.calls[0][0]));
    expect(entry).toMatchObject({
      event: "playback.telemetry.received",
      playbackEvent: "first_frame",
      elapsedMs: 842,
      rebufferCount: 0,
      attempt: 2,
      phase: "bootstrap",
      quality: "bootstrap",
    });
    expect(JSON.stringify(entry)).not.toContain("must not be persisted");
  });

  it("records expected native-VOD handoffs separately from user-visible rebuffers", async () => {
    const output = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const response = await POST(
      new Request("https://kheyflix.test/api/playback/telemetry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "native_vod_handoff",
          elapsedMs: 35,
          rebufferCount: 0,
          attempt: 1,
          phase: "standard",
          quality: "480",
        }),
      }),
    );

    expect(response.status).toBe(204);
    expect(JSON.parse(String(output.mock.calls[0][0]))).toMatchObject({
      playbackEvent: "native_vod_handoff",
      elapsedMs: 35,
      rebufferCount: 0,
    });
  });

  it("rejects malformed or unbounded telemetry", async () => {
    const response = await POST(
      new Request("https://kheyflix.test/api/playback/telemetry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: "unknown", elapsedMs: -1 }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVALID_PLAYBACK_TELEMETRY" },
    });
  });
});
