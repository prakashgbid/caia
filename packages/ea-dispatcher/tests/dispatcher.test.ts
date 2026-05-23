import { describe, it, expect } from 'vitest';
import { Dispatcher, dispatch } from '../src/dispatcher.js';
import {
  InMemoryTelemetrySink,
  NoopStateMachine,
  FrozenClock,
} from '../src/invoker.js';
import {
  MockArchitect,
  makeContract,
  stubDispatch,
  stubTicket,
  threeArchitectSet,
} from './fixtures.js';

describe('Dispatcher.dispatch — end-to-end', () => {
  it('runs a single architect and composes its output', async () => {
    const arch = new MockArchitect(
      'frontend',
      makeContract('frontend', ['frontend.framework']),
    );
    const result = await dispatch({ architects: [arch] }, stubDispatch());
    expect(result.finalState).toBe('ea-complete');
    expect(result.composedArchitecture).toEqual({
      'frontend.framework': 'val-frontend.framework',
    });
    expect(result.outputs.length).toBe(1);
    expect(result.outputs[0]?.status).toBe('ok');
  });

  it('produces a deterministic execution plan reflecting the wave order', async () => {
    const archs = threeArchitectSet();
    const result = await dispatch({ architects: archs }, stubDispatch());
    expect(result.plan.length).toBe(2);
    expect(result.plan[0]?.members).toEqual(['frontend']);
    expect(result.plan[1]?.members).toEqual(['a11y', 'performance']);
  });

  it('makes upstream outputs visible to wave-2 architects', async () => {
    let seenUpstream: Record<string, unknown> = {};
    const frontend = new MockArchitect(
      'frontend',
      makeContract('frontend', ['frontend.x']),
    );
    const a11y = new MockArchitect(
      'a11y',
      makeContract('a11y', ['a11y.x'], { dependsOn: ['frontend'] }),
      {
        onRun: (input) => {
          seenUpstream = { ...input.upstream.outputs };
        },
      },
    );
    await dispatch({ architects: [frontend, a11y] }, stubDispatch());
    expect(seenUpstream).toHaveProperty('frontend');
  });

  it('emits one telemetry row per architect call', async () => {
    const telemetry = new InMemoryTelemetrySink();
    const archs = threeArchitectSet();
    await dispatch({ architects: archs, telemetry }, stubDispatch());
    expect(telemetry.rows.length).toBe(3);
    expect(telemetry.rows.map((r) => r.architectName).sort()).toEqual([
      'a11y',
      'frontend',
      'performance',
    ]);
  });

  it('records 0 retries when first attempt is correct', async () => {
    const telemetry = new InMemoryTelemetrySink();
    const arch = new MockArchitect('a', makeContract('a', ['a.x']));
    await dispatch({ architects: [arch], telemetry }, stubDispatch());
    expect(telemetry.rows[0]?.retries).toBe(0);
  });

  it('retries once when the architect omits a required path', async () => {
    let attempt = 0;
    const arch = new MockArchitect('a', makeContract('a', ['a.x', 'a.y']));
    arch['opts'] = {
      output: 'ok',
      fields: { 'a.x': 1 }, // missing a.y
    };
    // Override run so the second attempt succeeds
    const orig = arch.run.bind(arch);
    arch.run = async (input) => {
      attempt += 1;
      if (attempt === 1) return orig(input);
      // 2nd attempt — full
      return (arch as unknown as { okOutput: Function }).okOutput(
        { 'a.x': 1, 'a.y': 2 },
        { confidence: 0.9 },
      );
    };
    const telemetry = new InMemoryTelemetrySink();
    const result = await dispatch({ architects: [arch], telemetry }, stubDispatch());
    expect(attempt).toBe(2);
    expect(telemetry.rows[0]?.retries).toBe(1);
    expect(result.composedArchitecture).toEqual({ 'a.x': 1, 'a.y': 2 });
  });

  it('marks the architect as failed if the second attempt still mismatches', async () => {
    const arch = new MockArchitect('a', makeContract('a', ['a.x', 'a.y']), {
      output: 'ok',
      fields: { 'a.x': 1 }, // permanently missing a.y
    });
    const result = await dispatch({ architects: [arch] }, stubDispatch());
    expect(result.outputs[0]?.status).toBe('failed');
    expect(result.outputs[0]?.failureReason).toMatch(/schema mismatch after retry/);
  });

  it('treats a failed architect as skipped in composition but still proceeds', async () => {
    const ok = new MockArchitect('ok', makeContract('ok', ['ok.x']));
    const bad = new MockArchitect('bad', makeContract('bad', ['bad.x']), { output: 'failed' });
    const result = await dispatch({ architects: [ok, bad] }, stubDispatch());
    expect(result.finalState).toBe('ea-complete');
    expect(result.composedArchitecture).toEqual({ 'ok.x': 'val-ok.x' });
  });

  it('transitions to ea-dispatching-failed when >50% architects fail', async () => {
    const a = new MockArchitect('a', makeContract('a', ['a.x']), { output: 'failed' });
    const b = new MockArchitect('b', makeContract('b', ['b.x']), { output: 'failed' });
    const c = new MockArchitect('c', makeContract('c', ['c.x']));
    const sm = new NoopStateMachine();
    const result = await dispatch({ architects: [a, b, c], stateMachine: sm }, stubDispatch());
    expect(result.finalState).toBe('ea-dispatching-failed');
    expect(sm.transitions.map((t) => t.toState)).toContain('ea-dispatching-failed');
  });

  it('claims, heartbeats, and releases the ticket', async () => {
    const sm = new NoopStateMachine();
    const arch = new MockArchitect('a', makeContract('a', ['a.x']));
    await dispatch({ architects: [arch], stateMachine: sm }, stubDispatch());
    expect(sm.claims.length).toBe(1);
    expect(sm.claims[0]).toMatchObject({ ticketId: 't-1', agentId: 'ea-dispatcher' });
    expect(sm.releases.length).toBe(1);
    expect(sm.releases[0]).toMatchObject({ finalStatus: 'done' });
  });

  it('skips architects whose appliesPredicate returns false', async () => {
    const apply = new MockArchitect('apply', makeContract('apply', ['apply.x']));
    const skip = new MockArchitect(
      'skip',
      makeContract('skip', ['skip.x'], { appliesPredicate: () => false }),
    );
    const result = await dispatch({ architects: [apply, skip] }, stubDispatch());
    expect(result.composedArchitecture).toEqual({ 'apply.x': 'val-apply.x' });
    expect(result.telemetry.skipped).toEqual(['skip']);
  });

  it('returns ea-complete and an empty composition when no architects apply', async () => {
    const all = new MockArchitect(
      'all',
      makeContract('all', ['all.x'], { appliesPredicate: () => false }),
    );
    const result = await dispatch({ architects: [all] }, stubDispatch());
    expect(result.finalState).toBe('ea-complete');
    expect(result.composedArchitecture).toEqual({});
    expect(result.outputs).toEqual([]);
  });

  it('rerunFor restricts the dispatch to only the named architects', async () => {
    const a = new MockArchitect('a', makeContract('a', ['a.x']));
    const b = new MockArchitect('b', makeContract('b', ['b.x']));
    const c = new MockArchitect('c', makeContract('c', ['c.x']));
    const result = await dispatch(
      { architects: [a, b, c] },
      stubDispatch({
        rerunFor: [{ architect: 'b', reason: 'reviewer rejected b', severity: 'P0' }],
      }),
    );
    expect(result.outputs.map((o) => o.architectName)).toEqual(['b']);
    // Composition only includes b
    expect(Object.keys(result.composedArchitecture)).toEqual(['b.x']);
  });

  it('refuses to dispatch past maxIterations', async () => {
    const arch = new MockArchitect('a', makeContract('a', ['a.x']));
    await expect(
      dispatch({ architects: [arch] }, stubDispatch({ iteration: 4 }), { maxIterations: 3 }),
    ).rejects.toThrow(/iteration 4 exceeds/);
  });

  it('detects + annotates a semantic conflict (iframe vs CSP)', async () => {
    const frontend = new MockArchitect(
      'frontend',
      makeContract('frontend', ['frontend.componentTree'], { precedenceLevel: 14 }),
      { fields: { 'frontend.componentTree': [{ kind: 'iframe-embed' }] } },
    );
    const security = new MockArchitect(
      'security',
      makeContract('security', ['security.cspPolicy'], {
        dependsOn: ['frontend'],
        precedenceLevel: 1,
      }),
      { fields: { 'security.cspPolicy': { frameSrc: "'none'" } } },
    );
    const result = await dispatch({ architects: [frontend, security] }, stubDispatch());
    expect(result.conflicts.length).toBeGreaterThanOrEqual(1);
    const iframeConflict = result.conflicts.find(
      (c) => c.ruleId === 'csp-frame-vs-iframe-embed',
    );
    expect(iframeConflict?.winner).toBe('security');
    expect(iframeConflict?.loser).toBe('frontend');
    expect(result.composedArchitecture['frontend.componentTree']).toHaveProperty('_dissent');
  });

  it('uses a frozen clock for deterministic telemetry timestamps', async () => {
    const clock = new FrozenClock();
    const telemetry = new InMemoryTelemetrySink();
    const arch = new MockArchitect('a', makeContract('a', ['a.x']));
    await dispatch({ architects: [arch], telemetry, clock }, stubDispatch());
    expect(telemetry.rows[0]?.startedAt).toMatch(/^2026-/);
  });

  it('Dispatcher class is reusable across dispatches', async () => {
    const arch = new MockArchitect('a', makeContract('a', ['a.x']));
    const d = new Dispatcher({ architects: [arch] });
    const r1 = await d.dispatch(stubDispatch({ ticket: stubTicket({ id: 't-A' }) }));
    const r2 = await d.dispatch(stubDispatch({ ticket: stubTicket({ id: 't-B' }) }));
    expect(r1.ticketId).toBe('t-A');
    expect(r2.ticketId).toBe('t-B');
  });
});
