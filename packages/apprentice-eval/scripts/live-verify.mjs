#!/usr/bin/env node
/**
 * Stage-8 live-verify probe (compiled-build form, .mjs).
 *
 * Imports the package's built dist/ to exercise rubric + pairwise + ollama
 * against live Ollama. See scripts/preflight.sh for prereqs.
 *
 * Usage:
 *   node scripts/live-verify.mjs [--base <tag>] [--degraded <tag>] [--cap N]
 *
 * Without a real LoRA adapter, "degraded" is a different (less-capable)
 * model tag — exercises the same rubric+pairwise pipeline that a real
 * adapter would.
 */

import { join, dirname } from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { aggregate } from '../dist/pairwise.js';
import { applyDefaults, parseSuiteYaml } from '../dist/suite-loader.js';
import { scoreOne } from '../dist/rubric-scorer.js';
import { createOllamaClient } from '../dist/ollama-client.js';

function parseArgs(argv) {
  const out = {
    base: 'qwen2.5-coder:7b',
    degraded: 'llama3.1:8b',
    suiteIds: ['directive', 'feedback'],
    perSuiteCap: 3
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--base') out.base = argv[++i] ?? out.base;
    else if (a === '--degraded') out.degraded = argv[++i] ?? out.degraded;
    else if (a === '--suites') out.suiteIds = (argv[++i] ?? '').split(',').filter(Boolean);
    else if (a === '--cap') out.perSuiteCap = Number(argv[++i] ?? '3');
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  console.log(`[live-verify] base=${args.base} degraded=${args.degraded} suites=${args.suiteIds.join(',')} cap=${args.perSuiteCap}`);

  const ollama = createOllamaClient({
    baseUrl: process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434',
    perPromptTimeoutMs: 120_000
  });

  try {
    await ollama.ping();
  } catch (e) {
    console.error(`[live-verify] FAIL: Ollama unreachable: ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }

  const suites = [];
  for (const id of args.suiteIds) {
    const path = join(pkgRoot, 'suites', `${id}.yaml`);
    const text = await readFile(path, 'utf-8');
    suites.push(applyDefaults(parseSuiteYaml(text, path, id)));
  }

  const baseResults = [];
  const degradedResults = [];
  let i = 0;
  for (const suite of suites) {
    let n = 0;
    for (const test of suite.tests) {
      if (n >= args.perSuiteCap) break;
      n += 1;
      i += 1;
      console.log(`[live-verify] [${i}] ${suite.id}/${test.id} — base...`);
      const base = await ollama.generate({
        model: args.base,
        prompt: test.vars.prompt,
        seed: 42,
        temperature: 0,
        timeoutMs: 120_000
      });
      console.log(`[live-verify] [${i}] ${suite.id}/${test.id} — degraded...`);
      const degraded = await ollama.generate({
        model: args.degraded,
        prompt: test.vars.prompt,
        seed: 42,
        temperature: 0,
        timeoutMs: 120_000
      });
      const baseScore = await scoreOne({ suite, test, adapter: 'base', output: base.output });
      const degradedScore = await scoreOne({
        suite,
        test,
        adapter: 'degraded',
        output: degraded.output
      });
      baseResults.push(baseScore);
      degradedResults.push(degradedScore);
      console.log(
        `[live-verify] [${i}] base=${baseScore.weightedScore.toFixed(2)} degraded=${degradedScore.weightedScore.toFixed(2)}`
      );
    }
  }

  const { winrate } = aggregate({
    base: baseResults,
    adapter: degradedResults,
    adapterName: 'degraded',
    tieEpsilon: 0.05,
    winRateThreshold: 0.6,
    forgettingThreshold: 0.1
  });

  console.log('');
  console.log(`[live-verify] degraded vs base — wins=${winrate.wins} losses=${winrate.losses} ties=${winrate.ties}`);
  console.log(`[live-verify] winRate(degraded)=${winrate.winRate.toFixed(2)}`);
  console.log(`[live-verify] decision=${winrate.decision}`);

  if (Number.isNaN(winrate.winRate)) {
    console.log('[live-verify] YELLOW: no decisive prompts (all tied)');
    return 1;
  }
  if (winrate.winRate < 0.5) {
    console.log('[live-verify] GREEN: harness correctly identified the degraded model as worse');
    return 0;
  }
  if (winrate.winRate >= 0.5 && winrate.winRate < 0.6) {
    console.log('[live-verify] YELLOW: degraded model not decisively worse — but eval still ran end-to-end');
    return 1;
  }
  console.log('[live-verify] RED: degraded model scored higher than base — model labels may be reversed');
  return 2;
}

main().then(
  (c) => process.exit(c),
  (err) => {
    console.error(`[live-verify] failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    process.exit(2);
  }
);
