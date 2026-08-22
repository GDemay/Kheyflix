// Issue selection: trust is anchored exclusively on manager-applied labels.
// Unlabeled issues, held issues, untrusted authors (when configured), and
// issues with unclosed dependencies are never executable.

import { DEFAULTS } from './config.js';

/** Extract `depends-on: #12, #15` declarations from an issue body. */
export function parseDependencies(body) {
  const deps = [];
  const re = /^\s*depends[-_ ]on\s*:\s*(.+)$/gim;
  let m;
  while ((m = re.exec(String(body || ''))) !== null) {
    for (const part of m[1].split(/[,;\s]+/)) {
      const n = part.replace(/^#/, '');
      if (/^\d+$/.test(n)) deps.push(Number(n));
    }
  }
  return [...new Set(deps)];
}

export function labelNames(issue) {
  return (issue?.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name));
}

export function priorityOf(issue, { priorityLabelRe = DEFAULTS.priorityLabelRe, defaultPriority = DEFAULTS.defaultPriority } = {}) {
  for (const name of labelNames(issue)) {
    const m = priorityLabelRe.exec(name);
    if (m) return Number(m[1]);
  }
  return defaultPriority;
}

/**
 * Is this issue executable at all? Requires:
 * - open issue (not a PR),
 * - labeled `agent:ready`,
 * - not labeled `agent:hold`,
 * - author in trustedLogins when that list is non-empty.
 */
export function isExecutableIssue(issue, cfg = {}) {
  if (!issue || issue.pull_request) return false;
  if (issue.state !== 'open') return false;
  const labels = labelNames(issue);
  if (!labels.includes(cfg.readyLabel ?? DEFAULTS.readyLabel)) return false;
  if (labels.includes(cfg.holdLabel ?? DEFAULTS.holdLabel)) return false;
  const trusted = cfg.trustedLogins ?? [];
  if (trusted.length > 0 && !trusted.includes(issue.user?.login)) return false;
  return true;
}

/**
 * Select exactly one issue: highest priority (lowest number wins), then
 * oldest created, then lowest number — among executable issues whose declared
 * dependencies are all closed.
 */
export function selectIssue(issues, { closedIssueNumbers = [], cfg = {} } = {}) {
  const closed = new Set(closedIssueNumbers);
  const eligible = (issues ?? [])
    .filter((i) => isExecutableIssue(i, cfg))
    .filter((i) => parseDependencies(i.body).every((d) => closed.has(d)))
    .sort((a, b) => {
      const p = priorityOf(a, cfg) - priorityOf(b, cfg);
      if (p !== 0) return p;
      const t = String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''));
      if (t !== 0) return t;
      return a.number - b.number;
    });
  return eligible[0] ?? null;
}
