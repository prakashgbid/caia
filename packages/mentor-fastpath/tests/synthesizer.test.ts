/**
 * Unit tests for the synthesizer (pure function — no I/O needed).
 *
 * Covers:
 *   - Frontmatter rendering for each major category
 *   - Slug generation: kebab-case, length cap, special-character handling
 *   - Title format
 *   - "How to apply" template selection
 *   - Provenance section completeness
 *   - Fallback for empty/whitespace correction text
 *   - Secondary-tags rendering
 */

import { describe, it, expect } from 'vitest';

import { synthesize, slugify } from '../src/synthesizer.js';
import type {
  ClassificationResult,
  EventRow,
  OperatorCorrectionInput
} from '../src/types.js';

function mkEvent(overrides: Partial<EventRow> = {}): EventRow {
  return {
    id: 'ev_test_1',
    event_type: 'OperatorCorrection',
    schema_version: 1,
    correlation_id: 'corr_xyz',
    parent_event_id: null,
    emitted_at: '2026-05-05T01:23:45Z',
    hostname: 'macbook-pro',
    process_name: 'caia-mentor-cli',
    payload_json: '{}',
    validation_failed: 0,
    ingest_offset: 1,
    ...overrides
  };
}

function mkPayload(
  overrides: Partial<OperatorCorrectionInput> = {}
): OperatorCorrectionInput {
  return {
    correctionText: 'we already decided this',
    detectionMode: 'manual',
    ...overrides
  };
}

function mkClass(
  overrides: Partial<ClassificationResult> = {}
): ClassificationResult {
  return {
    primary: 'ReLitigation',
    secondary: [],
    severity: 'high',
    generalizability: 'systemic',
    matchedBy: '\\b(already|previously)\\b',
    confidence: 1.0,
    ...overrides
  };
}

describe('slugify', () => {
  it('produces kebab-case from a sentence', () => {
    expect(slugify('We Already Decided This!')).toBe('we-already-decided-this');
  });

  it('strips special characters', () => {
    expect(slugify("Hey what's that #file.md doing?!")).toBe('hey-what-s-that-file-md-doing');
  });

  it('truncates at 60 chars', () => {
    const long = 'a'.repeat(200);
    const slug = slugify(long);
    expect(slug.length).toBeLessThanOrEqual(60);
  });

  it('returns "untitled" for empty input', () => {
    expect(slugify('')).toBe('untitled');
    expect(slugify('   ')).toBe('untitled');
    expect(slugify('!@#$%')).toBe('untitled');
  });

  it('handles diacritics', () => {
    expect(slugify('résumé naïve')).toBe('resume-naive');
  });

  it('does not produce trailing or leading hyphens', () => {
    expect(slugify('  -hello-  ')).toBe('hello');
    expect(slugify('---test---')).toBe('test');
  });
});

describe('synthesize', () => {
  it('returns a SynthesizedLesson with frontmatter, title, slug, markdown', () => {
    const lesson = synthesize(mkEvent(), mkPayload(), mkClass());
    expect(lesson.title).toContain('ReLitigation');
    expect(lesson.title).toContain('we already decided this');
    expect(lesson.slug).toContain('relitigation');
    expect(lesson.frontmatter.classifiedAs).toBe('ReLitigation');
    expect(lesson.frontmatter.severity).toBe('high');
    expect(lesson.frontmatter.type).toBe('feedback-proposal');
    expect(lesson.markdown).toMatch(/^---\n/);
    expect(lesson.markdown).toMatch(/\n---\n\n/);
    expect(lesson.markdown).toContain('## Why');
    expect(lesson.markdown).toContain('## How to apply');
    expect(lesson.markdown).toContain('## Provenance');
  });

  it('uses correlation_id as originSessionId when present', () => {
    const lesson = synthesize(
      mkEvent({ correlation_id: 'my-correlation-id' }),
      mkPayload(),
      mkClass()
    );
    expect(lesson.frontmatter.originSessionId).toBe('my-correlation-id');
  });

  it('falls back to event id when correlation_id is null', () => {
    const lesson = synthesize(
      mkEvent({ correlation_id: null, id: 'ev_no_corr' }),
      mkPayload(),
      mkClass()
    );
    expect(lesson.frontmatter.originSessionId).toBe('ev_no_corr');
  });

  it('renders the operator correction text as a blockquote', () => {
    const lesson = synthesize(
      mkEvent(),
      mkPayload({ correctionText: 'stop asking me' }),
      mkClass({ primary: 'DecisionClassifierViolation', severity: 'medium' })
    );
    expect(lesson.markdown).toContain('> stop asking me');
  });

  it('handles multi-line correction text by quoting each line', () => {
    const lesson = synthesize(
      mkEvent(),
      mkPayload({ correctionText: 'line one\nline two\nline three' }),
      mkClass()
    );
    expect(lesson.markdown).toContain('> line one\n> line two\n> line three');
  });

  it('handles empty correction text gracefully', () => {
    const lesson = synthesize(mkEvent(), mkPayload({ correctionText: '' }), mkClass());
    expect(lesson.markdown).toContain('(empty correction text)');
    expect(lesson.slug).toBeTruthy();
  });

  it('renders secondary tags when present', () => {
    const lesson = synthesize(
      mkEvent(),
      mkPayload(),
      mkClass({ secondary: ['MemoryDrift', 'OperatorConfusion'] })
    );
    expect(lesson.markdown).toContain('MemoryDrift, OperatorConfusion');
  });

  it('omits the secondary tags line when secondary is empty', () => {
    const lesson = synthesize(mkEvent(), mkPayload(), mkClass({ secondary: [] }));
    expect(lesson.markdown).not.toContain('Secondary tags:');
  });

  it('renders the matched-by regex source verbatim', () => {
    const lesson = synthesize(
      mkEvent(),
      mkPayload(),
      mkClass({ matchedBy: '\\b(test)\\b' })
    );
    expect(lesson.markdown).toContain('regex `\\b(test)\\b`');
  });

  it('renders "fallback" without the regex backticks', () => {
    const lesson = synthesize(
      mkEvent(),
      mkPayload(),
      mkClass({ primary: 'Unclassified', matchedBy: 'fallback', confidence: 0 })
    );
    expect(lesson.markdown).toContain('Classifier matched by: fallback');
  });

  it('selects the per-category How-to-apply template', () => {
    const halluc = synthesize(
      mkEvent(),
      mkPayload({ correctionText: 'that file does not exist' }),
      mkClass({ primary: 'Hallucination', severity: 'high' })
    );
    expect(halluc.markdown).toContain('verify it exists');

    const decision = synthesize(
      mkEvent(),
      mkPayload({ correctionText: 'stop asking' }),
      mkClass({ primary: 'DecisionClassifierViolation' })
    );
    expect(decision.markdown).toContain('Decide → execute → inform');
  });

  it('falls back to the Unclassified template for unknown categories', () => {
    const lesson = synthesize(
      mkEvent(),
      mkPayload({ correctionText: 'mystery' }),
      mkClass({ primary: 'Unclassified', confidence: 0 })
    );
    expect(lesson.markdown).toContain('Manual review needed');
  });

  it('truncates long correction text in the title to 80 chars + ellipsis', () => {
    const long = 'a'.repeat(120);
    const lesson = synthesize(
      mkEvent(),
      mkPayload({ correctionText: long }),
      mkClass()
    );
    expect(lesson.title).toMatch(/\.\.\.$/);
    expect(lesson.title.length).toBeLessThanOrEqual(120);
  });

  it('renders the operator-supplied context line when provided', () => {
    const lesson = synthesize(
      mkEvent(),
      mkPayload({ correctionText: 'stop', context: 'in PR #123 review' }),
      mkClass({ primary: 'DecisionClassifierViolation' })
    );
    expect(lesson.markdown).toContain('Context (operator-supplied): in PR #123 review');
  });

  it('omits the context line when not provided', () => {
    const lesson = synthesize(mkEvent(), mkPayload({ context: undefined }), mkClass());
    expect(lesson.markdown).not.toContain('Context (operator-supplied)');
  });

  it('records detection mode and process name in provenance', () => {
    const lesson = synthesize(
      mkEvent({ process_name: 'orchestrator' }),
      mkPayload({ detectionMode: 'regex' }),
      mkClass()
    );
    expect(lesson.markdown).toContain('Detection mode: regex');
    expect(lesson.markdown).toContain('Process: orchestrator');
  });

  it('renders (unknown) when process_name is null', () => {
    const lesson = synthesize(
      mkEvent({ process_name: null }),
      mkPayload(),
      mkClass()
    );
    expect(lesson.markdown).toContain('Process: (unknown)');
  });

  it('quotes frontmatter values containing colons', () => {
    const lesson = synthesize(
      mkEvent(),
      mkPayload({ correctionText: 'colon: in title' }),
      mkClass()
    );
    // Title contains "ReLitigation — colon: in title" — has a colon, must be quoted
    expect(lesson.markdown).toMatch(/name: "ReLitigation .*"/);
  });
});
