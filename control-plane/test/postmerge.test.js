// Post-merge regression handling: deterministic hotfix branch, and revert
// containment when the hotfix also regresses main.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeController, drive, driveAuto, makeMergeShaFactory, g } from './helpers.js';

async function runToPostMerge(h) {
  // Drive with gates cleared, stopping right after the merge lands.
  const issueNumber = h.gh.issues[0].number;
  h.gh.mergeShaFactory = makeMergeShaFactory(h.fx.repoPath);
  for (let i = 0; i < 40; i++) {
    const active = h.store.getActiveRun();
    if (active) {
      if (active.state === 'ci_pending' && active.head_sha) h.gh.setCi(active.head_sha, 'success');
      if (active.state === 'review_pending') h.gh.approve(active.pr_number);
    }
    const r = await h.controller.once();
    if (r.action === 'advanced' && r.state === 'post_merge_pending') break;
    if (['completed', 'failed', 'reverted', 'idle', 'noop'].includes(r.action)) break;
  }
  return h.store.getRunByIssue(issueNumber);
}

test('post-merge regression on main opens exactly one deterministic hotfix run', async (t) => {
  const h = await makeController({
    issues: [{ number: 71, title: 'regressing change', labels: [{ name: 'agent:ready' }] }],
    stubBehavior: 'success',
  });
  t.after(h.cleanup);

  const run = await runToPostMerge(h);
  assert.ok(run.merge_sha);
  h.gh.setCi(run.merge_sha, 'failure'); // main is red after the merge

  const r = await h.controller.once();
  assert.equal(r.action, 'hotfix_opened');

  // Original run completed; the hotfix owns recovery on -postmerge branch.
  // (getRunByIssue now returns the newer hotfix row, so check by branch.)
  assert.equal(h.store.getRunByBranch('agent/issue-71-regressing-change').state, 'completed');
  const hotfix = h.store.getRunByBranch('agent/issue-71-regressing-change-postmerge');
  assert.ok(hotfix, 'hotfix run exists with deterministic branch');
  assert.equal(hotfix.state, 'claimed');
  assert.match(h.store.getMeta(`evidence-ci-${hotfix.id}`) ?? '', /Post-merge regression on main/);

  // The hotfix itself flows through the full machine to completion.
  await driveAuto({ ...h });
  assert.equal(h.store.getRunByBranch('agent/issue-71-regressing-change-postmerge').state, 'completed');
  assert.equal(h.gh.calls.createPR, 2, 'one PR for the delivery, one for the hotfix');
});

test('a regressing hotfix is contained by reverting both merges on main', async (t) => {
  const h = await makeController({
    issues: [{ number: 72, title: 'double trouble', labels: [{ name: 'agent:ready' }] }],
    stubBehavior: 'success',
  });
  t.after(h.cleanup);

  const original = await runToPostMerge(h);
  h.gh.setCi(original.merge_sha, 'failure');
  await h.controller.once(); // open hotfix

  // Drive the hotfix manually to its post-merge check.
  h.gh.mergeShaFactory = makeMergeShaFactory(h.fx.repoPath);
  let hotfix = h.store.getRunByBranch('agent/issue-72-double-trouble-postmerge');
  for (let i = 0; i < 10; i++) {
    const active = h.store.getActiveRun();
    if (!active || active.id !== hotfix.id) break;
    if (active.state === 'ci_pending') h.gh.setCi(active.head_sha, 'success');
    if (active.state === 'review_pending') h.gh.approve(active.pr_number);
    const r = await h.controller.once();
    if (r.action === 'advanced' && r.state === 'post_merge_pending') break;
  }
  hotfix = h.store.getRunByBranch('agent/issue-72-double-trouble-postmerge');
  assert.equal(hotfix.state, 'post_merge_pending');

  // The hotfix merge ALSO regresses main → containment reverts both merges.
  h.gh.setCi(hotfix.merge_sha, 'failure');
  const r = await h.controller.once();
  assert.equal(r.action, 'reverted');
  assert.equal(h.store.getRunByBranch('agent/issue-72-double-trouble-postmerge').state, 'reverted');

  // Bare main actually moved backwards: revert commits were pushed.
  const log = await g(['log', 'origin/main', '--oneline', '-5'], { cwd: h.fx.repoPath });
  const revertCount = (await g(['log', 'origin/main', '--oneline'], { cwd: h.fx.repoPath }))
    .split('\n')
    .filter((l) => /revert .*contain post-merge regression/.test(l)).length;
  assert.ok(revertCount >= 1, `expected revert commits on main, got: ${log}`);
  assert.ok(
    h.gh.comments.some((c) => /merge reverted by the control plane/.test(c.body)),
    'manager was notified on the PR',
  );
});
