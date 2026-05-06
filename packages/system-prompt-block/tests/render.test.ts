import { describe, expect, it } from 'vitest';

import {
  renderArchitectureToc,
  renderDoDStages,
  renderPrimer,
  renderStandingInstructions
} from '../src/render.js';

describe('renderStandingInstructions', () => {
  it('renders a compact bullet list with the correct heading', () => {
    const text = renderStandingInstructions(['Rule A', 'Rule B']);
    expect(text).toContain('## Standing Instructions');
    expect(text).toContain('- Rule A');
    expect(text).toContain('- Rule B');
  });

  it('returns empty string for an empty bullet list', () => {
    expect(renderStandingInstructions([])).toBe('');
  });
});

describe('renderArchitectureToc', () => {
  it('renders a compact bullet list with the correct heading', () => {
    const text = renderArchitectureToc(['Overview', 'Services']);
    expect(text).toContain('## Architecture');
    expect(text).toContain('- Overview');
    expect(text).toContain('- Services');
  });
});

describe('renderDoDStages', () => {
  it('renders a numbered list', () => {
    const text = renderDoDStages(['Analyze', 'Research']);
    expect(text).toContain('## Definition of Done');
    expect(text).toContain('1. Analyze');
    expect(text).toContain('2. Research');
  });
});

describe('renderPrimer', () => {
  it('produces deterministic output for the same input', () => {
    const parts = {
      standingInstructions: ['A', 'B'],
      architectureToc: ['Overview'],
      dodStages: ['Analyze']
    };
    const a = renderPrimer(parts);
    const b = renderPrimer(parts);
    expect(a).toBe(b);
  });

  it('contains all three sections in the canonical order', () => {
    const text = renderPrimer({
      standingInstructions: ['A'],
      architectureToc: ['Overview'],
      dodStages: ['Analyze']
    });
    const idxStanding = text.indexOf('Standing Instructions');
    const idxArch = text.indexOf('Architecture');
    const idxDoD = text.indexOf('Definition of Done');
    expect(idxStanding).toBeGreaterThan(-1);
    expect(idxArch).toBeGreaterThan(idxStanding);
    expect(idxDoD).toBeGreaterThan(idxArch);
  });

  it('omits empty sections cleanly', () => {
    const text = renderPrimer({
      standingInstructions: [],
      architectureToc: ['Overview'],
      dodStages: ['Analyze']
    });
    expect(text).not.toContain('Standing Instructions');
    expect(text).toContain('Architecture');
    expect(text).toContain('Definition of Done');
  });

  it('uses LF line endings only', () => {
    const text = renderPrimer({
      standingInstructions: ['A'],
      architectureToc: ['B'],
      dodStages: ['C']
    });
    expect(text).not.toContain('\r');
  });
});
