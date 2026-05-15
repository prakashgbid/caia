import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  bootstrapNewChain,
  deriveLogSlug,
  deriveRunnerName,
  deriveWakeName,
  parseCron,
  renderScheduleBlock,
  renderTemplate,
} from '../src/bootstrap-chain.js';

// H-47 tests — bootstrap-new-chain (chain-runner-battle-harden phase 12).
// Covers: cron parsing, plist schedule block rendering, template
// substitution, full bootstrap roundtrip (no-bootstrap mode).

const TEMPLATES_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'bin',
  'templates',
);

describe('parseCron', () => {
  it('parses every-15-minute cron', () => {
    expect(parseCron('*/15 * * * *')).toEqual({ Minute: [0, 15, 30, 45] });
  });

  it('parses single fixed minute', () => {
    expect(parseCron('3 * * * *')).toEqual({ Minute: [3] });
  });

  it('parses comma-separated list', () => {
    expect(parseCron('3,18,33,48 * * * *')).toEqual({ Minute: [3, 18, 33, 48] });
  });

  it('parses fixed hour + minute', () => {
    expect(parseCron('0 2 * * *')).toEqual({ Minute: [0], Hour: [2] });
  });

  it('rejects wrong field count', () => {
    expect(() => parseCron('*/15 * *')).toThrow(/expected 5 fields/);
  });

  it('rejects out-of-range value', () => {
    expect(() => parseCron('99 * * * *')).toThrow(/invalid cron value/);
  });
});

describe('renderScheduleBlock', () => {
  it('renders every-15-minute schedule as four dicts', () => {
    const block = renderScheduleBlock({ Minute: [0, 15, 30, 45] });
    expect(block).toContain('<key>StartCalendarInterval</key>');
    expect(block).toContain('<integer>0</integer>');
    expect(block).toContain('<integer>15</integer>');
    expect(block).toContain('<integer>45</integer>');
    expect(block.match(/<dict>/g)?.length).toBe(4);
  });

  it('renders all-wildcards as one empty dict', () => {
    const block = renderScheduleBlock({});
    expect(block).toContain('<dict></dict>');
  });

  it('caps cartesian expansion', () => {
    // 24 hours × 4 minutes = 96 — exceeds the 60-entry cap.
    expect(() =>
      renderScheduleBlock({ Minute: [0, 15, 30, 45], Hour: Array.from({ length: 24 }, (_, i) => i) }),
    ).toThrow(/cron expansion exceeded/);
  });
});

describe('renderTemplate', () => {
  it('substitutes every placeholder', () => {
    const out = renderTemplate('{{CHAIN_ID}}/{{LABEL}}', {
      CHAIN_ID: 'my-chain',
      LABEL: 'com.x.y',
      // partial — the renderer only complains about referenced keys
    } as never);
    expect(out).toBe('my-chain/com.x.y');
  });

  it('throws on an unbound placeholder', () => {
    expect(() => renderTemplate('{{UNBOUND}}', {} as never)).toThrow(/no binding/);
  });
});

describe('derive helpers', () => {
  it('replaces dashes with underscores for log slug', () => {
    expect(deriveLogSlug('chain-runner-battle-harden')).toBe('chain_runner_battle_harden');
  });

  it('derives runner name from chain id', () => {
    expect(deriveRunnerName('apprentice-pull-forward')).toBe(
      '_apprentice_pull_forward_run_phase.sh',
    );
  });

  it('derives wake script name from chain id', () => {
    expect(deriveWakeName('redflag-remediation')).toBe('redflag-remediation_wake.sh');
  });
});

describe('bootstrapNewChain', () => {
  let root: string;
  let chainHomeBefore: string | undefined;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'caia-bootstrap-'));
    chainHomeBefore = process.env['CAIA_CHAIN_HOME'];
    process.env['CAIA_CHAIN_HOME'] = join(root, 'chain');
  });

  afterEach(() => {
    if (chainHomeBefore === undefined) {
      delete process.env['CAIA_CHAIN_HOME'];
    } else {
      process.env['CAIA_CHAIN_HOME'] = chainHomeBefore;
    }
    rmSync(root, { recursive: true, force: true });
  });

  function writePhases(): string {
    const p = join(root, 'phases.yaml');
    writeFileSync(
      p,
      `defaults: { max_retries: 1, max_minutes: 30 }\nphases:\n  - id: 1\n    name: only\n    deps: []\n    prompt_template: |\n      do stuff\n`,
    );
    return p;
  }

  it('generates wake + runner + plist + state.json with substitutions', () => {
    const phases = writePhases();
    const result = bootstrapNewChain({
      label: 'com.caia.chain-runner.bootstrap-test',
      chainId: 'bootstrap-test',
      phasesYaml: phases,
      schedule: '*/15 * * * *',
      noBootstrap: true,
      paths: {
        home: root,
        caiaChainBin: join(root, 'caia-chain.js'),
        watchdogDir: join(root, 'watchdog'),
        runnerDir: join(root, 'runner'),
        launchAgentsDir: join(root, 'agents'),
        templatesDir: TEMPLATES_DIR,
      },
    });

    expect(result.wakeScript).toBe(join(root, 'watchdog', 'bootstrap-test_wake.sh'));
    expect(result.runnerScript).toBe(join(root, 'runner', '_bootstrap_test_run_phase.sh'));
    expect(result.plist).toBe(join(root, 'agents', 'com.caia.chain-runner.bootstrap-test.plist'));
    expect(result.bootstrapped).toBe(false);

    const wake = readFileSync(result.wakeScript, 'utf8');
    expect(wake).toContain('CHAIN_ID="bootstrap-test"');
    expect(wake).toContain(`PHASES_FILE="${phases}"`);
    expect(wake).toContain('source "$HOME/.caia/chain-watchdog/_wake_helpers.sh"');
    expect(wake).toContain('emit-alert');

    const runner = readFileSync(result.runnerScript, 'utf8');
    expect(runner).toContain('CHAIN_ID="bootstrap-test"');
    expect(runner).toContain('source "$HOME/.caia/chain-watchdog/_dispatcher_helpers.sh"');
    expect(runner).toContain('claude \\');

    const plist = readFileSync(result.plist, 'utf8');
    expect(plist).toContain('<string>com.caia.chain-runner.bootstrap-test</string>');
    expect(plist).toContain(`<string>${result.wakeScript}</string>`);
    expect(plist).toContain('<integer>15</integer>');
    expect(plist).toContain('<integer>45</integer>');

    expect(existsSync(result.stateFile)).toBe(true);
    const state = JSON.parse(readFileSync(result.stateFile, 'utf8'));
    expect(state.paused).toBe(true);
    expect(state.paused_reason).toMatch(/bootstrap-new-chain/);
  });

  it('refuses to overwrite without --force', () => {
    const phases = writePhases();
    const customPaths = {
      home: root,
      caiaChainBin: join(root, 'caia-chain.js'),
      watchdogDir: join(root, 'watchdog'),
      runnerDir: join(root, 'runner'),
      launchAgentsDir: join(root, 'agents'),
      templatesDir: TEMPLATES_DIR,
    };
    bootstrapNewChain({
      label: 'com.caia.chain-runner.dup',
      chainId: 'dup-test',
      phasesYaml: phases,
      schedule: '*/15 * * * *',
      noBootstrap: true,
      paths: customPaths,
    });
    expect(() =>
      bootstrapNewChain({
        label: 'com.caia.chain-runner.dup',
        chainId: 'dup-test',
        phasesYaml: phases,
        schedule: '*/15 * * * *',
        noBootstrap: true,
        paths: customPaths,
      }),
    ).toThrow(/already exists/);
  });

  it('respects --start-unpaused', () => {
    const phases = writePhases();
    const result = bootstrapNewChain({
      label: 'com.caia.chain-runner.unpaused',
      chainId: 'unpaused-test',
      phasesYaml: phases,
      schedule: '*/15 * * * *',
      noBootstrap: true,
      startUnpaused: true,
      paths: {
        home: root,
        caiaChainBin: join(root, 'caia-chain.js'),
        watchdogDir: join(root, 'watchdog'),
        runnerDir: join(root, 'runner'),
        launchAgentsDir: join(root, 'agents'),
        templatesDir: TEMPLATES_DIR,
      },
    });
    const state = JSON.parse(readFileSync(result.stateFile, 'utf8'));
    expect(state.paused).toBe(false);
  });

  it('writes pointer files used by the watchdog shim', () => {
    const phases = writePhases();
    const result = bootstrapNewChain({
      label: 'com.caia.chain-runner.ptr',
      chainId: 'ptr-test',
      phasesYaml: phases,
      schedule: '*/15 * * * *',
      noBootstrap: true,
      paths: {
        home: root,
        caiaChainBin: join(root, 'caia-chain.js'),
        watchdogDir: join(root, 'watchdog'),
        runnerDir: join(root, 'runner'),
        launchAgentsDir: join(root, 'agents'),
        templatesDir: TEMPLATES_DIR,
      },
    });
    expect(readFileSync(result.phasesPointerFile, 'utf8').trim()).toBe(phases);
    expect(readFileSync(result.runnerPointerFile, 'utf8').trim()).toBe(result.runnerScript);
  });
});
