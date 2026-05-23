import { describe, it, expect } from 'vitest';
import { validateAwsSts } from '../src/validators/aws.js';
import { validateIdentity } from '../src/validators/identity.js';
import { validateDnsProof, validateDatabaseDsn } from '../src/validators/dns.js';
import { validate, resolveValidator, VALIDATORS } from '../src/validators/index.js';
import { mockFetch, fixedContext } from './helpers.js';

const baseInput = {
  tenantId: 't1',
  category: 'cloud' as const,
  providerId: 'aws',
  choices: {},
  credentials: { access_key_id: 'AKIA', secret_access_key: 'secret' },
};

describe('AWS validator', () => {
  it('passes when STS returns a 200 with Account+Arn XML', async () => {
    const xml = `<GetCallerIdentityResponse>
      <GetCallerIdentityResult>
        <Account>123456789012</Account>
        <Arn>arn:aws:iam::123456789012:user/caia</Arn>
        <UserId>UID</UserId>
      </GetCallerIdentityResult>
    </GetCallerIdentityResponse>`;
    const { fetch } = mockFetch({
      'https://sts.us-east-1.amazonaws.com/': {
        status: 200,
        body: xml,
        headers: { 'Content-Type': 'text/xml' },
      },
    });
    const r = await validateAwsSts(baseInput, fixedContext(fetch));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.metadata['accountId']).toBe('123456789012');
      expect(r.metadata['arn']).toContain('arn:aws:iam');
    }
  });

  it('fails on 403', async () => {
    const { fetch } = mockFetch({
      'https://sts.us-east-1.amazonaws.com/': { status: 403, body: '' },
    });
    const r = await validateAwsSts(baseInput, fixedContext(fetch));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errorCode).toBe('token_invalid');
  });

  it('rejects missing keys', async () => {
    const { fetch } = mockFetch({});
    const r = await validateAwsSts(
      { ...baseInput, credentials: {} },
      fixedContext(fetch),
    );
    expect(r.ok).toBe(false);
  });
});

describe('Identity validator', () => {
  it('passes with a normal email + tz', async () => {
    const { fetch } = mockFetch({});
    const r = await validateIdentity(
      {
        ...baseInput,
        category: 'identity' as const,
        providerId: 'self',
        choices: { ownerEmail: 'p@example.com', timezone: 'America/New_York', locale: 'en-US' },
      },
      fixedContext(fetch),
    );
    expect(r.ok).toBe(true);
  });

  it('rejects disposable emails', async () => {
    const { fetch } = mockFetch({});
    const r = await validateIdentity(
      {
        ...baseInput,
        category: 'identity' as const,
        providerId: 'self',
        choices: { ownerEmail: 'foo@mailinator.com' },
      },
      fixedContext(fetch),
    );
    expect(r.ok).toBe(false);
  });

  it('rejects invalid timezones', async () => {
    const { fetch } = mockFetch({});
    const r = await validateIdentity(
      {
        ...baseInput,
        category: 'identity' as const,
        providerId: 'self',
        choices: { ownerEmail: 'p@example.com', timezone: 'Mars/Olympus_Mons' },
      },
      fixedContext(fetch),
    );
    expect(r.ok).toBe(false);
  });

  it('rejects missing email', async () => {
    const { fetch } = mockFetch({});
    const r = await validateIdentity(
      {
        ...baseInput,
        category: 'identity' as const,
        providerId: 'self',
        choices: {},
      },
      fixedContext(fetch),
    );
    expect(r.ok).toBe(false);
  });

  it('rejects invalid locales', async () => {
    const { fetch } = mockFetch({});
    const r = await validateIdentity(
      {
        ...baseInput,
        category: 'identity' as const,
        providerId: 'self',
        choices: { ownerEmail: 'p@example.com', locale: '!!!' },
      },
      fixedContext(fetch),
    );
    expect(r.ok).toBe(false);
  });
});

describe('DNS + database validators', () => {
  it('passes when authoritative TXT matches', async () => {
    const { fetch } = mockFetch({
      'https://cloudflare-dns.com/dns-query': {
        status: 200,
        body: {
          Answer: [
            { name: '_caia-verify-t1.example.com.', type: 16, data: '"caia-token-1"' },
          ],
        },
      },
    });
    const r = await validateDnsProof(
      {
        tenantId: 't1',
        category: 'dns' as const,
        providerId: 'manual-dns-proof',
        choices: { zone: 'example.com' },
        credentials: { dns_proof_token: 'caia-token-1' },
      },
      fixedContext(fetch),
    );
    expect(r.ok).toBe(true);
  });

  it('fails when TXT does not contain expected value', async () => {
    const { fetch } = mockFetch({
      'https://cloudflare-dns.com/dns-query': {
        status: 200,
        body: { Answer: [{ name: '_x', type: 16, data: '"other"' }] },
      },
    });
    const r = await validateDnsProof(
      {
        tenantId: 't1',
        category: 'dns' as const,
        providerId: 'manual-dns-proof',
        choices: { zone: 'example.com' },
        credentials: { dns_proof_token: 'caia-token-1' },
      },
      fixedContext(fetch),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errorCode).toBe('token_invalid');
  });

  it('rejects bad DSN format', async () => {
    const { fetch } = mockFetch({});
    const r = await validateDatabaseDsn(
      {
        tenantId: 't',
        category: 'database' as const,
        providerId: 'self-hosted-postgres',
        choices: {},
        credentials: { dsn: 'http://nope' },
      },
      fixedContext(fetch),
    );
    expect(r.ok).toBe(false);
  });

  it('passes a parseable postgres DSN', async () => {
    const { fetch } = mockFetch({});
    const r = await validateDatabaseDsn(
      {
        tenantId: 't',
        category: 'database' as const,
        providerId: 'self-hosted-postgres',
        choices: {},
        credentials: { dsn: 'postgres://u:p@h:5432/db' },
      },
      fixedContext(fetch),
    );
    expect(r.ok).toBe(true);
  });
});

describe('Validator dispatch', () => {
  it('returns ok for noCredentials providers', async () => {
    const { fetch } = mockFetch({});
    const r = await validate(
      {
        tenantId: 't',
        category: 'repo' as const,
        providerId: 'caia-managed',
        choices: {},
        credentials: {},
      },
      fixedContext(fetch),
    );
    expect(r.ok).toBe(true);
  });

  it('returns choice_invalid for unknown category', async () => {
    const { fetch } = mockFetch({});
    const r = await validate(
      {
        tenantId: 't',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        category: 'nope' as any,
        providerId: 'whatever',
        choices: {},
        credentials: {},
      },
      fixedContext(fetch),
    );
    expect(r.ok).toBe(false);
  });

  it('returns choice_invalid for unknown provider', async () => {
    const { fetch } = mockFetch({});
    const r = await validate(
      {
        tenantId: 't',
        category: 'repo' as const,
        providerId: 'unknown-provider',
        choices: {},
        credentials: {},
      },
      fixedContext(fetch),
    );
    expect(r.ok).toBe(false);
  });

  it('resolveValidator returns a function for a known key', () => {
    expect(typeof resolveValidator('repo', 'github')).toBe('function');
    expect(resolveValidator('repo', 'nope')).toBeUndefined();
  });

  it('every registered key has a function', () => {
    for (const [k, v] of Object.entries(VALIDATORS)) {
      expect(typeof v).toBe('function');
      expect(k.split(':').length).toBe(2);
    }
  });
});
