#!/usr/bin/env node
/**
 * E2E live verify driver.
 *
 * Invokes the @chiefaia/researcher pipeline against a real upcoming CAIA
 * question — "evaluate Bun vs Node.js as runtime for Hono microservices" —
 * using a curated URL pool (because the orchestrator-side `caia-search`
 * binary isn't available on this host). Real `claude` binary, real Node
 * fetch.
 *
 * Writes the report to a path under /tmp so it's easy to inspect against
 * the four canonical CAIA reports for shape match.
 */

import { writeFileSync } from 'node:fs';
import { ResearcherAgent } from '../dist/index.js';
import { createDefaultWebFetcher } from '../dist/fetchers/web-fetcher.js';

// Curated URL pool covering the Bun vs Node + Hono question's main axes.
const POOL = [
  { title: 'Bun docs — runtime', url: 'https://bun.sh/docs/runtime/index', snippet: '' },
  { title: 'Node.js docs', url: 'https://nodejs.org/en/about', snippet: '' },
  { title: 'Hono docs', url: 'https://hono.dev/', snippet: '' },
  { title: 'Hono concepts', url: 'https://hono.dev/docs/concepts/motivation', snippet: '' },
  { title: 'Bun vs Node benchmarks', url: 'https://bun.sh/docs/runtime/benchmarks', snippet: '' },
  { title: 'Hono — Bun adapter', url: 'https://hono.dev/docs/getting-started/bun', snippet: '' },
  { title: 'Hono — Node adapter', url: 'https://hono.dev/docs/getting-started/nodejs', snippet: '' },
  { title: 'Bun GitHub', url: 'https://github.com/oven-sh/bun', snippet: '' },
  { title: 'Node.js GitHub', url: 'https://github.com/nodejs/node', snippet: '' },
  { title: 'Bun release notes 1.1', url: 'https://bun.sh/blog/bun-v1.1', snippet: '' }
];

const httpFetch = {
  async fetch({ url, timeoutMs }) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: ac.signal,
        headers: { 'User-Agent': 'caia-researcher/0.1.0-e2e' }
      });
      const body = await res.text();
      return { ok: res.ok, status: res.status, body };
    } catch {
      return { ok: false, status: 0, body: '' };
    } finally {
      clearTimeout(t);
    }
  }
};

const searcher = {
  async search(_q, opts) {
    const k = opts?.topK ?? POOL.length;
    return POOL.slice(0, k).map(r => ({ ...r }));
  }
};

const agent = new ResearcherAgent({
  searcher,
  fetcher: createDefaultWebFetcher({ httpFetch }),
  shallowSubQuestions: 3,
  shallowSourcesPerQuestion: 10,
  minSourceCount: 6,
  synthesisTimeoutMs: 240_000,
  plannerTimeoutMs: 60_000
});

const start = Date.now();
const report = await agent.investigateTopic({
  query: 'evaluate Bun vs Node.js as runtime for Hono microservices',
  depth: 'shallow'
});

const out = '/tmp/researcher-e2e-bun-vs-node.md';
writeFileSync(out, report.markdown, 'utf-8');
console.log(`OK — wrote ${out}`);
console.log(`bytes:    ${report.markdown.length}`);
console.log(`sources:  ${report.sources.length}`);
console.log(`sections: ${report.sections.length}`);
console.log(`verdict:  ${report.recommendation.verdict}/${report.recommendation.confidence}`);
console.log(`duration: ${((Date.now() - start) / 1000).toFixed(1)}s`);
console.log(`scrubbed: ${report.diagnostics.quotesScrubbed} quotes, ${report.diagnostics.hallucinationsDropped} citations`);
