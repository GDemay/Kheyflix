// Lifecycle orchestrator: claim → Ox run → controller push/PR → hosted CI →
// manager review check → Ox repair → merge → post-merge main CI → next issue.
//
// The machine is resumable: every `once()` advances the active run by one
// step and parks on remote waits (CI pending, review pending, backoff), so an
// external scheduler (launchd every 5 minutes) makes incremental progress and
// restarts are always safe.

import path from 'node:path';
import { acquireLock } from './lock.js';
import { selectIssue, parseDependencies, priorityOf } from './issues.js';
import { branchForIssue, slugify } from './branches.js';
import * as gitops from './gitops.js';
import { preflight as harnessPreflight, runHarness, classifyFailure, buildTaskPrompt } from './harness.js';
import { reconcile } from './recover.js';
import { controllerEnv } from './config.js';
import { tail } from './log.js';

const POSTMERGE_SUFFIX = '-postmerge';

export class Controller {
  constructor({ config, store, gh, logger, clock = {}, harness = {} }) {
    this.config = config;
    this.store = store;
    this.gh = gh;
    this.logger = logger;
    this.now = clock.now ?? (() => Date.now());
    this.sleep = clock.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.harness = {
      preflight: harness.preflight ?? harnessPreflight,
      run: harness.run ?? runHarness,
      classify: harness.classify ?? classifyFailure,
      prompt: harness.prompt ?? buildTaskPrompt,
    };
  }

  /** Fail-closed provider/model verification. Throws PreflightError on mismatch. */
  preflightHarness() {
    const cfg = this.config;
    return this.harness.preflight({
      dshHome: cfg.dshHome,
      profile: cfg.harnessProfile,
      harnessCmd: cfg.harnessCmd,
    });
  }

  /** Observe-only: resolve model identity and show the single selected issue. */
  async dryRun({ fixtureIssues, fixtureClosed } = {}) {
    const identity = this.preflightHarness();
    let issues;
    let closed;
    if (fixtureIssues) {
      issues = fixtureIssues;
      closed = fixtureClosed ?? [];
    } else {
      issues = await this.gh.listIssues({ state: 'open' });
      closed = await this.gh.listClosedIssueNumbers();
    }
    const selected = selectIssue(issues, { closedIssueNumbers: closed, cfg: this.config });
    return {
      provider: identity.provider,
      model: identity.model,
      profile: identity.profile,
      considered: issues.length,
      selected: selected
        ? {
            number: selected.number,
            title: selected.title,
            priority: priorityOf(selected, this.config),
            dependencies: parseDependencies(selected.body),
            branch: branchForIssue(selected.number, selected.title, { prefix: this.config.branchPrefix }),
          }
        : null,
    };
  }

  /** Advance the delivery lifecycle one step (or claim + start the next issue). */
  async once() {
    const cfg = this.config;
    const lock = acquireLock(cfg.stateDir, { staleMs: cfg.lockStaleMs, now: this.now });
    try {
      await reconcile({ store: this.store, gh: this.gh, config: cfg, logger: this.logger, now: this.now });
      let run = this.store.getActiveRun();
      if (!run) {
        const issue = await this.#selectNextIssue();
        if (!issue) return { action: 'idle' };
        run =
          this.store.claimIssue({
            issueNumber: issue.number,
            issueTitle: issue.title,
            slug: slugify(issue.title),
            branch: branchForIssue(issue.number, issue.title, { prefix: cfg.branchPrefix }),
          }) ?? this.store.getActiveRun();
        if (!run) return { action: 'idle' };
        this.store.setMeta(`issue-body-${issue.number}`, issue.body ?? '');
        this.logger.info('claimed issue', { issue: issue.number, branch: run.branch });
      }
      return await this.#advance(run);
    } finally {
      lock.release();
    }
  }

  async #selectNextIssue() {
    const cfg = this.config;
    const [issues, closed] = await Promise.all([
      this.gh.listIssues({ state: 'open' }),
      this.gh.listClosedIssueNumbers(),
    ]);
    // Issues that already have a run row are either the active run
    // (single-flight) or terminal — terminal deliveries need manager action,
    // never an automatic retry under the same branch.
    const existingBranches = new Set(this.store.listRuns().map((r) => r.branch));
    const candidates = issues.filter(
      (i) => !existingBranches.has(branchForIssue(i.number, i.title, { prefix: cfg.branchPrefix })),
    );
    return selectIssue(candidates, { closedIssueNumbers: closed, cfg });
  }

  async #advance(run) {
    switch (run.state) {
      case 'claimed':
        return this.#startAttempt(run);
      case 'ox_running':
        // Previous holder of the lock died mid-run; the child is gone.
        return this.#failOrRetry(run, 'interrupted', 'dispatcher restarted while harness was running');
      case 'pushing':
        return this.#pushAndOpenPR(run);
      case 'pr_open':
      case 'ci_pending':
        return this.#checkCi(run);
      case 'ci_failed':
        return this.#repair(run, 'ci');
      case 'review_pending':
        return this.#checkReview(run);
      case 'review_changes':
        return this.#repair(run, 'review');
      case 'merging':
        return this.#merge(run);
      case 'post_merge_pending':
        return this.#checkPostMerge(run);
      default:
        return { action: 'noop', state: run.state };
    }
  }

  // --- Ox runs -------------------------------------------------------------

  async #startAttempt(run) {
    if (run.next_attempt_at && this.now() < run.next_attempt_at) {
      return { action: 'parked', reason: 'backoff', until: run.next_attempt_at };
    }
    return this.#runOx(run, { mode: 'implement' });
  }

  async #worktreeFor(run) {
    const cfg = this.config;
    await gitops.ensureIdentity(cfg.repoPath, { name: cfg.controllerGitName, email: cfg.controllerGitEmail });
    await gitops.git(['fetch', 'origin', '--prune'], { cwd: cfg.repoPath }).catch(() => {});
    const dir = path.join(cfg.worktreeDir, run.branch.replace(/\//g, '__'));
    const { dir: wt } = await gitops.createWorktree({
      repoPath: cfg.repoPath,
      dir,
      branch: run.branch,
      baseRef: `origin/${cfg.baseBranch}`,
    });
    return wt;
  }

  async #runOx(run, { mode, evidence = '' } = {}) {
    const cfg = this.config;
    const dir = await this.#worktreeFor(run);
    const issue = {
      number: run.issue_number,
      title: run.issue_title,
      body: this.store.getMeta(`issue-body-${run.issue_number}`) ?? '',
    };
    const task = this.harness.prompt({ mode, issue, repoPath: cfg.repoPath, evidence });
    const attemptNo = (mode === 'repair' ? run.repair_attempts : run.attempts) + 1;
    this.store.setState(run.id, 'ox_running', { detail: `${mode} attempt ${attemptNo}` });
    const result = await this.harness.run({
      harnessCmd: cfg.harnessCmd,
      profile: cfg.harnessProfile,
      task,
      cwd: dir,
      timeoutMs: cfg.harnessTimeoutMs,
      transcriptPath: path.join(cfg.logDir, `run-${run.id}-${mode}-a${attemptNo}.log`),
      childEnvExtra: controllerEnv(cfg),
      now: this.now,
    });
    this.store.heartbeat(run.id);
    const kind = this.harness.classify(result);
    this.logger.info('harness attempt finished', { run: run.id, kind, durationMs: result.durationMs });

    if (kind === 'success') {
      const commits = await gitops.commitCount(dir, `origin/${cfg.baseBranch}`).catch(() => 0);
      if (commits > 0) {
        const headSha = (await gitops.headSha(dir)).trim();
        this.store.setState(run.id, 'pushing', {
          headSha,
          detail: `${mode} produced ${commits} commit(s)`,
        });
        return { action: 'advanced', state: 'pushing' };
      }
      return this.#failOrRetry(run, 'task_failed', 'harness completed without commits');
    }
    if (kind === 'model_outage') {
      const updated = this.store.incrementOutageAttempts(run.id);
      if (updated.outage_attempts >= cfg.modelOutageMaxAttempts) {
        this.store.setState(run.id, 'failed', {
          lastError: `model outage persisted after ${updated.outage_attempts} attempts`,
        });
        return { action: 'failed', reason: 'model_outage' };
      }
      const backoff = cfg.modelOutageBackoffMs * 2 ** (updated.outage_attempts - 1);
      this.store.setState(run.id, 'claimed', {
        detail: `model outage; backing off ${Math.round(backoff / 1000)}s`,
        lastError: tail(result.stderrTail, 400),
        nextAttemptAt: this.now() + backoff,
      });
      return { action: 'parked', reason: 'model_outage_backoff' };
    }
    return this.#failOrRetry(
      run,
      kind,
      kind === 'timeout' ? `harness timed out after ${cfg.harnessTimeoutMs}ms` : tail(result.stderrTail, 400),
    );
  }

  #failOrRetry(run, kind, message) {
    const updated = this.store.incrementAttempts(run.id);
    if (updated.attempts >= this.config.harnessMaxAttempts) {
      this.store.setState(run.id, 'failed', { lastError: `${kind}: ${message}` });
      return { action: 'failed', reason: kind };
    }
    this.store.setState(run.id, 'claimed', {
      lastError: `${kind}: ${message}`,
      nextAttemptAt: this.now() + 30_000,
      detail: `${kind}; retry scheduled`,
    });
    return { action: 'parked', reason: `${kind}_retry` };
  }

  // --- Push / PR -----------------------------------------------------------

  async #pushAndOpenPR(run) {
    const cfg = this.config;
    const dir = await this.#worktreeFor(run);
    const commits = await gitops.commitCount(dir, `origin/${cfg.baseBranch}`);
    if (commits === 0) {
      return this.#failOrRetry(run, 'task_failed', 'branch has no commits to deliver');
    }
    await gitops.pushBranch({
      repoPath: cfg.repoPath,
      branch: run.branch,
      remoteUrl: cfg.pushRemoteUrl,
      tokenEnvName: cfg.pushTokenEnv,
    });
    const headSha = (await gitops.headSha(dir)).trim();

    // Duplicate-PR prevention: DB record first, then GitHub lookup, then
    // create guarded against the race (422 → adopt the winner).
    let pr = run.pr_number ? await this.gh.getPR(run.pr_number).catch(() => null) : null;
    if (!pr) pr = await this.gh.getPRForHead(run.branch);
    if (!pr) {
      try {
        pr = await this.gh.createPR({
          title: `issue #${run.issue_number}: ${run.issue_title}`,
          head: run.branch,
          base: cfg.baseBranch,
          body: [
            `Closes #${run.issue_number}.`,
            '',
            'Authored by Ox Alpha via DeepSeek Harness; delivered by the Kheyflix control plane.',
            `Branch: \`${run.branch}\``,
          ].join('\n'),
        });
      } catch (err) {
        if (err?.status !== 422) throw err;
        pr = await this.gh.getPRForHead(run.branch);
        if (!pr) throw err;
      }
    }
    if (pr.state === 'closed') {
      if (pr.merged) {
        this.store.setState(run.id, 'completed', { detail: `PR #${pr.number} already merged` });
        return { action: 'completed' };
      }
      this.store.setState(run.id, 'failed', { lastError: `PR #${pr.number} was closed without merge` });
      return { action: 'failed', reason: 'pr_closed' };
    }
    this.store.setState(run.id, 'ci_pending', {
      prNumber: pr.number,
      prUrl: pr.html_url,
      headSha,
      detail: `pushed ${headSha.slice(0, 7)}; PR #${pr.number}`,
    });
    return { action: 'advanced', state: 'ci_pending', pr: pr.number };
  }

  // --- Hosted CI -----------------------------------------------------------

  async #checkCi(run) {
    const cfg = this.config;
    const ref = run.head_sha ?? `${run.branch}`;
    const summary = await this.gh.ciSummary(ref);
    if (summary.state === 'failure') {
      const evidence = [
        `Hosted CI failed for ${ref.slice(0, 7)}.`,
        `Failing checks: ${summary.failing.join(', ') || '(unknown)'}`,
        'Fix these failures on the current branch and commit.',
      ].join('\n');
      this.store.setMeta(`evidence-ci-${run.id}`, evidence);
      this.store.setState(run.id, 'ci_failed', { detail: `CI failing: ${summary.failing.join(', ')}` });
      return { action: 'advanced', state: 'ci_failed' };
    }
    if (summary.state === 'pending') {
      const deadline = run.state_entered_at + cfg.ciTimeoutMs;
      if (this.now() > deadline) {
        this.store.setMeta(`evidence-ci-${run.id}`, `Hosted CI timed out after ${cfg.ciTimeoutMs}ms for ${ref.slice(0, 7)}.`);
        this.store.setState(run.id, 'ci_failed', { detail: 'CI timed out' });
        return { action: 'advanced', state: 'ci_failed', reason: 'timeout' };
      }
      return { action: 'parked', reason: 'ci_pending' };
    }
    // 'success' or 'none' (bootstrap repos may have no checks yet).
    this.store.setState(run.id, 'review_pending', {
      detail: summary.state === 'none' ? 'CI green (no checks configured)' : 'CI green',
    });
    return { action: 'advanced', state: 'review_pending' };
  }

  // --- Manager review ------------------------------------------------------

  async #checkReview(run) {
    const cfg = this.config;
    const decision = await this.gh.reviewDecision(run.pr_number);
    if (decision === 'APPROVED') {
      this.store.setState(run.id, 'merging', { detail: 'manager review approved' });
      return { action: 'advanced', state: 'merging' };
    }
    if (decision === 'CHANGES_REQUESTED') {
      const reviews = await this.gh.listReviews(run.pr_number);
      const latest = [...reviews].reverse().find((r) => r.state === 'CHANGES_REQUESTED');
      const evidence = [
        `Manager requested changes on PR #${run.pr_number}.`,
        latest?.body ? `Review comments:\n${tail(latest.body, 2000)}` : '(no review body)',
        'Address every comment on the current branch and commit.',
      ].join('\n');
      this.store.setMeta(`evidence-review-${run.id}`, evidence);
      this.store.setState(run.id, 'review_changes', { detail: 'changes requested by manager' });
      return { action: 'advanced', state: 'review_changes' };
    }
    const deadline = run.state_entered_at + cfg.reviewTimeoutMs;
    if (this.now() > deadline) {
      this.store.setState(run.id, 'failed', { lastError: 'manager review timeout' });
      return { action: 'failed', reason: 'review_timeout' };
    }
    return { action: 'parked', reason: 'review_pending' };
  }

  // --- Repair --------------------------------------------------------------

  async #repair(run, source) {
    const cfg = this.config;
    const updated = this.store.incrementRepairAttempts(run.id);
    if (updated.repair_attempts > cfg.repairMaxAttempts) {
      this.store.setState(run.id, 'failed', { lastError: `${source} repair budget exhausted` });
      return { action: 'failed', reason: 'repair_budget' };
    }
    const evidence = this.store.getMeta(`evidence-${source}-${run.id}`) ?? '';
    return this.#runOx(run, { mode: 'repair', evidence });
  }

  // --- Merge & post-merge --------------------------------------------------

  async #merge(run) {
    const cfg = this.config;
    const res = await this.gh.mergePR(run.pr_number, { mergeMethod: cfg.mergeMethod });
    const mergeSha = res?.sha ?? null;
    this.store.setState(run.id, 'post_merge_pending', { mergeSha, detail: `merged PR #${run.pr_number}` });
    return { action: 'advanced', state: 'post_merge_pending' };
  }

  async #checkPostMerge(run) {
    const cfg = this.config;
    const summary = await this.gh.ciSummary(run.merge_sha);
    if (summary.state !== 'failure') {
      this.store.setState(run.id, 'completed', {
        detail: summary.state === 'none' ? 'merged; no post-merge checks' : 'merged; post-merge CI green',
      });
      return { action: 'completed' };
    }

    if (run.branch.endsWith(POSTMERGE_SUFFIX)) {
      // Hotfix itself regressed main: contain by reverting the hotfix merge
      // and the original merge, then park for manager attention.
      await this.#containRegression(run);
      return { action: 'reverted' };
    }

    // Original delivery regressed main: open exactly one deterministic hotfix
    // run (branch = <branch>-postmerge) carrying focused CI evidence.
    const evidence = [
      `Post-merge regression on main at ${String(run.merge_sha).slice(0, 7)}.`,
      `Failing checks: ${summary.failing.join(', ') || '(unknown)'}`,
      `Original PR: #${run.pr_number}. Produce a minimal fix.`,
    ].join('\n');
    const hotfixBranch = `${run.branch}${POSTMERGE_SUFFIX}`;
    const existing = this.store.getRunByBranch(hotfixBranch);
    if (existing && !['completed', 'failed', 'reverted'].includes(existing.state)) {
      return { action: 'parked', reason: 'hotfix_in_progress' };
    }
    this.store.setState(run.id, 'completed', {
      detail: `merged; post-merge regression detected; hotfix run on ${hotfixBranch}`,
    });
    const hotfix = this.store.adoptRun({
      issueNumber: run.issue_number,
      issueTitle: run.issue_title,
      slug: `${run.slug}${POSTMERGE_SUFFIX}`,
      branch: hotfixBranch,
      state: 'claimed',
      prNumber: null,
      prUrl: null,
      headSha: null,
    });
    if (!hotfix) return { action: 'parked', reason: 'hotfix_deferred_single_flight' };
    this.store.setMeta(`issue-body-${run.issue_number}`, this.store.getMeta(`issue-body-${run.issue_number}`) ?? '');
    this.store.setMeta(`evidence-ci-${hotfix.id}`, evidence);
    this.logger.warn('post-merge regression; hotfix opened', { issue: run.issue_number, hotfix: hotfix.id });
    return { action: 'hotfix_opened', hotfixRun: hotfix.id };
  }

  async #containRegression(run) {
    const cfg = this.config;
    const shas = [run.merge_sha].filter(Boolean);
    const original = this.store
      .listRuns()
      .find((r) => r.issue_number === run.issue_number && !r.branch.endsWith(POSTMERGE_SUFFIX) && r.merge_sha);
    if (original) shas.push(original.merge_sha);
    for (const sha of shas) {
      try {
        await gitops.revertOnMain({
          repoPath: cfg.repoPath,
          mergeSha: sha,
          remoteUrl: cfg.pushRemoteUrl,
          tokenEnvName: cfg.pushTokenEnv,
          tmpDir: cfg.worktreeDir,
          message: `revert ${sha.slice(0, 7)}: contain post-merge regression for issue #${run.issue_number}`,
        });
      } catch (err) {
        // One failed revert must not block the others; the manager sees the
        // remaining damage on the PR comment below.
        this.logger.error('revert failed during containment', { sha, error: String(err.message) });
      }
    }
    this.store.setState(run.id, 'reverted', { detail: 'post-merge regression contained via revert' });
    if (run.pr_number) {
      await this.gh
        .commentOn(run.pr_number, 'Post-merge regression detected; merge reverted by the control plane.')
        .catch(() => {});
    }
  }

  // --- Daemon --------------------------------------------------------------

  /** Loop until no eligible work remains or the step budget is exhausted. */
  async run({ maxSteps = 100, pollMs = 15_000 } = {}) {
    for (let step = 0; step < maxSteps; step++) {
      const result = await this.once();
      if (result.action === 'idle') return { steps: step + 1, stopped: 'idle' };
      if (result.action === 'parked') await this.sleep(pollMs);
    }
    return { steps: maxSteps, stopped: 'step_budget' };
  }
}
