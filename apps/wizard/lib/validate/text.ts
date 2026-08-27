/**
 * validateFreeText — reject garbage / cryptic / obviously insecure input.
 *
 * Returns { ok: true } or { ok: false, reason: 'human-readable' }.
 */

const PII_PATTERNS: Array<{ re: RegExp; name: string }> = [
  { re: /\b\d{3}-\d{2}-\d{4}\b/, name: 'SSN' },
  { re: /\b(?:\d[ -]*?){13,19}\b/, name: 'credit-card-like number' },
];

const INJECTION_PATTERNS: Array<{ re: RegExp; name: string }> = [
  { re: /<script[\s\S]*?>/i, name: 'inline script' },
  { re: /javascript:/i, name: 'javascript: URL' },
  { re: /on(?:click|error|load|mouseover)\s*=/i, name: 'inline event handler' },
];

export interface ValidateResult {
  ok: boolean;
  reason?: string;
}

export interface ValidateOptions {
  minLen?: number;
  maxLen?: number;
  requireSentence?: boolean;   // must have >=1 verb-ish word + >=3 total words
  requireLowercaseMix?: boolean; // reject ALL-CAPS
}

export function validateFreeText(input: string, opts: ValidateOptions = {}): ValidateResult {
  const raw = (input || '').trim();
  const minLen = opts.minLen ?? 10;
  const maxLen = opts.maxLen ?? 5000;

  if (raw.length === 0) return { ok: false, reason: 'Please write something before continuing.' };
  if (raw.length < minLen) return { ok: false, reason: `That's a bit short — give us at least ${minLen} characters so CAIA has something to work with.` };
  if (raw.length > maxLen) return { ok: false, reason: `That's over ${maxLen} characters — please trim it down.` };

  // All caps
  if (opts.requireLowercaseMix !== false && raw.length >= 20 && raw === raw.toUpperCase() && /[A-Z]/.test(raw)) {
    return { ok: false, reason: 'Please use normal capitalisation, not ALL CAPS.' };
  }
  // All digits or all punctuation
  if (/^[\d\s]+$/.test(raw)) return { ok: false, reason: 'Please write words, not just numbers.' };
  if (/^[^\p{L}\p{N}]+$/u.test(raw)) return { ok: false, reason: 'Please write real words, not just punctuation.' };

  // Gibberish: no vowels in a long-ish string
  const vowels = (raw.toLowerCase().match(/[aeiou]/g) || []).length;
  const letters = (raw.match(/\p{L}/gu) || []).length;
  if (letters >= 15 && vowels / letters < 0.15) {
    return { ok: false, reason: "That looks like keyboard mashing — please describe it in real words." };
  }

  // Sentence-ish
  if (opts.requireSentence) {
    const wordCount = raw.split(/\s+/).filter((w) => /\p{L}/u.test(w)).length;
    if (wordCount < 3) return { ok: false, reason: 'A short sentence works better — please give at least a few words.' };
  }

  // PII
  for (const { re, name } of PII_PATTERNS) {
    if (re.test(raw)) return { ok: false, reason: `Please don't paste sensitive data like ${name}. Remove it and try again.` };
  }
  // Injection
  for (const { re, name } of INJECTION_PATTERNS) {
    if (re.test(raw)) return { ok: false, reason: `That looks like ${name} — please remove it and rewrite in plain text.` };
  }

  return { ok: true };
}

export function validateEmail(input: string): ValidateResult {
  const raw = (input || '').trim();
  if (raw.length === 0) return { ok: false, reason: 'Please enter your email.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) return { ok: false, reason: "That doesn't look like a valid email." };
  if (raw.length > 254) return { ok: false, reason: 'That email is too long.' };
  return { ok: true };
}

export function validateProjectName(input: string): ValidateResult {
  const raw = (input || '').trim();
  if (raw.length < 2) return { ok: false, reason: 'Give your project a name (2+ chars).' };
  if (raw.length > 80) return { ok: false, reason: 'Project name is too long (max 80 chars).' };
  if (/[<>{}[\]|\\]/.test(raw)) return { ok: false, reason: 'Please use letters, numbers, and basic punctuation only.' };
  return { ok: true };
}
