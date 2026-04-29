/**
 * TEST-003 — verifies the new test.cases_generated and test.case_added
 * event types are registered in @chiefaia/events-taxonomy-internal and
 * round-trip through the eventBus.
 */
import {
  ALL_EVENT_TYPES,
  EVENT_SEVERITY,
  isValidEventType,
  type EventType,
  type TestCasesGeneratedPayload,
  type TestCaseAddedPayload,
} from '@chiefaia/events-taxonomy-internal';
import { eventBus } from '../../src/events/bus-adapter';

describe('TEST-003 — testing-framework event types', () => {
  it('registers test.cases_generated as a valid EventType', () => {
    expect(isValidEventType('test.cases_generated')).toBe(true);
    expect(ALL_EVENT_TYPES).toContain('test.cases_generated' as EventType);
    expect(EVENT_SEVERITY['test.cases_generated']).toBe('info');
  });

  it('registers test.case_added as a valid EventType', () => {
    expect(isValidEventType('test.case_added')).toBe(true);
    expect(ALL_EVENT_TYPES).toContain('test.case_added' as EventType);
    expect(EVENT_SEVERITY['test.case_added']).toBe('info');
  });

  it('typechecks the TestCasesGeneratedPayload contract', () => {
    const payload: TestCasesGeneratedPayload = {
      storyId: 'sty_test_003',
      promptId: 'prm_test_003',
      correlationId: 'cor_test_003',
      totalCases: 5,
      categoryCounts: {
        happy: 2, edge: 1, error: 1,
        accessibility: 1, security: 0, performance: 0, visual: 0,
      },
      durationMs: 230,
    };
    expect(payload.totalCases).toBe(5);
    expect(
      Object.values(payload.categoryCounts).reduce((a, b) => a + b, 0),
    ).toBe(payload.totalCases);
  });

  it('typechecks the TestCaseAddedPayload contract', () => {
    const payload: TestCaseAddedPayload = {
      storyId: 'sty_test_003',
      promptId: 'prm_test_003',
      correlationId: 'cor_test_003',
      testCaseId: 'tc-001',
      category: 'happy',
      layer: 'e2e',
    };
    expect(payload.category).toBe('happy');
  });

  it('round-trips test.cases_generated through the eventBus', (done) => {
    const unsub = eventBus.subscribe('test.cases_generated', (evt) => {
      try {
        expect(evt.actor).toBe('testing-agent');
        expect(evt.entity_id).toBe('sty_x');
        const pl = evt.payload as unknown as TestCasesGeneratedPayload;
        expect(pl.totalCases).toBe(3);
        expect(pl.categoryCounts.happy).toBe(2);
        expect(pl.categoryCounts.error).toBe(1);
        unsub();
        done();
      } catch (err) {
        unsub();
        done(err as Error);
      }
    });

    eventBus.publish({
      type: 'test.cases_generated',
      actor: 'testing-agent',
      correlation_id: 'cor_x',
      entity_type: 'story',
      entity_id: 'sty_x',
      payload: {
        storyId: 'sty_x',
        promptId: 'prm_x',
        correlationId: 'cor_x',
        totalCases: 3,
        categoryCounts: {
          happy: 2, edge: 0, error: 1,
          accessibility: 0, security: 0, performance: 0, visual: 0,
        },
        durationMs: 120,
      },
    });
  });

  it('round-trips test.case_added through the eventBus', (done) => {
    const unsub = eventBus.subscribe('test.case_added', (evt) => {
      try {
        expect(evt.actor).toBe('testing-agent');
        const pl = evt.payload as unknown as TestCaseAddedPayload;
        expect(pl.testCaseId).toBe('tc-007');
        expect(pl.category).toBe('accessibility');
        expect(pl.layer).toBe('accessibility');
        unsub();
        done();
      } catch (err) {
        unsub();
        done(err as Error);
      }
    });

    eventBus.publish({
      type: 'test.case_added',
      actor: 'testing-agent',
      correlation_id: 'cor_y',
      entity_type: 'story',
      entity_id: 'sty_y',
      payload: {
        storyId: 'sty_y',
        promptId: 'prm_y',
        correlationId: 'cor_y',
        testCaseId: 'tc-007',
        category: 'accessibility',
        layer: 'accessibility',
      },
    });
  });
});
