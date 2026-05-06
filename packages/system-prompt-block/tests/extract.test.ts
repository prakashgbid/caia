import { describe, expect, it } from 'vitest';

import {
  extractArchitectureToc,
  extractDoDStages,
  extractStandingInstructions
} from '../src/extract.js';

describe('extractStandingInstructions', () => {
  it('extracts bullets from the Standing Instructions section', () => {
    const md = [
      '# Memory',
      '',
      '## Standing Instructions (inviolate)',
      '',
      '- Rule A',
      '- Rule B',
      '',
      '## Other',
      '- not extracted'
    ].join('\n');
    const result = extractStandingInstructions(md);
    expect(result).toEqual(['Rule A', 'Rule B']);
  });

  it('alphabetises bullets for deterministic ordering', () => {
    const md = [
      '## Standing Instructions',
      '- zebra',
      '- apple',
      '- mango'
    ].join('\n');
    const result = extractStandingInstructions(md);
    expect(result).toEqual(['apple', 'mango', 'zebra']);
  });

  it('collapses multi-line bullets into a single line', () => {
    const md = [
      '## Standing Instructions',
      '- This is the first sentence',
      '  continuation of the same bullet',
      '- Second bullet'
    ].join('\n');
    const result = extractStandingInstructions(md);
    expect(result).toEqual([
      'Second bullet',
      'This is the first sentence continuation of the same bullet'
    ]);
  });

  it('throws when section is missing', () => {
    expect(() => extractStandingInstructions('# title\n\n## Other\n')).toThrow(
      /Standing Instructions/
    );
  });

  it('throws when section is empty', () => {
    expect(() =>
      extractStandingInstructions('## Standing Instructions\n\n## Other\n')
    ).toThrow(/Standing Instructions/);
  });
});

describe('extractArchitectureToc', () => {
  it('returns H2 headings in document order', () => {
    const md = [
      '# Title',
      '## Overview',
      'body',
      '## Services',
      '## Event Bus',
      '### subsection',
      '## ADRs'
    ].join('\n');
    const result = extractArchitectureToc(md);
    expect(result).toEqual(['Overview', 'Services', 'Event Bus', 'ADRs']);
  });

  it('throws when no H2 headings are present', () => {
    expect(() => extractArchitectureToc('# only h1\n\nbody')).toThrow(
      /caia_architecture/
    );
  });
});

describe('extractDoDStages', () => {
  const fullDoD = [
    'Analyze',
    'Research',
    'Solution',
    'Implement',
    'Unit test',
    'Integration test',
    'Deploy',
    'E2E live verify',
    'Regression test',
    'Document+learn'
  ];

  it('returns 10 canonical stages in canonical order', () => {
    const md = fullDoD.join(' → ');
    const result = extractDoDStages(md);
    expect(result).toEqual(fullDoD);
  });

  it('throws when stages are missing', () => {
    const partial = fullDoD.slice(0, 5).join(' → ');
    expect(() => extractDoDStages(partial)).toThrow(/missing 5 of 10/);
  });
});
