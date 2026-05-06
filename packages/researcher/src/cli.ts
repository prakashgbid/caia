#!/usr/bin/env node
/**
 * caia-researcher CLI.
 *
 * Subcommands:
 *
 *   investigate "<query>" [--depth shallow|medium|deep] [--report-out <path>] [--output stdout|file]
 *   dry-run     "<query>" [--depth shallow|medium|deep]
 *
 * Wires the production WebSearcher / WebFetcher / PrecedentSource via shell
 * binaries the operator's host already provides:
 *   - `caia-search` for WebSearcher (else fixture/empty if absent)
 *   - `caia-librarian-retrieve` for PrecedentSource (else empty)
 *   - The HttpFetcher uses Node's `fetch` (Node 20+).
 *
 * Subscription-only: the LLM client always scrubs ANTHROPIC_API_KEY.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { ResearcherAgent } from './agent.js';
import {
  CAIA_DEFAULT_REPORTS_ROOT,
  resolveConfig
} from './config.js';
import { createCommandLinePrecedentSource } from './fetchers/precedent-source.js';
import { createCommandLineSearcher } from './fetchers/web-searcher.js';
import { createDefaultWebFetcher } from './fetchers/web-fetcher.js';
import type { Depth, ResearchReport } from './types.js';

interface ParsedArgs {
  command: 'investigate' | 'dry-run' | 'help';
  query: string;
  depth: Depth | null;
  reportOut: string | null;
  output: 'stdout' | 'file';
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const a: ParsedArgs = {
    command: 'help',
    query: '',
    depth: null,
    reportOut: null,
    output: 'file'
  };
  if (argv.length === 0) return a;
  const cmd = argv[0];
  if (cmd === 'investigate' || cmd === 'dry-run') a.command = cmd;
  else if (cmd === 'help' || cmd === '--help' || cmd === '-h') return a;
  for (let i = 1; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === '--depth' || k === '-d') {
      if (v === 'shallow' || v === 'medium' || v === 'deep') a.depth = v;
      i++;
      continue;
    }
    if (k === '--report-out' || k === '-o') {
      a.reportOut = v ?? null;
      i++;
      continue;
    }
    if (k === '--output') {
      if (v === 'stdout' || v === 'file') a.output = v;
      i++;
      continue;
    }
    if (k !== undefined && !k.startsWith('--') && a.query.length === 0) {
      a.query = k;
      continue;
    }
  }
  return a;
}

function helpText(): string {
  return [
    'caia-researcher — on-demand deep-dive technology evaluation',
    '',
    'Usage:',
    '  caia-researcher investigate "<query>" [--depth shallow|medium|deep] [--report-out <path>] [--output stdout|file]',
    '  caia-researcher dry-run     "<query>" [--depth shallow|medium|deep]',
    '',
    'Defaults:',
    '  --depth        medium',
    '  --output       file (writes to ~/Documents/projects/reports/<slug>.md)',
    '',
    'Examples:',
    '  caia-researcher investigate "Bun vs Node.js for Hono microservices"',
    '  caia-researcher investigate "Should we adopt Mem0 over sqlite-vec?" --depth=deep',
    '  caia-researcher dry-run     "Open Deep Research patterns 2026"'
  ].join('\n');
}

function slugify(query: string): string {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function timestamp(): string {
  return new Date().toISOString().slice(0, 10);
}

async function main(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv);
  if (args.command === 'help') {
    console.log(helpText());
    return 0;
  }
  if (args.query.length === 0) {
    console.error('error: query required');
    console.error(helpText());
    return 2;
  }

  const cfg = resolveConfig({});
  const depth = args.depth ?? cfg.defaultDepth;

  if (args.command === 'dry-run') {
    console.log(`[dry-run] query: ${args.query}`);
    console.log(`[dry-run] depth: ${depth}`);
    console.log(
      `[dry-run] would plan ~${depth === 'deep' ? cfg.deepSubQuestions : depth === 'medium' ? cfg.mediumSubQuestions : cfg.shallowSubQuestions} sub-questions`
    );
    console.log(
      `[dry-run] would fetch ~${depth === 'deep' ? cfg.deepSubQuestions * cfg.deepSourcesPerQuestion : depth === 'medium' ? cfg.mediumSubQuestions * cfg.mediumSourcesPerQuestion : cfg.shallowSubQuestions * cfg.shallowSourcesPerQuestion} sources`
    );
    return 0;
  }

  const searcher = createCommandLineSearcher({
    binaryPath: 'caia-search',
    defaultTopK: 12
  });
  const httpFetch = {
    async fetch(input: { url: string; timeoutMs: number }): Promise<{
      ok: boolean;
      status: number;
      body: string;
      titleHint?: string;
    }> {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), input.timeoutMs);
      try {
        const res = await fetch(input.url, {
          signal: ac.signal,
          headers: { 'User-Agent': 'caia-researcher/0.1.0' }
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
  const fetcher = createDefaultWebFetcher({ httpFetch });
  const precedentSource = createCommandLinePrecedentSource({
    binaryPath: 'caia-librarian-retrieve',
    defaultTopN: 5
  });

  const agent = new ResearcherAgent({
    searcher,
    fetcher,
    precedentSource
  });

  let report: ResearchReport;
  try {
    report = await agent.investigateTopic({ query: args.query, depth });
  } catch (err) {
    console.error(
      `[caia-researcher] investigation failed: ${(err as Error).message}`
    );
    return 1;
  }

  if (args.output === 'stdout') {
    process.stdout.write(report.markdown);
    return 0;
  }

  const outPath =
    args.reportOut !== null
      ? resolve(args.reportOut)
      : join(
          CAIA_DEFAULT_REPORTS_ROOT,
          `researcher-${slugify(args.query)}-${timestamp()}.md`
        );
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, report.markdown, 'utf-8');
  console.log(`[caia-researcher] wrote ${outPath}`);
  console.log(
    `[caia-researcher] sources=${report.sources.length} depth=${report.depth} duration=${(report.durationMs / 1000).toFixed(1)}s`
  );
  return 0;
}

const argv = process.argv.slice(2);
main(argv).then(
  code => process.exit(code),
  err => {
    console.error(err);
    process.exit(1);
  }
);
