export async function GET() {
  const transcoderUrl =
    process.env.KHEYFLIX_TRANSCODER_URL || "http://127.0.0.1:3101";

  let transcoder = false;
  try {
    const response = await fetch(`${transcoderUrl}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2_000),
    });
    transcoder = response.ok;
  } catch {
    // Report dependency state without taking down the web process health check.
  }

  return Response.json(
    {
      status: "ok",
      dependencies: {
        alldebrid: Boolean(process.env.ALLDEBRID_API_KEY),
        discovery: Boolean(
          process.env.PROWLARR_URL && process.env.PROWLARR_API_KEY,
        ),
        metadata: Boolean(process.env.TMDB_READ_ACCESS_TOKEN),
        transcoder,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
