import { afterEach, describe, expect, it, vi } from "vitest";
import { observeApi, publicErrorMessage, writeLog } from "./observability";

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
      level: "info",
      event: "http.request.completed",
      requestId: "trace-123",
      method: "GET",
      route: "/api/example",
      status: 201,
      service: "kheyflix",
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

  it("emits a safe outcome event for every debrid route operation", async () => {
    const output = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const GET = observeApi("/api/debrid/stream/:id/:file", async () =>
      new Response("media", { status: 206 }),
    );

    await GET(new Request("https://kheyflix.test/api/debrid/stream/1/0"));

    const events = output.mock.calls.map(([entry]) => JSON.parse(String(entry)).event);
    expect(events).toEqual([
      "debrid.stream.completed",
      "http.request.completed",
    ]);
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
