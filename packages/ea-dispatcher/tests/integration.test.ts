/**
 * Integration test — 3 mock architects → dispatcher.dispatch() → composed
 * architecture. Exercises the full E2E path: filter → topo-sort → fan-out →
 * compose → conflict detection → telemetry → state-machine transitions.
 */
import { describe, it, expect } from 'vitest';
import { Dispatcher } from '../src/dispatcher.js';
import {
  InMemoryTelemetrySink,
  NoopStateMachine,
  FrozenClock,
} from '../src/invoker.js';
import {
  MockArchitect,
  makeContract,
  stubDispatch,
  threeArchitectSet,
} from './fixtures.js';

describe('integration: 3 mock architects end-to-end', () => {
  it('runs the canonical 3-arch fixture with a real DispatcherDeps', async () => {
    const telemetry = new InMemoryTelemetrySink();
    const sm = new NoopStateMachine();
    const clock = new FrozenClock();
    const d = new Dispatcher({
      architects: threeArchitectSet(),
      telemetry,
      stateMachine: sm,
      clock,
    });

    const result = await d.dispatch(stubDispatch());

    // 1. Final state.
    expect(result.finalState).toBe('ea-complete');

    // 2. Composition includes every declared path from every architect.
    expect(result.composedArchitecture).toEqual({
      'frontend.framework': 'val-frontend.framework',
      'frontend.tokens': 'val-frontend.tokens',
      'a11y.wcagLevel': 'val-a11y.wcagLevel',
      'performance.lighthouseTargets': 'val-performance.lighthouseTargets',
    });

    // 3. Telemetry — one row per architect.
    expect(telemetry.rows.length).toBe(3);

    // 4. State machine — claimed, transitioned, released.
    expect(sm.claims.length).toBe(1);
    expect(sm.transitions.map((t) => t.toState)).toContain('ea-complete');
    expect(sm.releases.length).toBe(1);
    expect(sm.releases[0]?.finalStatus).toBe('done');

    // 5. Plan reflects the two waves.
    expect(result.plan).toEqual([
      { wave: 1, members: ['frontend'] },
      { wave: 2, members: ['a11y', 'performance'] },
    ]);

    // 6. No conflicts on this clean fixture.
    expect(result.conflicts).toEqual([]);
  });

  it('end-to-end on the same fixture with one architect failing', async () => {
    const [frontend, a11y, _performance] = threeArchitectSet();
    const perfFail = new MockArchitect(
      'performance',
      makeContract('performance', ['performance.lighthouseTargets'], {
        dependsOn: ['frontend'],
        precedenceLevel: 5,
      }),
      { output: 'failed' },
    );
    const d = new Dispatcher({ architects: [frontend!, a11y!, perfFail] });
    const result = await d.dispatch(stubDispatch());
    expect(result.finalState).toBe('ea-complete'); // 1/3 = 33% under threshold
    expect(result.outputs.find((o) => o.architectName === 'performance')?.status).toBe(
      'failed',
    );
    // Composition still has frontend + a11y contributions
    expect(result.composedArchitecture).toHaveProperty('frontend.framework');
    expect(result.composedArchitecture).toHaveProperty('a11y.wcagLevel');
    expect(result.composedArchitecture).not.toHaveProperty('performance.lighthouseTargets');
  });

  it('end-to-end with a semantic conflict gets dissent annotation', async () => {
    const frontend = new MockArchitect(
      'frontend',
      makeContract('frontend', ['frontend.componentTree'], { precedenceLevel: 14 }),
      { fields: { 'frontend.componentTree': [{ id: 'btn-1', interactive: true }] } },
    );
    const a11y = new MockArchitect(
      'a11y',
      makeContract('a11y', ['a11y.keyboardSpec'], {
        dependsOn: ['frontend'],
        precedenceLevel: 3,
      }),
      { fields: { 'a11y.keyboardSpec': [] } },
    );
    const d = new Dispatcher({ architects: [frontend, a11y] });
    const result = await d.dispatch(stubDispatch());
    // The rule "interactive-widget-without-keyboard-spec" should fire.
    const fired = result.conflicts.map((c) => c.ruleId);
    expect(fired).toContain('interactive-widget-without-keyboard-spec');
    // a11y outranks frontend so the loser is frontend
    const conflict = result.conflicts.find(
      (c) => c.ruleId === 'interactive-widget-without-keyboard-spec',
    );
    expect(conflict?.winner).toBe('a11y');
    expect(conflict?.loser).toBe('frontend');
  });
});
