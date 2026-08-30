import { afterEach, describe, expect, it, vi } from "vitest";

const { verifyGithubActionsToken } = vi.hoisted(() => ({
  verifyGithubActionsToken: vi.fn(),
}));

vi.mock("../../../lib/github-actions-oidc", () => ({ verifyGithubActionsToken }));

import { ACCESS_COOKIE_NAME } from "../../../lib/access";
import { POST } from "./route";

afterEach(() => {
  delete process.env.KHEYFLIX_ACCESS_TOKEN;
  delete process.env.KHEYFLIX_SESSION_SECRET;
  delete process.env.KHEYFLIX_INTERNAL_TRANSCODER_TOKEN;
  verifyGithubActionsToken.mockReset();
});

describe("CI access exchange", () => {
  it("exchanges a verified Actions token for a short-lived opaque session", async () => {
    process.env.KHEYFLIX_ACCESS_TOKEN = "test-access-code";
    process.env.KHEYFLIX_SESSION_SECRET = "test-session-secret";
    process.env.KHEYFLIX_INTERNAL_TRANSCODER_TOKEN = "test-internal-token";
    verifyGithubActionsToken.mockResolvedValue({ repository: "GDemay/Kheyflix" });

    const response = await POST(
      new Request("https://kheyflix.test/api/access/ci", {
        method: "POST",
        headers: { Authorization: "Bearer signed-actions-token" },
      }),
    );

    const cookie = response.headers.get("set-cookie") || "";
    expect(response.status).toBe(204);
    expect(verifyGithubActionsToken).toHaveBeenCalledWith("signed-actions-token");
    expect(cookie).toContain(`${ACCESS_COOKIE_NAME}=`);
    expect(cookie).not.toContain("test-access-code");
    expect(cookie).toContain("Max-Age=600");
  });

  it("rejects missing, invalid, and unconfigured CI exchanges without a session", async () => {
    process.env.KHEYFLIX_ACCESS_TOKEN = "test-access-code";
    process.env.KHEYFLIX_SESSION_SECRET = "test-session-secret";
    process.env.KHEYFLIX_INTERNAL_TRANSCODER_TOKEN = "test-internal-token";

    const missing = await POST(new Request("https://kheyflix.test/api/access/ci", { method: "POST" }));
    expect(missing.status).toBe(401);

    verifyGithubActionsToken.mockRejectedValue(new Error("not authorized"));
    const invalid = await POST(
      new Request("https://kheyflix.test/api/access/ci", {
        method: "POST",
        headers: { Authorization: "Bearer invalid" },
      }),
    );
    expect(invalid.status).toBe(401);
    expect(invalid.headers.get("set-cookie")).toBeNull();

    delete process.env.KHEYFLIX_SESSION_SECRET;
    const unconfigured = await POST(
      new Request("https://kheyflix.test/api/access/ci", {
        method: "POST",
        headers: { Authorization: "Bearer signed-actions-token" },
      }),
    );
    expect(unconfigured.status).toBe(503);
    expect(verifyGithubActionsToken).toHaveBeenCalledTimes(1);
  });
});
