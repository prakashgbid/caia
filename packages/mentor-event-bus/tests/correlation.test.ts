import { describe, it, expect } from 'vitest';
import {
  withCorrelation,
  withCorrelationAsync,
  currentCorrelationId,
  currentParentEventId,
  currentCorrelation
} from '../src/correlation';

describe('correlation', () => {
  it('returns undefined outside withCorrelation', () => {
    expect(currentCorrelationId()).toBeUndefined();
    expect(currentParentEventId()).toBeUndefined();
    expect(currentCorrelation()).toBeUndefined();
  });

  it('exposes correlation_id inside withCorrelation', () => {
    let captured: string | undefined;
    withCorrelation('corr-x', () => {
      captured = currentCorrelationId();
    });
    expect(captured).toBe('corr-x');
    // and is reset after fn returns
    expect(currentCorrelationId()).toBeUndefined();
  });

  it('exposes parent_event_id when set', () => {
    let captured: string | undefined;
    withCorrelation('corr-y', () => {
      captured = currentParentEventId();
    }, 'parent-1');
    expect(captured).toBe('parent-1');
  });

  it('propagates across async boundaries', async () => {
    const observed: string[] = [];
    await withCorrelationAsync('corr-async', async () => {
      observed.push(currentCorrelationId() ?? 'none');
      await new Promise((resolve) => setTimeout(resolve, 5));
      observed.push(currentCorrelationId() ?? 'none');
      await Promise.resolve();
      observed.push(currentCorrelationId() ?? 'none');
    });
    expect(observed).toEqual(['corr-async', 'corr-async', 'corr-async']);
  });

  it('nested withCorrelation overrides the outer one', () => {
    const observed: string[] = [];
    withCorrelation('outer', () => {
      observed.push(currentCorrelationId() ?? 'none');
      withCorrelation('inner', () => {
        observed.push(currentCorrelationId() ?? 'none');
      });
      observed.push(currentCorrelationId() ?? 'none');
    });
    expect(observed).toEqual(['outer', 'inner', 'outer']);
  });
});
