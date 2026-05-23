/**
 * DNS proof-of-control validator (Archetype C from the spec).
 * Customer is shown a `_caia-verify-<tenantId>` TXT record value;
 * they place it; we poll authoritative nameservers (via Cloudflare's
 * DNS-over-HTTPS resolver as a stand-in for direct authoritative dig)
 * and pass when the record appears.
 */

import type { Validator, ValidatorContext } from '../types.js';
import { asResult, fail, ok } from './util.js';

const DOH = 'https://cloudflare-dns.com/dns-query';

interface DohAnswer {
  name: string;
  type: number;
  data: string;
}

async function dohQuery(
  ctx: ValidatorContext,
  name: string,
  type = 'TXT',
): Promise<DohAnswer[]> {
  const url = `${DOH}?name=${encodeURIComponent(name)}&type=${type}`;
  const res = await ctx.fetch(url, {
    headers: { Accept: 'application/dns-json' },
  });
  if (!res.ok) return [];
  const j = (await res.json().catch(() => null)) as
    | { Answer?: DohAnswer[] }
    | null;
  return j?.Answer ?? [];
}

export const validateDnsProof: Validator = async (input, ctx) => {
  const zone = (input.choices['zone'] as string) ?? '';
  const expected = (input.credentials['dns_proof_token'] ?? '').trim();
  if (!zone || !expected) {
    return fail(input.providerId, 'choice_invalid', 'zone + dns_proof_token required');
  }
  const recordName = `_caia-verify-${input.tenantId}.${zone}`;
  const answers = await dohQuery(ctx, recordName, 'TXT');
  // TXT data comes back with surrounding quotes in JSON form
  const seen = answers
    .map((a) => a.data.replace(/^"|"$/g, ''))
    .filter((d) => d.length > 0);
  if (!seen.includes(expected)) {
    return fail(
      input.providerId,
      'token_invalid',
      `TXT record ${recordName} did not contain expected value`,
      'Place the TXT record then re-run validation; DNS propagation can take several minutes',
    );
  }
  return asResult(
    ok(input.providerId, 'dns', { recordName, observed: seen.length }),
  );
};

export const validateDatabaseDsn: Validator = async (input, ctx) => {
  // Archetype E — endpoint reach. We don't open a TCP socket here
  // (Node-only); we sanity-check the DSN format and defer real reach
  // to the database-provisioner. The engine still records the
  // credential securely.
  void ctx;
  const dsn = input.credentials['dsn'];
  if (!dsn) {
    return fail(input.providerId, 'choice_invalid', 'dsn is required');
  }
  if (!/^postgres(ql)?:\/\//.test(dsn)) {
    return fail(
      input.providerId,
      'choice_invalid',
      'DSN must start with postgres:// or postgresql://',
    );
  }
  try {
    new URL(dsn);
  } catch {
    return fail(input.providerId, 'choice_invalid', 'DSN is not a parseable URL');
  }
  return asResult(ok(input.providerId, 'endpoint', { dsnFormat: 'postgres' }));
};
