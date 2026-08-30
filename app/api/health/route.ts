import { isProwlarrReady } from "../../lib/prowlarr";
import { isAllDebridReady } from "../../lib/alldebrid";
import { accessIsConfigured } from "../../lib/access";
import { observeApi, writeRequestLog } from "../../lib/observability";

const handleGet = async (request: Request) => {
  const transcoderUrl =
    process.env.KHEYFLIX_TRANSCODER_URL || "http://127.0.0.1:3101";
  const accessProtectionRequired =
    process.env.NODE_ENV === "production" ||
    Boolean(
      process.env.KHEYFLIX_ACCESS_TOKEN ||
        process.env.KHEYFLIX_SESSION_SECRET ||
      process.env.KHEYFLIX_INTERNAL_TRANSCODER_TOKEN,
    );
  const discoveryRequired = process.env.NODE_ENV === "production";
  const configured = {
    alldebrid: Boolean(process.env.ALLDEBRID_API_KEY),
    discovery: Boolean(
      process.env.PROWLARR_URL && process.env.PROWLARR_API_KEY,
    ),
    metadata: Boolean(process.env.TMDB_READ_ACCESS_TOKEN),
    transcoder: true,
    access: accessIsConfigured(),
  };

  const [transcoder, discovery, alldebrid] = await Promise.all([
    fetch(`${transcoderUrl}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2_000),
    })
      .then(async (response) => {
        if (!response.ok) return false;
        const health = await response.json();
        return (
          health.ok === true &&
          health.appOrigin === true &&
          (!accessProtectionRequired || health.internalAccessConfigured === true)
        );
    })
      .catch(() => false),
    configured.discovery ? isProwlarrReady() : Promise.resolve(false),
    configured.alldebrid ? isAllDebridReady() : Promise.resolve(false),
  ]);
  const dependencies = {
    alldebrid,
    discovery,
    metadata: configured.metadata,
    transcoder,
    access: !accessProtectionRequired || configured.access,
  };
  const ready =
    dependencies.alldebrid &&
    dependencies.transcoder &&
    dependencies.access &&
    (!discoveryRequired || dependencies.discovery);

  if (!ready)
    writeRequestLog("warn", "health.check.completed", request, {
      ready,
      failedDependencies: Object.entries(dependencies)
        .filter(([, healthy]) => !healthy)
        .map(([dependency]) => dependency),
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
