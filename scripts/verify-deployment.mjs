import { establishProductionAccess } from "./production-access.mjs";
import { assertExpectedDeploymentCommit } from "./deployment-health.mjs";

const target = process.argv[2];
const baseUrl = "https://kheyflix-production.up.railway.app";

if (target !== "production") {
  console.error(
    "Only production verification is supported: it is bound to the canonical main GitHub Actions identity. A staging verifier requires its own approved OIDC trust contract.",
  );
  process.exit(2);
}

async function json(path, accessCookie) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      Accept: "application/json",
      ...(accessCookie ? { Cookie: accessCookie } : {}),
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  return response.json();
}

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function playableCatalog(accessCookie, attempts = 12) {
  let lastCatalog;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    lastCatalog = await json("/api/debrid/magnets", accessCookie);
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
  assertExpectedDeploymentCommit(health);
  if (health.status !== "ok") throw new Error("Health status is not ok");
  if (!health.dependencies?.alldebrid)
    throw new Error("AllDebrid is not configured");
  if (!health.dependencies?.transcoder)
    throw new Error("Transcoder is not healthy");
  if (!health.dependencies?.discovery)
    throw new Error("Prowlarr discovery is not configured");

  const accessCookie = await establishProductionAccess(baseUrl);
  const { catalog, ready, videos } = await playableCatalog(accessCookie);

  const discovery = await json("/api/discovery/search?q=Shrek", accessCookie);
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
