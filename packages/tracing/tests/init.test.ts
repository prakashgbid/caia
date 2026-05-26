/**
 * initTracing / shutdownTracing tests.
 *
 * We disable auto-instrumentations to keep these tests focused on the
 * SDK lifecycle (idempotency, defaults, env override, shutdown).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_OTLP_ENDPOINT,
  __resetTracingForTests,
  currentServiceName,
  initTracing,
  isTracingInitialised,
  shutdownTracing,
} from '../src/init.js';

beforeEach(() => {
  __resetTracingForTests();
});

afterEach(async () => {
  await shutdownTracing();
  __resetTracingForTests();
});

describe('initTracing', () => {
  it('returns true on first call and false on subsequent calls', async () => {
    const first = await initTracing({
      serviceName: 'svc-test-1',
      disableAutoInstrumentations: true,
    });
    const second = await initTracing({
      serviceName: 'svc-test-1',
      disableAutoInstrumentations: true,
    });
    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  it('records the service name', async () => {
    expect(currentServiceName()).toBeNull();
    await initTracing({
      serviceName: 'svc-test-2',
      disableAutoInstrumentations: true,
    });
    expect(currentServiceName()).toBe('svc-test-2');
  });

  it('isTracingInitialised flips after init and back after shutdown', async () => {
    expect(isTracingInitialised()).toBe(false);
    await initTracing({
      serviceName: 'svc-test-3',
      disableAutoInstrumentations: true,
    });
    expect(isTracingInitialised()).toBe(true);
    await shutdownTracing();
    expect(isTracingInitialised()).toBe(false);
  });

  it('default OTLP endpoint targets the in-cluster Tempo', () => {
    expect(DEFAULT_OTLP_ENDPOINT).toBe(
      'http://tempo.chiefaia.svc.cluster.local:4318',
    );
  });

  it('honours an explicit otlpEndpoint without throwing', async () => {
    await expect(
      initTracing({
        serviceName: 'svc-test-4',
        otlpEndpoint: 'http://localhost:9999',
        disableAutoInstrumentations: true,
      }),
    ).resolves.toBe(true);
  });

  it('shutdownTracing is safe to call when never initialised', async () => {
    await expect(shutdownTracing()).resolves.toBeUndefined();
  });
});
