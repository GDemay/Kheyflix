import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
} from "jose";
import { describe, expect, it } from "vitest";

import {
  GITHUB_ACTIONS_OIDC_AUDIENCE,
  verifyGithubActionsToken,
} from "./github-actions-oidc";

const expectedCommit = "0123456789abcdef0123456789abcdef01234567";
const claims = {
  repository: "GDemay/Kheyflix",
  repository_owner: "GDemay",
  event_name: "push",
  ref: "refs/heads/main",
  ref_type: "branch",
  workflow_ref: "GDemay/Kheyflix/.github/workflows/ci.yml@refs/heads/main",
  runner_environment: "github-hosted",
  sha: expectedCommit,
};

const signedToken = async (overrides: Record<string, unknown> = {}) => {
  const keys = await generateKeyPair("RS256");
  const publicJwk = await exportJWK(keys.publicKey);
  publicJwk.kid = "test-key";
  const token = await new SignJWT({ ...claims, ...overrides })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer("https://token.actions.githubusercontent.com")
    .setAudience(GITHUB_ACTIONS_OIDC_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(keys.privateKey);
  return { keySet: createLocalJWKSet({ keys: [publicJwk] }), token };
};

describe("GitHub Actions OIDC verification", () => {
  it("accepts only a valid token for this deployed main workflow", async () => {
    const { keySet, token } = await signedToken();

    await expect(
      verifyGithubActionsToken(token, { expectedCommit, keySet }),
    ).resolves.toMatchObject({ repository: "GDemay/Kheyflix", sha: expectedCommit });
  });

  it.each([
    ["repository", "someone-else/Kheyflix"],
    ["repository_owner", "someone-else"],
    ["event_name", "pull_request"],
    ["ref", "refs/heads/feature"],
    ["ref_type", "tag"],
    ["workflow_ref", "GDemay/Kheyflix/.github/workflows/other.yml@refs/heads/main"],
    ["runner_environment", "self-hosted"],
    ["sha", "different-commit"],
  ])("rejects an invalid %s claim", async (claim, value) => {
    const { keySet, token } = await signedToken({ [claim]: value });

    await expect(
      verifyGithubActionsToken(token, { expectedCommit, keySet }),
    ).rejects.toThrow("not authorized");
  });

  it("rejects a valid signature with the wrong audience or issuer", async () => {
    const { keySet, token } = await signedToken();

    await expect(
      verifyGithubActionsToken(token, {
        expectedCommit,
        keySet,
        audience: "https://wrong.example/api/access/ci",
      }),
    ).rejects.toThrow();
    await expect(
      verifyGithubActionsToken(token, { expectedCommit: "" , keySet }),
    ).rejects.toThrow("not authorized");
  });

  it("fails closed when key verification is unavailable", async () => {
    const { token } = await signedToken();
    const unavailableKeySet = async () => {
      throw new Error("JWKS unavailable");
    };

    await expect(
      verifyGithubActionsToken(token, {
        expectedCommit,
        keySet: unavailableKeySet,
      }),
    ).rejects.toThrow();
  });
});
