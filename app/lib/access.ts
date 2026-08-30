export const ACCESS_COOKIE_NAME = "__Host-kheyflix-access";

const SESSION_VERSION = "v1";
const USER_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const MIN_ACCESS_CODE_LENGTH = 24;
const MIN_SERVER_SECRET_LENGTH = 32;
const ACCESS_ATTEMPT_LIMIT = 5;
const ACCESS_ATTEMPT_WINDOW_MS = 5 * 60_000;
const ACCESS_ATTEMPT_MAX_KEYS = 512;
const encoder = new TextEncoder();

type AccessStatus = {
  authorized: boolean;
  configured: boolean;
};

type AccessAttempt = {
  failed: number;
  resetAt: number;
};

const accessAttemptStore = globalThis as typeof globalThis & {
  __kheyflixAccessAttempts?: Map<string, AccessAttempt>;
};

const configuredAccessCode = () => process.env.KHEYFLIX_ACCESS_TOKEN?.trim();
const configuredSessionSecret = () => process.env.KHEYFLIX_SESSION_SECRET?.trim();
const configuredInternalToken = () =>
  process.env.KHEYFLIX_INTERNAL_TRANSCODER_TOKEN?.trim();

const isPlaceholder = (value: string) =>
  /^(?:replace|change|example|placeholder|your)[-_\s]/i.test(value) ||
  /^<[^>]+>$/.test(value);

const isProductionSecret = (value: string | undefined, minimumLength: number) =>
  Boolean(
    value &&
      value.length >= minimumLength &&
      !isPlaceholder(value),
  );

const requiredSecretIsConfigured = (
  value: string | undefined,
  minimumLength: number,
) =>
  process.env.NODE_ENV !== "production" || isProductionSecret(value, minimumLength);

const cookies = (request: Request) =>
  new Map(
    (request.headers.get("cookie") || "")
      .split(";")
      .map((part) => part.trim().split(/=(.*)/s, 2))
      .filter(([name]) => Boolean(name))
      .map(([name, value]) => {
        try {
          return [name, decodeURIComponent(value || "")] as const;
        } catch {
          return [name, ""] as const;
        }
      }),
  );

const constantTimeEqual = (expected: string, received: string) => {
  let difference = expected.length ^ received.length;
  const length = Math.max(expected.length, received.length);
  for (let index = 0; index < length; index += 1)
    difference |=
      (expected.charCodeAt(index) || 0) ^ (received.charCodeAt(index) || 0);
  return difference === 0;
};

const base64Url = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
};

const sessionSignature = async (payload: string) => {
  const secret = configuredSessionSecret();
  const accessCode = configuredAccessCode();
  if (!secret || !accessCode) return null;
  const key = await crypto.subtle.importKey(
    "raw",
    // Rotation of either server-side secret invalidates all issued sessions.
    // The access code is only key material: it is never serialized into the
    // opaque browser session or emitted by this module.
    encoder.encode(`${secret}\n${accessCode}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return base64Url(new Uint8Array(signature));
};

const normalizeMaxAge = (seconds: number) =>
  Math.min(USER_SESSION_MAX_AGE_SECONDS, Math.max(1, Math.floor(seconds)));

const sessionValue = async (maxAgeSeconds: number) => {
  const secret = configuredSessionSecret();
  if (!secret) return null;
  const expiresAt = Math.floor(Date.now() / 1000) + normalizeMaxAge(maxAgeSeconds);
  const nonceBytes = new Uint8Array(18);
  crypto.getRandomValues(nonceBytes);
  const payload = `${SESSION_VERSION}.${expiresAt}.${base64Url(nonceBytes)}`;
  const signature = await sessionSignature(payload);
  return signature ? `${payload}.${signature}` : null;
};

const validSession = async (value: string) => {
  const [version, rawExpiry, nonce, signature, ...rest] = value.split(".");
  const expiry = Number(rawExpiry);
  if (
    rest.length ||
    version !== SESSION_VERSION ||
    !Number.isSafeInteger(expiry) ||
    expiry <= Math.floor(Date.now() / 1000) ||
    !/^[A-Za-z0-9_-]{24}$/.test(nonce || "") ||
    !/^[A-Za-z0-9_-]{43}$/.test(signature || "")
  )
    return false;
  const expected = await sessionSignature(`${version}.${rawExpiry}.${nonce}`);
  return Boolean(expected && constantTimeEqual(expected, signature));
};

const internalStreamRequestIsAuthorized = (request: Request) => {
  if (!/^(?:GET|HEAD)$/.test(request.method)) return false;
  let path = "";
  try {
    path = new URL(request.url).pathname;
  } catch {
    return false;
  }
  if (!/^\/api\/debrid\/stream\/\d+\/\d+$/.test(path)) return false;
  const expected = configuredInternalToken();
  const received = request.headers.get("x-kheyflix-internal") || "";
  return Boolean(expected && constantTimeEqual(expected, received));
};

const accessAttemptKey = (request: Request) => {
  // Request does not expose a verified peer address in this runtime. Both
  // forwarding headers can be supplied by a client unless a trusted edge
  // strips and re-adds them, which this application cannot verify. Do not let
  // an untrusted header choose a fresh throttle bucket on every attempt.
  //
  // This is deliberately an abuse-friction key, not an authentication factor:
  // access still requires an exact high-entropy server-side code. A shared
  // durable limiter belongs at a trusted edge if this private deployment ever
  // needs cross-instance brute-force protection.
  return `agent:${(request.headers.get("user-agent") || "anonymous").slice(0, 160)}`;
};

const accessAttempts = () =>
  (accessAttemptStore.__kheyflixAccessAttempts ??= new Map());

const pruneAccessAttempts = (now = Date.now()) => {
  const attempts = accessAttempts();
  for (const [key, attempt] of attempts)
    if (attempt.resetAt <= now) attempts.delete(key);
  while (attempts.size > ACCESS_ATTEMPT_MAX_KEYS)
    attempts.delete(attempts.keys().next().value as string);
  return attempts;
};

export const accessAttemptRetryAfter = (request: Request, now = Date.now()) => {
  const attempts = pruneAccessAttempts(now);
  const key = accessAttemptKey(request);
  const attempt = attempts.get(key);
  if (!attempt || attempt.resetAt <= now) {
    if (attempt) attempts.delete(key);
    return 0;
  }
  return attempt.failed >= ACCESS_ATTEMPT_LIMIT
    ? Math.max(1, Math.ceil((attempt.resetAt - now) / 1_000))
    : 0;
};

export const recordFailedAccessAttempt = (request: Request, now = Date.now()) => {
  const key = accessAttemptKey(request);
  const attempts = pruneAccessAttempts(now);
  const current = attempts.get(key);
  const attempt =
    current && current.resetAt > now
      ? { ...current, failed: current.failed + 1 }
      : { failed: 1, resetAt: now + ACCESS_ATTEMPT_WINDOW_MS };
  // Move the identity to the newest position before trimming so repeated
  // attempts do not get evicted ahead of stale one-off identities.
  attempts.delete(key);
  attempts.set(key, attempt);
  pruneAccessAttempts(now);
  return Math.max(0, attempt.failed - ACCESS_ATTEMPT_LIMIT);
};

export const clearAccessAttempt = (request: Request) =>
  accessAttempts().delete(accessAttemptKey(request));

export const clearAccessAttemptsForTests = () => accessAttempts().clear();
export const accessAttemptCountForTests = () => accessAttempts().size;

const error = (status: number, code: string, message: string) =>
  Response.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": "private, no-store" } },
  );

export const accessIsConfigured = () =>
  Boolean(
    configuredAccessCode() &&
      configuredSessionSecret() &&
      configuredInternalToken() &&
      requiredSecretIsConfigured(
        configuredAccessCode(),
        MIN_ACCESS_CODE_LENGTH,
      ) &&
      requiredSecretIsConfigured(
        configuredSessionSecret(),
        MIN_SERVER_SECRET_LENGTH,
      ) &&
      requiredSecretIsConfigured(
        configuredInternalToken(),
        MIN_SERVER_SECRET_LENGTH,
      ),
  );

export const accessStatus = async (request: Request): Promise<AccessStatus> => {
  const accessCode = configuredAccessCode();
  if (!accessCode)
    return {
      configured: false,
      authorized: process.env.NODE_ENV !== "production",
    };
  if (!accessIsConfigured()) return { configured: false, authorized: false };
  return {
    configured: true,
    authorized: await validSession(cookies(request).get(ACCESS_COOKIE_NAME) || ""),
  };
};

export const verifyAccessCode = (value: unknown) => {
  const accessCode = configuredAccessCode();
  return (
    typeof value === "string" &&
    accessIsConfigured() &&
    Boolean(accessCode) &&
    constantTimeEqual(accessCode, value)
  );
};

export const requireProviderAccess = async (request: Request) => {
  if (internalStreamRequestIsAuthorized(request)) return null;
  const status = await accessStatus(request);
  if (
    !status.configured &&
    (process.env.NODE_ENV === "production" || Boolean(configuredAccessCode()))
  )
    return error(
      503,
      "ACCESS_NOT_CONFIGURED",
      "Kheyflix access is not configured yet. Please try again shortly.",
    );
  if (!status.authorized)
    return error(
      401,
      "ACCESS_REQUIRED",
      "Enter your Kheyflix access code to continue.",
    );
  return null;
};

export const accessSessionCookie = async (
  maxAgeSeconds = USER_SESSION_MAX_AGE_SECONDS,
) => {
  const maxAge = normalizeMaxAge(maxAgeSeconds);
  const session = await sessionValue(maxAge);
  if (!session) return "";
  // Provider-backed GET endpoints can allocate finite transcoder capacity.
  // Strict prevents a cross-site navigation from carrying a viewer session
  // into those endpoints and turning an authorized browser into a CSRF relay.
  return `${ACCESS_COOKIE_NAME}=${encodeURIComponent(session)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;
};

export const expiredAccessSessionCookie = () =>
  `${ACCESS_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
