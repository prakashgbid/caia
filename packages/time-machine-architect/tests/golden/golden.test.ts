/**
 * Golden test — the canonical known-good Time Machine artifact for a
 * known prakash-tiwari Page ticket (the /artists/[slug] booking page).
 *
 * Pins the FORWARD-CREATING REVERT INVARIANT — the single most
 * important contract guarantee: every revert is itself a new snapshot
 * appended at the chain tip, never an overwrite of prior history.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { TimeMachineArchitect } from '../../src/architect.js';
import { TIME_MACHINE_OWNED_FIELD_KEYS } from '../../src/contract.js';
import { TIME_MACHINE_INVARIANTS } from '../../src/invariants.js';
import { validateArchitectOutput } from '../../src/validation.js';
import {
  buildFakeInput,
  fakeGoldenSpawner,
  goldenAssistantText,
  goldenExpectedOutput
} from '../helpers/fakes.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('golden — prakash-tiwari /artists/[slug] Page ticket', () => {
  it('input-ticket.json fixture loads and matches buildFakeInput()', () => {
    const raw = JSON.parse(
      readFileSync(resolve(__dirname, 'input-ticket.json'), 'utf-8')
    );
    const fixture = buildFakeInput().ticket;
    expect(raw).toEqual(fixture);
  });

  it('input-businessplan.json fixture loads and matches buildFakeInput()', () => {
    const raw = JSON.parse(
      readFileSync(resolve(__dirname, 'input-businessplan.json'), 'utf-8')
    );
    const fixture = buildFakeInput().businessPlan;
    expect(raw).toEqual(fixture);
  });

  it('input-designversion.json fixture loads and matches buildFakeInput()', () => {
    const raw = JSON.parse(
      readFileSync(resolve(__dirname, 'input-designversion.json'), 'utf-8')
    );
    const fixture = buildFakeInput().designVersion;
    expect(raw).toEqual(fixture);
  });

  it('assistant text validates cleanly', () => {
    const result = validateArchitectOutput(
      goldenAssistantText(),
      TIME_MACHINE_OWNED_FIELD_KEYS
    );
    expect(result.ok).toBe(true);
  });

  it('end-to-end produces the canonical ArchitectOutput', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const arch = new TimeMachineArchitect({ spawner });
    const out = await arch.run(buildFakeInput());

    expect(out.architectName).toBe('time-machine');
    expect(out.status).toBe('ok');
    expect(out.confidence).toBeGreaterThan(0.5);

    for (const k of TIME_MACHINE_OWNED_FIELD_KEYS) {
      expect(out.architectureFields).toHaveProperty(k);
    }

    const expected = goldenExpectedOutput();
    expect(out.architectureFields).toEqual(expected.architectureFields);
    expect(out.confidence).toBe(expected.confidence);
    expect(out.notes).toBe(expected.notes);
    expect(out.dependencies).toEqual(expected.dependencies);
    expect(out.risks).toEqual(expected.risks);
  });

  it('output passes every Time Machine invariant', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const arch = new TimeMachineArchitect({ spawner });
    const out = await arch.run(buildFakeInput());

    for (const inv of TIME_MACHINE_INVARIANTS) {
      const ok = inv.detect(out.architectureFields);
      expect(ok, `invariant ${inv.id} should pass on the golden output`).toBe(true);
    }
  });

  it('idempotent — running twice yields equivalent ArchitectOutput', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const arch = new TimeMachineArchitect({ spawner });
    const a = await arch.run(buildFakeInput());
    const b = await arch.run(buildFakeInput());
    expect(a).toEqual(b);
  });
});

/**
 * The CANONICAL forward-creating-revert verification.
 *
 * Simulates a snapshot chain with reverts in the middle. The contract
 * guarantee under test: a revert MUST append a new snapshot at the tip
 * — never overwrite any prior version. After a revert, the chain has
 * one MORE entry than before, with every prior entry byte-identical.
 *
 * If the architect's output describes destructive revert, this
 * simulation throws — pinning the invariant at the test layer.
 */
describe('golden — forward-creating revert invariant', () => {
  interface ChainEntry {
    readonly key: string;
    readonly kind: 'commit' | 'revert';
    readonly description: string;
    readonly revertsTo?: string;
  }

  function applyRevertPerContract(
    chain: readonly ChainEntry[],
    targetKey: string,
    revertSpec: Readonly<Record<string, unknown>>
  ): readonly ChainEntry[] {
    if (revertSpec.forwardCreating !== true) {
      throw new Error(
        `forward-creating revert invariant violated: ` +
          `revertOperation.forwardCreating=${String(revertSpec.forwardCreating)}; ` +
          'expected literal true.'
      );
    }
    const tip = chain[chain.length - 1];
    const nextIndex = chain.length;
    const nextKey = `s${nextIndex.toString().padStart(3, '0')}`;
    const revertEntry: ChainEntry = {
      key: nextKey,
      kind: 'revert',
      description: `revert to ${targetKey} (from ${tip?.key ?? 'genesis'})`,
      revertsTo: targetKey
    };
    return [...chain, revertEntry];
  }

  it('revert spec is forward-creating (literal boolean true)', () => {
    const golden = goldenExpectedOutput();
    const rev = golden.architectureFields['timeMachine.revertOperation'] as Record<
      string,
      unknown
    >;
    expect(rev.forwardCreating).toBe(true);
    expect(typeof rev.forwardCreating).toBe('boolean');
  });

  it('a simulated revert appends a NEW snapshot at the chain tip (forward-creating)', () => {
    const golden = goldenExpectedOutput();
    const rev = golden.architectureFields['timeMachine.revertOperation'] as Record<
      string,
      unknown
    >;

    const initialChain: readonly ChainEntry[] = [
      { key: 's000', kind: 'commit', description: 'ship initial booking form' },
      { key: 's001', kind: 'commit', description: 'add availability calendar' },
      { key: 's002', kind: 'commit', description: 'broken deploy: removes CTA' }
    ];

    const after = applyRevertPerContract(initialChain, 's001', rev);

    expect(after.length).toBe(initialChain.length + 1);
    const tip = after[after.length - 1];
    expect(tip?.kind).toBe('revert');
    expect(tip?.revertsTo).toBe('s001');
    for (let i = 0; i < initialChain.length; i++) {
      expect(after[i]).toBe(initialChain[i]);
    }
  });

  it('a destructive revert spec throws (proves the simulation enforces the invariant)', () => {
    const destructiveSpec: Record<string, unknown> = {
      invocation: 'caia time-machine revert --hard',
      scope: 'feature',
      forwardCreating: false,
      postCondition: 'overwrites snapshot in place'
    };
    const initialChain: readonly ChainEntry[] = [
      { key: 's000', kind: 'commit', description: 'first' }
    ];
    expect(() => applyRevertPerContract(initialChain, 's000', destructiveSpec)).toThrow(
      /forward-creating revert invariant violated/
    );
  });

  it('successive reverts keep growing the chain (revert of a revert)', () => {
    const golden = goldenExpectedOutput();
    const rev = golden.architectureFields['timeMachine.revertOperation'] as Record<
      string,
      unknown
    >;

    const c0: readonly ChainEntry[] = [
      { key: 's000', kind: 'commit', description: 'first' },
      { key: 's001', kind: 'commit', description: 'second' },
      { key: 's002', kind: 'commit', description: 'broken third' }
    ];
    const c1 = applyRevertPerContract(c0, 's001', rev);
    const c2 = applyRevertPerContract(c1, 's002', rev);

    expect(c0.length).toBe(3);
    expect(c1.length).toBe(4);
    expect(c2.length).toBe(5);
    for (let i = 0; i < 3; i++) {
      expect(c2[i]).toBe(c0[i]);
    }
    expect(c2[c2.length - 1]?.revertsTo).toBe('s002');
  });

  it('revertOperation.postCondition describes append behaviour, not overwrite', () => {
    const golden = goldenExpectedOutput();
    const rev = golden.architectureFields['timeMachine.revertOperation'] as Record<
      string,
      unknown
    >;
    const pc = String(rev.postCondition ?? '');
    expect(pc).toContain('appended');
    expect(pc).not.toMatch(/\boverwrite\b/i);
    expect(pc).not.toMatch(/\brewrit/i);
    expect(pc).not.toMatch(/\bdestructive\b/i);
  });

  it('versioningStrategy declares append-only immutability (chain CANNOT shrink)', () => {
    const golden = goldenExpectedOutput();
    const vs = golden.architectureFields['timeMachine.versioningStrategy'] as Record<
      string,
      unknown
    >;
    expect(vs.immutability).toBe('append-only');
  });

  it('auditTrail declares append-only immutability (revert is logged forever)', () => {
    const golden = goldenExpectedOutput();
    const at = golden.architectureFields['timeMachine.auditTrail'] as Record<
      string,
      unknown
    >;
    expect(at.immutability).toBe('append-only');
  });

  it('auditTrail retention >= snapshotRetention (every snapshot stays auditable for its lifetime)', () => {
    const golden = goldenExpectedOutput();
    const at = golden.architectureFields['timeMachine.auditTrail'] as Record<
      string,
      unknown
    >;
    const sr = golden.architectureFields['timeMachine.snapshotRetention'] as Record<
      string,
      unknown
    >;
    expect(typeof at.retentionDays).toBe('number');
    expect(typeof sr.retentionDays).toBe('number');
    expect(at.retentionDays as number).toBeGreaterThanOrEqual(sr.retentionDays as number);
  });
});
