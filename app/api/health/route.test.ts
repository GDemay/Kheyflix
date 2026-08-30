import { afterEach, describe, expect, it, vi } from "vitest";

import { clearAllDebridHealthForTests } from "../../lib/alldebrid";
import { clearProwlarrHealthForTests } from "../../lib/prowlarr";
import { GET } from "./route";

afterEach(() => {
  delete process.env.ALLDEBRID_API_KEY;
  delete process.env.PROWLARR_URL;
  delete process.env.PROWLARR_API_KEY;
  delete process.env.KHEYFLIX_APP_ORIGIN;
  delete process.env.KHEYFLIX_TRANSCODER_URL;
  delete process.env.KHEYFLIX_ACCESS_TOKEN;
  delete process.env.KHEYFLIX_SESSION_SECRET;
  delete process.env.KHEYFLIX_INTERNAL_TRANSCODER_TOKEN;
  delete process.env.NODE_ENV;
  clearAllDebridHealthForTests();
  clearProwlarrHealthForTests();
  vi.unstubAllGlobals();
});

describe("application health readiness", () => {
  it("distinguishes configured dependencies from failed readiness probes", async () => {
    process.env.ALLDEBRID_API_KEY = "configured";
    process.env.PROWLARR_URL = "https://prowlarr.test";
    process.env.PROWLARR_API_KEY = "configured";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    const response = await GET();
    const body = await response.json();

    expect(body.status).toBe("degraded");
    expect(body.configured).toMatchObject({
      alldebrid: true,
      discovery: true,
      transcoder: true,
    });
    expect(body.dependencies).toMatchObject({
      alldebrid: false,
      discovery: false,
      transcoder: false,
    });
  });

  it("reports readiness only after the service, app origin, and providers respond", async () => {
    process.env.ALLDEBRID_API_KEY = "configured";
    process.env.PROWLARR_URL = "https://prowlarr.test";
    process.env.PROWLARR_API_KEY = "configured";
    process.env.KHEYFLIX_APP_ORIGIN = "http://localhost:3000";
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/health"))
        return Response.json({
          ok: true,
          appOrigin: true,
          service: "kheyflix-transcoder",
        });
      if (url.endsWith("/api/v1/health")) return Response.json([]);
      if (url.endsWith("/v4/user"))
        return Response.json({ status: "success", data: { username: "ready" } });
      return new Response(null, { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET();
    const body = await response.json();

    expect(body.status).toBe("ok");
    expect(body.dependencies).toMatchObject({
      alldebrid: true,
      discovery: true,
      transcoder: true,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://prowlarr.test/api/v1/health"),
      expect.objectContaining({ headers: expect.objectContaining({ "X-Api-Key": "configured" }) }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.alldebrid.com/v4/user",
      expect.objectContaining({ method: "POST", signal: expect.any(AbortSignal) }),
    );
  });

  it("coalesces concurrent public health checks into one Prowlarr readiness probe", async () => {
    process.env.PROWLARR_URL = "https://prowlarr.test";
    process.env.PROWLARR_API_KEY = "configured";
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/v1/health")) return Response.json([]);
      if (url.endsWith("/health"))
        return Response.json({ ok: true, appOrigin: true });
      return new Response(null, { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await Promise.all([GET(), GET(), GET()]);

    expect(
      fetchMock.mock.calls.filter(([input]) =>
        String(input).endsWith("/api/v1/health"),
      ),
    ).toHaveLength(1);
  });

  it("does not trust a transcoder that cannot reach its configured app origin", async () => {
    process.env.ALLDEBRID_API_KEY = "configured";
    const fetchMock = vi.fn(async () =>
      Response.json({
        ok: true,
        appOrigin: false,
        service: "kheyflix-transcoder",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET();
    const body = await response.json();

    expect(body.status).toBe("degraded");
    expect(body.dependencies.transcoder).toBe(false);
  });

  it("fails readiness when the AllDebrid credential cannot complete a bounded account probe", async () => {
    process.env.ALLDEBRID_API_KEY = "configured";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("provider unavailable")));

    const response = await GET();
    const body = await response.json();

    expect(body.status).toBe("degraded");
    expect(body.configured.alldebrid).toBe(true);
    expect(body.dependencies.alldebrid).toBe(false);
  });

  it("requires configured and healthy discovery in production", async () => {
    process.env.NODE_ENV = "production";
    process.env.ALLDEBRID_API_KEY = "configured";
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/health"))
        return Response.json({
          ok: true,
          appOrigin: true,
          internalAccessConfigured: true,
          service: "kheyflix-transcoder",
        });
      if (url.endsWith("/v4/user"))
        return Response.json({ status: "success", data: { username: "ready" } });
      return new Response(null, { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET();
    const body = await response.json();

    expect(body.status).toBe("degraded");
    expect(body.configured.discovery).toBe(false);
    expect(body.dependencies.discovery).toBe(false);
  });

  it("reports degraded when protected playback lacks its internal transcoder credential", async () => {
    process.env.ALLDEBRID_API_KEY = "configured";
    process.env.KHEYFLIX_ACCESS_TOKEN = "configured-access";
    process.env.KHEYFLIX_SESSION_SECRET = "configured-session";
    const fetchMock = vi.fn(async () =>
      Response.json({
        ok: true,
        appOrigin: true,
        internalAccessConfigured: false,
        service: "kheyflix-transcoder",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET();
    const body = await response.json();

    expect(body.status).toBe("degraded");
    expect(body.configured).toMatchObject({ access: false });
    expect(body.dependencies).toMatchObject({ access: false, transcoder: false });
  });
});
