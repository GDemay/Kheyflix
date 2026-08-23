#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  EXPECTED_REPOSITORY,
  protectedArguments,
  protectedEnvironment,
} from "./gh-kheyflix-policy.mjs";

const EXPECTED_LOGIN = "GDemay";
const gh = ["/opt/homebrew/bin/gh", "/usr/local/bin/gh", "/usr/bin/gh"].find(
  existsSync,
);
const configDir =
  process.env.KHEYFLIX_GH_CONFIG_DIR || join(homedir(), ".config", "gh-kheyflix");
const args = process.argv.slice(2);
const env = protectedEnvironment(process.env, configDir);

const fail = (message) => {
  console.error(`Kheyflix GitHub operation blocked: ${message}`);
  process.exit(1);
};

const run = (commandArgs, options = {}) =>
  spawnSync(gh || "gh-not-installed", commandArgs, {
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

let forwardedArgs;
if (args[0] !== "--setup") {
  try {
    forwardedArgs = protectedArguments(args);
  } catch (error) {
    fail(error instanceof Error ? error.message : "invalid GitHub CLI command.");
  }
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
if (remote.stdout.trim() !== "git@github.com:GDemay/Kheyflix.git")
  fail(`origin is not ${EXPECTED_REPOSITORY}.`);

if (args[0] === "--setup") {
  console.log(`Kheyflix GitHub profile ready: ${EXPECTED_LOGIN} -> ${EXPECTED_REPOSITORY}.`);
  process.exit(0);
}
const result = run(forwardedArgs, { stdio: "inherit" });
if (result.error) fail(`could not launch GitHub CLI (${result.error.message}).`);
process.exit(result.status ?? 1);
