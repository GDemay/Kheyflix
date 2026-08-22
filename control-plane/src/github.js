// Minimal GitHub REST client used only by the controller process. The token
// stays in this process: it is never placed in Harness env, argv, or logs.
// `fetchImpl` is injectable so controller tests are fully hermetic.

import { redactString } from './redact.js';

export class GitHubError extends Error {
  constructor(status, pathName, body) {
    super(`GitHub ${status} on ${pathName}: ${redactString(typeof body === 'string' ? body : JSON.stringify(body ?? ''))}`);
    this.name = 'GitHubError';
    this.status = status;
  }
}

export class GitHubClient {
  constructor({ token, owner, repo, apiBase = 'https://api.github.com', fetchImpl = fetch, log = () => {} }) {
    this.token = token;
    this.owner = owner;
    this.repo = repo;
    this.apiBase = apiBase.replace(/\/$/, '');
    this.fetchImpl = fetchImpl;
    this.log = log;
  }

  async #request(pathName, { method = 'GET', body, okStatuses = [] } = {}) {
    const url = `${this.apiBase}${pathName}`;
    const res = await this.fetchImpl(url, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok && !okStatuses.includes(res.status)) {
      throw new GitHubError(res.status, pathName, data);
    }
    this.log('debug', `${method} ${pathName} -> ${res.status}`);
    return data;
  }

  #repo(pathName) {
    return `/repos/${this.owner}/${this.repo}${pathName}`;
  }

  async listIssues({ state = 'open' } = {}) {
    const data = await this.#request(`${this.#repo('')}/issues?state=${state}&per_page=100`);
    return (data ?? []).filter((i) => !i.pull_request);
  }

  async getIssue(number) {
    return this.#request(this.#repo(`/issues/${number}`));
  }

  async listClosedIssueNumbers() {
    const issues = await this.listIssues({ state: 'closed' });
    return issues.map((i) => i.number);
  }

  async listBranches({ prefix = '' } = {}) {
    const data = await this.#request(`${this.#repo('/branches')}?per_page=100`);
    return (data ?? []).map((b) => b.name).filter((n) => n.startsWith(prefix));
  }

  async listOpenPRs() {
    return (await this.#request(`${this.#repo('/pulls')}?state=open&per_page=100`)) ?? [];
  }

  isForkPR(pr) {
    return Boolean(pr?.head?.repo && pr.head.repo.full_name !== `${this.owner}/${this.repo}`);
  }

  async getPRForHead(branch) {
    const prs = await this.listOpenPRs();
    return prs.find((pr) => pr.head?.ref === branch) ?? null;
  }

  async createPR({ title, head, base, body }) {
    return this.#request(this.#repo('/pulls'), {
      method: 'POST',
      body: { title, head, base, body, maintainer_can_modify: false },
      // 422 = PR already exists for this head; callers recover by re-listing.
      okStatuses: [],
    });
  }

  async getPR(number) {
    return this.#request(this.#repo(`/pulls/${number}`));
  }

  async closePR(number, comment) {
    if (comment) await this.commentOn(number, comment);
    return this.#request(this.#repo(`/pulls/${number}`), { method: 'PATCH', body: { state: 'closed' } });
  }

  async commentOn(number, body) {
    return this.#request(this.#repo(`/issues/${number}/comments`), { method: 'POST', body: { body } });
  }

  async listReviews(number) {
    return (await this.#request(this.#repo(`/pulls/${number}/reviews`))) ?? [];
  }

  /** Latest decisive review state across reviewers: CHANGES_REQUESTED wins over APPROVED if newer. */
  async reviewDecision(number) {
    const reviews = (await this.listReviews(number)).filter((r) => r.state !== 'PENDING' && r.state !== 'COMMENTED');
    if (reviews.length === 0) return 'NONE';
    const latestByUser = new Map();
    for (const r of reviews) latestByUser.set(r.user?.login, r);
    const decisions = [...latestByUser.values()];
    if (decisions.some((r) => r.state === 'CHANGES_REQUESTED')) return 'CHANGES_REQUESTED';
    if (decisions.some((r) => r.state === 'APPROVED')) return 'APPROVED';
    return 'NONE';
  }

  async mergePR(number, { mergeMethod = 'squash' } = {}) {
    return this.#request(this.#repo(`/pulls/${number}/merge`), {
      method: 'PUT',
      body: { merge_method: mergeMethod, commit_title: `merge PR #${number} (${mergeMethod})` },
    });
  }

  /** Combined CI view for a ref: check runs + commit statuses. */
  async ciSummary(ref) {
    const [checks, status] = await Promise.all([
      this.#request(`${this.#repo(`/commits/${ref}/check-runs`)}?per_page=100`),
      this.#request(this.#repo(`/commits/${ref}/status`)),
    ]);
    const runs = checks?.check_runs ?? [];
    const names = (state) =>
      [
        ...runs.filter((r) => r.status === 'completed' && r.conclusion === state).map((r) => r.name),
        ...((status?.statuses ?? []).filter((s) => s.state === (state === 'failure' ? 'error' : state)).map((s) => s.context)),
      ].filter(Boolean);
    const pending = [
      ...runs.filter((r) => r.status !== 'completed').map((r) => r.name),
      ...((status?.statuses ?? []).filter((s) => s.state === 'pending').map((s) => s.context)),
    ];
    const failed = [...names('failure'), ...names('cancelled'), ...names('timed_out'), ...names('startup_failure')];
    const succeeded = [...names('success'), ...names('skipped')];
    let state;
    if (failed.length > 0) state = 'failure';
    else if (pending.length > 0) state = 'pending';
    else if (succeeded.length > 0) state = 'success';
    else state = 'none';
    return {
      state,
      failing: failed,
      pending,
      succeeded,
      total: runs.length + (status?.statuses?.length ?? 0),
    };
  }
}
