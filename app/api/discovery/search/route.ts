import { ProwlarrError, searchProwlarr } from "../../../lib/prowlarr";

export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams.get("q") || "";
    if (query.trim().length < 2)
      return Response.json({ results: [] }, { headers: { "Cache-Control": "no-store" } });
    return Response.json(
      { results: await searchProwlarr(query) },
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
