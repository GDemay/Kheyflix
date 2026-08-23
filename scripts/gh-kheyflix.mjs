#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const EXPECTED_LOGIN = "GDemay";
const EXPECTED_REPOSITORY = "GDemay/Kheyflix";
const gh = process.env.KHEYFLIX_GH_BIN || "gh";
const configDir =
  process.env.KHEYFLIX_GH_CONFIG_DIR || join(homedir(), ".config", "gh-kheyflix");
const args = process.argv.slice(2);
const env = { ...process.env, GH_CONFIG_DIR: configDir, GH_REPO: EXPECTED_REPOSITORY };

// Environment tokens override gh's stored profile. They must never be able to
// silently replace the repository-isolated GDemay authentication.
delete env.GH_TOKEN;
delete env.GITHUB_TOKEN;

const fail = (message) => {
  console.error(`Kheyflix GitHub operation blocked: ${message}`);
  process.exit(1);
};

const run = (commandArgs, options = {}) =>
  spawnSync(gh, commandArgs, {
    env,
    encoding: "utf8",
    ...options,
  });

if (args[0] === "--setup") {
  const setup = run(
    ["auth", "login", "--hostname", "github.com", "--git-protocol", "ssh", "--web"],
    { stdio: "inherit" },
  );
  if (setup.error) fail(`could not launch GitHub CLI (${setup.error.message}).`);
  if (setup.status !== 0) process.exit(setup.status ?? 1);
}

const identity = run(["api", "user", "--jq", ".login"]);
if (identity.error) fail(`could not launch GitHub CLI (${identity.error.message}).`);
if (identity.status !== 0)
  fail(
    `the isolated profile is not authenticated. Run \"npm run github:setup\" and sign in as ${EXPECTED_LOGIN}.`,
  );
const login = identity.stdout.trim();
if (login !== EXPECTED_LOGIN)
  fail(`isolated profile is authenticated as ${login || "an unknown account"}, not ${EXPECTED_LOGIN}.`);

const remote = spawnSync("git", ["remote", "get-url", "origin"], {
  encoding: "utf8",
});
if (remote.status !== 0) fail("the authoritative origin remote is unavailable.");
if (!/^git@github\.com:GDemay\/Kheyflix\.git$|^https:\/\/github\.com\/GDemay\/Kheyflix(?:\.git)?$/.test(remote.stdout.trim()))
  fail(`origin is not ${EXPECTED_REPOSITORY}.`);

for (let index = 0; index < args.length; index += 1) {
  const value = args[index];
  if ((value === "--repo" || value === "-R") && args[index + 1] !== EXPECTED_REPOSITORY)
    fail(`explicit repository must be ${EXPECTED_REPOSITORY}.`);
  if ((value.startsWith("--repo=") || value.startsWith("-R=")) && value.split("=", 2)[1] !== EXPECTED_REPOSITORY)
    fail(`explicit repository must be ${EXPECTED_REPOSITORY}.`);
}

if (args[0] === "--setup") {
  console.log(`Kheyflix GitHub profile ready: ${EXPECTED_LOGIN} -> ${EXPECTED_REPOSITORY}.`);
  process.exit(0);
}
if (!args.length) fail("no GitHub CLI command was provided.");

const result = run(args, { stdio: "inherit" });
if (result.error) fail(`could not launch GitHub CLI (${result.error.message}).`);
process.exit(result.status ?? 1);
