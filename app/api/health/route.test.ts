import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

afterEach(() => {
  delete process.env.ALLDEBRID_API_KEY;
  delete process.env.PROWLARR_URL;
  delete process.env.PROWLARR_API_KEY;
  delete process.env.KHEYFLIX_APP_ORIGIN;
  delete process.env.KHEYFLIX_TRANSCODER_URL;
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
      alldebrid: true,
      discovery: false,
      transcoder: false,
    });
  });

  it("reports readiness only after the service, app origin, and provider respond", async () => {
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
});
