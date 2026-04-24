import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/index.js';

describe('loadConfig', () => {
  it('reads values from source', () => {
    const cfg = loadConfig(
      { port: { env: 'PORT', parse: Number, default: 3000 } },
      { PORT: '8080' },
    );
    expect(cfg.port).toBe(8080);
  });

  it('uses default when env not set', () => {
    const cfg = loadConfig(
      { port: { env: 'PORT', parse: Number, default: 3000 } },
      {},
    );
    expect(cfg.port).toBe(3000);
  });

  it('throws ConfigurationError for missing required field', () => {
    expect(() =>
      loadConfig({ apiKey: { env: 'API_KEY', required: true } }, {}),
    ).toThrow('Missing required config');
  });

  it('returns a frozen object', () => {
    const cfg = loadConfig({ x: { default: 1 } }, {});
    expect(Object.isFrozen(cfg)).toBe(true);
  });
});
