/**
 * Validator dispatch — looks up (category, provider) → strategy.
 *
 * Providers with `noCredentials: true` short-circuit to a synthetic
 * success result; the wizard still writes a `customer_choices` row but
 * no credential row.
 */

import type {
  CategoryId,
  Validator,
  ValidatorContext,
  ValidatorInput,
  ValidatorResult,
} from '../types.js';
import { getCategory, getProvider } from '../categories/index.js';
import { defaultContext, asResult, ok } from './util.js';

import {
  validateGithubToken,
  validateGithubOAuth,
} from './github.js';
import { validateCloudflareToken } from './cloudflare.js';
import { validateAwsSts } from './aws.js';
import { validateResendToken } from './resend.js';
import { validateIdentity } from './identity.js';
import { validateDnsProof, validateDatabaseDsn } from './dns.js';
import {
  validateAnthropicKey,
  validateAxiomToken,
  validateBitbucketToken,
  validateBuildkiteToken,
  validateCircleCiToken,
  validateCloudinaryKey,
  validateFigmaToken,
  validateFlyToken,
  validateGitlabToken,
  validateHoneycombToken,
  validateJiraToken,
  validateLinearToken,
  validateNeonToken,
  validateNotionToken,
  validatePlausibleToken,
  validatePostHogToken,
  validatePostmarkToken,
  validateSendgridToken,
  validateSentryToken,
  validateStripePaymentMethod,
  validateSupabaseKey,
  validateVercelToken,
} from './api-tokens.js';

/** Composite key: `${categoryId}:${providerId}`. */
type Key = `${CategoryId}:${string}`;

/** Authoritative registry of validators. */
export const VALIDATORS: Record<Key, Validator> = {
  // Identity
  'identity:self': validateIdentity,

  // Auth
  'auth:github': validateGithubOAuth,
  'auth:google': validateGithubOAuth, // OAuth shape; uses bearer probe
  'auth:apple': validateGithubOAuth,
  'auth:microsoft': validateGithubOAuth,

  // Pricing
  'pricing:byok': validateAnthropicKey,
  'pricing:credits': validateStripePaymentMethod,

  // Repo
  'repo:github': validateGithubToken,
  'repo:gitlab': validateGitlabToken,
  'repo:bitbucket': validateBitbucketToken,

  // CI
  'ci:github-actions': validateGithubToken,
  'ci:circleci': validateCircleCiToken,
  'ci:buildkite': validateBuildkiteToken,

  // Cloud
  'cloud:cloudflare-pages': validateCloudflareToken,
  'cloud:aws': validateAwsSts,
  'cloud:vercel': validateVercelToken,
  'cloud:fly': validateFlyToken,

  // Domain
  'domain:cloudflare-registrar': validateCloudflareToken,
  'domain:namecheap': validateCloudflareToken, // placeholder — namecheap-api shape

  // DNS
  'dns:cloudflare-dns': validateCloudflareToken,
  'dns:route53': validateAwsSts,
  'dns:manual-dns-proof': validateDnsProof,

  // CDN
  'cdn:cloudflare-r2': validateCloudflareToken,
  'cdn:aws-cloudfront-s3': validateAwsSts,
  'cdn:cloudinary': validateCloudinaryKey,

  // Database
  'database:self-hosted-postgres': validateDatabaseDsn,
  'database:supabase': validateSupabaseKey,
  'database:neon': validateNeonToken,

  // Email
  'email:resend': validateResendToken,
  'email:postmark': validatePostmarkToken,
  'email:sendgrid': validateSendgridToken,

  // Analytics
  'analytics:plausible-cloud': validatePlausibleToken,
  'analytics:posthog-cloud': validatePostHogToken,

  // Errors
  'errors:sentry': validateSentryToken,

  // Observability
  'observability:honeycomb': validateHoneycombToken,
  'observability:axiom': validateAxiomToken,

  // PM / issue tracker
  'pm:linear': validateLinearToken,
  'pm:jira-cloud': validateJiraToken,
  'pm:github-issues': validateGithubToken,

  // Docs / Design / Compliance / Anthropic prefs (optional)
  'docs:notion': validateNotionToken,
  'design:figma': validateFigmaToken,
  'compliance:self': async (input, ctx) => {
    void ctx;
    return asResult(ok(input.providerId, 'api_token', input.choices));
  },
  'anthropic_prefs:preferences': async (input, ctx) => {
    void ctx;
    return asResult(ok(input.providerId, 'api_token', input.choices));
  },
};

export function resolveValidator(
  categoryId: string,
  providerId: string,
): Validator | undefined {
  return VALIDATORS[`${categoryId}:${providerId}` as Key];
}

/**
 * Validate a single (category, provider) submission, dispatching via
 * the static catalog. Returns a discriminated `ValidatorResult`.
 *
 * - `noCredentials: true` providers (e.g. `caia-managed`) short-circuit
 *   to a synthetic success.
 * - Missing dispatch entry => `choice_invalid`.
 */
export async function validate(
  input: ValidatorInput,
  ctx: ValidatorContext = defaultContext(),
): Promise<ValidatorResult> {
  const cat = getCategory(input.category);
  if (!cat) {
    return {
      ok: false,
      providerId: input.providerId,
      errorCode: 'choice_invalid',
      message: `unknown category: ${input.category}`,
    };
  }
  const provider = getProvider(input.category, input.providerId);
  if (!provider) {
    return {
      ok: false,
      providerId: input.providerId,
      errorCode: 'choice_invalid',
      message: `unknown provider for ${input.category}: ${input.providerId}`,
    };
  }
  if (provider.noCredentials) {
    return ok(input.providerId, provider.archetype, { managed: true });
  }
  const validator = resolveValidator(input.category, input.providerId);
  if (!validator) {
    return {
      ok: false,
      providerId: input.providerId,
      errorCode: 'choice_invalid',
      message: `no validator registered for ${input.category}:${input.providerId}`,
    };
  }
  return validator(input, ctx);
}

export * from './util.js';
export * from './github.js';
export * from './cloudflare.js';
export * from './aws.js';
export * from './resend.js';
export * from './identity.js';
export * from './dns.js';
export * from './api-tokens.js';
