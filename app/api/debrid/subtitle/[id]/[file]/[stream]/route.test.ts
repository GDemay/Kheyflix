import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

const context = { params: Promise.resolve({ id: "42", file: "0", stream: "1" }) };

afterEach(() => {
  delete process.env.KHEYFLIX_TRANSCODER_URL;
  vi.unstubAllGlobals();
});

describe("subtitle gateway", () => {
  it("propagates browser cancellation to subtitle conversion", async () => {
    process.env.KHEYFLIX_TRANSCODER_URL = "http://transcoder.test";
    const fetchMock = vi.fn().mockResolvedValue(new Response("WEBVTT\n\n"));
    vi.stubGlobal("fetch", fetchMock);
    const request = new Request("https://kheyflix.test/api/debrid/subtitle/42/0/1?start=15");

    const response = await GET(request, context);

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://transcoder.test/subtitle/42/0/1.vtt?start=15",
      expect.objectContaining({ cache: "no-store", signal: request.signal }),
    );
  });

  it("does not report a disconnected subtitle request as a provider failure", async () => {
    process.env.KHEYFLIX_TRANSCODER_URL = "http://transcoder.test";
    const client = new AbortController();
    const fetchMock = vi.fn((_url: string, options: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        options.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("aborted", "AbortError")),
          { once: true },
        );
      }),
    );
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", fetchMock);
    const request = new Request(
      "https://kheyflix.test/api/debrid/subtitle/42/0/1?start=15",
      { signal: client.signal },
    );
    const responsePromise = GET(request, context);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    client.abort();

    const response = await responsePromise;

    expect(response.status).toBe(499);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://transcoder.test/subtitle/42/0/1.vtt?start=15",
      expect.objectContaining({ signal: request.signal }),
    );
    expect(warning).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});
