/**
 * AWS validator — STS GetCallerIdentity is the canonical noop probe.
 * AWS Signature V4 is non-trivial; rather than re-implementing it we
 * issue a raw HTTPS POST to the global STS endpoint with a v4 signed
 * Authorization header constructed inline.
 *
 * Implementation is a faithful subset of SigV4 sufficient for the
 * `sts:GetCallerIdentity` action, which carries no payload.
 *
 * Reference: https://docs.aws.amazon.com/general/latest/gr/sigv4_signing.html
 */

import type { Validator } from '../types.js';
import { asResult, fail, ok, requireCredential } from './util.js';

// We can't use webcrypto from inside a synchronous function reliably
// across Node 18+ and the edge runtime, so we compute SigV4 with the
// platform's crypto.subtle.
async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const k = await globalThis.crypto.subtle.importKey(
    'raw',
    key instanceof Uint8Array ? key : new Uint8Array(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return globalThis.crypto.subtle.sign('HMAC', k, new TextEncoder().encode(data));
}

async function sha256Hex(data: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(data),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function amzDate(d: Date): { amzDate: string; dateStamp: string } {
  const amz = d.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return { amzDate: amz, dateStamp: amz.slice(0, 8) };
}

async function signSts(
  accessKey: string,
  secretKey: string,
  region: string,
  now: Date,
  body: string,
): Promise<{ headers: Record<string, string>; url: string }> {
  const { amzDate: amz, dateStamp } = amzDate(now);
  const host = `sts.${region}.amazonaws.com`;
  const service = 'sts';
  const algorithm = 'AWS4-HMAC-SHA256';
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;

  const canonicalUri = '/';
  const canonicalQs = '';
  const payloadHash = await sha256Hex(body);
  const canonicalHeaders =
    `content-type:application/x-www-form-urlencoded; charset=utf-8\n` +
    `host:${host}\n` +
    `x-amz-date:${amz}\n`;
  const signedHeaders = 'content-type;host;x-amz-date';
  const canonicalRequest = [
    'POST',
    canonicalUri,
    canonicalQs,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');
  const canonicalRequestHash = await sha256Hex(canonicalRequest);
  const stringToSign = [algorithm, amz, credentialScope, canonicalRequestHash].join('\n');

  const kDate = await hmac(new TextEncoder().encode(`AWS4${secretKey}`), dateStamp);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  const kSigning = await hmac(kService, 'aws4_request');
  const signature = toHex(await hmac(kSigning, stringToSign));

  const authorization =
    `${algorithm} Credential=${accessKey}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, ` +
    `Signature=${signature}`;

  return {
    url: `https://${host}/`,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
      'X-Amz-Date': amz,
      Authorization: authorization,
    },
  };
}

export const validateAwsSts: Validator = async (input, ctx) => {
  const ak = requireCredential(input, 'access_key_id');
  if ('ok' in ak && ak.ok !== true) return ak;
  const sk = requireCredential(input, 'secret_access_key');
  if ('ok' in sk && sk.ok !== true) return sk;
  const region = (input.choices['region'] as string) ?? 'us-east-1';

  let signed: { url: string; headers: Record<string, string> };
  try {
    signed = await signSts(
      (ak as { value: string }).value,
      (sk as { value: string }).value,
      region,
      ctx.now(),
      'Action=GetCallerIdentity&Version=2011-06-15',
    );
  } catch (e) {
    return fail(
      input.providerId,
      'provider_error',
      `AWS signing error: ${(e as Error).message}`,
    );
  }
  let res: Response;
  try {
    res = await ctx.fetch(signed.url, {
      method: 'POST',
      headers: signed.headers,
      body: 'Action=GetCallerIdentity&Version=2011-06-15',
    });
  } catch (e) {
    return fail(
      input.providerId,
      'network_error',
      `AWS network error: ${(e as Error).message}`,
    );
  }
  const text = await res.text();
  if (res.status === 403) {
    return fail(
      input.providerId,
      'token_invalid',
      'AWS STS returned 403 — bad keys or insufficient policy',
    );
  }
  if (res.status >= 500) {
    return fail(input.providerId, 'provider_error', `AWS STS ${res.status}`);
  }
  if (res.status !== 200) {
    return fail(input.providerId, 'provider_error', `AWS STS ${res.status}: ${text}`);
  }
  const accountMatch = text.match(/<Account>([^<]+)<\/Account>/);
  const arnMatch = text.match(/<Arn>([^<]+)<\/Arn>/);
  return asResult(
    ok(input.providerId, 'api_token', {
      accountId: accountMatch?.[1] ?? null,
      arn: arnMatch?.[1] ?? null,
      region,
    }),
  );
};
