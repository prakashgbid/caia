/**
 * WebFetcher implementations.
 *
 * Orchestrator wires WebFetch tool / `mcp__workspace__web_fetch` to the
 * `httpFetch` slot. This package strips HTML to text, captures byte counts,
 * timestamps, and computes a trust tier.
 */

import type { FetchedPage, WebFetcher } from '../types.js';
import { classifyTrust } from '../trust.js';

export interface HttpFetcher {
  fetch(input: { url: string; timeoutMs: number }): Promise<{
    ok: boolean;
    status: number;
    body: string;
    /** Optional title hint from headers / first H1. */
    titleHint?: string;
  }>;
}

export interface DefaultWebFetcherOptions {
  httpFetch: HttpFetcher;
  /** Override clock for deterministic tests. */
  clock?: () => Date;
}

/** Strip HTML tags, scripts, and styles to a plain-text approximation. */
export function htmlToText(html: string): string {
  // Remove scripts and styles entirely (greedy; fine for non-pathological docs).
  let s = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, ' ');
  // Replace tags with whitespace.
  s = s.replace(/<[^>]+>/g, ' ');
  // Decode common HTML entities.
  s = s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
  // Collapse whitespace.
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

/** Pull title from <title> or first <h1>; fall back to URL host. */
export function extractTitle(html: string, url: string): string {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch !== null && titleMatch[1] !== undefined) {
    const t = titleMatch[1].replace(/\s+/g, ' ').trim();
    if (t.length > 0) return t.slice(0, 200);
  }
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1Match !== null && h1Match[1] !== undefined) {
    const t = htmlToText(h1Match[1]);
    if (t.length > 0) return t.slice(0, 200);
  }
  try {
    return new URL(url).host;
  } catch {
    return url.slice(0, 200);
  }
}

/** Cap fetched text bytes — runaway pages would bloat synthesis prompts. */
const MAX_TEXT_BYTES = 100_000;

export function createDefaultWebFetcher(
  opts: DefaultWebFetcherOptions
): WebFetcher {
  const clock = opts.clock ?? ((): Date => new Date());
  return {
    async fetch(
      url: string,
      qopts?: { timeoutMs?: number }
    ): Promise<FetchedPage> {
      const timeoutMs = qopts?.timeoutMs ?? 30_000;
      const r = await opts.httpFetch.fetch({ url, timeoutMs });
      if (!r.ok || r.body.length === 0) {
        throw new Error(`fetch ${url} failed (status=${r.status})`);
      }
      const looksHtml = r.body.includes('<html') || r.body.includes('<HTML');
      const text = looksHtml ? htmlToText(r.body) : r.body;
      const truncated =
        text.length > MAX_TEXT_BYTES ? text.slice(0, MAX_TEXT_BYTES) : text;
      const title =
        r.titleHint !== undefined && r.titleHint.length > 0
          ? r.titleHint
          : extractTitle(r.body, url);
      return {
        url,
        title,
        fetchedAtIso: clock().toISOString(),
        bytesFetched: r.body.length,
        text: truncated,
        trust: classifyTrust(url)
      };
    }
  };
}

/** Test seam: returns canned results from a URL → page map. */
export function createFixtureWebFetcher(
  fixtures: ReadonlyMap<string, FetchedPage>
): WebFetcher {
  return {
    async fetch(url: string): Promise<FetchedPage> {
      const fx = fixtures.get(url);
      if (fx === undefined) {
        throw new Error(`fixture missing for ${url}`);
      }
      return { ...fx };
    }
  };
}
