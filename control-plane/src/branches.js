// Deterministic branch naming. Same issue title always yields the same branch,
// so restarts and GitHub-state recovery converge without duplicates.

import { DEFAULTS } from './config.js';

export function slugify(title, { max = 40 } = {}) {
  const slug = String(title || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
  return slug || 'issue';
}

export function branchForIssue(issueNumber, title, { prefix = DEFAULTS.branchPrefix } = {}) {
  return `${prefix}${issueNumber}-${slugify(title)}`;
}

export function postMergeBranchFor(branch) {
  return branch.endsWith('-postmerge') ? branch : `${branch}-postmerge`;
}

export function issueNumberFromBranch(branch, { prefix = DEFAULTS.branchPrefix } = {}) {
  if (!branch || !branch.startsWith(prefix)) return null;
  const rest = branch.slice(prefix.length);
  const m = rest.match(/^(\d+)-/);
  return m ? Number(m[1]) : null;
}

export function isAgentBranch(branch, { prefix = DEFAULTS.branchPrefix } = {}) {
  return typeof branch === 'string' && branch.startsWith(prefix) && issueNumberFromBranch(branch, { prefix }) !== null;
}
