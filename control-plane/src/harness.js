// DeepSeek Harness driver. Headless invocation via the local `dsh` CLI using
// the dedicated kheyflix-ox profile. Preflight FAILS CLOSED unless the
// resolved provider/model is exactly openrouter-ox/stealth/ox-alpha — there
// is no fallback model and no degraded mode.

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { REQUIRED_MODEL, REQUIRED_PROVIDER } from './config.js';
import { redactString } from './redact.js';

export class PreflightError extends Error {
  constructor(errors) {
    super(`harness preflight failed (fail closed): ${errors.join('; ')}`);
    this.name = 'PreflightError';
    this.errors = errors;
  }
}

/**
 * Minimal reader for $DSH_HOME/settings.yaml that extracts the effective
 * agent-default-model (the same values DeepSeek Harness boots with).
 */
export function readAgentDefaultModel(yamlText) {
  let inBlock = false;
  const out = {};
  for (const rawLine of String(yamlText ?? '').split('\n')) {
    const line = rawLine.replace(/#.*$/, '').replace(/\r$/, '');
    if (/^agent-default-model:\s*$/.test(line)) {
      inBlock = true;
      continue;
    }
    if (!inBlock) continue;
    if (/^\S/.test(line)) break; // next top-level key ends the block
    const m = line.match(/^\s+(provider|model):\s*(.+?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out.provider && out.model ? { provider: out.provider, model: out.model } : null;
}

/** Resolve the effective provider/model for a dsh home directory. */
export function resolveModelIdentity({ dshHome }) {
  const settingsPath = path.join(dshHome, 'settings.yaml');
  let text;
  try {
    text = fs.readFileSync(settingsPath, 'utf8');
  } catch (err) {
    return { ok: false, error: `cannot read ${settingsPath}: ${err.code ?? err.message}` };
  }
  const resolved = readAgentDefaultModel(text);
  if (!resolved) return { ok: false, error: `agent-default-model not found in ${settingsPath}` };
  return { ok: true, ...resolved, source: settingsPath };
}

function whichSync(cmd) {
  if (cmd.includes('/')) return fs.existsSync(cmd) ? cmd : null;
  for (const dir of (process.env.PATH ?? '').split(':')) {
    if (!dir) continue;
    const candidate = path.join(dir, cmd);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

/**
 * Fail-closed preflight. Throws PreflightError unless:
 * - settings.yaml resolves provider === openrouter-ox AND model === stealth/ox-alpha,
 * - the dedicated profile directory exists,
 * - the harness binary resolves on PATH.
 */
export function preflight({ dshHome, profile, harnessCmd }) {
  const errors = [];
  const identity = resolveModelIdentity({ dshHome });
  if (!identity.ok) {
    errors.push(identity.error);
  } else {
    if (identity.provider !== REQUIRED_PROVIDER) {
      errors.push(`provider resolved to '${identity.provider}', required exactly '${REQUIRED_PROVIDER}'`);
    }
    if (identity.model !== REQUIRED_MODEL) {
      errors.push(`model resolved to '${identity.model}', required exactly '${REQUIRED_MODEL}'`);
    }
  }
  if (!fs.existsSync(path.join(dshHome, 'profiles', profile))) {
    errors.push(`profile '${profile}' not found under ${dshHome}/profiles`);
  }
  if (!whichSync(harnessCmd)) {
    errors.push(`harness command '${harnessCmd}' not found on PATH`);
  }
  if (errors.length > 0) throw new PreflightError(errors);
  return { provider: REQUIRED_PROVIDER, model: REQUIRED_MODEL, profile };
}

/** Child environment allowlist: deliberately excludes every credential class. */
export function harnessChildEnv(extra = {}) {
  const allowed = ['PATH', 'HOME', 'DSH_HOME', 'LANG', 'LC_ALL', 'TMPDIR', 'TERM', 'SHELL', 'USER', 'LOGNAME'];
  const env = {};
  for (const key of allowed) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  // Test-only passthrough (KHEYFLIX_TEST_*): never set in production, used to
  // drive hermetic Harness stubs in the controller test suite.
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('KHEYFLIX_TEST_')) env[key] = process.env[key];
  }
  // Git identity so the agent can commit locally; controller does all pushes.
  Object.assign(env, extra);
  for (const key of Object.keys(env)) {
    if (/token|secret|password|credential|api[_-]?key/i.test(key) && !/^GIT_(AUTHOR|COMMITTER)_/.test(key)) {
      delete env[key];
    }
  }
  return env;
}

/**
 * Run one headless Harness task. Streams redacted output into a transcript
 * file and enforces a hard timeout (SIGTERM, then SIGKILL).
 */
export function runHarness({
  harnessCmd,
  profile,
  task,
  cwd,
  timeoutMs,
  transcriptPath,
  childEnvExtra = {},
  now = () => Date.now(),
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  spawnImpl = spawn,
} ) {
  return new Promise((resolve, reject) => {
    const startedAt = now();
    const args = ['--profile', profile, task];
    let child;
    try {
      child = spawnImpl(harnessCmd, args, { cwd, env: harnessChildEnv(childEnvExtra), stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      reject(err);
      return;
    }
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    fs.mkdirSync(path.dirname(transcriptPath), { recursive: true });
    const transcript = fs.openSync(transcriptPath, 'w');
    const record = (streamName, chunk) => {
      const text = chunk.toString('utf8');
      if (streamName === 'stdout') stdout += text;
      else stderr += text;
      fs.writeSync(transcript, `[${new Date().toISOString()}] ${streamName}: ${redactString(text)}\n`);
    };
    child.stdout.on('data', (c) => record('stdout', c));
    child.stderr.on('data', (c) => record('stderr', c));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* already gone */
        }
      }, 5000).unref();
    }, Math.max(1, timeoutMs));
    timer.unref?.();
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fs.closeSync(transcript);
      reject(err);
    });
    child.on('close', async (code, signal) => {
      clearTimeout(timer);
      fs.closeSync(transcript);
      if (timedOut) {
        // Give the OS a moment to reap the killed process group.
        await sleep(10);
      }
      settled = true;
      resolve({
        code,
        signal,
        timedOut,
        durationMs: now() - startedAt,
        stdoutTail: stdout.slice(-8000),
        stderrTail: stderr.slice(-8000),
        transcriptPath,
      });
    });
  });
}

const OUTAGE_RE =
  /(rate.?limit|\b429\b|\b502\b|\b503\b|\b504\b|quota|insufficient|overloaded|provider (?:is )?(?:unavailable|error)|model (?:is )?(?:unavailable|not found)|econnreset|etimedout|fetch failed|socket hang up|upstream error)/i;

export function classifyFailure(result) {
  if (!result) return 'unknown';
  if (result.timedOut || result.signal === 'SIGKILL') return 'timeout';
  if (result.code === 0) return 'success';
  const combined = `${result.stderrTail ?? ''}\n${result.stdoutTail ?? ''}`;
  if (OUTAGE_RE.test(combined)) return 'model_outage';
  return 'task_failed';
}

/**
 * Compose the Harness task prompt. Only permitted content enters this string:
 * checkout location, repository instructions, the issue itself, and focused
 * CI/review evidence. Never credentials, never environment dumps.
 */
export function buildTaskPrompt({ mode, issue, repoPath, evidence = '', architectureDoc = 'docs/architecture.md' }) {
  const header =
    mode === 'repair'
      ? `You are repairing delivery for issue #${issue.number}. A previous attempt was pushed but rejected. Fix the reported problems on the current branch, commit, and stop. Do not push.`
      : `Implement GitHub issue #${issue.number} in this checkout. Work only on the current branch, commit your changes, and stop. Do not push.`;
  return [
    header,
    '',
    `Checkout: ${repoPath}`,
    `Read and obey AGENTS.md and ${architectureDoc} before writing code.`,
    '',
    `## Issue #${issue.number}: ${issue.title}`,
    issue.body ?? '(no body)',
    '',
    ...(evidence ? [`## Focused evidence\n${evidence}`, ''] : []),
    '## Hard rules',
    '- Never print, commit, or exfiltrate secrets or tokens.',
    '- Do not push, do not touch git remotes, do not modify GitHub state.',
    '- Stay on the current branch; do not create branches or worktrees.',
    '- Finish with a clean commit summarizing the change.',
  ].join('\n');
}
