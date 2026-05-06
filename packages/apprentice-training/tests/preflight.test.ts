import { describe, it, expect } from 'vitest';
import { Preflight, REQUIRED_MLX_FLAGS } from '../src/preflight.js';
import { resolveConfig } from '../src/config.js';
import { createInMemoryFs, createFakeSubprocess } from './helpers/fakes.js';
import { PreflightError, MlxLmVersionIncompatibleError } from '../src/types.js';

describe('Preflight.run', () => {
  it('throws when adapter dir already exists', async () => {
    const fs = createInMemoryFs();
    fs.mkdir('/adapters/2026-05-06');
    const sub = createFakeSubprocess(fs, { logTail: REQUIRED_MLX_FLAGS.join('\n') });
    const cfg = resolveConfig({});
    const pre = new Preflight(fs, sub);
    await expect(
      pre.run({ cfg, adapterPath: '/adapters/2026-05-06', skipMlxLmCheck: true })
    ).rejects.toThrow(PreflightError);
  });

  it('creates work-dir + adapter-root if missing', async () => {
    const fs = createInMemoryFs();
    const sub = createFakeSubprocess(fs, { logTail: REQUIRED_MLX_FLAGS.join('\n') });
    const cfg = resolveConfig({
      workDirRoot: '/some/work',
      outputAdapterRoot: '/some/adapters'
    });
    const pre = new Preflight(fs, sub);
    await pre.run({ cfg, adapterPath: '/some/adapters/run-1', skipMlxLmCheck: true });
    expect(fs.exists('/some/work')).toBe(true);
    expect(fs.exists('/some/adapters')).toBe(true);
  });

  it('throws when cloudGpuEnabled=true (Phase 2 stub)', async () => {
    const fs = createInMemoryFs();
    const sub = createFakeSubprocess(fs);
    const cfg = resolveConfig({ cloudGpuEnabled: true });
    const pre = new Preflight(fs, sub);
    await expect(
      pre.run({ cfg, adapterPath: '/adapters/x', skipMlxLmCheck: true })
    ).rejects.toThrow(/cloudGpuEnabled/);
  });

  it('skips mlx-lm check when skipMlxLmCheck=true', async () => {
    const fs = createInMemoryFs();
    const sub = createFakeSubprocess(fs);
    const cfg = resolveConfig({});
    const pre = new Preflight(fs, sub);
    await pre.run({ cfg, adapterPath: '/adapters/x', skipMlxLmCheck: true });
    expect(sub.invocations.length).toBe(0);
  });

  it('throws MlxLmVersionIncompatibleError when mlx-lm --help omits required flags', async () => {
    const fs = createInMemoryFs();
    const sub = createFakeSubprocess(fs, {
      // Help output missing --num-layers + --max-seq-length
      logTail: '--train --model --data --adapter-path --iters --batch-size --learning-rate'
    });
    const cfg = resolveConfig({});
    const pre = new Preflight(fs, sub);
    await expect(
      pre.run({ cfg, adapterPath: '/adapters/x', skipMlxLmCheck: false })
    ).rejects.toThrow(MlxLmVersionIncompatibleError);
  });

  it('throws PreflightError when subprocess fails to invoke', async () => {
    const fs = createInMemoryFs();
    const sub = createFakeSubprocess(fs, { exitCode: 127, logTail: 'mlx_lm: not found' });
    const cfg = resolveConfig({});
    const pre = new Preflight(fs, sub);
    await expect(
      pre.run({ cfg, adapterPath: '/adapters/x', skipMlxLmCheck: false })
    ).rejects.toThrow(PreflightError);
  });

  it('warns when --lora-layers is found instead of --num-layers', async () => {
    const fs = createInMemoryFs();
    const sub = createFakeSubprocess(fs, {
      logTail: ['--lora-layers', ...REQUIRED_MLX_FLAGS.filter(f => f !== '--num-layers')].join('\n')
    });
    const cfg = resolveConfig({});
    const _pre = new Preflight(fs, sub);
    // missing --num-layers triggers the version-incompatible throw before the warning lands;
    // this test verifies the warning ALSO fires when --num-layers IS present.
    const sub2 = createFakeSubprocess(fs, {
      logTail: ['--lora-layers', ...REQUIRED_MLX_FLAGS].join('\n')
    });
    const pre2 = new Preflight(fs, sub2);
    const result = await pre2.run({ cfg, adapterPath: '/adapters/x2', skipMlxLmCheck: false });
    expect(result.warnings.find(w => w.includes('--lora-layers'))).toBeDefined();
  });
});
