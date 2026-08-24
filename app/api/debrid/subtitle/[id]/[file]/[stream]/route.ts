import { AllDebridError } from "../../../../../../lib/alldebrid";
import { observeApi, publicErrorMessage, requestIdFor, writeLog } from "../../../../../../lib/observability";
const handleGet = async (
  request: Request,
  { params }: { params: Promise<{ id: string; file: string; stream: string }> },
) => {
  try {
    const { id, file, stream } = await params;
    if (![id, file, stream].every((value) => /^\d+$/.test(value)))
      throw new AllDebridError(
        "Invalid subtitle selection.",
        "INVALID_MEDIA",
        400,
      );
    const start = Math.max(0, Number(new URL(request.url).searchParams.get("start") || 0));
    const base = process.env.KHEYFLIX_TRANSCODER_URL || "http://127.0.0.1:3101",
      response = await fetch(`${base}/subtitle/${id}/${file}/${stream}.vtt?start=${start}`, {
        cache: "no-store",
      });
    if (!response.ok || !response.body)
      return Response.json(
        { error: { message: "Subtitle track is unavailable." } },
        { status: response.status || 502 },
      );
    return new Response(response.body, {
      headers: {
        "Content-Type": "text/vtt; charset=utf-8",
        "Cache-Control": "private, max-age=86400",
      },
    });
  } catch (error) {
    const known =
      error instanceof AllDebridError
        ? error
        : new AllDebridError("Subtitle track is unavailable.");
    writeLog("error", "debrid.subtitle.failed", {
      requestId: requestIdFor(request),
      code: known.code,
      status: known.status,
      error: error instanceof Error ? error : new Error(String(error)),
    });
    return Response.json(
      { error: { code: known.code, message: publicErrorMessage(known.message, "Subtitle track is unavailable.") } },
      { status: known.status },
    );
  }
};

export const GET = observeApi(
  "/api/debrid/subtitle/:id/:file/:stream",
  handleGet,
);
