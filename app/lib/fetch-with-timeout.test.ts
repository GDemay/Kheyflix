import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWithTimeout, RequestTimeoutError } from "./fetch-with-timeout";

describe("fetchWithTimeout", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("aborts a stalled request and reports a distinct timeout", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const request = fetchWithTimeout("/slow", {}, 25);
    const timedOut = expect(request).rejects.toBeInstanceOf(RequestTimeoutError);
    await vi.advanceTimersByTimeAsync(25);
    await timedOut;
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it("preserves ordinary network failures", async () => {
    const networkError = new TypeError("Network unavailable");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(networkError));
    await expect(fetchWithTimeout("/offline", {}, 25)).rejects.toBe(networkError);
  });

  it("returns responses inside the deadline", async () => {
    const response = new Response("ok");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    await expect(fetchWithTimeout("/fast", {}, 25)).resolves.toBe(response);
  });

  it("preserves caller cancellation instead of reporting its own timeout", async () => {
    const controller = new AbortController();
    const aborted = new DOMException("Cancelled", "AbortError");
    const abortSignalAny = vi.spyOn(AbortSignal, "any").mockImplementation(() => {
      throw new Error("AbortSignal.any should not be required by client requests");
    });
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(aborted), { once: true });
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const request = fetchWithTimeout("/cancel", { signal: controller.signal }, 5_000);
    controller.abort();

    await expect(request).rejects.toBe(aborted);
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(abortSignalAny).not.toHaveBeenCalled();
  });
});
