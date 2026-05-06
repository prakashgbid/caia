import { describe, it, expect } from 'vitest';
import { Postflight } from '../src/postflight.js';
import { createInMemoryFs } from './helpers/fakes.js';
import { AdapterNotProducedError } from '../src/types.js';

describe('Postflight.run', () => {
  it('verifies adapter file + adapter_config.json + parses config', () => {
    const fs = createInMemoryFs({
      '/adapters/x/adapters.safetensors': 'binary-data-stub-nontrivial-bytes',
      '/adapters/x/adapter_config.json': JSON.stringify({ num_layers: 16, rank: 8 })
    });
    const post = new Postflight(fs);
    const result = post.run({ adapterPath: '/adapters/x', logTail: '' });
    expect(result.adapterFile).toBe('/adapters/x/adapters.safetensors');
    expect(result.adapterConfigFile).toBe('/adapters/x/adapter_config.json');
    expect(result.adapterFileBytes).toBeGreaterThan(0);
    expect((result.adapterConfig as { num_layers: number }).num_layers).toBe(16);
  });

  it('throws when adapters.safetensors missing', () => {
    const fs = createInMemoryFs({
      '/adapters/x/adapter_config.json': JSON.stringify({})
    });
    const post = new Postflight(fs);
    expect(() => post.run({ adapterPath: '/adapters/x', logTail: 'last log line' })).toThrow(
      AdapterNotProducedError
    );
  });

  it('throws when adapter_config.json missing', () => {
    const fs = createInMemoryFs({
      '/adapters/x/adapters.safetensors': 'data'
    });
    const post = new Postflight(fs);
    expect(() => post.run({ adapterPath: '/adapters/x', logTail: '' })).toThrow(
      AdapterNotProducedError
    );
  });

  it('throws when safetensors is empty (0 bytes)', () => {
    const fs = createInMemoryFs({
      '/adapters/x/adapters.safetensors': '',
      '/adapters/x/adapter_config.json': JSON.stringify({})
    });
    const post = new Postflight(fs);
    expect(() => post.run({ adapterPath: '/adapters/x', logTail: '' })).toThrow(/0 bytes/);
  });

  it('throws when adapter_config.json is invalid JSON', () => {
    const fs = createInMemoryFs({
      '/adapters/x/adapters.safetensors': 'data',
      '/adapters/x/adapter_config.json': '{bad json'
    });
    const post = new Postflight(fs);
    expect(() => post.run({ adapterPath: '/adapters/x', logTail: '' })).toThrow(/isn't valid JSON/);
  });
});
