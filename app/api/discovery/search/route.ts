import { ProwlarrError, searchProwlarr } from "../../../lib/prowlarr";
import { observeApi, writeRequestLog } from "../../../lib/observability";

const handleGet = async (request: Request) => {
  try {
    const query = new URL(request.url).searchParams.get("q") || "";
    const parameters = new URL(request.url).searchParams;
    const kind = parameters.get("kind");
    const season = Number(parameters.get("season"));
    const episode = Number(parameters.get("episode"));
    if (query.trim().length < 2)
      return Response.json({ results: [] }, { headers: { "Cache-Control": "no-store" } });
    const results = await searchProwlarr(query, {
        kind: kind === "movie" || kind === "series" ? kind : undefined,
        season: Number.isInteger(season) && season > 0 ? season : undefined,
        episode: Number.isInteger(episode) && episode > 0 ? episode : undefined,
      });
    writeRequestLog("info", "discovery.search.completed", request, {
      kind: kind === "movie" || kind === "series" ? kind : "all",
      resultCount: results.length,
    });
    return Response.json(
      { results },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    const known =
      error instanceof ProwlarrError
        ? error
        : new ProwlarrError("Discovery is temporarily unavailable.");
    writeRequestLog("error", "discovery.search.failed", request, {
      error: error instanceof Error ? error : new Error(String(error)),
      code: known.code,
      status: known.status,
    });
    return Response.json(
      { error: { code: known.code, message: known.message } },
      { status: known.status },
    );
  }
};

export const GET = observeApi("/api/discovery/search", handleGet);
