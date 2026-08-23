const target = process.argv[2];
const urls = {
  production: "https://kheyflix-production.up.railway.app",
  staging: "https://kheyflix-staging.up.railway.app",
};
const baseUrl = urls[target];

if (!baseUrl) {
  console.error(
    "Usage: node scripts/verify-deployment.mjs <staging|production>",
  );
  process.exit(2);
}

async function json(path) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  return response.json();
}

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function playableCatalog(attempts = 12) {
  let lastCatalog;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    lastCatalog = await json("/api/debrid/magnets");
    const ready =
      lastCatalog.magnets?.filter((item) => item.statusCode === 4) || [];
    const videos = ready.reduce(
      (total, item) => total + (item.videoFiles?.length || 0),
      0,
    );
    if (ready.length && videos) return { catalog: lastCatalog, ready, videos };
    if (attempt < attempts) await delay(5_000);
  }
  throw new Error("The deployed catalog has no playable video files");
}

try {
  const root = await fetch(baseUrl, { signal: AbortSignal.timeout(15_000) });
  if (!root.ok) throw new Error(`/ returned HTTP ${root.status}`);

  const health = await json("/api/health");
  if (health.status !== "ok") throw new Error("Health status is not ok");
  if (!health.dependencies?.alldebrid)
    throw new Error("AllDebrid is not configured");
  if (!health.dependencies?.transcoder)
    throw new Error("Transcoder is not healthy");
  if (!health.dependencies?.discovery)
    throw new Error("Prowlarr discovery is not configured");

  const { catalog, ready, videos } = await playableCatalog();

  const discovery = await json("/api/discovery/search?q=Shrek");
  if (!Array.isArray(discovery.results))
    throw new Error("Discovery did not return a results array");

  console.log(
    `${target}: healthy (${catalog.magnets.length} catalog records, ${ready.length} ready, ${videos} video files, ${discovery.results.length} discovery results)`,
  );
} catch (error) {
  console.error(
    `${target}: verification failed: ${error instanceof Error ? error.message : error}`,
  );
  process.exit(1);
}
