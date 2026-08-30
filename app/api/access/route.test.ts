import { afterEach, describe, expect, it } from "vitest";

import { ACCESS_COOKIE_NAME, clearAccessAttemptsForTests } from "../../lib/access";
import { DELETE, GET, POST } from "./route";

afterEach(() => {
  delete process.env.KHEYFLIX_ACCESS_TOKEN;
  delete process.env.KHEYFLIX_SESSION_SECRET;
  delete process.env.KHEYFLIX_INTERNAL_TRANSCODER_TOKEN;
  delete process.env.NODE_ENV;
  clearAccessAttemptsForTests();
});

describe("browser access session", () => {
  it("reports a configured but anonymous session without revealing the access code", async () => {
    process.env.KHEYFLIX_ACCESS_TOKEN = "test-access-code";
    process.env.KHEYFLIX_SESSION_SECRET = "test-session-secret";
    process.env.KHEYFLIX_INTERNAL_TRANSCODER_TOKEN = "test-internal-token";

    const response = await GET(new Request("https://kheyflix.test/api/access"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ configured: true, authorized: false });
  });

  it("sets a secure HttpOnly session only after an exact access-code match", async () => {
    process.env.KHEYFLIX_ACCESS_TOKEN = "test-access-code";
    process.env.KHEYFLIX_SESSION_SECRET = "test-session-secret";
    process.env.KHEYFLIX_INTERNAL_TRANSCODER_TOKEN = "test-internal-token";

    const denied = await POST(
      new Request("https://kheyflix.test/api/access", {
        method: "POST",
        body: JSON.stringify({ accessCode: "wrong-code" }),
      }),
    );
    expect(denied.status).toBe(401);
    expect(denied.headers.get("set-cookie")).toBeNull();

    const allowed = await POST(
      new Request("https://kheyflix.test/api/access", {
        method: "POST",
        body: JSON.stringify({ accessCode: "test-access-code" }),
      }),
    );
    const cookie = allowed.headers.get("set-cookie") || "";
    expect(allowed.status).toBe(204);
    expect(cookie).toContain(`${ACCESS_COOKIE_NAME}=`);
    expect(cookie).not.toContain("test-access-code");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).not.toContain("wrong-code");

    const status = await GET(
      new Request("https://kheyflix.test/api/access", { headers: { cookie } }),
    );
    expect(await status.json()).toEqual({ configured: true, authorized: true });
  });

  it("clears the access cookie without requiring a provider call", async () => {
    const response = await DELETE();

    expect(response.status).toBe(204);
    expect(response.headers.get("set-cookie")).toContain(`${ACCESS_COOKIE_NAME}=;`);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(response.headers.get("set-cookie")).toContain("SameSite=Strict");
  });

  it("throttles repeated bad access codes and bounds anonymous request bodies", async () => {
    process.env.KHEYFLIX_ACCESS_TOKEN = "test-access-code";
    process.env.KHEYFLIX_SESSION_SECRET = "test-session-secret";
    process.env.KHEYFLIX_INTERNAL_TRANSCODER_TOKEN = "test-internal-token";
    const invalid = () =>
      POST(
        new Request("https://kheyflix.test/api/access", {
          method: "POST",
          headers: { "x-real-ip": "203.0.113.17" },
          body: JSON.stringify({ accessCode: "wrong-code" }),
        }),
      );

    for (let attempt = 0; attempt < 5; attempt += 1)
      expect((await invalid()).status).toBe(401);

    const throttled = await invalid();
    expect(throttled.status).toBe(429);
    expect(Number(throttled.headers.get("retry-after"))).toBeGreaterThan(0);

    const oversized = await POST(
      new Request("https://kheyflix.test/api/access", {
        method: "POST",
        headers: {
          "x-real-ip": "203.0.113.18",
          "user-agent": "oversized-access-request-test",
        },
        body: JSON.stringify({ accessCode: "x".repeat(2_000) }),
      }),
    );
    expect(oversized.status).toBe(413);
    await expect(oversized.json()).resolves.toMatchObject({
      error: { code: "ACCESS_REQUEST_TOO_LARGE" },
    });
  });

  it("does not let a caller bypass the access-code throttle by changing forwarded IP headers", async () => {
    process.env.KHEYFLIX_ACCESS_TOKEN = "test-access-code";
    process.env.KHEYFLIX_SESSION_SECRET = "test-session-secret";
    process.env.KHEYFLIX_INTERNAL_TRANSCODER_TOKEN = "test-internal-token";

    const invalid = (headers: HeadersInit) =>
      POST(
        new Request("https://kheyflix.test/api/access", {
          method: "POST",
          headers: {
            "user-agent": "Kheyflix access regression browser",
            ...headers,
          },
          body: JSON.stringify({ accessCode: "wrong-code" }),
        }),
      );

    for (let attempt = 0; attempt < 5; attempt += 1)
      expect(
        (
          await invalid({
            "x-real-ip": `203.0.113.${attempt + 1}`,
            "x-forwarded-for": `198.51.100.${attempt + 1}`,
          })
        ).status,
      ).toBe(401);

    const throttled = await invalid({
      "x-real-ip": "192.0.2.254",
      "x-forwarded-for": "198.51.100.254",
    });

    expect(throttled.status).toBe(429);
  });
});
