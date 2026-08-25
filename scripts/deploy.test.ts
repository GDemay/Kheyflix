import { describe, expect, it } from "vitest";

import { deploymentArgs } from "./deploy.mjs";

describe("deploymentArgs", () => {
  it("pins staging to the isolated Railway service", () => {
    expect(deploymentArgs("staging")).toEqual(
      expect.arrayContaining([
        "--project",
        "aa2423af-32c8-4dc0-9129-3db69c7e4a5d",
        "--environment",
        "950f9a22-c5f2-43fd-ba54-9e11b446e336",
        "--service",
        "2f853515-80f0-45f9-afe0-9607ee0a0adf",
      ]),
    );
  });

  it("pins production to the canonical GitHub-backed service", () => {
    expect(deploymentArgs("production")).toEqual(
      expect.arrayContaining([
        "--project",
        "aa2423af-32c8-4dc0-9129-3db69c7e4a5d",
        "--environment",
        "ed9b7bff-19ed-4ff8-9b9f-ff159411c11a",
        "--service",
        "1fb8e716-8ba7-4906-80fd-9226e0eeb43e",
      ]),
    );
  });

  it("rejects unknown deployment targets", () => {
    expect(() => deploymentArgs("preview")).toThrow(
      "Unknown deployment target: preview",
    );
  });
});
