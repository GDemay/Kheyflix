import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ACCESS_COOKIE_NAME,
  accessAttemptCountForTests,
  accessAttemptRetryAfter,
  accessSessionCookie,
  accessStatus,
  clearAccessAttemptsForTests,
  recordFailedAccessAttempt,
  requireProviderAccess,
  verifyAccessCode,
} from "./access";

const request = (
  cookie?: string,
  internalToken?: string,
  path = "/api/debrid/magnets",
  method = "GET",
) =>
  new Request(`https://kheyflix.test${path}`, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(internalToken ? { "x-kheyflix-internal": internalToken } : {}),
    },
  });

afterEach(() => {
  delete process.env.KHEYFLIX_ACCESS_TOKEN;
  delete process.env.KHEYFLIX_SESSION_SECRET;
  delete process.env.KHEYFLIX_INTERNAL_TRANSCODER_TOKEN;
  delete process.env.NODE_ENV;
  clearAccessAttemptsForTests();
  vi.useRealTimers();
});

describe("provider access boundary", () => {
  it("fails closed in production when the deployment has no complete access configuration", async () => {
    process.env.NODE_ENV = "production";

    const response = await requireProviderAccess(request());

    expect(response?.status).toBe(503);
    await expect(response?.json()).resolves.toMatchObject({
      error: { code: "ACCESS_NOT_CONFIGURED" },
    });
  });

  it("uses a signed opaque HttpOnly browser session instead of the access code", async () => {
    process.env.KHEYFLIX_ACCESS_TOKEN = "test-access-code";
    process.env.KHEYFLIX_SESSION_SECRET = "test-session-secret";
    process.env.KHEYFLIX_INTERNAL_TRANSCODER_TOKEN = "test-internal-token";

    const denied = await requireProviderAccess(request());
    expect(denied?.status).toBe(401);
    await expect(accessStatus(request())).resolves.toEqual({
      configured: true,
      authorized: false,
    });
    expect(verifyAccessCode("wrong-code")).toBe(false);

    const cookie = await accessSessionCookie();
    expect(cookie).toContain(`${ACCESS_COOKIE_NAME}=`);
    expect(cookie).not.toContain("test-access-code");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Strict");

    const allowed = request(cookie);
    await expect(requireProviderAccess(allowed)).resolves.toBeNull();
    await expect(accessStatus(allowed)).resolves.toEqual({
      configured: true,
      authorized: true,
    });
    expect(verifyAccessCode("test-access-code")).toBe(true);
  });

  it("rejects tampered and expired browser sessions", async () => {
    process.env.KHEYFLIX_ACCESS_TOKEN = "test-access-code";
    process.env.KHEYFLIX_SESSION_SECRET = "test-session-secret";
    process.env.KHEYFLIX_INTERNAL_TRANSCODER_TOKEN = "test-internal-token";
    vi.useFakeTimers({ now: new Date("2026-08-29T12:00:00Z") });

    const cookie = await accessSessionCookie(10);
    const [nameValue] = cookie.split(";");
    const [name, value] = nameValue.split("=");
    const tampered = `${name}=${value.slice(0, -1)}x`;

    await expect(accessStatus(request(tampered))).resolves.toEqual({
      configured: true,
      authorized: false,
    });

    vi.setSystemTime(new Date("2026-08-29T12:00:11Z"));
    await expect(accessStatus(request(cookie))).resolves.toEqual({
      configured: true,
      authorized: false,
    });
  });

  it("accepts the internal credential only for exact stream reads", async () => {
    process.env.KHEYFLIX_ACCESS_TOKEN = "test-access-code";
    process.env.KHEYFLIX_SESSION_SECRET = "test-session-secret";
    process.env.KHEYFLIX_INTERNAL_TRANSCODER_TOKEN = "test-internal-token";

    await expect(requireProviderAccess(request(undefined, "wrong-token", "/api/debrid/stream/42/0"))).resolves.toMatchObject({
      status: 401,
    });
    await expect(requireProviderAccess(request(undefined, "test-internal-token", "/api/debrid/stream/42/0"))).resolves.toBeNull();
    await expect(requireProviderAccess(request(undefined, "test-internal-token", "/api/debrid/stream/42/0", "HEAD"))).resolves.toBeNull();
    await expect(requireProviderAccess(request(undefined, "test-internal-token"))).resolves.toMatchObject({ status: 401 });
    await expect(requireProviderAccess(request(undefined, "test-internal-token", "/api/debrid/stream/42/0", "POST"))).resolves.toMatchObject({ status: 401 });
    await expect(requireProviderAccess(request(undefined, "test-internal-token", "/api/debrid/stream/not-an-id/0"))).resolves.toMatchObject({ status: 401 });
  });

  it("rejects short and placeholder production secrets", async () => {
    process.env.NODE_ENV = "production";
    process.env.KHEYFLIX_ACCESS_TOKEN = "replace_with_an_access_code";
    process.env.KHEYFLIX_SESSION_SECRET = "short";
    process.env.KHEYFLIX_INTERNAL_TRANSCODER_TOKEN = "short";

    await expect(requireProviderAccess(request())).resolves.toMatchObject({ status: 503 });
    expect(verifyAccessCode("replace_with_an_access_code")).toBe(false);
  });

  it("revokes existing sessions when the access code is rotated", async () => {
    process.env.KHEYFLIX_ACCESS_TOKEN = "test-access-code";
    process.env.KHEYFLIX_SESSION_SECRET = "test-session-secret";
    process.env.KHEYFLIX_INTERNAL_TRANSCODER_TOKEN = "test-internal-token";

    const cookie = await accessSessionCookie();
    await expect(accessStatus(request(cookie))).resolves.toMatchObject({
      configured: true,
      authorized: true,
    });

    process.env.KHEYFLIX_ACCESS_TOKEN = "rotated-access-code";

    await expect(accessStatus(request(cookie))).resolves.toMatchObject({
      configured: true,
      authorized: false,
    });
  });

  it("bounds and expires anonymous access-attempt identities", () => {
    const startedAt = 10_000;
    for (let index = 0; index < 600; index += 1) {
      const anonymousRequest = new Request("https://kheyflix.test/api/access", {
        headers: { "user-agent": `anonymous-${index}` },
      });
      recordFailedAccessAttempt(anonymousRequest, startedAt);
    }

    expect(accessAttemptCountForTests()).toBeLessThanOrEqual(512);
    accessAttemptRetryAfter(
      new Request("https://kheyflix.test/api/access", {
        headers: { "user-agent": "fresh-identity" },
      }),
      startedAt + 5 * 60_000 + 1,
    );
    expect(accessAttemptCountForTests()).toBe(0);
  });
});
