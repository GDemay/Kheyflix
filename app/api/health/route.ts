import { isProwlarrReady } from "../../lib/prowlarr";
import { observeApi, requestIdFor, writeLog } from "../../lib/observability";

const handleGet = async (request: Request) => {
  const transcoderUrl =
    process.env.KHEYFLIX_TRANSCODER_URL || "http://127.0.0.1:3101";
  const configured = {
    alldebrid: Boolean(process.env.ALLDEBRID_API_KEY),
    discovery: Boolean(
      process.env.PROWLARR_URL && process.env.PROWLARR_API_KEY,
    ),
    metadata: Boolean(process.env.TMDB_READ_ACCESS_TOKEN),
    transcoder: true,
  };

  const [transcoder, discovery] = await Promise.all([
    fetch(`${transcoderUrl}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2_000),
    })
      .then(async (response) => {
        if (!response.ok) return false;
        const health = await response.json();
        return health.ok === true && health.appOrigin === true;
      })
      .catch(() => false),
    configured.discovery ? isProwlarrReady() : Promise.resolve(false),
  ]);
  const dependencies = {
    alldebrid: configured.alldebrid,
    discovery,
    metadata: configured.metadata,
    transcoder,
  };
  const ready =
    dependencies.alldebrid &&
    dependencies.transcoder &&
    (!configured.discovery || dependencies.discovery);

  writeLog(ready ? "info" : "warn", "health.check.completed", {
    requestId: requestIdFor(request),
    ready,
    configured,
    dependencies,
  });

  return Response.json(
    {
      status: ready ? "ok" : "degraded",
      deployment: {
        commit: process.env.RAILWAY_GIT_COMMIT_SHA || null,
      },
      configured,
      dependencies,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
};

export const GET = observeApi("/api/health", handleGet);
