import { ProwlarrError, searchProwlarr } from "../../../lib/prowlarr";

export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams.get("q") || "";
    const parameters = new URL(request.url).searchParams;
    const kind = parameters.get("kind");
    const season = Number(parameters.get("season"));
    const episode = Number(parameters.get("episode"));
    if (query.trim().length < 2)
      return Response.json({ results: [] }, { headers: { "Cache-Control": "no-store" } });
    return Response.json(
      { results: await searchProwlarr(query, {
        kind: kind === "movie" || kind === "series" ? kind : undefined,
        season: Number.isInteger(season) && season > 0 ? season : undefined,
        episode: Number.isInteger(episode) && episode > 0 ? episode : undefined,
      }) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    const known =
      error instanceof ProwlarrError
        ? error
        : new ProwlarrError("Discovery is temporarily unavailable.");
    return Response.json(
      { error: { code: known.code, message: known.message } },
      { status: known.status },
    );
  }
}
