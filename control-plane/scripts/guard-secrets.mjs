#!/usr/bin/env node
// Secrets guard: scans tracked repository content for credential-shaped
// strings. Fails closed (non-zero exit) on any match. Used by hosted CI and
// runnable locally via `npm run guard:secrets`.
import { execFileSync } from 'node:child_process';
import { redactPatterns } from '../src/redact.js';

// Files that legitimately contain credential-shaped literals: the redactor's
// own pattern definitions and the tests that exercise it. Everything else is
// scanned.
const ALLOWLIST = [/^control-plane\/src\/redact\.js$/, /^control-plane\/test\//];

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'buffer' })
  .toString()
  .split('\0')
  .filter(Boolean)
  .filter((f) => !ALLOWLIST.some((re) => re.test(f)));

const offenders = [];
for (const file of files) {
  let content;
  try {
    content = await import('node:fs').then((fs) => fs.promises.readFile(file, 'utf8'));
  } catch {
    continue;
  }
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    for (const { name, re } of redactPatterns()) {
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
