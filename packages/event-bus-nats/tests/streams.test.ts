import { describe, it, expect } from 'vitest';
import { DEFAULT_STREAM, defaultConsumer, NAMESPACE_HINTS } from '../src/streams.js';

describe('DEFAULT_STREAM', () => {
  it('is named chiefaia-events', () => {
    expect(DEFAULT_STREAM.name).toBe('chiefaia-events');
  });

  it('captures the chiefaia.> subject space', () => {
    expect(DEFAULT_STREAM.subjects).toEqual(['chiefaia.>']);
  });

  it('uses file storage', () => {
    expect(DEFAULT_STREAM.storage).toBe('file');
  });

  it('uses 3 replicas (matching cluster size)', () => {
    expect(DEFAULT_STREAM.replicas).toBe(3);
  });

  it('retains for 7 days', () => {
    expect(DEFAULT_STREAM.maxAgeMs).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('caps at 4 GiB', () => {
    expect(DEFAULT_STREAM.maxBytes).toBe(4 * 1024 * 1024 * 1024);
  });

  it('uses limits retention', () => {
    expect(DEFAULT_STREAM.retention).toBe('limits');
  });
});

describe('defaultConsumer', () => {
  it('uses explicit ack policy', () => {
    expect(defaultConsumer('d').ackPolicy).toBe('explicit');
  });

  it('points at DEFAULT_STREAM', () => {
    expect(defaultConsumer('d').stream).toBe(DEFAULT_STREAM.name);
  });

  it('defaults to chiefaia.> filter', () => {
    expect(defaultConsumer('d').filterSubject).toBe('chiefaia.>');
  });

  it('honors filter override', () => {
    expect(defaultConsumer('d', 'chiefaia.story.>').filterSubject).toBe('chiefaia.story.>');
  });

  it('honors ackWaitMs override', () => {
    expect(defaultConsumer('d', undefined, { ackWaitMs: 5000 }).ackWaitMs).toBe(5000);
  });

  it('honors maxDeliver override', () => {
    expect(defaultConsumer('d', undefined, { maxDeliver: 9 }).maxDeliver).toBe(9);
  });
});

describe('NAMESPACE_HINTS (v0.2 sketch)', () => {
  it('has 15 namespaces', () => {
    expect(NAMESPACE_HINTS).toHaveLength(15);
  });

  it('all entries have positive retentionDays', () => {
    for (const ns of NAMESPACE_HINTS) expect(ns.retentionDays).toBeGreaterThan(0);
  });

  it('all entries have positive approxEventTypes', () => {
    for (const ns of NAMESPACE_HINTS) expect(ns.approxEventTypes).toBeGreaterThan(0);
  });
});
