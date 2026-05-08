#!/usr/bin/env node
/**
 * A/B harness for the Mem0 swap (validation decision #4, 2026-05-06).
 *
 * Builds BOTH backends (sqlite-vec Phase-1 + Mem0 Phase-2) from the
 * SAME CAIA corpus (agent/memory + ~/Documents/projects/reports) and
 * runs 10 canonical retrieval queries against each. Writes a
 * side-by-side markdown report.
 *
 * Required environment:
 *   - Ollama running at http://127.0.0.1:11434
 *   - nomic-embed-text pulled
 *
 * Usage:
 *   node packages/librarian/scripts/ab-harness.mjs <memoryDir> [<reportsDir>] [<outputPath>]
 *
 * No Anthropic / OpenAI API keys required (per
 * feedback_no_api_key_billing.md). All embeddings via local Ollama.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

import {
  buildIndex,
  retrievePrecedent,
  buildMem0Index,
  retrieveMem0Precedent,
  Mem0Backend,
  createOllamaEmbedder,
} from '../dist/index.js';

const memoryDir = process.argv[2];
const reportsDir = process.argv[3];
const outputPath = process.argv[4] ?? `${process.env.HOME}/Documents/projects/reports/mem0-vs-sqlite-vec-ab-2026-05-06.md`;

if (!memoryDir) {
  console.error('Usage: ab-harness.mjs <memoryDir> [<reportsDir>] [<outputPath>]');
  process.exit(1);
}

// 10 canonical queries spanning the corpus's main topical seams.
// Hand-picked from validation decisions, no-API-key seam, Option E,
// agent ecosystem, evidence gate, and master backlog.
const QUERIES = [
  { q: 'Was the Aider pilot approved?', expectAny: ['feedback_validation_decisions', 'aider'] },
  { q: 'Can we use the Anthropic API key?', expectAny: ['feedback_no_api_key_billing'] },
  { q: 'What is Option E for agent architecture?', expectAny: ['agent_architecture_shape'] },
  { q: 'How does Mentor pre-spawn injection work?', expectAny: ['mentor', 'agent_ecosystem'] },
  { q: 'What is the master backlog sequencing for the next leg?', expectAny: ['master_backlog'] },
  { q: 'How does Promptfoo fit into CAIA evaluation?', expectAny: ['enterprise', 'prompt-evals', 'apprentice_agent', 'feedback_validation_decisions'] },
  { q: 'Should the operator review code in Cursor?', expectAny: ['feedback_operator', 'feedback_validation_decisions'] },
  { q: 'When does the A2A protocol check-in fire?', expectAny: ['feedback_validation_decisions', 'a2a'] },
  { q: 'What are the Evidence Gate contexts?', expectAny: ['gate_', 'evidence_'] },
  { q: 'How is Apprentice Phase 0 sequenced?', expectAny: ['apprentice', 'master_backlog'] },
];

function pct(n, total) {
  if (total === 0) return '0.0%';
  return `${((n / total) * 100).toFixed(1)}%`;
}

function fmtMs(ms) {
  return `${ms.toFixed(0)}ms`;
}

function topMatchesAny(top, expectAny) {
  if (top.length === 0) return false;
  const slug = (top[0]?.slug ?? '').toLowerCase();
  return expectAny.some(e => slug.includes(e.toLowerCase()));
}

function topNJaccard(a, b, n = 3) {
  const setA = new Set(a.slice(0, n).map(r => r.slug));
  const setB = new Set(b.slice(0, n).map(r => r.slug));
  let inter = 0;
  for (const s of setA) if (setB.has(s)) inter++;
  const union = setA.size + setB.size - inter;
  return union === 0 ? 1 : inter / union;
}

async function main() {
  console.error(`A/B harness — memoryDir=${memoryDir}`);
  if (reportsDir) console.error(`               reportsDir=${reportsDir}`);

  const tmp = mkdtempSync(join(tmpdir(), 'librarian-ab-'));
  // Use isolated index DBs in the tmp dir so we don't interfere with the
  // live CAIA index. Mem0 backend will create its own DBs in tmp too.
  const sqliteDbPath = join(tmp, '_librarian-index.sqlite');
  const mem0DbPath = join(tmp, '_librarian-mem0-index.sqlite');
  const mem0HistoryPath = join(tmp, '_librarian-mem0-history.sqlite');

  const embed = createOllamaEmbedder();

  console.error('\n=== Building sqlite-vec index ===');
  const t0a = performance.now();
  const sqliteStats = await buildIndex({
    memoryDir,
    reportsDir: reportsDir || undefined,
    embed,
    log: (m) => console.error(`  ${m}`),
    dbPath: sqliteDbPath,
  });
  const sqliteBuildMs = performance.now() - t0a;
  console.error(`  scanned=${sqliteStats.scanned} embedded=${sqliteStats.embeddedNew} reused=${sqliteStats.reusedUnchanged} stale=${sqliteStats.removedStale} failed=${sqliteStats.failedEmbed} elapsed=${fmtMs(sqliteBuildMs)}`);

  console.error('\n=== Building mem0 index ===');
  const mem0Backend = new Mem0Backend({
    memoryDir,
    vectorStoreDbPath: mem0DbPath,
    historyDbPath: mem0HistoryPath,
    userId: 'caia-librarian-ab',
  });
  const t0b = performance.now();
  const mem0Stats = await buildMem0Index({
    memoryDir,
    reportsDir: reportsDir || undefined,
    backend: mem0Backend,
    log: (m) => console.error(`  ${m}`),
  });
  const mem0BuildMs = performance.now() - t0b;
  console.error(`  scanned=${mem0Stats.scanned} embedded=${mem0Stats.embeddedNew} reused=${mem0Stats.reusedUnchanged} stale=${mem0Stats.removedStale} failed=${mem0Stats.failedEmbed} elapsed=${fmtMs(mem0BuildMs)}`);

  console.error('\n=== Running queries ===');
  const rows = [];
  for (const { q, expectAny } of QUERIES) {
    const ts = performance.now();
    const sqliteRes = await retrievePrecedent(q, {
      memoryDir,
      embed,
      topN: 5,
      minSimilarity: 0.0,
      dbPath: sqliteDbPath,
    });
    const sqliteMs = performance.now() - ts;

    const tm = performance.now();
    const mem0Res = await retrieveMem0Precedent(q, {
      memoryDir,
      backend: mem0Backend,
      topN: 5,
      minSimilarity: 0.0,
    });
    const mem0Ms = performance.now() - tm;

    const sqliteHit = topMatchesAny(sqliteRes, expectAny);
    const mem0Hit = topMatchesAny(mem0Res, expectAny);
    const jaccard = topNJaccard(sqliteRes, mem0Res, 3);
    rows.push({ q, expectAny, sqliteRes, mem0Res, sqliteMs, mem0Ms, sqliteHit, mem0Hit, jaccard });
    console.error(`  Q: ${q}`);
    console.error(`     sqlite top-1: ${sqliteRes[0]?.slug ?? '(none)'}@${(sqliteRes[0]?.similarity ?? 0).toFixed(3)}  ${sqliteHit ? 'HIT' : 'miss'}  ${fmtMs(sqliteMs)}`);
    console.error(`     mem0   top-1: ${mem0Res[0]?.slug ?? '(none)'}@${(mem0Res[0]?.similarity ?? 0).toFixed(3)}  ${mem0Hit ? 'HIT' : 'miss'}  ${fmtMs(mem0Ms)}`);
  }

  // Summarize.
  const sqliteHits = rows.filter(r => r.sqliteHit).length;
  const mem0Hits = rows.filter(r => r.mem0Hit).length;
  const sqliteAvgMs = rows.reduce((s, r) => s + r.sqliteMs, 0) / rows.length;
  const mem0AvgMs = rows.reduce((s, r) => s + r.mem0Ms, 0) / rows.length;
  const sqliteSorted = [...rows.map(r => r.sqliteMs)].sort((a, b) => a - b);
  const mem0Sorted = [...rows.map(r => r.mem0Ms)].sort((a, b) => a - b);
  const sqliteP95 = sqliteSorted[Math.max(0, Math.ceil(sqliteSorted.length * 0.95) - 1)];
  const mem0P95 = mem0Sorted[Math.max(0, Math.ceil(mem0Sorted.length * 0.95) - 1)];
  const avgJaccard = rows.reduce((s, r) => s + r.jaccard, 0) / rows.length;

  // Verdict logic.
  let verdict;
  if (mem0Hits >= 9 && mem0P95 <= sqliteP95 * 2) {
    verdict = 'DEFAULT-FLIP recommended (Mem0 ≥ sqlite-vec on top-1 ≥ 9/10, latency p95 ≤ 2× sqlite-vec)';
  } else if (Math.abs(mem0Hits - sqliteHits) <= 1 && mem0P95 <= sqliteP95 * 2) {
    verdict = 'PARITY (keep both backends; sqlite-vec stays default)';
  } else {
    verdict = 'REGRESSION (Mem0 not yet ready; sqlite-vec stays default)';
  }

  // Markdown output.
  const lines = [];
  lines.push('# Mem0 vs sqlite-vec — A/B harness results');
  lines.push('');
  lines.push(`**Date:** 2026-05-06`);
  lines.push(`**Author:** mem0-swap leg #1`);
  lines.push(`**Validation decision:** #4 (operator-approved 2026-05-06)`);
  lines.push(`**Companion design:** \`packages/librarian/src/backends/mem0-backend.DESIGN.md\``);
  lines.push(`**Companion investigation:** \`~/Documents/projects/reports/mem0-swap-investigation-2026-05-06.md\``);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push('| Metric | sqlite-vec | mem0 |');
  lines.push('|---|---|---|');
  lines.push(`| Top-1 hits (out of 10) | ${sqliteHits} | ${mem0Hits} |`);
  lines.push(`| Build elapsed (full) | ${fmtMs(sqliteBuildMs)} | ${fmtMs(mem0BuildMs)} |`);
  lines.push(`| Files scanned | ${sqliteStats.scanned} | ${mem0Stats.scanned} |`);
  lines.push(`| Files embedded | ${sqliteStats.embeddedNew} | ${mem0Stats.embeddedNew} |`);
  lines.push(`| Files failed | ${sqliteStats.failedEmbed} | ${mem0Stats.failedEmbed} |`);
  lines.push(`| Avg query latency | ${fmtMs(sqliteAvgMs)} | ${fmtMs(mem0AvgMs)} |`);
  lines.push(`| P95 query latency | ${fmtMs(sqliteP95)} | ${fmtMs(mem0P95)} |`);
  lines.push(`| Top-3 Jaccard (avg) | — | ${avgJaccard.toFixed(3)} |`);
  lines.push('');
  lines.push(`### Verdict: ${verdict}`);
  lines.push('');
  lines.push('## Per-query results');
  lines.push('');
  for (const r of rows) {
    lines.push(`### Q: ${r.q}`);
    lines.push('');
    lines.push(`Expected slug substring (any): \`${r.expectAny.join('` | `')}\``);
    lines.push('');
    lines.push('| Backend | Top-1 slug | Similarity | Latency | Hit? |');
    lines.push('|---|---|---|---|---|');
    lines.push(`| sqlite-vec | ${r.sqliteRes[0]?.slug ?? '(none)'} | ${(r.sqliteRes[0]?.similarity ?? 0).toFixed(3)} | ${fmtMs(r.sqliteMs)} | ${r.sqliteHit ? 'yes' : 'NO'} |`);
    lines.push(`| mem0 | ${r.mem0Res[0]?.slug ?? '(none)'} | ${(r.mem0Res[0]?.similarity ?? 0).toFixed(3)} | ${fmtMs(r.mem0Ms)} | ${r.mem0Hit ? 'yes' : 'NO'} |`);
    lines.push('');
    lines.push(`Top-3 Jaccard: \`${r.jaccard.toFixed(3)}\``);
    lines.push('');
    lines.push('Top-3 sqlite-vec:');
    for (let i = 0; i < Math.min(3, r.sqliteRes.length); i++) {
      const x = r.sqliteRes[i];
      lines.push(`- ${i + 1}. \`${x.slug}\` (${x.kind}) similarity=${x.similarity.toFixed(3)}`);
    }
    lines.push('');
    lines.push('Top-3 mem0:');
    for (let i = 0; i < Math.min(3, r.mem0Res.length); i++) {
      const x = r.mem0Res[i];
      lines.push(`- ${i + 1}. \`${x.slug}\` (${x.kind}) similarity=${x.similarity.toFixed(3)}`);
    }
    lines.push('');
  }
  lines.push('## Reproduction');
  lines.push('');
  lines.push('```sh');
  lines.push(`pnpm -C packages/librarian build`);
  lines.push(`node packages/librarian/scripts/ab-harness.mjs \\\\`);
  lines.push(`  '${memoryDir}' \\\\`);
  lines.push(`  '${reportsDir ?? ''}'`);
  lines.push('```');

  writeFileSync(outputPath, lines.join('\n') + '\n');
  console.error(`\n=== Report written to ${outputPath} ===`);
  console.error(`Verdict: ${verdict}`);

  rmSync(tmp, { recursive: true, force: true });
}

main().catch((e) => {
  console.error(`Fatal: ${e?.stack ?? e?.message ?? e}`);
  process.exit(1);
});
