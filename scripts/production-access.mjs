export const CI_ACCESS_AUDIENCE =
  "https://kheyflix-production.up.railway.app/api/access/ci";

const sessionCookie = (response) => {
  const value = response.headers.get("set-cookie") || "";
  const cookie = value.split(";", 1)[0];
  if (!cookie.startsWith("__Host-kheyflix-access="))
    throw new Error("Kheyflix did not issue a secure access session");
  return cookie;
};

const requestActionsToken = async ({ environment, fetchImpl }) => {
  const requestUrl = environment.ACTIONS_ID_TOKEN_REQUEST_URL;
  const requestToken = environment.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!requestUrl && !requestToken) return null;
  if (!requestUrl || !requestToken)
    throw new Error("GitHub Actions OIDC is not fully configured");
  const url = new URL(requestUrl);
  url.searchParams.set("audience", CI_ACCESS_AUDIENCE);
  const response = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${requestToken}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error("GitHub Actions OIDC token request failed");
  const body = await response.json();
  if (!body || typeof body.value !== "string" || !body.value)
    throw new Error("GitHub Actions OIDC token response was invalid");
  return body.value;
};

export const establishProductionAccess = async (
  baseUrl,
  { environment = process.env, fetchImpl = fetch } = {},
) => {
  const origin = baseUrl.replace(/\/$/, "");
  const oidcToken = await requestActionsToken({ environment, fetchImpl });
  const accessCode = environment.KHEYFLIX_ACCESS_TOKEN;
  if (!oidcToken && !accessCode)
    throw new Error("No Kheyflix access credential is available for production verification");

  const response = oidcToken
    ? await fetchImpl(`${origin}/api/access/ci`, {
        method: "POST",
        headers: { Authorization: `Bearer ${oidcToken}` },
        signal: AbortSignal.timeout(30_000),
      })
    : await fetchImpl(`${origin}/api/access`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessCode }),
        signal: AbortSignal.timeout(30_000),
      });
  if (!response.ok) throw new Error("Kheyflix access session request failed");
  return sessionCookie(response);
};
