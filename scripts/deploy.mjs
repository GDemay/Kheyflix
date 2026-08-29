import { pathToFileURL } from "node:url";

const targets = new Set(["staging", "production"]);

export function main(argv = process.argv) {
  const environment = argv[2];
  if (!targets.has(environment)) {
    console.error("Usage: node scripts/deploy.mjs <staging|production>");
    return 2;
  }

  console.error(
    `Direct Railway CLI deployment is disabled for ${environment}. Use the configured Railway MCP with the canonical resource IDs and the required approval workflow.`,
  );
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
