import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import yaml from 'js-yaml';
import {
  scaffoldFromBacklogItem,
  buildChainSpec,
  buildInitialState,
  validateBacklogItem,
  chainPaths,
  deriveLogSlug,
  renderRunnerScript,
  type BacklogItem,
} from '../src/templated.js';
import { parseBacklog, listPending, nextAvailable } from '../src/backlog.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = resolve(__dirname, '..', 'tests', 'fixtures', 'sample-item.yaml');

function loadFixture(): BacklogItem {
  const raw = yaml.load(readFileSync(FIXTURE_PATH, 'utf8'));
  validateBacklogItem(raw);
  return raw;
}

let tmpHome: string;

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'scaffolder-test-'));
});

afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true });
});

describe('validateBacklogItem', () => {
  it('accepts the fixture as-is', () => {
    const raw = yaml.load(readFileSync(FIXTURE_PATH, 'utf8'));
    expect(() => validateBacklogItem(raw)).not.toThrow();
  });

  it('rejects unknown machine', () => {
    const raw = yaml.load(readFileSync(FIXTURE_PATH, 'utf8')) as Record<string, unknown>;
    raw.machine = 'desktop';
    expect(() => validateBacklogItem(raw)).toThrow(/machine must be one of/);
  });

  it('rejects out-of-range phase_count', () => {
    const raw = yaml.load(readFileSync(FIXTURE_PATH, 'utf8')) as Record<string, unknown>;
    raw.phase_count = 4;
    expect(() => validateBacklogItem(raw)).toThrow(/phase_count must be an integer in \[1, 3\]/);
  });

  it('rejects bad id (uppercase / leading dash)', () => {
    const raw = yaml.load(readFileSync(FIXTURE_PATH, 'utf8')) as Record<string, unknown>;
    raw.id = 'Bad-ID';
    expect(() => validateBacklogItem(raw)).toThrow(/invalid id/);
  });
});

describe('deriveLogSlug', () => {
  it('replaces dashes with underscores', () => {
    expect(deriveLogSlug('foo-bar-baz')).toBe('foo_bar_baz');
  });
});

describe('chainPaths', () => {
  it('uses HOME-relative locations', () => {
    const p = chainPaths('foo-bar', '/tmp/h');
    expect(p.stateFile).toBe('/tmp/h/.caia/chain/foo-bar/state.json');
    expect(p.phasesYaml).toBe('/tmp/h/Documents/projects/agent-memory/foo_bar_phases.yaml');
    expect(p.runnerScript).toBe('/tmp/h/Documents/projects/agent-memory/_foo_bar_run_phase.sh');
    expect(p.phaseLogDir).toBe('/tmp/h/Documents/projects/agent-memory/_foo_bar_phase_logs');
  });
});

describe('buildInitialState', () => {
  it('paused, schema_version=2, all phases pending', () => {
    const item = loadFixture();
    const state = buildInitialState(item);
    expect(state.schema_version).toBe(2);
    expect(state.paused).toBe(true);
    expect(state.all_done).toBe(false);
    expect(state.budget_cap_pct).toBe(25);
    expect(state.chain_id).toBe(item.id);
    expect(Object.keys(state.phase_status)).toEqual(['1']);
    expect(state.phase_status['1']?.status).toBe('pending');
    expect(state.phase_status['1']?.heartbeat_grace_sec).toBe(1800);
  });

  it('respects phase_count=3', () => {
    const item = { ...loadFixture(), phase_count: 3 };
    const state = buildInitialState(item);
    expect(Object.keys(state.phase_status).sort()).toEqual(['1', '2', '3']);
  });
});

describe('buildChainSpec', () => {
  it('phase_count=1 → single implement phase, no deps[]', () => {
    const spec = buildChainSpec(loadFixture());
    expect(spec.phases).toHaveLength(1);
    expect(spec.phases[0]?.name).toBe('implement');
    expect(spec.phases[0]?.deps).toEqual([]);
    expect(spec.phases[0]?.success_criteria.requires_merged_pr).toBe(true);
    expect(spec.chain_config.machine).toBe('m3');
  });

  it('phase_count=2 → implement → demonstrate, deps wired', () => {
    const spec = buildChainSpec({ ...loadFixture(), phase_count: 2 });
    expect(spec.phases).toHaveLength(2);
    expect(spec.phases[0]?.name).toBe('implement');
    expect(spec.phases[1]?.name).toBe('demonstrate_and_report');
    expect(spec.phases[1]?.deps).toEqual([1]);
  });

  it('phase_count=3 → investigate → implement → demonstrate', () => {
    const spec = buildChainSpec({ ...loadFixture(), phase_count: 3 });
    expect(spec.phases.map((p) => p.name)).toEqual([
      'investigate',
      'implement',
      'demonstrate_and_report',
    ]);
    expect(spec.phases[0]?.deps).toEqual([]);
    expect(spec.phases[1]?.deps).toEqual([1]);
    expect(spec.phases[2]?.deps).toEqual([2]);
    // requires_merged_pr only on the implement phase
    expect(spec.phases[1]?.success_criteria.requires_merged_pr).toBe(true);
    expect(spec.phases[2]?.success_criteria.requires_merged_pr).toBeUndefined();
  });

  it('grep_match lands on the LAST phase only (where the final report is)', () => {
    const spec = buildChainSpec({ ...loadFixture(), phase_count: 3 });
    expect(spec.phases[0]?.success_criteria.grep_match).toBeUndefined();
    expect(spec.phases[2]?.success_criteria.grep_match).toBe('JSDoc|parseCron');
  });
});

describe('renderRunnerScript', () => {
  it('produces a bash script with bypassPermissions, heartbeat loop, and the right chain id', () => {
    const out = renderRunnerScript({
      chainId: 'sample-readme-jsdoc',
      phasesYaml: '/tmp/p.yaml',
      phaseLogDir: '/tmp/logs',
      generatedAt: '2026-05-16T00:00:00Z',
      fileScope: ['x.ts'],
    });
    expect(out.startsWith('#!/bin/bash')).toBe(true);
    expect(out).toContain('CHAIN_ID="sample-readme-jsdoc"');
    expect(out).toContain('PHASES_FILE="/tmp/p.yaml"');
    expect(out).toContain('LOG_DIR="/tmp/logs"');
    expect(out).toContain('--permission-mode bypassPermissions');
    expect(out).toContain('"$NODE_BIN" "$CAIA_CHAIN" heartbeat');
    expect(out).toContain('node@22');
  });
});

describe('scaffoldFromBacklogItem', () => {
  it('writes state.json + phases.yaml + runner.sh and returns their paths', () => {
    const item = loadFixture();
    const result = scaffoldFromBacklogItem(item, { home: tmpHome });
    expect(result.chainId).toBe(item.id);
    expect(existsSync(result.stateFile)).toBe(true);
    expect(existsSync(result.phasesYaml)).toBe(true);
    expect(existsSync(result.runnerScript)).toBe(true);
    expect(existsSync(result.phaseLogDir)).toBe(true);
    // runner is executable
    expect(statSync(result.runnerScript).mode & 0o111).not.toBe(0);
  });

  it('round-trips: state.json is JSON, phases.yaml is YAML, runner is bash', () => {
    const item = loadFixture();
    const result = scaffoldFromBacklogItem(item, { home: tmpHome });

    const state = JSON.parse(readFileSync(result.stateFile, 'utf8'));
    expect(state.chain_id).toBe(item.id);
    expect(state.paused).toBe(true);
    expect(state.phase_status['1'].status).toBe('pending');

    const spec = yaml.load(readFileSync(result.phasesYaml, 'utf8')) as Record<string, unknown>;
    expect(Array.isArray(spec.phases)).toBe(true);
    const phases = spec.phases as Array<Record<string, unknown>>;
    expect(phases[0]?.name).toBe('implement');
    expect((phases[0]?.prompt_template as string).startsWith('Phase 1 — ')).toBe(true);
    expect(phases[0]?.prompt_template).toContain(item.title);

    const runner = readFileSync(result.runnerScript, 'utf8');
    expect(runner.startsWith('#!/bin/bash')).toBe(true);
    expect(runner).toContain(`CHAIN_ID="${item.id}"`);

    // bash -n smoke parse: catches trivial syntax errors before dispatch.
    const parse = spawnSync('bash', ['-n', result.runnerScript]);
    expect(parse.status).toBe(0);
  });

  it('refuses to overwrite without --force', () => {
    const item = loadFixture();
    scaffoldFromBacklogItem(item, { home: tmpHome });
    expect(() => scaffoldFromBacklogItem(item, { home: tmpHome })).toThrow(/already exists/);
  });

  it('overwrites with --force', () => {
    const item = loadFixture();
    scaffoldFromBacklogItem(item, { home: tmpHome });
    expect(() =>
      scaffoldFromBacklogItem(item, { home: tmpHome, force: true }),
    ).not.toThrow();
  });

  it('generated phases.yaml round-trips through the chain-runner spec loader (smoke)', () => {
    // We can't import @chiefaia/chain-runner here without a workspace dep
    // dance, but the spec shape is small + stable: phases[].id + .name
    // are the strict-validated fields. Re-validate them here to catch
    // future drift in the renderer.
    const item = loadFixture();
    const result = scaffoldFromBacklogItem(item, { home: tmpHome });
    const spec = yaml.load(readFileSync(result.phasesYaml, 'utf8')) as Record<string, unknown>;
    expect(spec.phases).toBeTruthy();
    for (const p of spec.phases as Array<Record<string, unknown>>) {
      expect(typeof p.id).toBe('number');
      expect(typeof p.name).toBe('string');
      expect(typeof p.prompt_template).toBe('string');
      expect((p.prompt_template as string).length).toBeGreaterThan(50);
    }
  });

  it('generated state.json matches the chain-runner v2 schema fields the runtime requires', () => {
    const item = loadFixture();
    const result = scaffoldFromBacklogItem(item, { home: tmpHome });
    const state = JSON.parse(readFileSync(result.stateFile, 'utf8'));
    // Runtime-required fields per state.ts:buildInitialState.
    for (const k of [
      'schema_version',
      'paused',
      'paused_at',
      'paused_reason',
      'paused_until',
      'budget_consumed_pct',
      'budget_cap_pct',
      'phase_status',
      'current_phase',
      'all_done',
      'none_eligible_streak',
    ]) {
      expect(state).toHaveProperty(k);
    }
    for (const p of Object.values(state.phase_status) as Array<Record<string, unknown>>) {
      for (const k of [
        'status',
        'attempts',
        'max_retries',
        'max_minutes',
        'started_at',
        'completed_at',
        'session_id',
        'error',
        'failure',
        'last_failure_class',
        'backoff_until',
        'heartbeat_grace_sec',
      ]) {
        expect(p).toHaveProperty(k);
      }
    }
  });
});

describe('backlog discovery', () => {
  function writeItem(dir: string, name: string, body: Partial<BacklogItem> & { id: string }): void {
    mkdirSync(dir, { recursive: true });
    const merged: BacklogItem = {
      title: 'demo',
      description: 'demo',
      machine: 'm3',
      file_paths: ['x'],
      success_criteria: {
        output_file: '~/Documents/projects/reports/demo.md',
        min_bytes: 100,
        requires_merged_pr: false,
      },
      phase_count: 1,
      deps: [],
      demonstrate_step: 'echo ok',
      ...body,
    } as BacklogItem;
    writeFileSync(join(dir, name), yaml.dump(merged), 'utf8');
  }

  it('walks a directory of yaml files and indexes each item', () => {
    const dir = join(tmpHome, 'backlog');
    writeItem(dir, 'a.yaml', { id: 'thing-a' });
    writeItem(dir, 'b.yaml', { id: 'thing-b' });
    const idx = parseBacklog(dir, { home: tmpHome });
    expect(idx.entries.map((e) => e.item.id).sort()).toEqual(['thing-a', 'thing-b']);
    expect(idx.errors).toEqual([]);
  });

  it('listPending omits items that already have chain-state', () => {
    const dir = join(tmpHome, 'backlog');
    writeItem(dir, 'a.yaml', { id: 'thing-a' });
    writeItem(dir, 'b.yaml', { id: 'thing-b' });
    scaffoldFromBacklogItem(loadFixture(), { home: tmpHome });
    // Scaffold thing-a so it disappears from pending.
    const aSpec = yaml.load(readFileSync(join(dir, 'a.yaml'), 'utf8')) as BacklogItem;
    scaffoldFromBacklogItem(aSpec, { home: tmpHome });
    const pending = listPending(dir, { home: tmpHome });
    expect(pending.map((p) => p.item.id)).toEqual(['thing-b']);
  });

  it('nextAvailable respects deps: returns null when dep chain is not all_done', () => {
    const dir = join(tmpHome, 'backlog');
    writeItem(dir, 'b.yaml', { id: 'thing-b', deps: ['thing-a'] });
    expect(nextAvailable(dir, { home: tmpHome })).toBeNull();
  });

  it('nextAvailable returns the item once its dep chain reports all_done=true', () => {
    const dir = join(tmpHome, 'backlog');
    writeItem(dir, 'a.yaml', { id: 'thing-a' });
    writeItem(dir, 'b.yaml', { id: 'thing-b', deps: ['thing-a'] });
    // Scaffold thing-a, then mutate its state to all_done so thing-b unblocks.
    const aSpec = yaml.load(readFileSync(join(dir, 'a.yaml'), 'utf8')) as BacklogItem;
    const aResult = scaffoldFromBacklogItem(aSpec, { home: tmpHome });
    const aState = JSON.parse(readFileSync(aResult.stateFile, 'utf8'));
    aState.all_done = true;
    writeFileSync(aResult.stateFile, JSON.stringify(aState, null, 2));
    const next = nextAvailable(dir, { home: tmpHome });
    expect(next?.item.id).toBe('thing-b');
  });

  it('directs --backlog at MASTER_BACKLOG.md by reading sibling structured/ dir', () => {
    const dir = join(tmpHome, 'backlog');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'MASTER_BACKLOG.md'), '# header\n', 'utf8');
    writeItem(join(dir, 'structured'), 'a.yaml', { id: 'thing-a' });
    const idx = parseBacklog(join(dir, 'MASTER_BACKLOG.md'), { home: tmpHome });
    expect(idx.entries.map((e) => e.item.id)).toEqual(['thing-a']);
  });

  it('captures bad items in errors[] without aborting the walk', () => {
    const dir = join(tmpHome, 'backlog');
    writeItem(dir, 'good.yaml', { id: 'good' });
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'bad.yaml'), 'not_an_item: true\n');
    const idx = parseBacklog(dir, { home: tmpHome });
    expect(idx.entries.map((e) => e.item.id)).toEqual(['good']);
    expect(idx.errors).toHaveLength(1);
    expect(idx.errors[0]?.source.endsWith('bad.yaml')).toBe(true);
  });
});
