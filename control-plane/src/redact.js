// Log/content redaction. Defense in depth: the control plane never hands
// secrets to Harness in the first place, but every byte written to logs or
// transcripts also passes through here.
//
// Pipeline: specific credential shapes are replaced with an internal sentinel
// first (URL creds, headers, tokens); the generic key=value sweep runs last
// with the sentinel excluded from its character classes, so it can neither
// leak nor mangle earlier redactions. The sentinel is restored to a readable
// "<redacted>" marker at the end.

const SENTINEL = '\u0000';

const GITHUB_TOKENS = /gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,}/g;
const OPENROUTER_KEYS = /sk-or-[A-Za-z0-9-]{16,}/g;
const BEARER = /(bearer\s+)[^\s'",;)}\]]+/gi;
const URL_CREDS = /((?:https?|ssh|git):\/\/)([^\s/@:]+):([^\s/@]+)@/g;
const X_ACCESS = /(x-access-token:)[^\s@]+/g;
// Generic key=value sweep. The (?=(...))\1 pair emulates an atomic group so
// the value must match its full run, and the trailing lookahead then refuses
// matches sitting right in front of an already-redacted sentinel — without
// allowing a shorter backtrack value.
const GENERIC_KEYS =
  /((?:api[_-]?key|access[_-]?token|refresh[_-]?token|installation[_-]?token|app[_-]?token|token|secret|password|passwd|credential|authorization|private[_-]?key)("|')?\s*[:=]\s*)("[^"]*"|'[^']*'|(?=([^\s"',;)}\]\u0000]+))\4)(?!\s*\u0000)/gi;

export function redactPatterns() {
  return [
    { name: 'github-token', re: GITHUB_TOKENS },
    { name: 'openrouter-key', re: OPENROUTER_KEYS },
    // URL-embedded and header credentials before the generic sweep: they are
    // more specific and must not be left half-redacted.
    { name: 'url-credentials', re: URL_CREDS },
    { name: 'x-access-token', re: X_ACCESS },
    { name: 'bearer', re: BEARER },
    { name: 'key-value', re: GENERIC_KEYS },
  ];
}

function keepPrefix(match, ...groups) {
  // groups = capture list; last two entries are offset/string.
  if (groups.length >= 3 && typeof groups[0] === 'string' && groups[0].length > 0) {
    const prefix = groups[0];
    const mid = typeof groups[1] === 'string' ? groups[1] : '';
    return `${prefix}${mid}${SENTINEL}`;
  }
  return SENTINEL;
}

export function redactString(input, extraSecrets = []) {
  if (input == null) return input;
  let out = String(input);
  for (const secret of extraSecrets) {
    if (secret && String(secret).length >= 8) {
      // Split to survive token embedding inside longer strings (e.g. push URLs).
      out = out.split(String(secret)).join(SENTINEL);
    }
  }
  for (const { name, re } of redactPatterns()) {
    out =
      name === 'url-credentials'
        ? out.replace(re, (match, scheme, user) => `${scheme}${user}${SENTINEL}@`)
        : out.replace(re, keepPrefix);
  }
  return out.split(SENTINEL).join('<redacted>');
}

export function redactValue(value, extraSecrets = []) {
  if (typeof value === 'string') return redactString(value, extraSecrets);
  if (Array.isArray(value)) return value.map((v) => redactValue(v, extraSecrets));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = redactValue(v, extraSecrets);
    return out;
  }
  return value;
}
