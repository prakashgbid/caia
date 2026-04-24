import { describe, it, expect } from 'vitest';
import { loadConfig, z } from '../src/index.js';

describe('loadConfig (record schema)', () => {
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

  it('ignores empty string env values and falls back to default', () => {
    const cfg = loadConfig(
      { host: { env: 'HOST', default: 'localhost' } },
      { HOST: '' },
    );
    expect(cfg.host).toBe('localhost');
  });

  it('omits keys with no default and no env value when not required', () => {
    const cfg = loadConfig(
      { optional: { env: 'OPTIONAL_VAR' } },
      {},
    ) as Record<string, unknown>;
    expect(cfg['optional']).toBeUndefined();
  });

  it('includes multiple missing required fields in one error', () => {
    expect(() =>
      loadConfig(
        {
          a: { env: 'A', required: true },
          b: { env: 'B', required: true },
        },
        {},
      ),
    ).toThrow('Configuration validation failed');
  });
});

describe('loadConfig (Zod schema)', () => {
  it('parses and returns typed config from Zod schema', () => {
    const schema = z.object({ PORT: z.string() });
    const cfg = loadConfig(schema, { PORT: '3000' });
    expect(cfg.PORT).toBe('3000');
  });

  it('throws ConfigurationError when Zod validation fails', () => {
    const schema = z.object({ PORT: z.string() });
    expect(() => loadConfig(schema, {})).toThrow('Configuration validation failed');
  });

  it('validates nested required fields', () => {
    const schema = z.object({
      HOST: z.string(),
      PORT: z.string(),
    });
    expect(() => loadConfig(schema, { HOST: 'localhost' })).toThrow('Configuration validation failed');
  });

  it('supports optional fields with defaults in Zod schema', () => {
    const schema = z.object({
      HOST: z.string().default('localhost'),
      PORT: z.string().default('3000'),
    });
    const cfg = loadConfig(schema, {});
    expect(cfg.HOST).toBe('localhost');
    expect(cfg.PORT).toBe('3000');
  });

  it('re-exports z for consumers', () => {
    expect(z).toBeDefined();
    expect(typeof z.object).toBe('function');
  });
});
