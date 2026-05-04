import { describe, it, expect } from 'vitest';
import { decomposeRuleBased } from './rule-based';
import type { DecompositionNode } from './types';

/**
 * Phase-2 stability audit (2026-04-30) finding: an 11859-byte prompt
 * caused the rule-based decomposer to produce 2070+ descendants.
 *
 * PR #296 added an 8000-char body cap at the API gateway. This test
 * suite exercises the in-decomposer cap (DEFAULT_MAX_SECTIONS = 20)
 * which is the defense-in-depth fallback for any path that bypasses
 * the API gateway.
 */

function flattenDescendants(nodes: DecompositionNode[]): DecompositionNode[] {
  const out: DecompositionNode[] = [];
  for (const n of nodes) {
    out.push(n);
    if (n.children) out.push(...flattenDescendants(n.children));
  }
  return out;
}

describe('decomposer section cap (T-009)', () => {
  it('caps section count at default 20 for runaway prompts', () => {
    // 100 newline-separated short sentences = 100 sections without cap.
    const sentences = Array.from(
      { length: 100 },
      (_, i) => `Add a feature for use case number ${i.toString().padStart(3, '0')} with associated tests`,
    );
    const prompt = sentences.join('\n');
    const result = decomposeRuleBased(prompt);
    const initiative = result.hierarchy[0];
    const epicCount = (initiative.children ?? []).length;
    expect(epicCount).toBeLessThanOrEqual(20);
    expect(epicCount).toBe(20);
  });

  it('descendant count stays bounded for very-long prompts', () => {
    // 200 sentences = 200 sections without cap = ~1800 descendants.
    // With cap=20, expect ≤ 1 init + 20 epics * 9 nodes = 181 descendants.
    const sentences = Array.from(
      { length: 200 },
      (_, i) => `Build module ${i} that handles a distinct concern`,
    );
    const prompt = sentences.join('\n');
    const result = decomposeRuleBased(prompt);
    expect(result.totalNodes).toBeLessThanOrEqual(200);
  });

  it('coalesces overflow sections into the final epic without losing content', () => {
    const sentences = Array.from(
      { length: 25 },
      (_, i) => `Section content marker ${i}`,
    );
    const prompt = sentences.join('\n');
    const result = decomposeRuleBased(prompt);
    const initiative = result.hierarchy[0];
    const finalEpic = (initiative.children ?? [])[19];
    // Final epic's description should include content from sections 19..24.
    expect(finalEpic.description).toContain('Section content marker 19');
    expect(finalEpic.description).toContain('Section content marker 24');
  });

  it('honours per-call config.maxSections override', () => {
    const sentences = Array.from(
      { length: 30 },
      (_, i) => `Item ${i} with sufficient content for a section`,
    );
    const prompt = sentences.join('\n');
    const result = decomposeRuleBased(prompt, { maxSections: 5 });
    const initiative = result.hierarchy[0];
    expect((initiative.children ?? []).length).toBe(5);
  });

  it('does not cap when section count is below the default', () => {
    // 4 sections — well below cap=20.
    const prompt = 'Build login.\nBuild signup.\nBuild dashboard.\nBuild settings.';
    const result = decomposeRuleBased(prompt);
    const initiative = result.hierarchy[0];
    expect((initiative.children ?? []).length).toBe(4);
  });
});
