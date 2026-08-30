import { createRemoteJWKSet, jwtVerify } from "jose";

export const GITHUB_ACTIONS_OIDC_AUDIENCE =
  "https://kheyflix-production.up.railway.app/api/access/ci";

const GITHUB_ACTIONS_ISSUER = "https://token.actions.githubusercontent.com";
const GITHUB_ACTIONS_WORKFLOW =
  "GDemay/Kheyflix/.github/workflows/ci.yml@refs/heads/main";
const githubActionsKeySet = createRemoteJWKSet(
  new URL("https://token.actions.githubusercontent.com/.well-known/jwks"),
);

type VerifyOptions = {
  audience?: string;
  expectedCommit?: string;
  keySet?: Parameters<typeof jwtVerify>[1];
};

const unauthorized = () => {
  throw new Error("GitHub Actions token is not authorized");
};

export const verifyGithubActionsToken = async (
  token: string,
  {
    audience = GITHUB_ACTIONS_OIDC_AUDIENCE,
    expectedCommit = process.env.RAILWAY_GIT_COMMIT_SHA || "",
    keySet = githubActionsKeySet,
  }: VerifyOptions = {},
) => {
  if (!token || !expectedCommit) unauthorized();

  let payload;
  try {
    ({ payload } = await jwtVerify(token, keySet, {
      algorithms: ["RS256"],
      audience,
      issuer: GITHUB_ACTIONS_ISSUER,
    }));
  } catch {
    unauthorized();
  }

  const trustedClaims: Record<string, string> = {
    repository: "GDemay/Kheyflix",
    repository_owner: "GDemay",
    event_name: "push",
    ref: "refs/heads/main",
    ref_type: "branch",
    workflow_ref: GITHUB_ACTIONS_WORKFLOW,
    runner_environment: "github-hosted",
    sha: expectedCommit,
  };
  for (const [claim, value] of Object.entries(trustedClaims))
    if (payload[claim] !== value) unauthorized();
  return payload;
};
