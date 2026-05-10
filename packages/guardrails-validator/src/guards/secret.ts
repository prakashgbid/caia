/**
 * Secret guard — detects API keys, tokens, private keys, high-entropy strings.
 *
 * Catches secrets at the agent-input / agent-output boundary BEFORE they hit
 * Langfuse spans, log lines, or commit messages. Pairs with the existing
 * `feedback_secret_scanner_history_squash.md` policy (which is repo-side).
 */

import type { NamedPattern } from '../types.js';

export interface SecretOptions {
  /** Min length of a high-entropy slice before scoring. Default 32. */
  minEntropyChars?: number;
  /** Shannon-entropy threshold. Default 4.5. */
  entropyThreshold?: number;
}

export const BUILTIN_SECRET_PATTERNS: readonly NamedPattern[] = Object.freeze([
  {
    id: 'secret.openai-api-key',
    description: 'OpenAI API key (sk-...)',
    // Project keys (sk-proj-...) and legacy. Excludes Anthropic which has its own pattern.
    re: /\bsk-(?!ant-)(?:proj-)?[A-Za-z0-9_-]{20,}\b/g,
  },
  {
    id: 'secret.anthropic-api-key',
    description: 'Anthropic API key (sk-ant-...)',
    re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g,
  },
  {
    id: 'secret.aws-access-key',
    description: 'AWS access key (AKIA...)',
    re: /\bAKIA[0-9A-Z]{16}\b/g,
  },
  {
    id: 'secret.aws-secret-key',
    description: 'AWS secret key (40-char base64-ish following aws_secret_access_key)',
    re: /aws_secret_access_key\s*[:=]\s*['"]?[A-Za-z0-9/+=]{40}['"]?/gi,
  },
  {
    id: 'secret.github-token-classic',
    description: 'GitHub personal access token (ghp_...)',
    re: /\bghp_[A-Za-z0-9]{36}\b/g,
  },
  {
    id: 'secret.github-token-fine-grained',
    description: 'GitHub fine-grained PAT (github_pat_...)',
    re: /\bgithub_pat_[A-Za-z0-9_]{82}\b/g,
  },
  {
    id: 'secret.private-key-pem',
    description: 'PEM-encoded private key',
    re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g,
  },
  {
    id: 'secret.jwt',
    description: 'JSON Web Token (header.payload.signature)',
    re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  },
  {
    id: 'secret.slack-token',
    description: 'Slack token (xoxb-... / xoxa-... / xoxp-...)',
    re: /\bxox[abpr]-[A-Za-z0-9-]{10,}\b/g,
  },
  {
    id: 'secret.google-api-key',
    description: 'Google API key (AIza...)',
    re: /\bAIza[0-9A-Za-z_-]{35}\b/g,
  },
]);

export interface SecretScanResult {
  hits: Array<{ id: string; description: string; values: string[] }>;
}

export function scanSecret(
  text: string,
  customPatterns: readonly NamedPattern[] = [],
  opts: SecretOptions = {},
): SecretScanResult {
  const hits: SecretScanResult['hits'] = [];
  for (const pat of BUILTIN_SECRET_PATTERNS) {
    // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- caller-supplied pattern is the package contract
    const re = new RegExp(pat.re.source, ensureGlobal(pat.re.flags));
    const values = text.match(re) ?? [];
    if (values.length === 0) continue;
    hits.push({ id: pat.id, description: pat.description, values });
  }
  for (const pat of customPatterns) {
    // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- caller-supplied pattern is the package contract
    const re = new RegExp(pat.re.source, ensureGlobal(pat.re.flags));
    const values = text.match(re) ?? [];
    if (values.length === 0) continue;
    hits.push({ id: pat.id, description: pat.description, values });
  }
  // High-entropy fallback — catches unknown-prefix tokens.
  const entropyHits = scanHighEntropy(text, opts);
  if (entropyHits.length > 0) {
    hits.push({
      id: 'secret.high-entropy',
      description: 'High-entropy token (≥ entropyThreshold)',
      values: entropyHits,
    });
  }
  return { hits };
}

const ALNUM_RUN_RE = /[A-Za-z0-9_-]{32,}/g;

function scanHighEntropy(text: string, opts: SecretOptions): string[] {
  const minChars = opts.minEntropyChars ?? 32;
  const threshold = opts.entropyThreshold ?? 4.5;
  const hits: string[] = [];
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- caller-supplied pattern is the package contract
  for (const m of text.matchAll(new RegExp(ALNUM_RUN_RE.source, 'g'))) {
    const slice = m[0];
    if (slice.length < minChars) continue;
    if (shannon(slice) >= threshold) {
      hits.push(slice);
    }
  }
  return hits;
}

function shannon(s: string): number {
  const freq = new Map<string, number>();
  for (const ch of s) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  const len = s.length;
  let h = 0;
  for (const c of freq.values()) {
    const p = c / len;
    h -= p * Math.log2(p);
  }
  return h;
}

function ensureGlobal(flags: string): string {
  return flags.includes('g') ? flags : flags + 'g';
}

/**
 * Partial-mask a secret for audit log preservation. Keeps first 4 chars,
 * replaces rest with `***`. Never returns more than 7 chars.
 */
export function maskSecret(value: string): string {
  if (value.length <= 4) return '***';
  return `${value.slice(0, 4)}***`;
}
