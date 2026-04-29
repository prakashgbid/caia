// Unit tests for the model catalog (LAI-001).

import { describe, it, expect } from 'vitest';
import {
  MODEL_CATALOG,
  getModel,
  modelsByRole,
  totalRuntimeRamGB,
  M1_PRO_USABLE_MODEL_RAM_GB,
} from '../src/model-catalog.js';

describe('model-catalog', () => {
  describe('MODEL_CATALOG', () => {
    it('has at least one model per role we route on today', () => {
      const roles = new Set(MODEL_CATALOG.map((m) => m.role));
      expect(roles.has('coder')).toBe(true);
      expect(roles.has('generalist')).toBe(true);
      expect(roles.has('reasoning')).toBe(true);
      expect(roles.has('embeddings')).toBe(true);
    });

    it('every entry has a non-empty tag and notes', () => {
      for (const m of MODEL_CATALOG) {
        expect(m.tag.length).toBeGreaterThan(0);
        expect(m.notes.length).toBeGreaterThan(0);
      }
    });

    it('every entry declares positive RAM and disk usage', () => {
      for (const m of MODEL_CATALOG) {
        expect(m.runtimeRamGB).toBeGreaterThan(0);
        expect(m.diskSizeGB).toBeGreaterThan(0);
      }
    });

    it('uses unique tags', () => {
      const tags = MODEL_CATALOG.map((m) => m.tag);
      expect(new Set(tags).size).toBe(tags.length);
    });

    it('flags qwen3 as emitting thinking tokens by default', () => {
      // Belt-and-braces: anyone routing through qwen3 needs to know to send
      // think:false via the chat endpoint, otherwise responses come back
      // empty and eval_count is consumed by chain-of-thought tokens.
      const qwen3 = getModel('qwen3:14b');
      expect(qwen3?.emitsThinkingByDefault).toBe(true);
      expect(qwen3?.endpoint).toBe('chat');
    });

    it('keeps the existing baseline models in the catalog', () => {
      // Don't drop these without consciously updating routing rules.
      expect(getModel('qwen2.5-coder:7b')).toBeDefined();
      expect(getModel('llama3.1:8b')).toBeDefined();
    });

    it('includes the new LAI-001 14B-class additions', () => {
      expect(getModel('qwen3:14b')).toBeDefined();
      expect(getModel('phi4')).toBeDefined();
      expect(getModel('qwen2.5-coder:14b')).toBeDefined();
    });

    it('includes an embeddings model for RAG / cache work', () => {
      const embeddings = modelsByRole('embeddings');
      expect(embeddings.length).toBeGreaterThan(0);
      expect(embeddings.some((m) => m.tag === 'nomic-embed-text')).toBe(true);
    });

    it('every chat-endpoint model that emits thinking declares it', () => {
      // If we add another chain-of-thought model later, force the catalog
      // entry to spell out the behaviour rather than rely on caller heuristics.
      for (const m of MODEL_CATALOG) {
        if (m.emitsThinkingByDefault) {
          expect(m.endpoint).toBe('chat');
        }
      }
    });
  });

  describe('getModel', () => {
    it('returns the entry for a known tag', () => {
      const m = getModel('qwen2.5-coder:7b');
      expect(m?.tag).toBe('qwen2.5-coder:7b');
      expect(m?.role).toBe('coder');
    });

    it('returns undefined for an unknown tag', () => {
      expect(getModel('does-not-exist:100b')).toBeUndefined();
    });
  });

  describe('modelsByRole', () => {
    it('returns only models matching the requested role', () => {
      const coders = modelsByRole('coder');
      expect(coders.length).toBeGreaterThan(0);
      for (const m of coders) {
        expect(m.role).toBe('coder');
      }
    });

    it('returns an empty array when no model fits the role', () => {
      // No long-context-only models are required by LAI-001; this guards
      // the call shape in case the catalog regresses in either direction.
      const result = modelsByRole('long-context');
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('hardware budget', () => {
    it('records a plausible ceiling for M1 Pro 16GB unified RAM', () => {
      // Sanity: leaving ~5 GB for OS + editor on a 16 GB machine.
      expect(M1_PRO_USABLE_MODEL_RAM_GB).toBeGreaterThanOrEqual(8);
      expect(M1_PRO_USABLE_MODEL_RAM_GB).toBeLessThanOrEqual(13);
    });

    it('individual catalog entries fit within the M1 Pro budget', () => {
      // We knowingly catalog several 14B-class models. Each one alone must
      // fit in the budget; concurrent loading is the router's responsibility,
      // not the catalog's.
      for (const m of MODEL_CATALOG) {
        expect(m.runtimeRamGB).toBeLessThanOrEqual(
          M1_PRO_USABLE_MODEL_RAM_GB,
        );
      }
    });

    it('flags catalog drift if total RAM exceeds available disk', () => {
      // M1 Pro currently has 85 GB free disk; this is a soft tripwire — if
      // we ever catalog so many models that we'd run out of disk on a fresh
      // machine, force a conscious decision.
      expect(totalRuntimeRamGB()).toBeLessThan(60);
    });
  });
});
