/**
 * Source-trust scoring — DESIGN.md §10.
 *
 * Trust is informational (the synthesis prompt weights primary sources higher)
 * but does NOT block secondary/tertiary sources. The four canonical reports
 * cite all three tiers.
 */

import type { Trust } from './types.js';

const PRIMARY_HOSTS: readonly string[] = Object.freeze([
  'arxiv.org',
  'anthropic.com',
  'openai.com',
  'deepmind.google',
  'research.google',
  'ai.meta.com',
  'linuxfoundation.org',
  'iso.org',
  'ietf.org',
  'modelcontextprotocol.io',
  'a2a-protocol.org',
  'webmcp.org'
]);

/** Hosts whose engineering-blog content we treat as secondary by default. */
const SECONDARY_HOSTS: readonly string[] = Object.freeze([
  'engineering.fb.com',
  'martinfowler.com',
  'aws.amazon.com',
  'cloud.google.com',
  'azure.microsoft.com',
  'devblogs.microsoft.com',
  'netflixtechblog.com',
  'eng.uber.com',
  'shopify.engineering',
  'github.blog',
  'developer.chrome.com',
  'web.dev',
  'go.dev',
  'rust-lang.org',
  'typescriptlang.org',
  'nodejs.org',
  'bun.sh',
  'cognition.ai',
  'huggingface.co',
  'pytorch.org',
  'tensorflow.org',
  'langchain.com',
  'crewai.com',
  'mistral.ai',
  'llamaindex.ai',
  'replit.com'
]);

/** Hosts treated as tertiary (aggregators, news, social). Default for unknowns. */
const TERTIARY_HOSTS: readonly string[] = Object.freeze([
  'medium.com',
  'substack.com',
  'reddit.com',
  'news.ycombinator.com',
  'twitter.com',
  'x.com',
  'linkedin.com',
  'dev.to',
  'hashnode.com',
  'producthunt.com'
]);

/** Treat every `docs.*` host as primary (vendor docs). */
function isVendorDocsHost(host: string): boolean {
  return host.startsWith('docs.') || host.includes('.docs.');
}

/** Strip leading `www.` from a host. */
function normalizeHost(host: string): string {
  return host.replace(/^www\./i, '').toLowerCase();
}

/** Score URL → trust tier. */
export function classifyTrust(url: string): Trust {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'tertiary';
  }
  const host = normalizeHost(parsed.host);
  if (isVendorDocsHost(host)) return 'primary';
  if (PRIMARY_HOSTS.some(h => host === h || host.endsWith(`.${h}`))) {
    return 'primary';
  }
  if (SECONDARY_HOSTS.some(h => host === h || host.endsWith(`.${h}`))) {
    return 'secondary';
  }
  if (TERTIARY_HOSTS.some(h => host === h || host.endsWith(`.${h}`))) {
    return 'tertiary';
  }
  // GitHub repos: treat repo root + tree URLs as primary; gist as tertiary
  if (host === 'github.com') return 'primary';
  if (host === 'github.io' || host.endsWith('.github.io')) return 'primary';
  if (host === 'gist.github.com') return 'tertiary';
  return 'tertiary';
}
