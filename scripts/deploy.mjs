import { spawnSync } from "node:child_process";

const environment = process.argv[2];
if (!new Set(["staging", "production"]).has(environment)) {
  console.error("Usage: node scripts/deploy.mjs <staging|production>");
  process.exit(2);
}

const result = spawnSync(
  "railway",
  [
    "up",
    "--service",
    "kheyflix",
    "--environment",
    environment,
    "--detach",
    "--json",
    "--yes",
    "--message",
    `Deploy ${environment} from local checkout`,
  ],
  { env: process.env, stdio: "inherit" },
);

if (result.error) {
  console.error(`Railway CLI failed to start: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);

