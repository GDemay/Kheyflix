import { requireProviderAccess } from "../../../lib/access";
import { observeApi, writeRequestLog } from "../../../lib/observability";

const events = new Set([
  "first_frame",
  "native_vod_handoff",
  "rebuffer",
  "startup_timeout",
  "startup_retry",
  "failure",
]);
const phases = new Set(["bootstrap", "standard"]);
const qualities = new Set(["bootstrap", "480", "720", "1080", "original"]);

const validMeasurement = (value: unknown, maximum: number) =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= 0 &&
    value <= maximum;

const validAttempt = (value: unknown) =>
  typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 20;

const failure = () =>
  Response.json(
    {
      error: {
        code: "INVALID_PLAYBACK_TELEMETRY",
        message: "Playback telemetry was invalid.",
      },
    },
    { status: 400, headers: { "Cache-Control": "private, no-store" } },
  );

const handlePost = async (request: Request) => {
  const blocked = await requireProviderAccess(request);
  if (blocked) return blocked;
  let body: Record<string, unknown>;
  try {
    const value = await request.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) return failure();
    body = value as Record<string, unknown>;
  } catch {
    return failure();
  }

  const event = body.event,
    elapsedMs = body.elapsedMs,
    rebufferCount = body.rebufferCount ?? 0,
    attempt = body.attempt ?? 1,
    phase = body.phase,
    quality = body.quality;
  if (
    typeof event !== "string" ||
    !events.has(event) ||
    !validMeasurement(elapsedMs, 300_000) ||
    !validMeasurement(rebufferCount, 100) ||
    !validAttempt(attempt) ||
    (phase !== undefined && (typeof phase !== "string" || !phases.has(phase))) ||
    (quality !== undefined && (typeof quality !== "string" || !qualities.has(quality)))
  )
    return failure();

  writeRequestLog("info", "playback.telemetry.received", request, {
    playbackEvent: event,
    elapsedMs: Math.round(elapsedMs),
    rebufferCount: Math.floor(rebufferCount),
    attempt,
    ...(typeof phase === "string" ? { phase } : {}),
    ...(typeof quality === "string" ? { quality } : {}),
  });
  return new Response(null, {
    status: 204,
    headers: { "Cache-Control": "private, no-store" },
  });
};

export const POST = observeApi("/api/playback/telemetry", handlePost);
