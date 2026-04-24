import { describe, it, expect } from 'vitest';
import { createRegistry } from '../src/index.js';

describe('createRegistry', () => {
  it('counter increments', () => {
    const reg = createRegistry();
    const c = reg.counter('requests_total', 'Total requests');
    c.inc();
    c.inc({ route: '/api' }, 3);
    expect(c.get()).toBe(1);
    expect(c.get({ route: '/api' })).toBe(3);
  });

  it('gauge sets and adjusts', () => {
    const reg = createRegistry();
    const g = reg.gauge('active_connections', 'Active connections');
    g.set(5);
    g.inc();
    g.dec({}, 2);
    expect(g.get()).toBe(4);
  });

  it('histogram records observations', () => {
    const reg = createRegistry();
    const h = reg.histogram('response_time_seconds', 'Response time');
    h.observe(0.1);
    h.observe(0.2);
    expect(h.getCount()).toBe(2);
    expect(h.getSum()).toBeCloseTo(0.3);
  });

  it('renders prometheus text format', () => {
    const reg = createRegistry();
    const c = reg.counter('hits', 'Hit count');
    c.inc();
    const output = reg.render();
    expect(output).toContain('# TYPE hits counter');
    expect(output).toContain('hits 1');
  });
});
