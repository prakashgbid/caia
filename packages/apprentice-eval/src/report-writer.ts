/**
 * report-writer — emits summary.md, score-cards.json, winrate-report.json,
 * config.json, and per-prompt outputs/<adapter>/<suite>/<prompt-id>.json.
 *
 * Per DESIGN.md §8 + §10.
 */

import { join } from 'node:path';

import type {
  AdapterWinrate,
  FsWriter,
  GenerateResult,
  PairwiseResult,
  RubricResult,
  RunConfigSnapshot,
  ScoreCardEntry,
  ScoreCards,
  WinrateReport
} from './types.js';

export interface WriteRunReportOpts {
  readonly outputDir: string;
  readonly generatedAt: string;
  readonly config: RunConfigSnapshot;
  readonly base: { readonly adapter: 'base'; readonly results: ReadonlyArray<RubricResult>; readonly outputs: ReadonlyArray<{ result: RubricResult; gen: GenerateResult }> };
  readonly adapters: ReadonlyArray<{
    readonly adapter: string;
    readonly results: ReadonlyArray<RubricResult>;
    readonly outputs: ReadonlyArray<{ result: RubricResult; gen: GenerateResult }>;
    readonly pairwise: ReadonlyArray<PairwiseResult>;
    readonly winrate: AdapterWinrate;
  }>;
  readonly writer: FsWriter;
}

function suitePassRateForBase(results: ReadonlyArray<RubricResult>): number {
  if (results.length === 0) return 0;
  let hits = 0;
  for (const r of results) if (r.weightedScore >= 0.5) hits += 1;
  return hits / results.length;
}

function fmtPct(n: number): string {
  if (Number.isNaN(n)) return 'n/a';
  return `${(n * 100).toFixed(1)}%`;
}

function fmtScore(n: number): string {
  return n.toFixed(2);
}

export function buildScoreCards(opts: {
  generatedAt: string;
  base: WriteRunReportOpts['base'];
  adapters: WriteRunReportOpts['adapters'];
}): ScoreCards {
  const entries: ScoreCardEntry[] = [];
  const allRuns = [
    { adapter: 'base', outputs: opts.base.outputs },
    ...opts.adapters.map((a) => ({ adapter: a.adapter, outputs: a.outputs }))
  ];
  for (const run of allRuns) {
    for (const o of run.outputs) {
      entries.push({
        ...o.result,
        elapsedMs: o.gen.elapsedMs,
        provider: o.gen.provider
      });
    }
  }
  return { version: 1, generatedAt: opts.generatedAt, entries };
}

export function buildWinrateReport(opts: {
  generatedAt: string;
  baseModel: string;
  base: WriteRunReportOpts['base'];
  adapters: WriteRunReportOpts['adapters'];
}): WinrateReport {
  return {
    version: 1,
    generatedAt: opts.generatedAt,
    base: {
      model: opts.baseModel,
      suitePassRate: suitePassRateForBase(opts.base.results)
    },
    adapters: opts.adapters.map((a) => a.winrate),
    pairwise: opts.adapters.flatMap((a) => a.pairwise)
  };
}

export function buildSummaryMd(opts: {
  generatedAt: string;
  baseModel: string;
  base: WriteRunReportOpts['base'];
  adapters: WriteRunReportOpts['adapters'];
}): string {
  const basePass = suitePassRateForBase(opts.base.results);
  const lines: string[] = [];
  lines.push(`# Apprentice eval run — ${opts.generatedAt}`);
  lines.push('');
  lines.push(`Base: \`${opts.baseModel}\``);
  if (opts.adapters.length === 0) {
    lines.push('No adapters scored.');
  } else {
    lines.push(`Adapters scored: ${opts.adapters.map((a) => `\`${a.adapter}\``).join(', ')}`);
  }
  lines.push('');
  lines.push('| Adapter | Suite pass-rate | Win-rate vs base | Regressions | Decision |');
  lines.push('|---|---|---|---|---|');
  lines.push(`| (base) | ${fmtPct(basePass)} | — | — | (baseline) |`);
  for (const a of opts.adapters) {
    const decision =
      a.winrate.decision === 'promote-canary'
        ? 'promote to canary'
        : a.winrate.decision === 'reject-regression'
          ? 'reject — regressions'
          : a.winrate.decision === 'reject-winrate'
            ? `reject — winrate < threshold`
            : 'reject — no decisive prompts';
    lines.push(
      `| ${a.adapter} | ${fmtPct(a.winrate.suitePassRate)} | ${fmtPct(a.winrate.winRate)} | ${a.winrate.regressions.length} | ${decision} |`
    );
  }
  lines.push('');
  for (const a of opts.adapters) {
    const wins = a.pairwise.filter((p) => p.outcome === 'win').sort((x, y) => y.delta - x.delta);
    const losses = a.pairwise.filter((p) => p.outcome === 'loss').sort((x, y) => x.delta - y.delta);
    if (wins.length > 0) {
      lines.push(`## Top wins (${a.adapter} over base)`);
      for (const w of wins.slice(0, 5)) {
        lines.push(`- \`${w.suiteId}/${w.promptId}\` — base ${fmtScore(w.baseScore)} → adapter ${fmtScore(w.adapterScore)}`);
      }
      lines.push('');
    }
    if (losses.length > 0) {
      lines.push(`## Top losses (${a.adapter} vs base)`);
      for (const l of losses.slice(0, 5)) {
        const flagged = a.winrate.regressions.some(
          (r) => r.promptId === l.promptId && r.suiteId === l.suiteId
        );
        lines.push(
          `- \`${l.suiteId}/${l.promptId}\` — base ${fmtScore(l.baseScore)} → adapter ${fmtScore(l.adapterScore)}${flagged ? ' (regression flagged)' : ''}`
        );
      }
      lines.push('');
    }
  }
  return lines.join('\n');
}

export async function writeRunReport(opts: WriteRunReportOpts): Promise<{
  scoreCardsPath: string;
  winrateReportPath: string;
  summaryPath: string;
  configPath: string;
}> {
  await opts.writer.mkdir(opts.outputDir);
  await opts.writer.mkdir(join(opts.outputDir, 'outputs'));

  // Per-prompt output dump.
  for (const o of opts.base.outputs) {
    const dir = join(opts.outputDir, 'outputs', 'base', o.result.suiteId);
    await opts.writer.mkdir(dir);
    await opts.writer.writeFile(
      join(dir, `${o.result.promptId}.json`),
      JSON.stringify({ result: o.result, gen: o.gen }, null, 2) + '\n'
    );
  }
  for (const a of opts.adapters) {
    for (const o of a.outputs) {
      const dir = join(opts.outputDir, 'outputs', a.adapter, o.result.suiteId);
      await opts.writer.mkdir(dir);
      await opts.writer.writeFile(
        join(dir, `${o.result.promptId}.json`),
        JSON.stringify({ result: o.result, gen: o.gen }, null, 2) + '\n'
      );
    }
  }

  const scoreCards = buildScoreCards({
    generatedAt: opts.generatedAt,
    base: opts.base,
    adapters: opts.adapters
  });
  const winrateReport = buildWinrateReport({
    generatedAt: opts.generatedAt,
    baseModel: opts.config.baseModel,
    base: opts.base,
    adapters: opts.adapters
  });
  const summaryMd = buildSummaryMd({
    generatedAt: opts.generatedAt,
    baseModel: opts.config.baseModel,
    base: opts.base,
    adapters: opts.adapters
  });

  const scoreCardsPath = join(opts.outputDir, 'score-cards.json');
  const winrateReportPath = join(opts.outputDir, 'winrate-report.json');
  const summaryPath = join(opts.outputDir, 'summary.md');
  const configPath = join(opts.outputDir, 'config.json');

  await opts.writer.writeFile(scoreCardsPath, JSON.stringify(scoreCards, null, 2) + '\n');
  await opts.writer.writeFile(winrateReportPath, JSON.stringify(winrateReport, null, 2) + '\n');
  await opts.writer.writeFile(summaryPath, summaryMd);
  await opts.writer.writeFile(configPath, JSON.stringify(opts.config, null, 2) + '\n');

  return { scoreCardsPath, winrateReportPath, summaryPath, configPath };
}

export const __TEST_ONLY = { fmtPct, fmtScore, suitePassRateForBase };
