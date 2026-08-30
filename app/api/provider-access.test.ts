import { afterEach, describe, expect, it } from "vitest";

import { GET as catalog, POST as upload } from "./debrid/magnets/route";
import { GET as media } from "./debrid/media/[id]/[file]/route";
import { GET as stream, HEAD as streamHead } from "./debrid/stream/[id]/[file]/route";
import { GET as subtitle } from "./debrid/subtitle/[id]/[file]/[stream]/route";
import {
  GET as transcode,
  PATCH as touchTranscode,
  POST as stopTranscode,
} from "./debrid/transcode/[id]/[file]/route";
import { GET as hls } from "./debrid/hls/[id]/[file]/[session]/[asset]/route";
import { GET as discovery } from "./discovery/search/route";
import { GET as metadata } from "./metadata/route";
import { POST as telemetry } from "./playback/telemetry/route";

const contexts = {
  media: { params: Promise.resolve({ id: "42", file: "0" }) },
  stream: { params: Promise.resolve({ id: "42", file: "0" }) },
  subtitle: { params: Promise.resolve({ id: "42", file: "0", stream: "1" }) },
  transcode: { params: Promise.resolve({ id: "42", file: "0" }) },
  hls: {
    params: Promise.resolve({
      id: "42",
      file: "0",
      session: "session-42",
      asset: "master.m3u8",
    }),
  },
};

afterEach(() => {
  delete process.env.KHEYFLIX_ACCESS_TOKEN;
  delete process.env.KHEYFLIX_SESSION_SECRET;
  delete process.env.KHEYFLIX_INTERNAL_TRANSCODER_TOKEN;
});

describe("provider-backed API protection", () => {
  it("rejects every browser-provider method before external work begins", async () => {
    process.env.KHEYFLIX_ACCESS_TOKEN = "test-access-code";
    process.env.KHEYFLIX_SESSION_SECRET = "test-session-secret";
    process.env.KHEYFLIX_INTERNAL_TRANSCODER_TOKEN = "test-internal-token";
    const request = (path: string, init?: RequestInit) =>
      new Request(`https://kheyflix.test${path}`, init);
    const responses = await Promise.all([
      catalog(request("/api/debrid/magnets")),
      upload(
        request("/api/debrid/magnets", {
          method: "POST",
          body: JSON.stringify({ magnet: "magnet:?xt=urn:btih:blocked" }),
        }),
      ),
      media(request("/api/debrid/media/42/0"), contexts.media),
      stream(request("/api/debrid/stream/42/0"), contexts.stream),
      streamHead(
        request("/api/debrid/stream/42/0", { method: "HEAD" }),
        contexts.stream,
      ),
      subtitle(request("/api/debrid/subtitle/42/0/1"), contexts.subtitle),
      transcode(request("/api/debrid/transcode/42/0"), contexts.transcode),
      stopTranscode(
        request("/api/debrid/transcode/42/0?session=blocked", { method: "POST" }),
      ),
      touchTranscode(
        request("/api/debrid/transcode/42/0?session=blocked", { method: "PATCH" }),
      ),
      hls(request("/api/debrid/hls/42/0/session-42/master.m3u8"), contexts.hls),
      discovery(request("/api/discovery/search?q=Arrival")),
      metadata(request("/api/metadata?title=Arrival")),
      telemetry(
        request("/api/playback/telemetry", {
          method: "POST",
          body: JSON.stringify({ event: "first_frame", elapsedMs: 1 }),
        }),
      ),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "ACCESS_REQUIRED" },
      });
    }
  });
});
