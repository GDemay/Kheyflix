import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../../lib/alldebrid", () => ({
  AllDebridError: class AllDebridError extends Error {
    code = "ALLDEBRID_ERROR";
    status = 502;
  },
}));

vi.mock("../../../../../lib/observability", () => ({
  observeApi: (_route: string, handler: unknown) => handler,
  publicErrorMessage: (message: string) => message,
  writeRequestLog: vi.fn(),
}));

import { GET, POST } from "./route";

const context = { params: Promise.resolve({ id: "42", file: "0" }) };

afterEach(() => {
  delete process.env.KHEYFLIX_TRANSCODER_URL;
  vi.unstubAllGlobals();
});

describe("compatible playback gateway", () => {
  it("preserves the short bootstrap profile at the transcoder boundary", async () => {
    process.env.KHEYFLIX_TRANSCODER_URL = "http://transcoder.test";
    const fetchMock = vi.fn().mockResolvedValue(new Response("fragment"));
    vi.stubGlobal("fetch", fetchMock);

    const request = new Request(
      "https://kheyflix.test/api/debrid/transcode/42/0?session=startup-42&quality=bootstrap",
    );
    const response = await GET(request, context);

    expect(response.status).toBe(200);
    expect(response.headers.get("x-kheyflix-quality")).toBe("bootstrap");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://transcoder.test/transcode/42/0?start=0&audio=1&sync=0&token=startup-42&quality=bootstrap",
      expect.objectContaining({ cache: "no-store", signal: request.signal }),
    );
  });

  it("normalizes invalid input and forwards the capacity retry contract", async () => {
    process.env.KHEYFLIX_TRANSCODER_URL = "http://transcoder.test";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 429,
        headers: { "retry-after": "2" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(
      new Request(
        "https://kheyflix.test/api/debrid/transcode/42/0?session=***&start=Infinity&audio=Infinity&quality=480",
      ),
      context,
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("2");
    const upstream = String(fetchMock.mock.calls[0]?.[0]);
    expect(upstream).toContain("start=0&audio=1&sync=0&token=");
    expect(upstream).toContain("&quality=480");
    expect(upstream).not.toContain("***");
  });

  it("continues a bounded stop relay after the browser request is cancelled", async () => {
    process.env.KHEYFLIX_TRANSCODER_URL = "http://transcoder.test";
    const browser = new AbortController();
    const request = new Request(
      "https://kheyflix.test/api/debrid/transcode/42/0?session=closing-42",
      { method: "POST", signal: browser.signal },
    );
    let relaySignal: AbortSignal | null = null;
    let resolveRelay: (response: Response) => void;
    const fetchMock = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((resolve) => {
          relaySignal = init?.signal ?? null;
          resolveRelay = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = POST(request);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    browser.abort();

    expect(request.signal.aborted).toBe(true);
    expect(relaySignal).not.toBe(request.signal);
    expect(relaySignal?.aborted).toBe(false);
    resolveRelay!(new Response(null, { status: 204 }));
    expect((await response).status).toBe(204);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://transcoder.test/stop/closing-42",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
