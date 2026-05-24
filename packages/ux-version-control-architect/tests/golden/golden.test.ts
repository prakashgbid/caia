/**
 * Golden test — the canonical known-good UX Version Control artifact
 * for a known prakash-tiwari Page ticket (the /artists/[slug] booking
 * page UX-versioning spec).
 *
 * Pins:
 *   - The FORWARD-CREATING REVERT INVARIANT — every design revert is
 *     itself a new version appended at the chain tip, never an overwrite
 *     of prior history.
 *   - The PRESERVATION GUARANTEE — every uploaded UX preserved forever
 *     in immutable R2 storage (spec §2.15).
 *
 * Also serves as the canonical fixture the other 16 architect packages
 * reference when validating cross-architect disjointness.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { UxVersionControlArchitect } from '../../src/architect.js';
import { UX_VERSION_CONTROL_OWNED_FIELD_KEYS } from '../../src/contract.js';
import { UX_VERSION_CONTROL_INVARIANTS } from '../../src/invariants.js';
import { validateArchitectOutput } from '../../src/validation.js';
import {
  buildFakeInput,
  fakeGoldenSpawner,
  goldenAssistantText,
  goldenExpectedOutput
} from '../helpers/fakes.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('golden — prakash-tiwari /artists/[slug] UX Version Control Page ticket', () => {
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
      UX_VERSION_CONTROL_OWNED_FIELD_KEYS
    );
    expect(result.ok).toBe(true);
  });

  it('end-to-end produces the canonical ArchitectOutput', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const arch = new UxVersionControlArchitect({ spawner });
    const out = await arch.run(buildFakeInput());

    expect(out.architectName).toBe('ux-version-control');
    expect(out.status).toBe('ok');
    expect(out.confidence).toBeGreaterThan(0.5);

    for (const k of UX_VERSION_CONTROL_OWNED_FIELD_KEYS) {
      expect(out.architectureFields).toHaveProperty(k);
    }

    const expected = goldenExpectedOutput();
    expect(out.architectureFields).toEqual(expected.architectureFields);
    expect(out.confidence).toBe(expected.confidence);
    expect(out.notes).toBe(expected.notes);
    expect(out.dependencies).toEqual(expected.dependencies);
    expect(out.risks).toEqual(expected.risks);
  });

  it('output passes every UX Version Control invariant', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const arch = new UxVersionControlArchitect({ spawner });
    const out = await arch.run(buildFakeInput());

    for (const inv of UX_VERSION_CONTROL_INVARIANTS) {
      const ok = inv.detect(out.architectureFields);
      expect(ok, `invariant ${inv.id} should pass on the golden output`).toBe(true);
    }
  });

  it('idempotent — running twice yields equivalent ArchitectOutput', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const arch = new UxVersionControlArchitect({ spawner });
    const a = await arch.run(buildFakeInput());
    const b = await arch.run(buildFakeInput());
    expect(a).toEqual(b);
  });
});

/**
 * The CANONICAL forward-creating-revert verification (design-version chain).
 *
 * Simulates a design-version chain with reverts in the middle. The contract
 * guarantee under test: a design revert MUST append a new version at the tip
 * — never overwrite any prior version. After a revert, the chain has one
 * MORE entry than before, with every prior entry byte-identical.
 *
 * If the architect's output describes destructive revert, this simulation
 * throws — pinning the invariant at the test layer. Mirrors the immutability
 * guarantee proven in `@caia/atlas-design-snapshotter` (PR #538).
 */
describe('golden — forward-creating revert invariant (design-version chain)', () => {
  interface DesignChainEntry {
    readonly versionId: string;
    readonly kind: 'upload' | 'revert';
    readonly description: string;
    readonly revertsTo?: string;
  }

  function applyRevertPerContract(
    chain: readonly DesignChainEntry[],
    targetVersionId: string,
    revertSpec: Readonly<Record<string, unknown>>
  ): readonly DesignChainEntry[] {
    if (revertSpec.forwardCreating !== true) {
      throw new Error(
        `forward-creating revert invariant violated: ` +
          `revertOperation.forwardCreating=${String(revertSpec.forwardCreating)}; ` +
          'expected literal true.'
      );
    }
    const tip = chain[chain.length - 1];
    const nextIndex = chain.length;
    const nextVersionId = `v${nextIndex.toString().padStart(3, '0')}`;
    const revertEntry: DesignChainEntry = {
      versionId: nextVersionId,
      kind: 'revert',
      description: `revert to ${targetVersionId} (from ${tip?.versionId ?? 'genesis'})`,
      revertsTo: targetVersionId
    };
    return [...chain, revertEntry];
  }

  it('revert spec is forward-creating (literal boolean true)', () => {
    const golden = goldenExpectedOutput();
    const rev = golden.architectureFields['uxVersionControl.revertOperation'] as Record<
      string,
      unknown
    >;
    expect(rev.forwardCreating).toBe(true);
    expect(typeof rev.forwardCreating).toBe('boolean');
  });

  it('a simulated design-version revert appends a NEW version at the chain tip', () => {
    const golden = goldenExpectedOutput();
    const rev = golden.architectureFields['uxVersionControl.revertOperation'] as Record<
      string,
      unknown
    >;

    const initialChain: readonly DesignChainEntry[] = [
      { versionId: 'v000', kind: 'upload', description: 'initial hero + form design' },
      { versionId: 'v001', kind: 'upload', description: 'redesign hero portrait' },
      { versionId: 'v002', kind: 'upload', description: 'broken: removed CTA from hero' }
    ];

    const after = applyRevertPerContract(initialChain, 'v001', rev);

    expect(after.length).toBe(initialChain.length + 1);
    const tip = after[after.length - 1];
    expect(tip?.kind).toBe('revert');
    expect(tip?.revertsTo).toBe('v001');
    for (let i = 0; i < initialChain.length; i++) {
      expect(after[i]).toBe(initialChain[i]);
    }
  });

  it('a destructive revert spec throws (proves the simulation enforces the invariant)', () => {
    const destructiveSpec: Record<string, unknown> = {
      invocation: 'caia ux-version-control revert --hard',
      scope: 'design',
      forwardCreating: false,
      postCondition: 'overwrites version in place'
    };
    const initialChain: readonly DesignChainEntry[] = [
      { versionId: 'v000', kind: 'upload', description: 'first' }
    ];
    expect(() => applyRevertPerContract(initialChain, 'v000', destructiveSpec)).toThrow(
      /forward-creating revert invariant violated/
    );
  });

  it('successive design reverts keep growing the chain (revert of a revert)', () => {
    const golden = goldenExpectedOutput();
    const rev = golden.architectureFields['uxVersionControl.revertOperation'] as Record<
      string,
      unknown
    >;

    const c0: readonly DesignChainEntry[] = [
      { versionId: 'v000', kind: 'upload', description: 'first' },
      { versionId: 'v001', kind: 'upload', description: 'second' },
      { versionId: 'v002', kind: 'upload', description: 'broken third' }
    ];
    const c1 = applyRevertPerContract(c0, 'v001', rev);
    const c2 = applyRevertPerContract(c1, 'v002', rev);

    expect(c0.length).toBe(3);
    expect(c1.length).toBe(4);
    expect(c2.length).toBe(5);
    for (let i = 0; i < 3; i++) {
      expect(c2[i]).toBe(c0[i]);
    }
    expect(c2[c2.length - 1]?.revertsTo).toBe('v002');
  });

  it('revertOperation.postCondition describes append behaviour, not overwrite', () => {
    const golden = goldenExpectedOutput();
    const rev = golden.architectureFields['uxVersionControl.revertOperation'] as Record<
      string,
      unknown
    >;
    const pc = String(rev.postCondition ?? '');
    expect(pc).toContain('appended');
    expect(pc).not.toMatch(/\boverwrite\b/i);
    expect(pc).not.toMatch(/\brewrit/i);
    expect(pc).not.toMatch(/\bdestructive\b/i);
  });

  it('preservationGuarantee is immutable-r2-storage (no version is ever destroyed)', () => {
    const golden = goldenExpectedOutput();
    const retention = golden.architectureFields[
      'uxVersionControl.designVersionRetention'
    ] as Record<string, unknown>;
    expect(retention.preservationGuarantee).toBe('immutable-r2-storage');
  });

  it('retentionDays defaults to "forever" (spec §2.15: preserve every upload forever)', () => {
    const golden = goldenExpectedOutput();
    const retention = golden.architectureFields[
      'uxVersionControl.designVersionRetention'
    ] as Record<string, unknown>;
    expect(retention.retentionDays).toBe('forever');
  });

  it('auditTrail declares append-only immutability (every revert is logged forever)', () => {
    const golden = goldenExpectedOutput();
    const at = golden.architectureFields['uxVersionControl.auditTrail'] as Record<
      string,
      unknown
    >;
    expect(at.immutability).toBe('append-only');
  });

  it('auditTrail retentionDays meets 7-year regulatory floor (2555 days)', () => {
    const golden = goldenExpectedOutput();
    const at = golden.architectureFields['uxVersionControl.auditTrail'] as Record<
      string,
      unknown
    >;
    expect(typeof at.retentionDays).toBe('number');
    expect(at.retentionDays as number).toBeGreaterThanOrEqual(2555);
  });

  it('diffVisualizationSpec covers all five canonical layers (tree/token/copy/asset/interactivity)', () => {
    const golden = goldenExpectedOutput();
    const diff = golden.architectureFields[
      'uxVersionControl.diffVisualizationSpec'
    ] as Record<string, unknown>;
    const layers = diff.diffLayers as readonly string[];
    expect(layers).toContain('tree');
    expect(layers).toContain('token');
    expect(layers).toContain('copy');
    expect(layers).toContain('asset');
    expect(layers).toContain('interactivity');
  });

  it('branchingStrategy.forkAllowed is false (V1 posture: linear chain only)', () => {
    const golden = goldenExpectedOutput();
    const b = golden.architectureFields['uxVersionControl.branchingStrategy'] as Record<
      string,
      unknown
    >;
    expect(b.forkAllowed).toBe(false);
  });
});
