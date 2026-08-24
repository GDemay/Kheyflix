import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const DEPLOYMENT_TARGETS = Object.freeze({
  staging: Object.freeze({
    project: "aa2423af-32c8-4dc0-9129-3db69c7e4a5d",
    environment: "950f9a22-c5f2-43fd-ba54-9e11b446e336",
    service: "1fb8e716-8ba7-4906-80fd-9226e0eeb43e",
  }),
  production: Object.freeze({
    project: "aa2423af-32c8-4dc0-9129-3db69c7e4a5d",
    environment: "ed9b7bff-19ed-4ff8-9b9f-ff159411c11a",
    service: "1fb8e716-8ba7-4906-80fd-9226e0eeb43e",
  }),
});

export function deploymentArgs(environment) {
  const target = DEPLOYMENT_TARGETS[environment];
  if (!target) throw new Error(`Unknown deployment target: ${environment}`);

  return [
    "up",
    "--project",
    target.project,
    "--service",
    target.service,
    "--environment",
    target.environment,
    "--detach",
    "--json",
    "--yes",
    "--message",
    `Deploy ${environment} from local checkout`,
  ];
}

export function main(argv = process.argv) {
  const environment = argv[2];
  let args;
  try {
    args = deploymentArgs(environment);
  } catch {
    console.error("Usage: node scripts/deploy.mjs <staging|production>");
    return 2;
  }

  const result = spawnSync("railway", args, {
    env: process.env,
    stdio: "inherit",
  });

  if (result.error) {
    console.error(`Railway CLI failed to start: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
