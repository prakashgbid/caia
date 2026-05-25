import { describe, it, expect } from 'vitest';
import {
  encodeEnvelope,
  decodeEnvelope,
  subjectFor,
  subjectGlob,
  eventTypeFromSubject,
  inflateEvent,
  wrap,
  makeEventId,
} from '../src/envelope.js';
import type { ConductorEvent } from '../src/types.js';

const sampleEvent = (overrides: Partial<ConductorEvent> = {}): ConductorEvent => ({
  id: 'ev_test_0000000000000001',
  type: 'story.completed' as any,
  occurred_at: '2026-05-25T00:00:00.000Z',
  actor: 'executor' as any,
  domain_slugs: [],
  payload: { story_id: 'st_1' },
  metadata: {},
  severity: 'info' as any,
  ...overrides,
});

describe('subjectFor', () => {
  it('prefixes a simple type with chiefaia', () => {
    expect(subjectFor('story.completed')).toBe('chiefaia.story.completed');
  });

  it('honors a custom prefix', () => {
    expect(subjectFor('story.completed', 'tenantA')).toBe('tenantA.story.completed');
  });

  it('throws on empty type', () => {
    expect(() => subjectFor('')).toThrow(/invalid eventType/);
  });

  it('throws on non-string type', () => {
    // @ts-expect-error testing runtime guard
    expect(() => subjectFor(null)).toThrow(/invalid eventType/);
  });
});

describe('eventTypeFromSubject', () => {
  it('reverses subjectFor', () => {
    const t = 'pipeline.stage.advanced';
    expect(eventTypeFromSubject(subjectFor(t))).toBe(t);
  });

  it('honors a custom prefix on reverse', () => {
    expect(eventTypeFromSubject('tenantA.x.y', 'tenantA')).toBe('x.y');
  });

  it('throws when subject is not under prefix', () => {
    expect(() => eventTypeFromSubject('other.x.y')).toThrow(/not under prefix/);
  });
});

describe('subjectGlob', () => {
  it('maps "*" to "<prefix>.>"', () => {
    expect(subjectGlob('*')).toBe('chiefaia.>');
  });

  it('maps "**" to "<prefix>.>"', () => {
    expect(subjectGlob('**')).toBe('chiefaia.>');
  });

  it('maps "story.*" to "chiefaia.story.>"', () => {
    expect(subjectGlob('story.*')).toBe('chiefaia.story.>');
  });

  it('passes through exact subjects unchanged (with prefix)', () => {
    expect(subjectGlob('story.completed')).toBe('chiefaia.story.completed');
  });
});

describe('makeEventId', () => {
  it('produces an id with the ev_ prefix', () => {
    expect(makeEventId()).toMatch(/^ev_[0-9a-z]+_[0-9a-f]{16}$/);
  });

  it('produces unique ids across calls', () => {
    const ids = new Set(Array.from({ length: 100 }, () => makeEventId()));
    expect(ids.size).toBe(100);
  });
});

describe('encodeEnvelope / decodeEnvelope', () => {
  it('round-trips a full envelope', () => {
    const ev = sampleEvent();
    const env = wrap(ev, 'agent-a', ['agent-b']);
    const bytes = encodeEnvelope(env);
    const back = decodeEnvelope(bytes);
    expect(back).toEqual(env);
  });

  it('produces valid UTF-8 bytes', () => {
    const ev = sampleEvent({ payload: { msg: 'héllo 世界' } });
    const env = wrap(ev, 'agent-a');
    const bytes = encodeEnvelope(env);
    const back = decodeEnvelope(bytes);
    expect((back.event.payload as any).msg).toBe('héllo 世界');
  });

  it('throws on invalid JSON bytes', () => {
    expect(() => decodeEnvelope(new TextEncoder().encode('not json'))).toThrow(/invalid JSON/);
  });

  it('throws on non-object payload', () => {
    expect(() => decodeEnvelope(new TextEncoder().encode('"a string"'))).toThrow(/not an object/);
  });

  it('throws on unsupported schema_version', () => {
    const bad = JSON.stringify({ schema_version: 99, event: sampleEvent(), idempotency_key: 'x', sender: 's', recipients: [] });
    expect(() => decodeEnvelope(new TextEncoder().encode(bad))).toThrow(/schema_version/);
  });

  it('throws on missing event', () => {
    const bad = JSON.stringify({ schema_version: 1, idempotency_key: 'x', sender: 's', recipients: [] });
    expect(() => decodeEnvelope(new TextEncoder().encode(bad))).toThrow(/missing event/);
  });

  it('throws on missing idempotency_key', () => {
    const bad = JSON.stringify({ schema_version: 1, event: sampleEvent(), sender: 's', recipients: [] });
    expect(() => decodeEnvelope(new TextEncoder().encode(bad))).toThrow(/idempotency_key/);
  });

  it('throws on missing sender', () => {
    const bad = JSON.stringify({ schema_version: 1, event: sampleEvent(), idempotency_key: 'x', recipients: [] });
    expect(() => decodeEnvelope(new TextEncoder().encode(bad))).toThrow(/sender/);
  });

  it('throws on non-array recipients', () => {
    const bad = JSON.stringify({ schema_version: 1, event: sampleEvent(), idempotency_key: 'x', sender: 's', recipients: 'oops' });
    expect(() => decodeEnvelope(new TextEncoder().encode(bad))).toThrow(/recipients must be array/);
  });
});

describe('wrap', () => {
  it('defaults recipients to empty array', () => {
    const env = wrap(sampleEvent(), 'agent-a');
    expect(env.recipients).toEqual([]);
  });

  it('sets idempotency_key to event.id by default', () => {
    const ev = sampleEvent({ id: 'ev_abc' });
    expect(wrap(ev, 'agent-a').idempotency_key).toBe('ev_abc');
  });

  it('sets schema_version to 1', () => {
    expect(wrap(sampleEvent(), 'agent-a').schema_version).toBe(1);
  });
});

describe('inflateEvent', () => {
  it('fills in id, occurred_at, severity', () => {
    const ev = inflateEvent(
      { type: 'story.completed' as any, actor: 'executor' as any, payload: {}, metadata: {}, domain_slugs: [] } as any,
      () => 'info' as any,
    );
    expect(ev.id).toMatch(/^ev_/);
    expect(ev.occurred_at).toMatch(/T/);
    expect(ev.severity).toBe('info');
  });

  it('honors explicit severity over taxonomy default', () => {
    const ev = inflateEvent(
      { type: 'story.completed' as any, actor: 'executor' as any, payload: {}, metadata: {}, domain_slugs: [], severity: 'critical' as any } as any,
      () => 'info' as any,
    );
    expect(ev.severity).toBe('critical');
  });

  it('falls back to "info" when taxonomy has no entry', () => {
    const ev = inflateEvent(
      { type: 'unknown.thing' as any, actor: 'executor' as any, payload: {}, metadata: {}, domain_slugs: [] } as any,
      () => undefined,
    );
    expect(ev.severity).toBe('info');
  });
});
