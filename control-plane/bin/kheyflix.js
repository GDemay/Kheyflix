#!/usr/bin/env node
// Kheyflix control-plane CLI.
//
//   kheyflix preflight          fail-closed provider/model verification
//   kheyflix dry-run [--fixture issues.json]   show the one issue that would run
//   kheyflix once               advance the lifecycle one step/issue
//   kheyflix run [--max-steps N]  loop until no eligible work remains
//   kheyflix recover            run GitHub+SQLite reconciliation only
//   kheyflix status             dump runs and recent events
//
// Requires KHEYFLIX_GITHUB_TOKEN in the controller environment (never passed
// to Harness). See docs/secrets.md for the trust boundaries.

import fs from 'node:fs';
import { loadConfig, RESOLVED_MODEL } from '../src/config.js';
import { createLogger } from '../src/log.js';
import { Store } from '../src/db.js';
import { GitHubClient } from '../src/github.js';
import { Controller } from '../src/lifecycle.js';
import { reconcile } from '../src/recover.js';
import { PreflightError } from '../src/harness.js';

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--fixture') args.fixture = argv[++i];
    else if (a === '--max-steps') args.maxSteps = Number(argv[++i]);
    else if (a === '--poll-ms') args.pollMs = Number(argv[++i]);
    else args._.push(a);
  }
  return args;
}

function build({ logToConsole = true } = {}) {
  const config = loadConfig();
  const logger = createLogger({ dir: config.logDir, stream: logToConsole ? process.stderr : { write() {} } });
  const store = new Store(config.dbPath);
  const gh = new GitHubClient({
    token: config.githubToken,
    owner: config.owner,
    repo: config.repo,
    apiBase: config.githubApiBase,
    log: (level, msg) => logger.info(msg),
  });
  const controller = new Controller({ config, store, gh, logger });
  return { config, logger, store, gh, controller };
}

function printIdentity(identity) {
  console.log(`provider: ${identity.provider}`);
  console.log(`model:    ${identity.model}`);
  console.log(`profile:  ${identity.profile}`);
  if (identity.provider !== 'openrouter-ox' || identity.model !== 'stealth/ox-alpha') {
    const msg = `resolved ${identity.provider}/${identity.model}, required exactly ${RESOLVED_MODEL}`;
    throw new PreflightError([`refusing to run: ${msg}`]);
  }
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);

  if (cmd === 'preflight') {
    const { controller, store, logger } = build({ logToConsole: false });
    try {
      printIdentity(controller.preflightHarness());
      console.log('preflight OK');
      store.close();
      logger.close();
      return;
    } catch (err) {
      store?.close?.();
      logger?.close?.();
      throw err;
    }
  }

  if (cmd === 'dry-run') {
    const { controller, store, logger } = build({ logToConsole: false });
    try {
      let fixtureIssues;
      let fixtureClosed;
      if (args.fixture) {
        const data = JSON.parse(fs.readFileSync(args.fixture, 'utf8'));
        fixtureIssues = data.issues ?? data;
        fixtureClosed = data.closedIssueNumbers ?? [];
      }
      const result = await controller.dryRun({ fixtureIssues, fixtureClosed });
      console.log('resolved provider/model (fail-closed):');
      printIdentity(result);
      console.log(`issues considered: ${result.considered}`);
      if (result.selected) {
        console.log('selected exactly one eligible issue:');
        console.log(`  #${result.selected.number} ${result.selected.title}`);
        console.log(`  priority: P${result.selected.priority}`);
        console.log(`  dependencies: ${result.selected.dependencies.length ? result.selected.dependencies.map((d) => `#${d}`).join(', ') : '(none)'}`);
        console.log(`  branch: ${result.selected.branch}`);
      } else {
        console.log('selected: none (no eligible issue)');
      }
      store.close();
      logger.close();
      return;
    } catch (err) {
      store?.close?.();
      logger?.close?.();
      throw err;
    }
  }

  if (cmd === 'once' || cmd === 'run' || cmd === 'recover') {
    const { controller, store, logger, config, gh } = build();
    try {
      if (cmd === 'recover') {
        const summary = await reconcile({ store, gh, config, logger });
        console.log(JSON.stringify(summary, null, 2));
      } else if (cmd === 'once') {
        console.log(JSON.stringify(await controller.once(), null, 2));
      } else {
        const result = await controller.run({ maxSteps: args.maxSteps ?? 100, pollMs: args.pollMs ?? config.ciPollMs });
        console.log(JSON.stringify(result, null, 2));
      }
    } finally {
      store.close();
      logger.close();
    }
    return;
  }

  if (cmd === 'status') {
    const { store } = build({ logToConsole: false });
    for (const run of store.listRuns()) {
      console.log(
        `run #${run.id} issue #${run.issue_number} state=${run.state} attempts=${run.attempts}` +
          ` repairs=${run.repair_attempts} outages=${run.outage_attempts} pr=${run.pr_number ?? '-'} branch=${run.branch}`,
      );
      for (const ev of store.events(run.id)) {
        console.log(`   event ${ev.at}: ${ev.from_state ?? '*'} -> ${ev.to_state}${ev.detail ? ` (${ev.detail})` : ''}`);
      }
    }
    store.close();
    return;
  }

  console.error('usage: kheyflix <preflight|dry-run|once|run|recover|status> [options]');
  process.exit(2);
}

main().catch((err) => {
  if (err instanceof PreflightError) {
    console.error(err.message);
    process.exit(3);
  }
  console.error(err?.stack ?? String(err));
  process.exit(1);
});
