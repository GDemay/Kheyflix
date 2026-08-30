import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../../../../lib/alldebrid", () => ({
  AllDebridError: class AllDebridError extends Error {
    code = "ALLDEBRID_ERROR";
    status = 502;
  },
}));

vi.mock("../../../../../../../lib/observability", () => ({
  observeApi: (_route: string, handler: unknown) => handler,
  publicErrorMessage: (message: string) => message,
  writeRequestLog: vi.fn(),
}));

import { GET } from "./route";

const context = {
  params: Promise.resolve({
    id: "42",
    file: "0",
    session: "session-42",
    asset: "master.m3u8",
  }),
};

afterEach(() => {
  delete process.env.KHEYFLIX_TRANSCODER_URL;
  vi.unstubAllGlobals();
});

describe("iPhone-compatible HLS gateway", () => {
  it("propagates the browser abort signal to the transcoder request", async () => {
    process.env.KHEYFLIX_TRANSCODER_URL = "http://transcoder.test";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("#EXTM3U", {
        headers: { "content-type": "application/vnd.apple.mpegurl" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    const request = new Request(
      "https://kheyflix.test/api/debrid/hls/42/0/session-42/master.m3u8?quality=bootstrap",
      { signal: controller.signal },
    );

    const response = await GET(request, context);

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      new URL(
        "http://transcoder.test/hls/42/0/session-42/master.m3u8?quality=bootstrap",
      ),
      expect.objectContaining({ cache: "no-store", signal: request.signal }),
    );
  });

  it("forwards only bounded native-VOD modes and ignores diagnostic transport switches", async () => {
    process.env.KHEYFLIX_TRANSCODER_URL = "http://transcoder.test";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("#EXTM3U", {
        headers: { "content-type": "application/vnd.apple.mpegurl" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await GET(
      new Request(
        "https://kheyflix.test/api/debrid/hls/42/0/session-42/master.m3u8?start=200&quality=480&mode=native-vod&format=fmp4&playlist=event",
      ),
      context,
    );

    expect(fetchMock).toHaveBeenCalledWith(
      new URL(
        "http://transcoder.test/hls/42/0/session-42/master.m3u8?start=200&quality=480&mode=native-vod",
      ),
      expect.objectContaining({ cache: "no-store" }),
    );

    await GET(
      new Request(
        "https://kheyflix.test/api/debrid/hls/42/0/session-42/master.m3u8?start=215&quality=480&mode=native-vod-warm&format=fmp4&playlist=event",
      ),
      context,
    );

    expect(fetchMock).toHaveBeenLastCalledWith(
      new URL(
        "http://transcoder.test/hls/42/0/session-42/master.m3u8?start=215&quality=480&mode=native-vod-warm",
      ),
      expect.objectContaining({ cache: "no-store" }),
    );

    await GET(
      new Request(
        "https://kheyflix.test/api/debrid/hls/42/0/session-42/master.m3u8?start=215&quality=480&mode=unbounded",
      ),
      context,
    );

    expect(fetchMock).toHaveBeenLastCalledWith(
      new URL(
        "http://transcoder.test/hls/42/0/session-42/master.m3u8?start=215&quality=480",
      ),
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("propagates an abort before a playlist is ready without issuing a duplicate stop", async () => {
    process.env.KHEYFLIX_TRANSCODER_URL = "http://transcoder.test";
    const fetchMock = vi.fn(
      (_url: URL, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("The request was aborted.", "AbortError")),
            { once: true },
          );
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    const request = new Request(
      "https://kheyflix.test/api/debrid/hls/42/0/session-42/master.m3u8?quality=480",
      { signal: controller.signal },
    );

    const response = GET(request, context);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    controller.abort();
    await response;

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      new URL(
        "http://transcoder.test/hls/42/0/session-42/master.m3u8?quality=480",
      ),
      expect.objectContaining({ signal: request.signal }),
    );
  });

  it("keeps a ready HLS session alive when Safari cancels its delivered manifest", async () => {
    process.env.KHEYFLIX_TRANSCODER_URL = "http://transcoder.test";
    const encoder = new TextEncoder();
    const cancel = vi.fn();
    const upstreamBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("#EXTM3U\n#EXTINF:2,\nsegment00000.ts\n"));
      },
      cancel,
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(upstreamBody, {
        headers: { "content-type": "application/vnd.apple.mpegurl" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(
      new Request(
        "https://kheyflix.test/api/debrid/hls/42/0/session-42/master.m3u8?quality=480",
      ),
      context,
    );
    const reader = response.body?.getReader();
    expect(new TextDecoder().decode((await reader?.read()).value)).toContain("#EXTM3U");
    await reader?.cancel("Safari is revalidating the manifest");

    await vi.waitFor(() => expect(cancel).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("cancels a delivered HLS body when the browser request disconnects", async () => {
    process.env.KHEYFLIX_TRANSCODER_URL = "http://transcoder.test";
    const controller = new AbortController();
    const encoder = new TextEncoder();
    const cancel = vi.fn();
    const upstreamBody = new ReadableStream<Uint8Array>({
      start(stream) {
        stream.enqueue(encoder.encode("segment-bytes"));
      },
      pull() {
        return new Promise<void>(() => undefined);
      },
      cancel,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(upstreamBody, {
          headers: { "content-type": "video/mp2t" },
        }),
      ),
    );

    const response = await GET(
      new Request(
        "https://kheyflix.test/api/debrid/hls/42/0/session-42/segment00000.ts?quality=480",
        { signal: controller.signal },
      ),
      { params: Promise.resolve({ ...await context.params, asset: "segment00000.ts" }) },
    );
    await response.body?.getReader().read();
    controller.abort();

    await vi.waitFor(() => expect(cancel).toHaveBeenCalled());
  });

  it("cancels the upstream body when the client aborts as fetch resolves", async () => {
    process.env.KHEYFLIX_TRANSCODER_URL = "http://transcoder.test";
    const controller = new AbortController();
    const cancel = vi.fn();
    const upstreamBody = new ReadableStream<Uint8Array>({
      pull() {
        return new Promise<void>(() => undefined);
      },
      cancel,
    });
    let resolveFetch!: (response: Response) => void;
    const fetchReady = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    const fetchMock = vi.fn().mockReturnValue(fetchReady);
    vi.stubGlobal("fetch", fetchMock);

    const response = GET(
      new Request(
        "https://kheyflix.test/api/debrid/hls/42/0/session-42/segment00000.ts?quality=480",
        { signal: controller.signal },
      ),
      { params: Promise.resolve({ ...await context.params, asset: "segment00000.ts" }) },
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    resolveFetch(
      new Response(upstreamBody, {
        headers: { "content-type": "video/mp2t" },
      }),
    );
    controller.abort(new DOMException("The request was aborted.", "AbortError"));

    await response;
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledTimes(1));
  });

  it("preserves the bounded retry contract from the transcoder", async () => {
    process.env.KHEYFLIX_TRANSCODER_URL = "http://transcoder.test";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(null, {
          status: 429,
          headers: { "retry-after": "2" },
        }),
      ),
    );

    const response = await GET(
      new Request(
        "https://kheyflix.test/api/debrid/hls/42/0/session-42/master.m3u8?quality=480",
      ),
      context,
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("2");
  });
});
