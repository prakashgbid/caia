/**
 * Test fixtures — non-CAIA config that exercises VastuConfigSchema without
 * touching real CAIA paths. Per Option E gate #3 (fixture-corpus tests).
 */

import type { VastuConfig } from '../../src/config.js';

export const mockVastuConfig: VastuConfig = {
  brandVoice: {
    tone: 'playful, succinct',
    audience: 'unit-test fixtures',
    persona: 'fixture'
  },
  palette: {
    primary: '#ff00ff',
    secondary: '#00ffff',
    background: '#000000',
    surface: '#111111',
    textPrimary: '#ffffff',
    textSecondary: '#bbbbbb'
  },
  contentTone: 'short, punchy fixture prose',
  libraryUrls: {
    basic: 'https://example.invalid/basic',
    business: 'https://example.invalid/business',
    blueprints: 'https://example.invalid/blueprints'
  },
  componentLibrary: {
    HeroSection: { libraryKey: 'L3', codeConnectKey: 'HeroSection', nodeId: '1:2' },
    FeatureGrid: { libraryKey: 'L3', codeConnectKey: 'FeatureGrid' }
  },
  defaultSectionHeight: 280,
  desktopWidth: 1280,
  scaffoldTargetTemplate: 'fixture-template',
  payloadOutDir: '.fixture-out',
  allowFigmaWrite: false
};
