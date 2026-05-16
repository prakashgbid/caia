import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { scaffoldFromLlm } from '../src/llm.js';
import { specToYaml, parseScaffolderSpec } from '../src/schema.js';
import { makeFixtureProvider } from '../src/providers.js';
import type { LooseBacklogItem } from '../src/types.js';

const REPO_ROOT = resolve(__dirname, '../../..');
const CHAIN_RUNNER_CLI = resolve(REPO_ROOT, 'packages/chain-runner/bin/caia-chain.js');
const MASTER_BACKLOG = resolve(process.env.HOME ?? '~', 'Documents/projects/backlog/MASTER_BACKLOG.md');
const FIXTURE_DIR = resolve(__dirname, '../tests/fixtures');

/**
 * Pull a real loose backlog item out of MASTER_BACKLOG.md. We grab the first
 * "⏳ pending [INDEPENDENT]" line — those are the canonical "loose items"
 * the LLM scaffolder is supposed to handle.
 */
function pickLooseBacklogItem(): LooseBacklogItem {
  if (!existsSync(MASTER_BACKLOG)) {
    // CI / fresh checkouts may not have the backlog — fall back to a synthetic
    // loose item that exercises the same scaffolder code path.
    return {
      id: 'synthetic-cache-warmer',
      title: 'Synthetic cache warmer for embeddings',
      description: 'Warm the embedding cache at boot so cold-start latency drops below 200 ms.',
    };
  }
  const text = readFileSync(MASTER_BACKLOG, 'utf8');
  // Match: - **<TITLE>** · ... ⏳ pending [INDEPENDENT]
  const m = text.match(/-\s+\*\*([^*]+?)\*\*[^\n]*⏳\s+pending\s+\[INDEPENDENT\]/);
  if (!m) {
    return {
      id: 'synthetic-cache-warmer',
      title: 'Synthetic cache warmer for embeddings',
      description: 'Warm the embedding cache at boot so cold-start latency drops below 200 ms.',
    };
  }
  const rawTitle = m[1].trim();
  // Strip leading code refs like "A.5.3 " for the id
  const id =
    'backlog-' +
    rawTitle
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50);
  return {
    id,
    title: rawTitle.slice(0, 100),
    description: `Backlog-driven scaffold of "${rawTitle}". Loose item taken verbatim from ~/Documents/projects/backlog/MASTER_BACKLOG.md.`,
  };
}

describe('integration: scaffold-from-llm → chain-runner', () => {
  it('scaffolds a real loose backlog item, validates the chain shape, and survives caia-chain init', async () => {
    const item = pickLooseBacklogItem();

    // Provider: the bundled fixture response, which is shape-valid but mentions
    // a different item. The shape check is what matters here — we are
    // exercising the scaffolder + validator + emitter end-to-end, not the
    // semantic quality of the LLM (covered separately when wired up live).
    const provider = makeFixtureProvider(readFileSync(resolve(FIXTURE_DIR, 'loose_item_response.yaml'), 'utf8'));

    const result = await scaffoldFromLlm(item, {
      providerInstance: provider,
      routerBaseUrl: null,
      grepImpl: async () => [],
      fewShotExamplePath: resolve(FIXTURE_DIR, 'example_chain.yaml'),
      today: '2026-05-16',
    });

    expect(result.spec.phases.length).toBeGreaterThanOrEqual(1);

    // Emit YAML and round-trip-parse to confirm the emitter produces valid output.
    const yamlText = specToYaml(result.spec);
    const reparsed = parseScaffolderSpec(yamlText);
    expect(reparsed.phases).toEqual(result.spec.phases);

    // Write to a tmpdir and have the real chain-runner load it.
    const sandbox = mkdtempSync(join(tmpdir(), 'caia-scaffold-it-'));
    const phasesFile = join(sandbox, `${item.id}_phases.yaml`);
    writeFileSync(phasesFile, yamlText, 'utf8');

    const env = { ...process.env, CAIA_CHAIN_HOME: join(sandbox, 'chain') };
    // The chain-runner CLI exits 0 when init succeeds and 1 otherwise.
    execFileSync(
      process.execPath,
      [CHAIN_RUNNER_CLI, 'init', '--chain-id', item.id, '--phases', phasesFile],
      { env, stdio: 'pipe' },
    );
    const stateFile = join(sandbox, 'chain', item.id, 'state.json');
    expect(existsSync(stateFile)).toBe(true);
    const state = JSON.parse(readFileSync(stateFile, 'utf8'));
    expect(state.schema_version).toBeGreaterThanOrEqual(1);
    expect(state.phase_status).toBeTruthy();
    expect(state.phase_status['1']).toBeTruthy();
    expect(state.phase_status['1'].status).toBe('pending');

    // Confirm next-phase resolves cleanly to phase 1 (read-only, no mutation).
    const out = execFileSync(
      process.execPath,
      [
        CHAIN_RUNNER_CLI,
        'next-phase',
        '--chain-id',
        item.id,
        '--phases',
        phasesFile,
        '--read-only',
      ],
      { env, stdio: ['pipe', 'pipe', 'pipe'] },
    ).toString();
    expect(out.trim()).toMatch(/^1\s*$/);
  });
});
