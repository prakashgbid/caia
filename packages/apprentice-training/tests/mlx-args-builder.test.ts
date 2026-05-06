import { describe, it, expect } from 'vitest';
import { buildMlxLoraArgs, renderLoraConfigYaml } from '../src/mlx-args-builder.js';
import { resolveConfig, DEFAULT_LORA_CONFIG } from '../src/config.js';

describe('buildMlxLoraArgs', () => {
  it('emits the canonical flag set with default config', () => {
    const cfg = resolveConfig({});
    const inv = buildMlxLoraArgs({ cfg, workDir: '/work', adapterPath: '/adapter' });
    expect(inv.command).toBe('python3');
    expect(inv.args[0]).toBe('-m');
    expect(inv.args[1]).toBe('mlx_lm.lora');
    expect(inv.args).toContain('--train');
    expect(inv.args).toContain('--model');
    expect(inv.args).toContain(cfg.baseModel);
    expect(inv.args).toContain('--data');
    expect(inv.args).toContain('/work');
    expect(inv.args).toContain('--adapter-path');
    expect(inv.args).toContain('/adapter');
  });

  it('uses --num-layers (canonical) NOT --lora-layers', () => {
    const inv = buildMlxLoraArgs({
      cfg: resolveConfig({}),
      workDir: '/w',
      adapterPath: '/a'
    });
    expect(inv.args).toContain('--num-layers');
    expect(inv.args).not.toContain('--lora-layers');
  });

  it('passes numeric hyperparameters as strings', () => {
    const cfg = resolveConfig({
      loraConfig: { numLayers: 8, iters: 100, batchSize: 2, maxSeqLength: 1024, gradAccumulationSteps: 2 }
    });
    const inv = buildMlxLoraArgs({ cfg, workDir: '/w', adapterPath: '/a' });
    const argMap = pairs(inv.args);
    expect(argMap.get('--num-layers')).toBe('8');
    expect(argMap.get('--iters')).toBe('100');
    expect(argMap.get('--batch-size')).toBe('2');
    expect(argMap.get('--max-seq-length')).toBe('1024');
    expect(argMap.get('--grad-accumulation-steps')).toBe('2');
  });

  it('emits --grad-checkpoint when enabled, omits when disabled', () => {
    const enabled = buildMlxLoraArgs({ cfg: resolveConfig({}), workDir: '/w', adapterPath: '/a' });
    expect(enabled.args).toContain('--grad-checkpoint');

    const disabled = buildMlxLoraArgs({
      cfg: resolveConfig({ loraConfig: { gradCheckpoint: false } }),
      workDir: '/w',
      adapterPath: '/a'
    });
    expect(disabled.args).not.toContain('--grad-checkpoint');
  });

  it('emits --mask-prompt when enabled, omits when disabled', () => {
    const enabled = buildMlxLoraArgs({ cfg: resolveConfig({}), workDir: '/w', adapterPath: '/a' });
    expect(enabled.args).toContain('--mask-prompt');

    const disabled = buildMlxLoraArgs({
      cfg: resolveConfig({ loraConfig: { maskPrompt: false } }),
      workDir: '/w',
      adapterPath: '/a'
    });
    expect(disabled.args).not.toContain('--mask-prompt');
  });

  it('points --config at <workDir>/lora.yaml for rank/alpha/dropout passthrough', () => {
    const inv = buildMlxLoraArgs({
      cfg: resolveConfig({}),
      workDir: '/some/work',
      adapterPath: '/a'
    });
    const argMap = pairs(inv.args);
    expect(argMap.get('--config')).toBe('/some/work/lora.yaml');
  });

  it('emits the seed flag for determinism', () => {
    const inv = buildMlxLoraArgs({
      cfg: resolveConfig({ loraConfig: { seed: 12345 } }),
      workDir: '/w',
      adapterPath: '/a'
    });
    expect(pairs(inv.args).get('--seed')).toBe('12345');
  });

  it('uses configured python binary', () => {
    const inv = buildMlxLoraArgs({
      cfg: resolveConfig({ pythonBinaryPath: '/opt/venv/bin/python' }),
      workDir: '/w',
      adapterPath: '/a'
    });
    expect(inv.command).toBe('/opt/venv/bin/python');
  });
});

describe('renderLoraConfigYaml', () => {
  it('renders rank, scale (alpha/rank), dropout', () => {
    const yaml = renderLoraConfigYaml(DEFAULT_LORA_CONFIG);
    expect(yaml).toContain('rank: 8');
    expect(yaml).toContain('scale: 2');
    expect(yaml).toContain('dropout: 0');
    expect(yaml).toContain('lora_parameters:');
  });

  it('produces a stable, deterministic output', () => {
    const a = renderLoraConfigYaml(DEFAULT_LORA_CONFIG);
    const b = renderLoraConfigYaml(DEFAULT_LORA_CONFIG);
    expect(a).toBe(b);
  });
});

/** Group `--flag value` pairs out of an argv array. */
function pairs(args: string[]): Map<string, string> {
  const m = new Map<string, string>();
  for (let i = 0; i < args.length - 1; i++) {
    const cur = args[i];
    if (cur === undefined) continue;
    if (cur.startsWith('--')) {
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        m.set(cur, next);
      }
    }
  }
  return m;
}
