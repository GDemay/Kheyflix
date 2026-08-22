// Redaction guarantees for logs and transcripts (docs/secrets.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { redactString, redactValue } from '../src/redact.js';
import { createLogger } from '../src/log.js';

test('credential-shaped strings never survive redaction', () => {
  const cases = [
    ['token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456 in log', /ghp_/, '<redacted>'],
    ['github_pat_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456 leaked', /github_pat_/, '<redacted>'],
    ['sk-or-abcdefghijklmnopqrstuv key', /sk-or-/, '<redacted>'],
    ['Authorization: Bearer abc.def.ghi', /Bearer abc/, 'Bearer <redacted>'],
    ['https://user:hunter2@github.com/x', /hunter2/, '<redacted>@'],
    ['x-access-token:ghs_sometokenhere@github.com', /ghs_sometokenhere/, '<redacted>'],
    ['api_key = supersecretvalue', /supersecretvalue/, '<redacted>'],
    ['"password": "hunter2"', /hunter2/, '<redacted>'],
  ];
  for (const [input, mustNotMatch, expectedPart] of cases) {
    const out = redactString(input);
    assert.doesNotMatch(out, mustNotMatch, `input: ${input}`);
    assert.ok(out.includes(expectedPart), `${input} -> ${out}`);
  }
});

test('registered exact secrets are scrubbed even from odd embeddings', () => {
  const token = 'Kf9wJZq7Xr2Ns4Lm8QvT1Bc5Dy0Hg3Ap';
  const out = redactString(`push failed for https://x-access-token:${token}@github.com/o/r.git`, [token]);
  assert.doesNotMatch(out, new RegExp(token));
});

test('redactValue walks objects and arrays', () => {
  const out = redactValue({ a: 'password: topsecret', b: ['ok', 'Bearer xyz'], c: { d: 1 } });
  assert.equal(out.a, 'password: <redacted>');
  assert.equal(out.b[1], 'Bearer <redacted>');
  assert.deepEqual(out.c, { d: 1 });
});

test('logger writes only redacted JSONL to disk and console', async (t) => {
  const base = fs.mkdtempSync('kheyflix-redact-');
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const secret = 'ghp_ZZZZZZZZZZZZZZZZZZZZZZZZZZZZ12';
  const dir = path.join(base, 'logs');
  const lines = [];
  const logger = createLogger({ dir, extraSecrets: [secret], stream: { write(s) { lines.push(s); } } });
  logger.info('pushed with token ' + secret, { url: `https://x-access-token:${secret}@github.com/o/r`, ok: true });
  logger.close();

  const file = fs.readFileSync(path.join(dir, 'controller.log'), 'utf8');
  for (const sink of [file, lines.join('')]) {
    assert.doesNotMatch(sink, new RegExp(secret));
    assert.match(sink, /<redacted>/);
    assert.match(sink, /"msg":"pushed with token <redacted>"/);
  }
});
