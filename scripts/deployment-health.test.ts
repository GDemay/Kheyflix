import { describe, expect, it } from "vitest";

import { assertExpectedDeploymentCommit } from "./deployment-health.mjs";

describe("deployment health assertions", () => {
  it("accepts a matching exact release commit", () => {
    expect(() =>
      assertExpectedDeploymentCommit(
        { deployment: { commit: "a".repeat(40) } },
        "a".repeat(40),
      ),
    ).not.toThrow();
  });

  it("fails closed when the public health response is an older release", () => {
    expect(() =>
      assertExpectedDeploymentCommit(
        { deployment: { commit: "a".repeat(40) } },
        "b".repeat(40),
      ),
    ).toThrow("Deployment commit mismatch");
  });

  it("permits local diagnostics when no expected release was requested", () => {
    expect(() => assertExpectedDeploymentCommit({ deployment: {} }, "")).not.toThrow();
  });
});
