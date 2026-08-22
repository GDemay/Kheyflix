// Restart/GitHub-state recovery. The database and GitHub are both sources of
// truth; reconciliation converges on: one canonical PR per issue, one run row
// per agent branch, no duplicate branches/PRs/runs. Fork PRs are never touched.

import { issueNumberFromBranch, isAgentBranch } from './branches.js';
import { ACTIVE_STATES } from './config.js';

export async function reconcile({ store, gh, config, logger, now = () => Date.now() }) {
  const summary = { adoptedPRs: 0, adoptedBranches: 0, closedDuplicates: [], requeued: [], failed: [], ignoredForkPRs: 0, completedMerged: [], skipped: [] };

  const remoteBranches = new Set(await gh.listBranches({ prefix: config.branchPrefix }));
  const openPRs = await gh.listOpenPRs();

  // Group same-repo PRs whose head matches our deterministic branch pattern.
  const prsByIssue = new Map();
  for (const pr of openPRs) {
    const head = pr.head?.ref;
    if (!isAgentBranch(head, { prefix: config.branchPrefix })) continue;
    if (gh.isForkPR(pr)) {
      summary.ignoredForkPRs += 1;
      continue; // untrusted: never adopted, never closed
    }
    const issueNumber = issueNumberFromBranch(head, { prefix: config.branchPrefix });
    if (!prsByIssue.has(issueNumber)) prsByIssue.set(issueNumber, []);
    prsByIssue.get(issueNumber).push(pr);
  }

  // One canonical PR per issue (lowest number wins); close duplicates.
  for (const [issueNumber, prs] of prsByIssue) {
    prs.sort((a, b) => a.number - b.number);
    const canonical = prs[0];
    for (const dup of prs.slice(1)) {
      await gh.closePR(dup.number, 'Duplicate PR for this issue; closed by the control plane (canonical: #' + canonical.number + ').');
      summary.closedDuplicates.push(dup.number);
      logger.warn('closed duplicate PR', { pr: dup.number, issue: issueNumber });
    }
    const branch = canonical.head.ref;
    const existing = store.getRunByBranch(branch);
    const state = existing && ACTIVE_STATES.includes(existing.state) ? existing.state : 'pr_open';
    store.adoptRun({
      issueNumber,
      issueTitle: canonical.title.replace(/^issue #\d+:\s*/, '') || `issue #${issueNumber}`,
      slug: branch.slice(config.branchPrefix.length + String(issueNumber).length + 1),
      branch,
      state,
      prNumber: canonical.number,
      prUrl: canonical.html_url,
      headSha: canonical.head?.sha ?? null,
    });
    summary.adoptedPRs += 1;
  }

  // Agent branches without an open PR: make sure a run row exists so the
  // lifecycle can push/PR or requeue deterministically.
  for (const branch of remoteBranches) {
    if (store.getRunByBranch(branch)) continue;
    const issueNumber = issueNumberFromBranch(branch, { prefix: config.branchPrefix });
    if (issueNumber == null || prsByIssue.has(issueNumber)) continue;
    const adopted = store.adoptRun({
      issueNumber,
      issueTitle: `issue #${issueNumber}`,
      slug: branch.slice(config.branchPrefix.length + String(issueNumber).length + 1),
      branch,
      state: 'pushing',
      prNumber: null,
      prUrl: null,
      headSha: null,
    });
    if (adopted) summary.adoptedBranches += 1;
    else summary.skipped.push(branch);
  }

  // Local active runs that no longer exist on GitHub, and PRs merged/closed
  // out-of-band.
  for (const run of store.listRuns()) {
    if (!run.active) continue;
    // The controller itself drives merging/post-merge states; out-of-band
    // merge detection only applies to earlier phases.
    if (run.state === 'merging' || run.state === 'post_merge_pending') continue;
    const pr = run.pr_number ? await gh.getPR(run.pr_number).catch(() => null) : null;
    if (pr?.merged) {
      store.setState(run.id, 'completed', { detail: `PR #${pr.number} merged (observed during recovery)` });
      summary.completedMerged.push(run.id);
      continue;
    }
    if (pr && pr.state === 'closed') {
      store.setState(run.id, 'failed', { lastError: `PR #${pr.number} was closed without merge` });
      summary.failed.push(run.id);
      continue;
    }
    if (pr) continue;
    if (!remoteBranches.has(run.branch)) {
      const stale = now() - run.heartbeat_at > config.heartbeatStaleMs;
      if (!stale) continue; // possibly in-flight elsewhere; leave untouched
      if (run.attempts < config.harnessMaxAttempts && run.state !== 'ox_running') {
        store.setState(run.id, 'claimed', { detail: 'stale recovery: branch missing, requeued' });
        summary.requeued.push(run.id);
      } else {
        store.setState(run.id, 'failed', { lastError: 'stale recovery: branch missing after max attempts' });
        summary.failed.push(run.id);
      }
    }
  }

  logger.info('reconcile complete', { ...summary });
  return summary;
}
