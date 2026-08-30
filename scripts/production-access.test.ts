import { describe, expect, it } from "vitest";

import {
  CI_ACCESS_AUDIENCE,
  establishProductionAccess,
} from "./production-access.mjs";

const baseUrl = "https://kheyflix-production.up.railway.app";

describe("production access helper", () => {
  it("exchanges a GitHub Actions OIDC token without needing an access-code secret", async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
      calls.push([String(input), init]);
      if (calls.length === 1)
        return Response.json({ value: "signed-actions-token" });
      return new Response(null, {
        status: 204,
        headers: { "Set-Cookie": "__Host-kheyflix-access=signed-session; Path=/; HttpOnly" },
      });
    };

    await expect(
      establishProductionAccess(baseUrl, {
        environment: {
          ACTIONS_ID_TOKEN_REQUEST_URL: "https://token.actions.githubusercontent.com/request?existing=1",
          ACTIONS_ID_TOKEN_REQUEST_TOKEN: "runner-request-token",
        },
        fetchImpl,
      }),
    ).resolves.toBe("__Host-kheyflix-access=signed-session");

    expect(new URL(calls[0][0]).searchParams.get("audience")).toBe(CI_ACCESS_AUDIENCE);
    expect(calls[1]).toEqual([
      `${baseUrl}/api/access/ci`,
      expect.objectContaining({
        method: "POST",
        headers: { Authorization: "Bearer signed-actions-token" },
      }),
    ]);
  });

  it("uses a local access code only outside Actions and returns no secret material", async () => {
    let body = "";
    const access = await establishProductionAccess(baseUrl, {
      environment: { KHEYFLIX_ACCESS_TOKEN: "local-only-access-code" },
      fetchImpl: async (_input, init) => {
        body = String(init?.body);
        return new Response(null, {
          status: 204,
          headers: { "Set-Cookie": "__Host-kheyflix-access=opaque-session; Path=/; HttpOnly" },
        });
      },
    });

    expect(body).toBe(JSON.stringify({ accessCode: "local-only-access-code" }));
    expect(access).toBe("__Host-kheyflix-access=opaque-session");
    expect(access).not.toContain("local-only-access-code");
  });

  it("fails closed when no verifier credential is available", async () => {
    await expect(
      establishProductionAccess(baseUrl, { environment: {}, fetchImpl: fetch }),
    ).rejects.toThrow("No Kheyflix access credential is available");
  });
});
