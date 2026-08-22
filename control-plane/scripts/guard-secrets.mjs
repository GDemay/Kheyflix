#!/usr/bin/env node
// Secrets guard: scans tracked repository content for credential-shaped
// strings. Fails closed (non-zero exit) on any match. Used by hosted CI and
// runnable locally via `npm run guard:secrets`.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { redactPatterns } from '../src/redact.js';

// Files that legitimately contain credential-shaped literals: the redactor's
// own pattern definitions, this guard's documentation examples, and the tests
// that exercise them. Everything else is scanned.
const ALLOWLIST = [
  /^control-plane\/src\/redact\.js$/,
  /^control-plane\/scripts\/guard-secrets\.mjs$/,
  /^control-plane\/test\//,
];

/**
 * Skip obvious non-secret code shapes on the key-value sweep:
 * - identifier self-assignment (`this.token = token`),
 * - dotted identifier reads (`githubToken: env.GITHUB_TOKEN`),
 * - empty-string placeholders.
 * Markdown backticks around any of these are ignored.
 */
function isBenignKeyValue(line, re) {
  const m = re.exec(line);
  if (!m) return false;
  const raw = m[3] ?? '';
  const cleaned = raw.replace(/[`'"*]+$/, '');
  // Empty-string placeholder ('' / ``).
  if (raw !== cleaned && cleaned === '') return true;
  // Dotted identifier read (env.FOO_BAR) carries no literal secret.
  if (/^[A-Za-z_$][A-Za-z0-9_$.]*\.[A-Za-z0-9_$]*$/.test(cleaned)) return true;
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(cleaned)) return false;
  const keyWords = (m[1] ?? '').split(/[^A-Za-z0-9_$]+/).filter(Boolean);
  const keyTail = keyWords[keyWords.length - 1];
  if (keyTail == null) return true;
  return cleaned.toLowerCase() === keyTail.toLowerCase();
}

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'buffer' })
  .toString()
  .split('\0')
  .filter(Boolean)
  .filter((f) => !ALLOWLIST.some((re) => re.test(f)));

const offenders = [];
for (const file of files) {
  let content;
  try {
    content = fs.readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    for (const { name, re } of redactPatterns()) {
      re.lastIndex = 0;
      if (name === 'key-value' && isBenignKeyValue(lines[i], new RegExp(re.source, 'i'))) continue;
      if (re.test(lines[i])) {
        offenders.push(`${file}:${i + 1}: matched ${name}`);
      }
    }
  }
}

if (offenders.length > 0) {
  console.error('SECRETS GUARD: potential credentials found in repository content:');
  for (const o of offenders) console.error(`  ${o}`);
  process.exit(1);
}
console.log(`secrets guard: clean (${files.length} tracked files scanned)`);
