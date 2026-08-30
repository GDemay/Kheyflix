import { afterEach, describe, expect, it, vi } from "vitest";

import { accessSessionCookie } from "../../../lib/access";
import { GET } from "./route";

afterEach(() => {
  delete process.env.KHEYFLIX_ACCESS_TOKEN;
  delete process.env.KHEYFLIX_SESSION_SECRET;
  delete process.env.KHEYFLIX_INTERNAL_TRANSCODER_TOKEN;
  delete process.env.PROWLARR_URL;
  delete process.env.PROWLARR_API_KEY;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("discovery search route", () => {
  it("propagates a client abort into provider work without retrying it", async () => {
    process.env.KHEYFLIX_ACCESS_TOKEN = "test-access-code";
    process.env.KHEYFLIX_SESSION_SECRET = "test-session-secret";
    process.env.KHEYFLIX_INTERNAL_TRANSCODER_TOKEN = "test-internal-token";
    process.env.PROWLARR_URL = "https://prowlarr.test";
    process.env.PROWLARR_API_KEY = "test-prowlarr-key";
    const debug = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const controller = new AbortController();
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Cancelled", "AbortError")),
          { once: true },
        );
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const cookie = await accessSessionCookie();
    const request = new Request(
      "https://kheyflix.test/api/discovery/search?q=Candidate+Movie&kind=movie",
      { headers: { cookie }, signal: controller.signal },
    );

    const response = GET(request);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    controller.abort();

    await expect(response).resolves.toMatchObject({ status: 499 });
    const completed = await response;
    await expect(completed.json()).resolves.toMatchObject({
      error: { code: "DISCOVERY_CANCELLED" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(error).not.toHaveBeenCalled();
    expect(JSON.parse(String(debug.mock.calls[0]?.[0]))).toMatchObject({
      event: "http.request.cancelled",
      level: "debug",
      status: 499,
      errorCode: "DISCOVERY_CANCELLED",
    });
  });
});
