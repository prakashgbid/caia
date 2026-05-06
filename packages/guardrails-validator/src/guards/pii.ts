/**
 * PII guard — detects personally identifiable information.
 *
 * Pattern catalogue:
 *  - email                (RFC-5322-lite)
 *  - phone-us             (xxx-xxx-xxxx, (xxx) xxx-xxxx, 10-digit)
 *  - phone-international  (+CC NNNNNNNN minimal form)
 *  - ssn-us               (XXX-XX-XXXX)
 *  - credit-card          (Luhn-validated 13-19 digits)
 *  - ipv4                 (skips RFC1918 / loopback by default)
 *  - ipv6                 (full or compressed)
 */

import type { NamedPattern } from '../types.js';

export interface PiiOptions {
  /** Skip private ranges in IPv4 detection. Default true. */
  ipv4SkipPrivateRanges?: boolean;
}

export const BUILTIN_PII_PATTERNS: readonly NamedPattern[] = Object.freeze([
  {
    id: 'pii.email',
    description: 'Email address',
    re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
  },
  {
    id: 'pii.phone-us',
    description: 'US phone number',
    re: /(?:\(\d{3}\)\s?\d{3}-\d{4}|\b\d{3}-\d{3}-\d{4}\b|(?<!\d)\d{10}(?!\d))/g,
  },
  {
    id: 'pii.phone-international',
    description: 'International phone number',
    re: /\+\d{1,3}[\s-]?\d{6,14}/g,
  },
  {
    id: 'pii.ssn-us',
    description: 'US Social Security Number',
    re: /\b\d{3}-\d{2}-\d{4}\b/g,
  },
  {
    id: 'pii.ipv6',
    description: 'IPv6 address',
    // Simplified IPv6 (full or compressed form). False positives possible on hex blobs.
    re: /\b(?:[A-Fa-f0-9]{1,4}:){2,7}[A-Fa-f0-9]{1,4}\b/g,
  },
]);

const IPV4_RE = /\b(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\b/g;
const CC_RE = /\b(?:\d[ -]?){12,18}\d\b/g;

export interface PiiScanResult {
  /** Per-pattern matches, with raw values for redaction. */
  hits: Array<{ id: string; description: string; values: string[] }>;
}

export function scanPii(
  text: string,
  customPatterns: readonly NamedPattern[] = [],
  opts: PiiOptions = {},
): PiiScanResult {
  const hits: PiiScanResult['hits'] = [];
  for (const pat of BUILTIN_PII_PATTERNS) {
    const re = new RegExp(pat.re.source, ensureGlobal(pat.re.flags));
    const values = text.match(re) ?? [];
    if (values.length === 0) continue;
    hits.push({ id: pat.id, description: pat.description, values });
  }
  // IPv4 with private-range skip
  const ipv4Skip = opts.ipv4SkipPrivateRanges ?? true;
  const ipv4Hits: string[] = [];
  for (const m of text.matchAll(new RegExp(IPV4_RE.source, 'g'))) {
    const octets = [m[1], m[2], m[3], m[4]].map((o) => parseInt(o ?? '0', 10));
    if (octets.some((o) => Number.isNaN(o) || o < 0 || o > 255)) continue;
    if (ipv4Skip && isPrivateIpv4(octets as [number, number, number, number])) continue;
    ipv4Hits.push(m[0]);
  }
  if (ipv4Hits.length > 0) {
    hits.push({
      id: 'pii.ipv4',
      description: ipv4Skip ? 'Public IPv4 address' : 'IPv4 address',
      values: ipv4Hits,
    });
  }
  // Credit card (Luhn-validated)
  const ccHits: string[] = [];
  for (const m of text.matchAll(new RegExp(CC_RE.source, 'g'))) {
    const digits = m[0].replace(/[\s-]/g, '');
    if (digits.length < 13 || digits.length > 19) continue;
    if (!luhn(digits)) continue;
    ccHits.push(m[0]);
  }
  if (ccHits.length > 0) {
    hits.push({
      id: 'pii.credit-card',
      description: 'Luhn-valid credit card number',
      values: ccHits,
    });
  }
  for (const pat of customPatterns) {
    const re = new RegExp(pat.re.source, ensureGlobal(pat.re.flags));
    const values = text.match(re) ?? [];
    if (values.length === 0) continue;
    hits.push({ id: pat.id, description: pat.description, values });
  }
  return { hits };
}

function isPrivateIpv4(octets: [number, number, number, number]): boolean {
  const [a, b] = octets;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true; // link-local
  if (a === 0) return true;
  if (a >= 224) return true; // multicast / reserved
  return false;
}

function luhn(digits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (n < 0 || n > 9) return false;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

function ensureGlobal(flags: string): string {
  return flags.includes('g') ? flags : flags + 'g';
}

/**
 * Partially mask a value for audit log preservation. Keeps first 2 + last 2 chars,
 * replaces middle with `***`.
 */
export function maskPii(value: string): string {
  if (value.length <= 6) return '***';
  return `${value.slice(0, 2)}***${value.slice(-2)}`;
}
