type LogLevel = "debug" | "info" | "warn" | "error";
type LogContext = Record<string, unknown>;
type ApiHandler<TArgs extends readonly unknown[]> = (
  request: Request,
  ...args: TArgs
) => Response | Promise<Response>;

const REQUEST_ID = /^[a-zA-Z0-9._:-]{1,96}$/;
const CREDENTIAL_TEXT = /(?:token|cookie|session|credentials?|api[-_ ]?key|access[-_ ]?key|private[-_ ]?key|authorization|password|secret)\s*(?:[:=]|\s)\s*\S+/i;
const SENSITIVE_KEY = /(?:authorization|cookie|token|credentials?|secret|password|api[-_]?key|access[-_]?key|private[-_]?key|magnet|url|uri|body|headers|query|title|filename|link)/i;
const observedRequestIds = new WeakMap<Request, string>();
const pendingRequestLogs = new WeakMap<Request, {
  level: LogLevel;
  event: string;
  context: LogContext;
}>();

const sanitizedString = (value: string) => {
  if (/magnet:\?xt=/i.test(value)) return "[REDACTED_MAGNET]";
  if (/\bBearer\s+\S+/i.test(value)) return "[REDACTED_AUTHORIZATION]";
  if (CREDENTIAL_TEXT.test(value))
    return "[REDACTED_SENSITIVE_TEXT]";
  if (/https?:\/\//i.test(value)) return "[REDACTED_URL]";
  return value.slice(0, 2_000);
};

const sanitizedValue = (value: unknown, depth = 0, includeStack = false): unknown => {
  if (depth > 5) return "[TRUNCATED]";
  if (value instanceof Error)
    return {
      type: value.name,
      message: sanitizedString(value.message),
      ...(includeStack && value.stack ? { stack: sanitizedString(value.stack) } : {}),
    };
  if (typeof value === "string") return sanitizedString(value);
  if (typeof value === "number" || typeof value === "boolean" || value === null)
    return value;
  if (Array.isArray(value))
    return value.slice(0, 50).map((item) => sanitizedValue(item, depth + 1, includeStack));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 100)
        .map(([key, item]) => [
          key,
          SENSITIVE_KEY.test(key) ? "[REDACTED]" : sanitizedValue(item, depth + 1, includeStack),
        ]),
    );
  return String(value);
};

export const requestIdFor = (request: Request) => {
  const observed = observedRequestIds.get(request);
  if (observed) return observed;
  const incoming = request.headers.get("x-request-id")?.trim();
  const requestId = incoming && REQUEST_ID.test(incoming) ? incoming : crypto.randomUUID();
  observedRequestIds.set(request, requestId);
  return requestId;
};

export const publicErrorMessage = (message: string, fallback: string) => {
  const normalized = message.trim();
  if (
    !normalized ||
    normalized.length > 300 ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(normalized) ||
    /magnet:\?xt=|https?:\/\/|\bBearer\s+|token|cookie|session|credentials?|api[-_ ]?key|access[-_ ]?key|private[-_ ]?key|authorization|password|secret/i.test(normalized)
  ) return fallback;
  return normalized;
};

export const writeLog = (level: LogLevel, event: string, context: LogContext = {}) => {
  const sanitizedContext = sanitizedValue(context, 0, level === "error") as LogContext;
  const suppliedMessage = typeof sanitizedContext.message === "string"
    ? sanitizedContext.message
    : undefined;
  delete sanitizedContext.message;
  const entry = {
    message: suppliedMessage || event.replaceAll(".", " "),
    level,
    event,
    ...sanitizedContext,
  };
  const serialized = JSON.stringify(entry);
  if (level === "error") console.error(serialized);
  else if (level === "warn") console.warn(serialized);
  else if (level === "debug") console.debug(serialized);
  else console.info(serialized);
};

const operationName = (route: string, method: string) => {
  if (route === "/api/health") return "Check app health";
  if (route === "/api/discovery/search") return "Search catalog";
  if (route === "/api/metadata") return "Load title details";
  if (route === "/api/debrid/magnets")
    return method === "POST" ? "Add title" : "Load library";
  if (route.includes("/api/debrid/stream"))
    return method === "HEAD" ? "Check media source" : "Stream media";
  if (route.includes("/api/debrid/media")) return "Inspect media";
  if (route.includes("/api/debrid/transcode")) {
    if (method === "PATCH") return "Keep compatible stream alive";
    if (method === "POST") return "Stop compatible stream";
    return "Stream compatible video";
  }
  if (route.includes("/api/debrid/hls")) return "Stream iPhone-compatible video";
  if (route.includes("/api/debrid/subtitle")) return "Load subtitles";
  return `${method} ${route}`;
};

const eventMessage = (event: string, request: Request, context: LogContext) => {
  const status = typeof context.status === "number" ? ` (${context.status})` : "";
  if (event === "health.check.completed")
    return context.ready ? "App health check passed" : "App health check is degraded";
  if (event === "discovery.search.completed") return "Catalog search completed";
  if (event === "debrid.catalog.completed") return "Library loaded";
  if (event === "debrid.magnet.upload.completed") return "Title added to library";
  if (event === "metadata.lookup.degraded")
    return "Title details unavailable; continuing without them";
  return `${operationName(new URL(request.url).pathname, request.method)} failed${status}`;
};

export const writeRequestLog = (
  level: LogLevel,
  event: string,
  request: Request,
  context: LogContext = {},
) => {
  pendingRequestLogs.set(request, { level, event, context });
};

const correlatedResponse = async (
  response: Response,
  requestId: string,
  durationMs: number,
) => {
  const timing = `app;dur=${durationMs.toFixed(1)}`;
  if (
    response.status >= 400 &&
    response.headers.get("content-type")?.includes("application/json")
  ) {
    const headers = new Headers(response.headers);
    headers.set("x-request-id", requestId);
    headers.set(
      "server-timing",
      headers.has("server-timing") ? `${headers.get("server-timing")}, ${timing}` : timing,
    );
    const payload = await response.json() as { error?: Record<string, unknown> };
    if (payload.error && typeof payload.error === "object")
      payload.error.requestId = requestId;
    headers.delete("content-length");
    return {
      response: new Response(JSON.stringify(payload), {
        status: response.status,
        statusText: response.statusText,
        headers,
      }),
      errorCode: typeof payload.error?.code === "string" ? payload.error.code : undefined,
    };
  }
  response.headers.set("x-request-id", requestId);
  response.headers.set(
    "server-timing",
    response.headers.has("server-timing")
      ? `${response.headers.get("server-timing")}, ${timing}`
      : timing,
  );
  return {
    response,
    errorCode: undefined,
  };
};

export const observeApi = <TArgs extends readonly unknown[]>(
  route: string,
  handler: ApiHandler<TArgs>,
) => async (request: Request = new Request(`http://localhost${route}`), ...args: TArgs) => {
  const startedAt = performance.now();
  const requestId = requestIdFor(request);
  let response: Response;
  let unhandled: Error | undefined;
  try {
    response = await handler(request, ...args);
  } catch (error) {
    unhandled = error instanceof Error ? error : new Error(String(error));
    response = Response.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "An unexpected error occurred.",
        },
      },
      { status: 500 },
    );
  }
  const durationMs = performance.now() - startedAt;
  const correlated = await correlatedResponse(response, requestId, durationMs);
  const level = response.status >= 500 ? "error" : response.status >= 400 ? "warn" : "info";
  const completionContext = {
    message: `${operationName(route, request.method)} ${response.status >= 400 ? "failed" : "succeeded"} (${response.status}) in ${durationMs.toFixed(1)} ms`,
    requestId,
    method: request.method,
    route,
    status: response.status,
    durationMs: Number(durationMs.toFixed(1)),
    ...(correlated.errorCode ? { errorCode: correlated.errorCode } : {}),
    ...(unhandled ? { error: unhandled } : {}),
  };
  const routineSuccess = response.status < 400 && (
    route === "/api/health" ||
    (route.includes("/api/debrid/transcode") && ["PATCH", "POST"].includes(request.method)) ||
    (route.includes("/api/debrid/stream") && response.status === 206 && request.headers.has("range"))
  );
  const pending = pendingRequestLogs.get(request);
  if (pending) {
    const { code, ...domainContext } = pending.context;
    writeLog(pending.level, pending.event, {
      ...completionContext,
      ...domainContext,
      message: eventMessage(pending.event, request, {
        ...pending.context,
        status: response.status,
      }),
      ...(typeof code === "string" ? { errorCode: code } : {}),
    });
  } else if (!routineSuccess) {
    writeLog(level, "http.request.completed", completionContext);
  }
  pendingRequestLogs.delete(request);
  return correlated.response;
};
