import { AllDebridError } from "../../../../../../../lib/alldebrid";
import { observeApi, publicErrorMessage, requestIdFor, writeLog } from "../../../../../../../lib/observability";

const ASSETS = /^(?:master\.m3u8|segment\d+\.ts)$/;

const handleGet = async (
  request: Request,
  {
    params,
  }: {
    params: Promise<{ id: string; file: string; session: string; asset: string }>;
  },
) => {
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
    const upstream = await fetch(upstreamUrl, { cache: "no-store" });
    if (!upstream.ok || !upstream.body)
      return Response.json(
        {
          error: {
            code: "HLS_UNAVAILABLE",
            message: "The iOS-compatible stream is temporarily unavailable.",
          },
        },
        { status: upstream.status || 502 },
      );
    const headers = new Headers();
    for (const name of ["content-type", "content-length", "cache-control"]) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new Response(upstream.body, { headers });
  } catch (error) {
    const known =
      error instanceof AllDebridError
        ? error
        : new AllDebridError("The iOS-compatible stream is unavailable.");
    writeLog("error", "debrid.hls.failed", {
      requestId: requestIdFor(request),
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
