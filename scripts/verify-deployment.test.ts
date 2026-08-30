import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("deployment verifier target boundary", () => {
  it("fails closed for staging instead of minting a production-audience OIDC token", () => {
    const result = spawnSync(process.execPath, ["scripts/verify-deployment.mjs", "staging"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Only production verification is supported");
    expect(result.stderr).toContain("OIDC trust contract");
  });
});
