import { describe, expect, it } from 'vitest';
import {
  dodStewardsGreenPolicy,
  freshness
} from '../../src/policies/dod-stewards-green.js';
import {
  freshGreenStewards,
  makeCtx,
  redStewardSnapshot,
  staleGreenStewards
} from '../fixtures.js';

describe('dod-stewards-green policy', () => {
  describe('freshness helper', () => {
    it('reports fresh for recent snapshots', () => {
      expect(freshness(freshGreenStewards())).toBe('fresh');
    });
    it('reports stale for >24h snapshots', () => {
      expect(freshness(staleGreenStewards())).toBe('stale');
    });
    it('reports unknown when snapshotAt missing', () => {
      const snap = { ...freshGreenStewards() };
      delete (snap as { snapshotAt?: string }).snapshotAt;
      expect(freshness(snap)).toBe('unknown');
    });
    it('reports unknown when undefined', () => {
      expect(freshness(undefined)).toBe('unknown');
    });
  });

  describe('pass cases', () => {
    it('passes for research intent (not subject)', async () => {
      const v = await dodStewardsGreenPolicy.check(
        makeCtx({ intent: 'research', dodStewards: redStewardSnapshot('outcomeSteward') })
      );
      expect(v.ok).toBe(true);
    });

    it('passes when bootstrap-exempt metadata set', async () => {
      const v = await dodStewardsGreenPolicy.check(
        makeCtx({
          intent: 'build',
          dodStewards: redStewardSnapshot('planDefender'),
          metadata: { dodBootstrapExempt: true }
        })
      );
      expect(v.ok).toBe(true);
    });

    it('passes when all four stewards are fresh green', async () => {
      const v = await dodStewardsGreenPolicy.check(
        makeCtx({ intent: 'build', dodStewards: freshGreenStewards() })
      );
      expect(v.ok).toBe(true);
    });
  });

  describe('fail cases', () => {
    it('hard-fails when activation-steward is red', async () => {
      const v = await dodStewardsGreenPolicy.check(
        makeCtx({ intent: 'build', dodStewards: redStewardSnapshot('activationSteward') })
      );
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.mode).toBe('hard-fail');
    });

    it('hard-fails when ea-doc-steward is red', async () => {
      const v = await dodStewardsGreenPolicy.check(
        makeCtx({ intent: 'ops', dodStewards: redStewardSnapshot('eaDocSteward') })
      );
      expect(v.ok).toBe(false);
    });

    it('hard-fails when plan-defender is red', async () => {
      const v = await dodStewardsGreenPolicy.check(
        makeCtx({ intent: 'build', dodStewards: redStewardSnapshot('planDefender') })
      );
      expect(v.ok).toBe(false);
    });

    it('soft-fails when snapshot is missing for build intent', async () => {
      const v = await dodStewardsGreenPolicy.check(
        makeCtx({ intent: 'build', dodStewards: undefined })
      );
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.mode).toBe('soft-fail');
    });

    it('soft-fails when snapshot is stale', async () => {
      const v = await dodStewardsGreenPolicy.check(
        makeCtx({ intent: 'build', dodStewards: staleGreenStewards() })
      );
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.mode).toBe('soft-fail');
    });
  });

  describe('remediation', () => {
    it('mentions the failing steward by name', async () => {
      const v = await dodStewardsGreenPolicy.check(
        makeCtx({ intent: 'build', dodStewards: redStewardSnapshot('outcomeSteward') })
      );
      if (v.ok) throw new Error('expected fail');
      expect(v.suggestedFix).toMatch(/outcomeSteward/);
    });
  });
});
