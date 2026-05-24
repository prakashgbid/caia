/**
 * Spawner tests — round-by-round + escalation + cap.
 */

import { describe, expect, it } from 'vitest';

import { makeStubContextDump } from '../src/context-dump.js';
import { MemoryFs } from '../src/fs.js';
import { StubResponder } from '../src/responder.js';
import { PlanDefenderSpawner } from '../src/spawner.js';
import type { DefenderAnswer } from '../src/types.js';
import { DEFENDER_ITERATION_CAP } from '../src/types.js';

const baseTs = '2026-05-24T12:00:00.000Z';

function ans(partial: Partial<DefenderAnswer> & { confidence: DefenderAnswer['confidence'] }): DefenderAnswer {
  return {
    round: 1,
    answer: partial.answer ?? 'stub',
    cited_sources: partial.cited_sources ?? [],
    confidence: partial.confidence,
    recommended_action: partial.recommended_action ?? 'plan-stands',
    ts: partial.ts ?? baseTs,
    ...(partial.notes_for_reviewer !== undefined ? { notes_for_reviewer: partial.notes_for_reviewer } : {})
  };
}

describe('PlanDefenderSpawner.spawn', () => {
  it('returns a handle + validation', () => {
    const fs = new MemoryFs();
    const spawner = new PlanDefenderSpawner({ fs, dialogueDir: '/tmp/dialogues' });
    const { handle, validation } = spawner.spawn('sub-1', makeStubContextDump());
    expect(handle.submissionId).toBe('sub-1');
    expect(handle.round).toBe(0);
    expect(handle.closed).toBe(false);
    expect(validation).toBeDefined();
  });

  it('isSpawned returns true after spawn', () => {
    const spawner = new PlanDefenderSpawner({ fs: new MemoryFs(), dialogueDir: '/tmp/d' });
    expect(spawner.isSpawned('s')).toBe(false);
    spawner.spawn('s', makeStubContextDump());
    expect(spawner.isSpawned('s')).toBe(true);
  });
});

describe('PlanDefenderSpawner.askQuestion', () => {
  it('persists Q + A to dialogue log', async () => {
    const fs = new MemoryFs();
    const responder = new StubResponder([
      ans({ confidence: 'high', recommended_action: 'plan-stands', answer: 'all good' })
    ]);
    const spawner = new PlanDefenderSpawner({ fs, dialogueDir: '/tmp/d', responder });
    spawner.spawn('s', makeStubContextDump());
    const result = await spawner.askQuestion('s', 'why did you pick option A?');
    expect(result.answer.confidence).toBe('high');
    const log = fs.snapshot()['/tmp/d/s.jsonl'];
    expect(log).toBeDefined();
    const lines = (log as string).split('\n').filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(2);
  });

  it('escalates on strategic-class question', async () => {
    const spawner = new PlanDefenderSpawner({
      fs: new MemoryFs(),
      dialogueDir: '/tmp/d',
      responder: new StubResponder([ans({ confidence: 'high' })])
    });
    spawner.spawn('s', makeStubContextDump());
    const result = await spawner.askQuestion('s', 'should we pivot the product?');
    expect(result.escalation?.kind).toBe('strategic-class-question');
    expect(result.closed).toBe(true);
  });

  it('escalates on three consecutive low-confidence answers', async () => {
    const spawner = new PlanDefenderSpawner({
      fs: new MemoryFs(),
      dialogueDir: '/tmp/d',
      responder: new StubResponder([
        ans({ confidence: 'low' }),
        ans({ confidence: 'low' }),
        ans({ confidence: 'low' })
      ])
    });
    spawner.spawn('s', makeStubContextDump());
    const r1 = await spawner.askQuestion('s', 'Q1');
    const r2 = await spawner.askQuestion('s', 'Q2');
    const r3 = await spawner.askQuestion('s', 'Q3');
    expect(r1.escalation).toBeUndefined();
    expect(r2.escalation).toBeUndefined();
    expect(r3.escalation?.kind).toBe('consecutive-low-confidence');
  });

  it('forces escalation at cap', async () => {
    const fs = new MemoryFs();
    const responder = new StubResponder(
      Array.from({ length: DEFENDER_ITERATION_CAP + 1 }, () =>
        ans({ confidence: 'medium' })
      )
    );
    const spawner = new PlanDefenderSpawner({ fs, dialogueDir: '/tmp/d', responder });
    spawner.spawn('s', makeStubContextDump());
    for (let i = 0; i < DEFENDER_ITERATION_CAP; i++) {
      // eslint-disable-next-line no-await-in-loop
      const r = await spawner.askQuestion('s', `Stub decision question ${i + 1}`);
      expect(r.escalation).toBeUndefined();
    }
    // Handle should be marked closed (closed === true returned on the last call).
    // The cap was reached at round 5; next askQuestion fires the cap branch.
    const capped = await spawner.askQuestion('s', 'Stub decision over the cap');
    expect(capped.escalation?.kind).toBe('iteration-cap-reached');
    expect(capped.closed).toBe(true);
  });

  it('tracks isolation between submissions (concurrency)', async () => {
    const spawner = new PlanDefenderSpawner({
      fs: new MemoryFs(),
      dialogueDir: '/tmp/d',
      responder: new StubResponder([
        ans({ confidence: 'high' }),
        ans({ confidence: 'high' }),
        ans({ confidence: 'high' })
      ])
    });
    spawner.spawn('a', makeStubContextDump({ plan_slug: 'plan-a' }));
    spawner.spawn('b', makeStubContextDump({ plan_slug: 'plan-b' }));
    spawner.spawn('c', makeStubContextDump({ plan_slug: 'plan-c' }));
    await Promise.all([
      spawner.askQuestion('a', 'Why did you pick Stub decision option-a?'),
      spawner.askQuestion('b', 'Why did you pick Stub decision option-a for plan-b?'),
      spawner.askQuestion('c', 'Why did you pick Stub decision option-a for plan-c?')
    ]);
    expect(spawner.getHandle('a')?.round).toBe(1);
    expect(spawner.getHandle('b')?.round).toBe(1);
    expect(spawner.getHandle('c')?.round).toBe(1);
    expect(spawner.inFlightCount()).toBe(3);
  });
});
