import { describe, it, expect } from 'vitest';
import {
  VastuConfigSchema,
  defaultCaiaVastuConfig,
  buildVastuConfig
} from '../src/config.js';
import { mockVastuConfig } from './fixtures/mock-config.js';

describe('VastuConfigSchema', () => {
  it('validates the CAIA default config', () => {
    expect(() => VastuConfigSchema.parse(defaultCaiaVastuConfig)).not.toThrow();
  });

  it('validates a fixture config', () => {
    expect(() => VastuConfigSchema.parse(mockVastuConfig)).not.toThrow();
  });

  it('rejects malformed configs', () => {
    expect(() =>
      VastuConfigSchema.parse({ ...defaultCaiaVastuConfig, desktopWidth: -1 })
    ).toThrow();
  });
});

describe('buildVastuConfig', () => {
  it('returns the CAIA default when called with no overrides', () => {
    const cfg = buildVastuConfig();
    expect(cfg).toEqual(defaultCaiaVastuConfig);
  });

  it('merges nested brandVoice overrides without dropping other defaults', () => {
    const cfg = buildVastuConfig({ brandVoice: { tone: 'witty', audience: 'demo' } });
    expect(cfg.brandVoice.tone).toBe('witty');
    expect(cfg.brandVoice.audience).toBe('demo');
    // persona inherits from default
    expect(cfg.brandVoice.persona).toBe(defaultCaiaVastuConfig.brandVoice.persona);
    // palette unchanged
    expect(cfg.palette).toEqual(defaultCaiaVastuConfig.palette);
  });

  it('merges componentLibrary additively', () => {
    const cfg = buildVastuConfig({
      componentLibrary: { HeroSection: { libraryKey: 'L3', codeConnectKey: 'HeroSection' } }
    });
    expect(cfg.componentLibrary['HeroSection']).toEqual({
      libraryKey: 'L3',
      codeConnectKey: 'HeroSection'
    });
  });

  it('keeps allowFigmaWrite=false in the CAIA default (zero-dollar gate)', () => {
    expect(defaultCaiaVastuConfig.allowFigmaWrite).toBe(false);
  });
});
