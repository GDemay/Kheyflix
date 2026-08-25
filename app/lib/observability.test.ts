import { afterEach, describe, expect, it, vi } from "vitest";
import { observeApi, publicErrorMessage, writeLog, writeRequestLog } from "./observability";

afterEach(() => vi.restoreAllMocks());

describe("API observability", () => {
  it("correlates a response with one structured completion log", async () => {
    const output = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const GET = observeApi("/api/example", async () =>
      Response.json({ ok: true }, { status: 201 }),
    );

    const response = await GET(new Request("https://kheyflix.test/api/example?secret=hidden", {
      headers: { "x-request-id": "trace-123" },
    }));

    expect(response.headers.get("x-request-id")).toBe("trace-123");
    expect(response.headers.get("server-timing")).toMatch(/^app;dur=/);
    expect(output).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(output.mock.calls[0][0]))).toMatchObject({
      message: expect.stringMatching(/^GET \/api\/example succeeded \(201\) in /),
      level: "info",
      event: "http.request.completed",
      requestId: "trace-123",
      method: "GET",
      route: "/api/example",
      status: 201,
    });
    expect(String(output.mock.calls[0][0])).not.toContain("secret=hidden");
  });

  it("sanitizes sensitive values and magnet or provider URLs", () => {
    const output = vi.spyOn(console, "info").mockImplementation(() => undefined);

    writeLog("info", "provider.operation", {
      apiKey: "server-only-key",
      authorization: "Bearer secret",
      magnet: "magnet:?xt=urn:btih:SECRET",
      url: "https://provider.test/unlocked/SECRET",
      resultCount: 2,
    });

    const serialized = String(output.mock.calls[0][0]);
    expect(serialized).not.toContain("server-only-key");
    expect(serialized).not.toContain("Bearer secret");
    expect(serialized).not.toContain("btih");
    expect(serialized).not.toContain("provider.test");
    expect(JSON.parse(serialized)).toMatchObject({ resultCount: 2 });
  });

  it("turns an unhandled exception into a sanitized correlated failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const GET = observeApi("/api/example", async () => {
      throw new Error("provider secret details");
    });

    const response = await GET(new Request("https://kheyflix.test/api/example"));
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred.",
        requestId: response.headers.get("x-request-id"),
      },
    });
  });

  it("records handled API error codes in the completion event", async () => {
    const output = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const GET = observeApi("/api/example", async () => Response.json({
      error: { code: "UPSTREAM_UNAVAILABLE", message: "Try again." },
    }, { status: 503 }));

    const response = await GET(new Request("https://kheyflix.test/api/example"));

    expect(response.headers.get("x-request-id")).toBeTruthy();
    expect((await response.json()).error.requestId).toBe(response.headers.get("x-request-id"));
    expect(JSON.parse(String(output.mock.calls[0][0]))).toMatchObject({
      event: "http.request.completed",
      status: 503,
      errorCode: "UPSTREAM_UNAVAILABLE",
    });
  });

  it("emits one readable outcome event for a debrid route operation", async () => {
    const output = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const upstream = new Response("media", { status: 206 });
    const GET = observeApi("/api/debrid/stream/:id/:file", async () => upstream);

    const response = await GET(new Request("https://kheyflix.test/api/debrid/stream/1/0"));

    expect(response).toBe(upstream);
    expect(output).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(output.mock.calls[0][0]))).toMatchObject({
      event: "http.request.completed",
      message: expect.stringMatching(/^Stream media succeeded \(206\) in /),
    });
  });

  it("does not duplicate a request-specific action log", async () => {
    const output = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const GET = observeApi("/api/discovery/search", async (request) => {
      writeRequestLog("info", "discovery.search.completed", request, { resultCount: 0 });
      return Response.json({ results: [] });
    });

    await GET(new Request("https://kheyflix.test/api/discovery/search?q=Pokemon"));

    expect(output).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(output.mock.calls[0][0]))).toMatchObject({
      message: "Catalog search completed",
      resultCount: 0,
    });
  });

  it("keeps expected client errors concise without a stack", async () => {
    const output = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const handler = observeApi("/api/debrid/stream/:id/:file", async (request) => {
      writeRequestLog("warn", "debrid.stream.failed", request, {
        code: "INVALID_MEDIA",
        error: new Error("Invalid media selection."),
      });
      return Response.json({ error: { code: "INVALID_MEDIA" } }, { status: 400 });
    });

    await handler(new Request("https://kheyflix.test/api/debrid/stream/bad/0", { method: "HEAD" }));

    const entry = JSON.parse(String(output.mock.calls[0][0]));
    expect(entry.message).toBe("Check media source failed (400)");
    expect(entry).toMatchObject({ status: 400, errorCode: "INVALID_MEDIA", route: "/api/debrid/stream/:id/:file" });
    expect(entry.error).toEqual({ type: "Error", message: "Invalid media selection." });
  });

  it.each([
    ["/api/health", "GET", 200, {}],
    ["/api/debrid/transcode/:id/:file", "PATCH", 204, {}],
    ["/api/debrid/transcode/:id/:file", "POST", 204, {}],
    ["/api/debrid/stream/:id/:file", "GET", 206, { range: "bytes=0-1023" }],
  ])("suppresses noisy routine success logs for %s %s", async (route, method, status, headers) => {
    const output = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const debug = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    const handler = observeApi(route, async () => new Response(null, { status }));

    await handler(new Request(`https://kheyflix.test${route.replace(":id", "1").replace(":file", "0")}`, { method, headers }));

    expect(output).not.toHaveBeenCalled();
    expect(debug).not.toHaveBeenCalled();
  });

  it("keeps safe provider guidance and rejects provider-originated sensitive text", () => {
    expect(publicErrorMessage("This account is unavailable.", "Fallback")).toBe(
      "This account is unavailable.",
    );
    expect(publicErrorMessage(
      "Download failed at https://provider.test/private?token=secret",
      "The media service is temporarily unavailable.",
    )).toBe("The media service is temporarily unavailable.");
    expect(publicErrorMessage("Provider token abc123", "Fallback")).toBe("Fallback");
    expect(publicErrorMessage("Cookie session=abc123", "Fallback")).toBe("Fallback");
    expect(publicErrorMessage("Provider credential abc123", "Fallback")).toBe("Fallback");
    expect(publicErrorMessage("Access key abc123", "Fallback")).toBe("Fallback");
  });

  it("redacts credentials embedded in logged error messages and stacks", () => {
    const output = vi.spyOn(console, "error").mockImplementation(() => undefined);

    writeLog("error", "provider.failed", {
      firstError: new Error("Provider token abc123"),
      secondError: new Error("Cookie session=abc123"),
      thirdError: new Error("Provider credential abc123"),
      fourthError: new Error("Access key abc123"),
    });

    const serialized = String(output.mock.calls[0][0]);
    expect(serialized).not.toContain("abc123");
    expect(serialized).toContain("[REDACTED_SENSITIVE_TEXT]");
  });
});
