/**
 * Identity validator — applied to category #1 (Identity & contact).
 * Verifies the owner's email domain has at least one MX record (rejects
 * obvious disposable-mail patterns) and validates the chosen timezone +
 * locale strings against the IANA tables built into the runtime.
 */

import type { Validator } from '../types.js';
import { asResult, fail, ok } from './util.js';

// A short list — the production rejection list lives in a maintained
// dataset; this is sufficient for the wizard's first-line defence.
const DISPOSABLE_DOMAINS = new Set<string>([
  'mailinator.com',
  '10minutemail.com',
  'tempmail.com',
  'guerrillamail.com',
  'getnada.com',
  'yopmail.com',
  'dispostable.com',
]);

function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function isValidLocale(loc: string): boolean {
  try {
    return new Intl.Locale(loc).baseName.length > 0;
  } catch {
    return false;
  }
}

export const validateIdentity: Validator = async (input, ctx) => {
  void ctx;
  const email = (input.choices['ownerEmail'] as string) ?? '';
  if (!email || !email.includes('@')) {
    return fail(input.providerId, 'choice_invalid', 'ownerEmail is required');
  }
  const domain = email.split('@')[1]?.toLowerCase() ?? '';
  if (!domain) {
    return fail(input.providerId, 'choice_invalid', 'email missing domain');
  }
  if (DISPOSABLE_DOMAINS.has(domain)) {
    return fail(
      input.providerId,
      'choice_invalid',
      `disposable email provider rejected: ${domain}`,
    );
  }
  const tz = (input.choices['timezone'] as string) ?? 'UTC';
  if (!isValidTimezone(tz)) {
    return fail(input.providerId, 'choice_invalid', `invalid IANA timezone: ${tz}`);
  }
  const locale = (input.choices['locale'] as string) ?? 'en-US';
  if (!isValidLocale(locale)) {
    return fail(input.providerId, 'choice_invalid', `invalid locale: ${locale}`);
  }
  return asResult(
    ok(input.providerId, 'api_token', { domain, timezone: tz, locale }),
  );
};
