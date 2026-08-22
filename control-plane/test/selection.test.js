// Issue ordering, dependency gating, trust anchoring, and dry-run evidence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDependencies, selectIssue, priorityOf } from '../src/issues.js';
import { branchForIssue, slugify } from '../src/branches.js';
import { makeController } from './helpers.js';
import { RESOLVED_MODEL } from '../src/config.js';

const issue = (n, over = {}) => ({
  number: n,
  title: `issue ${n}`,
  body: '',
  labels: [{ name: 'agent:ready' }],
  state: 'open',
  created_at: `2026-01-0${(n % 9) + 1}T00:00:00Z`,
  user: { login: 'manager' },
  ...over,
});

test('dependencies parsing handles #refs, commas, and multiple lines', () => {
  assert.deepEqual(parseDependencies('depends-on: #12, #15\ndepends_on: #20'), [12, 15, 20]);
  assert.deepEqual(parseDependencies('Depends-On: #7'), [7]);
  assert.deepEqual(parseDependencies('no deps here'), []);
});

test('ordering: highest priority wins; ties break by oldest then lowest number', async () => {
  const issues = [
    issue(3, { title: 'p2 task', labels: [{ name: 'agent:ready' }, { name: 'agent:priority:2' }] }),
    issue(1, { title: 'p0 older', labels: [{ name: 'agent:ready' }, { name: 'agent:priority:0' }], created_at: '2026-01-02T00:00:00Z' }),
    issue(2, { title: 'p0 newer', labels: [{ name: 'agent:ready' }, { name: 'agent:priority:0' }], created_at: '2026-01-03T00:00:00Z' }),
    issue(4, { title: 'default' }),
  ];
  const selected = selectIssue(issues, {});
  assert.equal(selected.number, 1); // both P0; oldest first
  assert.equal(priorityOf(issue(5, { labels: [] })), 5);
});

test('unlabeled, held, PRs, closed, and untrusted-author issues are never executable', async () => {
  const issues = [
    issue(10, { labels: [] }), // no agent:ready
    issue(11, { labels: [{ name: 'agent:hold' }] }),
    issue(12, { pull_request: {} , labels: [{ name: 'agent:ready' }] }),
    issue(13, { state: 'closed' }),
    issue(14, { user: { login: 'randompasserby' } }),
  ];
  assert.equal(selectIssue(issues, { cfg: { trustedLogins: ['manager'] } }), null);
  // Without the author restriction the labeled open human issue is eligible:
  assert.equal(selectIssue(issues, {}).number, 14);
});

test('dependency gating: blocked until all declared dependencies are closed', async () => {
  const high = issue(21, {
    title: 'blocked but urgent',
    labels: [{ name: 'agent:ready' }, { name: 'agent:priority:0' }],
    body: 'depends-on: #22',
  });
  const low = issue(23, { title: 'independent', labels: [{ name: 'agent:ready' }, { name: 'agent:priority:3' }] });
  assert.equal(selectIssue([high, low], { closedIssueNumbers: [] }).number, 23);
  assert.equal(selectIssue([high, low], { closedIssueNumbers: [22] }).number, 21);
});

test('deterministic branch naming', () => {
  assert.equal(slugify('[AUTONOMY] Bootstrap control plane!'), 'autonomy-bootstrap-control-plane');
  assert.equal(branchForIssue(7, '[AUTONOMY] Bootstrap control plane'), 'agent/issue-7-autonomy-bootstrap-control-plane');
  const longTitle = 'A very long title that goes on and on and should be truncated somewhere';
  assert.match(branchForIssue(12, longTitle), /^agent\/issue-12-a-very-long-title/);
  assert.ok(branchForIssue(12, longTitle).length <= 'agent/issue-12-'.length + 40 + 1);
  assert.equal(branchForIssue(12, longTitle), branchForIssue(12, `${longTitle} (identical)`), 'slug input beyond the cap cannot change the branch');
});

test('dry-run resolves exactly one eligible issue with Ox Alpha as only model', async (t) => {
  const h = await makeController({
    issues: [
      issue(30, { title: 'not ready', labels: [] }),
      issue(31, { title: 'dependent', body: 'depends-on: #99' }),
      issue(32, { title: 'first ready task', created_at: '2026-01-02T00:00:00Z' }),
      issue(33, { title: 'second ready task', created_at: '2026-01-05T00:00:00Z' }),
    ],
    closedIssueNumbers: [],
  });
  t.after(h.cleanup);
  const result = await h.controller.dryRun({ fixtureIssues: h.gh.issues, fixtureClosed: [] });
  assert.equal(result.provider, 'openrouter-ox');
  assert.equal(result.model, 'stealth/ox-alpha');
  assert.equal(`${result.provider}/${result.model}`, RESOLVED_MODEL);
  assert.equal(result.selected.number, 32, 'exactly one issue selected: highest-priority eligible');
  assert.equal(result.selected.branch, 'agent/issue-32-first-ready-task');
});
