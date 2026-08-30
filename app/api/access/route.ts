import {
  accessAttemptRetryAfter,
  accessSessionCookie,
  accessStatus,
  clearAccessAttempt,
  expiredAccessSessionCookie,
  recordFailedAccessAttempt,
  verifyAccessCode,
} from "../../lib/access";
import { observeApi } from "../../lib/observability";

const noStore = { "Cache-Control": "private, no-store" };
const MAX_ACCESS_REQUEST_BYTES = 1_024;

class AccessBodyTooLargeError extends Error {}

const readAccessRequest = async (request: Request) => {
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (
    !Number.isFinite(declaredLength) ||
    declaredLength < 0 ||
    declaredLength > MAX_ACCESS_REQUEST_BYTES
  )
    throw new AccessBodyTooLargeError();
  const reader = request.body?.getReader();
  if (!reader) return {};
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_ACCESS_REQUEST_BYTES) {
      await reader.cancel();
      throw new AccessBodyTooLargeError();
    }
    chunks.push(value);
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(body)) as { accessCode?: unknown };
};

const throttled = (retryAfter: number) =>
  Response.json(
    {
      error: {
        code: "ACCESS_RETRY_LATER",
        message: "Too many access-code attempts. Please try again shortly.",
      },
    },
    {
      status: 429,
      headers: { ...noStore, "Retry-After": String(retryAfter) },
    },
  );

const handleGet = async (request: Request) =>
  Response.json(await accessStatus(request), { headers: noStore });

const handlePost = async (request: Request) => {
  const status = await accessStatus(request);
  if (!status.configured)
    return Response.json(
      {
        error: {
          code: "ACCESS_NOT_CONFIGURED",
          message: "Kheyflix access is not configured yet. Please try again shortly.",
        },
      },
      { status: 503, headers: noStore },
    );

  const retryAfter = accessAttemptRetryAfter(request);
  if (retryAfter) return throttled(retryAfter);

  let accessCode: unknown;
  try {
    accessCode = (await readAccessRequest(request)).accessCode;
  } catch (error) {
    recordFailedAccessAttempt(request);
    return Response.json(
      {
        error: {
          code:
            error instanceof AccessBodyTooLargeError
              ? "ACCESS_REQUEST_TOO_LARGE"
              : "ACCESS_CODE_REQUIRED",
          message:
            error instanceof AccessBodyTooLargeError
              ? "The access request is too large."
              : "Enter a valid Kheyflix access code to continue.",
        },
      },
      {
        status: error instanceof AccessBodyTooLargeError ? 413 : 400,
        headers: noStore,
      },
    );
  }

  if (!verifyAccessCode(accessCode)) {
    recordFailedAccessAttempt(request);
    return Response.json(
      {
        error: {
          code: "ACCESS_DENIED",
          message: "That access code is not recognized.",
        },
      },
      { status: 401, headers: noStore },
    );
  }

  clearAccessAttempt(request);

  return new Response(null, {
    status: 204,
    headers: { ...noStore, "Set-Cookie": await accessSessionCookie() },
  });
};

const handleDelete = async () =>
  new Response(null, {
    status: 204,
    headers: { ...noStore, "Set-Cookie": expiredAccessSessionCookie() },
  });

export const GET = observeApi("/api/access", handleGet);
export const POST = observeApi("/api/access", handlePost);
export const DELETE = observeApi("/api/access", handleDelete);
