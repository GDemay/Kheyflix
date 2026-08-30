import { accessIsConfigured, accessSessionCookie } from "../../../lib/access";
import { verifyGithubActionsToken } from "../../../lib/github-actions-oidc";
import { observeApi } from "../../../lib/observability";

const noStore = { "Cache-Control": "private, no-store" };

const failure = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message } }, { status, headers: noStore });

const handlePost = async (request: Request) => {
  if (!accessIsConfigured())
    return failure(
      503,
      "ACCESS_NOT_CONFIGURED",
      "Kheyflix access is not configured yet. Please try again shortly.",
    );

  const token = request.headers
    .get("authorization")
    ?.match(/^Bearer\s+(.+)$/i)?.[1]
    ?.trim();
  if (!token)
    return failure(401, "CI_ACCESS_REQUIRED", "CI access verification is required.");

  try {
    await verifyGithubActionsToken(token);
  } catch {
    return failure(401, "CI_ACCESS_DENIED", "CI access verification was denied.");
  }

  const cookie = await accessSessionCookie(600);
  if (!cookie)
    return failure(
      503,
      "ACCESS_NOT_CONFIGURED",
      "Kheyflix access is not configured yet. Please try again shortly.",
    );
  return new Response(null, {
    status: 204,
    headers: { ...noStore, "Set-Cookie": cookie },
  });
};

export const POST = observeApi("/api/access/ci", handlePost);
