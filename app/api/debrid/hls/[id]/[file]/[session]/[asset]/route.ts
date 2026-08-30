import { AllDebridError } from "../../../../../../../lib/alldebrid";
import { requireProviderAccess } from "../../../../../../../lib/access";
import { observeApi, publicErrorMessage, writeRequestLog } from "../../../../../../../lib/observability";

const ASSETS = /^(?:master\.m3u8|segment\d+\.ts)$/;

const handleGet = async (
  request: Request,
  {
    params,
  }: {
    params: Promise<{ id: string; file: string; session: string; asset: string }>;
  },
) => {
  const blocked = await requireProviderAccess(request);
  if (blocked) return blocked;
  try {
    const { id, file, session, asset } = await params;
    if (
      !/^\d+$/.test(id) ||
      !/^\d+$/.test(file) ||
      !/^[a-z0-9-]+$/i.test(session) ||
      !ASSETS.test(asset)
    )
      throw new AllDebridError(
        "Invalid HLS media selection.",
        "INVALID_MEDIA",
        400,
      );
    const source = new URL(request.url),
      base = process.env.KHEYFLIX_TRANSCODER_URL || "http://127.0.0.1:3101",
      upstreamUrl = new URL(`${base}/hls/${id}/${file}/${session}/${asset}`);
    for (const key of ["start", "audio", "sync", "quality"]) {
      const value = source.searchParams.get(key);
      if (value !== null) upstreamUrl.searchParams.set(key, value);
    }
    const mode = source.searchParams.get("mode");
    if (mode === "native-vod" || mode === "native-vod-warm")
      upstreamUrl.searchParams.set("mode", mode);
    const upstream = await fetch(upstreamUrl, {
      cache: "no-store",
      signal: request.signal,
    });
    if (!upstream.ok || !upstream.body)
      return Response.json(
        {
          error: {
            code: "HLS_UNAVAILABLE",
            message: "The iOS-compatible stream is temporarily unavailable.",
          },
        },
        {
          status: upstream.status || 502,
          headers: upstream.headers.get("retry-after")
            ? { "Retry-After": upstream.headers.get("retry-after")! }
            : {},
        },
      );
    const headers = new Headers();
    for (const name of ["content-type", "content-length", "cache-control"]) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    const reader = upstream.body.getReader();
    let canceled = false;
    const cancelReader = async (reason?: unknown) => {
      if (canceled) return;
      canceled = true;
      await reader.cancel(reason).catch(() => undefined);
    };
    const abortReader = () => {
      void cancelReader(request.signal.reason);
    };
    request.signal.addEventListener("abort", abortReader, { once: true });
    // AbortSignal does not replay an abort to listeners attached after it
    // fired. Fetch can settle in the same turn as a client disconnect, so
    // close that narrow handoff window before exposing the relay body.
    if (request.signal.aborted) abortReader();
    const cleanupAbort = () =>
      request.signal.removeEventListener("abort", abortReader);
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            cleanupAbort();
            controller.close();
          }
          else controller.enqueue(value);
        } catch (reason) {
          cleanupAbort();
          controller.error(reason);
        }
      },
      async cancel(reason) {
        await cancelReader(reason);
        cleanupAbort();
        // WebKit is allowed to cancel or revalidate a finite manifest after it
        // has received it, then immediately fetch its relative segments.  Do
        // not turn that normal HLS behavior into a session stop. The upstream
        // request signal still reaches the transcoder before a playlist is
        // ready, while explicit player lifecycle events, heartbeats, and the
        // lease sweeper bound completed-session cleanup.
      },
    });
    return new Response(body, { headers });
  } catch (error) {
    const known =
      error instanceof AllDebridError
        ? error
        : new AllDebridError("The iOS-compatible stream is unavailable.");
    writeRequestLog(known.status >= 500 ? "error" : "warn", "debrid.hls.failed", request, {
      code: known.code,
      status: known.status,
      error: error instanceof Error ? error : new Error(String(error)),
    });
    return Response.json(
      { error: { code: known.code, message: publicErrorMessage(known.message, "The iOS-compatible stream is unavailable.") } },
      { status: known.status },
    );
  }
};

export const GET = observeApi(
  "/api/debrid/hls/:id/:file/:session/:asset",
  handleGet,
);
