/**
 * PORecursiveDecomposer — the engine.
 *
 * Stateless across calls (every input is explicit; no shared per-class
 * state). Cancellable via an AbortSignal that is checked between
 * recursion steps so a cancel bounds wall-clock by ~one outstanding
 * LLM call. Cost-tracked: every parent expansion emits an AuditEntry
 * with model, tokens, cost; the engine sums these and exposes a
 * cumulative total via `decomposeRoot`'s return value.
 *
 * P0 scope (this slice):
 *   - one parent → children expansion via `decomposeOne`
 *   - bounded retry on schema parse failure (via callStructured)
 *   - per-child atomicity classification (via classifyAtomicity)
 *   - recursion via `decomposeRoot` that walks down to atomicity
 *
 * P0 explicitly does NOT:
 *   - run MECE judges (that's PR 3)
 *   - generate clarifying questions (that's P1)
 *   - chunk vision documents (P1)
 *   - call the real FREG/AKG (P1 — the stub returns empty)
 */

import { createHash } from 'node:crypto';

import { classifyAtomicity } from './atomicity-classifier.js';
import {
  formatAkgHitsForPrompt,
  formatFregHitsForPrompt,
  querySubstrateStub,
} from './freg-akg-stub.js';
import {
  CHILD_SCOPE_OF,
  DECOMPOSER_SYSTEM_PROMPTS,
  DECOMPOSER_TASK_TYPES,
} from './per-scope-prompts.js';
import { ChildTicketArraySchema } from './schemas.js';
import { callStructured } from './structured-output.js';
import type {
  AuditEntry,
  CancellationSignal,
  ChildTicket,
  Decomposition,
  StoryScope,
} from './types.js';
import { STORY_SCOPE_ORDER } from './types.js';

/**
 * The parent-node shape the engine expects. Either a synthetic root
 * (built from the user's prompt) or a previously-emitted child being
 * recursively expanded.
 */
export interface ParentNode {
  id: string;
  scope: StoryScope;
  title: string;
  description: string;
  inScope: string[];
  outOfScope: string[];
  /** Optional acceptance criteria (story+ scope only). */
  acceptanceCriteria?: string[];
  /** Optional project slug for FREG queries (P1 will use it). */
  projectSlug?: string;
  /** Optional tech sub-domains for AKG queries (P1 will use it). */
  techSubDomains?: string[];
}

export interface DecomposeOneOptions {
  parent: ParentNode;
  /** The scope of the children to produce (one level below parent). */
  childScope: StoryScope;
  /** Optional cancellation signal (checked before LLM call). */
  signal?: CancellationSignal;
}

export interface DecomposeRootOptions {
  parent: ParentNode;
  /**
   * Target scope — recursion stops once children at this scope are
   * produced. Used by the orchestrator (PR 4) when the scope detector
   * picks a deep starting scope (e.g., 'story') so we don't build
   * artificial above-story ancestry.
   */
  targetScope: StoryScope;
  /**
   * Maximum recursion depth (levels). Defaults to 5 (initiative →
   * subtask). Caller should set this to the worst-case depth.
   */
  maxDepth?: number;
  /**
   * Maximum total parent expansions across the whole tree. A cost
   * guard against runaway prompts. Default 200; vision-doc decomps
   * may need more.
   */
  maxExpansions?: number;
  /** Optional cancellation signal. */
  signal?: CancellationSignal;
}

export interface DecomposedTreeNode {
  ticket: ChildTicket;
  children: DecomposedTreeNode[];
  /** Whether this node was deemed atomic by the classifier. */
  atomic: boolean;
}

export interface DecomposeRootResult {
  /** Sub-tree rooted at the original parent. */
  tree: DecomposedTreeNode;
  /** Audit entries in expansion order, every level included. */
  audits: AuditEntry[];
  /** Cumulative cost across the whole tree (USD). */
  totalCostUsd: number;
  /** Cumulative wall-clock across the whole tree (ms). */
  totalDurationMs: number;
  /** Total LLM calls made. */
  totalCalls: number;
  /** True if the engine hit max-expansions (partial tree). */
  truncated: boolean;
}

export class PORecursiveDecomposerCancelled extends Error {
  constructor() {
    super('[decomposer-recursive] decomposition cancelled');
    this.name = 'PORecursiveDecomposerCancelled';
  }
}

export class PORecursiveDecomposer {
  /**
   * Expand ONE parent into its children at `childScope`. Stateless;
   * the caller drives the recursion via `decomposeRoot` or directly.
   *
   * Returns a `Decomposition` with:
   *   - childTickets[] — typed children parsed against the schema
   *   - audit — single AuditEntry for this expansion
   *   - judgeScores: { coverage: null, disjointness: null } — judges
   *     are not in P0; PR 3 fills them.
   */
  async decomposeOne(opts: DecomposeOneOptions): Promise<Decomposition> {
    const { parent, childScope, signal } = opts;

    if (signal?.aborted) throw new PORecursiveDecomposerCancelled();

    const taskType = DECOMPOSER_TASK_TYPES[parent.scope];
    const systemPrompt = DECOMPOSER_SYSTEM_PROMPTS[parent.scope];

    const substrate = await querySubstrateStub({
      query: `${parent.title}\n\n${parent.description}`,
      ...(parent.projectSlug ? { projectSlug: parent.projectSlug } : {}),
      ...(parent.techSubDomains ? { techSubDomains: parent.techSubDomains } : {}),
    });

    const userPrompt = buildUserPrompt(parent, childScope, substrate);
    const promptHash = sha256(systemPrompt + '\n\n' + userPrompt);

    if (signal?.aborted) throw new PORecursiveDecomposerCancelled();

    const result = await callStructured(ChildTicketArraySchema, {
      taskType,
      systemPrompt,
      userPrompt,
      maxRetries: 2,
      ...(signal ? { signal } : {}),
    });

    // Parse into ChildTicket[]. Set every child's scope to childScope
    // (the LLM is asked to label, but we override to be safe).
    const childTickets: ChildTicket[] = result.data.map((c) => {
      const cleanedExistingArtifacts = c.existingArtifacts.map((a) => {
        const out: { source: 'feature' | 'arch_artifact'; id: string; name: string; score: number; hint?: string } = {
          source: a.source,
          id: a.id,
          name: a.name,
          score: a.score,
        };
        if (a.hint !== undefined) out.hint = a.hint;
        return out;
      });
      const base: ChildTicket = {
        id: c.id,
        scope: childScope,
        title: c.title,
        description: c.description,
        inScope: c.inScope,
        outOfScope: c.outOfScope,
        dependencies: c.dependencies,
        existingArtifacts: cleanedExistingArtifacts,
        lifecycle: c.lifecycle,
        estimatedAtomic: false,
      };
      if (c.acceptanceCriteria !== undefined) {
        base.acceptanceCriteria = c.acceptanceCriteria;
      }
      return base;
    });

    const audit: AuditEntry = {
      parentNodeId: parent.id,
      parentScope: parent.scope,
      childScope,
      attempt: result.attempts,
      promptTextHash: promptHash,
      model: result.model,
      tokensIn: result.usage?.promptTokens ?? 0,
      tokensOut: result.usage?.completionTokens ?? 0,
      costUsd: result.costUsd,
      durationMs: result.durationMs,
      alternativesConsidered: 1, // P0 single-sample
      coverageScore: null,
      disjointnessScore: null,
      ambiguityDetected: false,
      questionsEmittedCount: 0,
      decisionRationale: `single-sample expansion (P0); ${String(childTickets.length)} children produced`,
      childrenCount: childTickets.length,
      outcome: 'committed',
    };

    return {
      childTickets,
      clarifyingQuestions: [],
      dependencies: [],
      confidence: null,
      judgeScores: { coverage: null, disjointness: null },
      audit,
    };
  }

  /**
   * Recursively decompose a parent down to the atomicity floor (or
   * to `targetScope`, whichever is hit first).
   *
   * Walks depth-first. Runs the atomicity classifier on each child
   * after generation; atomic children become leaves, non-atomic ones
   * recurse one scope deeper.
   */
  async decomposeRoot(
    opts: DecomposeRootOptions,
  ): Promise<DecomposeRootResult> {
    const { parent, targetScope, signal } = opts;
    const maxDepth = opts.maxDepth ?? 5;
    const maxExpansions = opts.maxExpansions ?? 200;

    const audits: AuditEntry[] = [];
    let totalCostUsd = 0;
    let totalDurationMs = 0;
    let totalCalls = 0;
    let expansions = 0;
    let truncated = false;

    // The root is presented as itself a "child" in the tree (so the
    // tree shape is uniform for the caller). Build a synthetic
    // ChildTicket from the parent.
    const rootTicket: ChildTicket = {
      id: parent.id,
      scope: parent.scope,
      title: parent.title,
      description: parent.description,
      ...(parent.acceptanceCriteria && parent.acceptanceCriteria.length > 0
        ? { acceptanceCriteria: parent.acceptanceCriteria }
        : {}),
      inScope: parent.inScope,
      outOfScope: parent.outOfScope,
      dependencies: [],
      estimatedAtomic: false,
      existingArtifacts: [],
      lifecycle: 'new',
    };
    const rootNode: DecomposedTreeNode = {
      ticket: rootTicket,
      children: [],
      atomic: false,
    };

    // BFS-frontier of (parentNode, depthFromRoot) pairs to expand.
    type FrontierItem = {
      node: DecomposedTreeNode;
      parent: ParentNode;
      depth: number;
    };
    const frontier: FrontierItem[] = [
      { node: rootNode, parent, depth: 0 },
    ];

    while (frontier.length > 0) {
      if (signal?.aborted) throw new PORecursiveDecomposerCancelled();
      const item = frontier.shift();
      if (!item) break;
      const { node, parent: p, depth } = item;

      // Atomicity floor check by scope index.
      const childScope = CHILD_SCOPE_OF[p.scope];
      if (childScope === null) {
        // Already at subtask — never decompose further.
        node.atomic = true;
        continue;
      }
      // Hard depth + scope guard.
      if (depth >= maxDepth) {
        node.atomic = true;
        continue;
      }
      // Target-scope guard: don't decompose past the requested target scope.
      const childScopeIdx = STORY_SCOPE_ORDER[childScope];
      const targetIdx = STORY_SCOPE_ORDER[targetScope];
      if (childScopeIdx > targetIdx) {
        // We've already produced children AT or BELOW the target scope.
        // The current parent is at-or-above target — but we only get
        // here if its scope index is < target's. Decompose anyway —
        // we want to land EXACTLY at target.
      }
      if (STORY_SCOPE_ORDER[p.scope] >= targetIdx) {
        // Parent is already at-or-below target scope; it is the leaf.
        node.atomic = true;
        continue;
      }

      // Cost/expansion budget guard.
      if (expansions >= maxExpansions) {
        truncated = true;
        node.atomic = true;
        continue;
      }
      expansions++;

      // Run the expansion.
      const decomp = await this.decomposeOne({
        parent: p,
        childScope,
        ...(signal ? { signal } : {}),
      });
      audits.push(decomp.audit);
      totalCostUsd += decomp.audit.costUsd;
      totalDurationMs += decomp.audit.durationMs;
      totalCalls += decomp.audit.attempt;

      // For each child, run atomicity classification then enqueue
      // for further expansion if not atomic and below target scope.
      for (const child of decomp.childTickets) {
        const verdict = await classifyAtomicity({
          child,
          ...(signal ? { signal } : {}),
        });
        // (atomicity classifier call counts toward totalCalls but not audits)
        totalCalls += 1;
        // Pass-through telemetry: classifier doesn't currently land in audits[].
        const childWithVerdict: ChildTicket = {
          ...child,
          estimatedAtomic: verdict.atomic,
        };
        const childNode: DecomposedTreeNode = {
          ticket: childWithVerdict,
          children: [],
          atomic: verdict.atomic,
        };
        node.children.push(childNode);

        const childIdx = STORY_SCOPE_ORDER[childWithVerdict.scope];
        const targetIdxInner = STORY_SCOPE_ORDER[targetScope];
        if (!verdict.atomic && childIdx < targetIdxInner) {
          frontier.push({
            node: childNode,
            parent: childTicketToParent(childWithVerdict, p),
            depth: depth + 1,
          });
        }
      }
    }

    return {
      tree: rootNode,
      audits,
      totalCostUsd,
      totalDurationMs,
      totalCalls,
      truncated,
    };
  }
}

// ─── helpers ────────────────────────────────────────────────────────────

function buildUserPrompt(
  parent: ParentNode,
  childScope: StoryScope,
  substrate: { fregHits: never[] | unknown[]; akgHits: never[] | unknown[] },
): string {
  const fregBlock = formatFregHitsForPrompt(
    substrate.fregHits as Parameters<typeof formatFregHitsForPrompt>[0],
  );
  const akgBlock = formatAkgHitsForPrompt(
    substrate.akgHits as Parameters<typeof formatAkgHitsForPrompt>[0],
  );

  const acBlock =
    parent.acceptanceCriteria && parent.acceptanceCriteria.length > 0
      ? `\nAcceptance criteria:\n${parent.acceptanceCriteria.map((a) => `  - ${a}`).join('\n')}`
      : '';

  return [
    `Decompose the parent ticket below into ${childScope} children.`,
    '',
    '## PARENT TICKET',
    `Title: ${parent.title}`,
    `Scope: ${parent.scope}`,
    `Description: ${parent.description}`,
    `In scope: ${parent.inScope.join('; ') || '(empty)'}`,
    `Out of scope: ${parent.outOfScope.join('; ') || '(empty)'}${acBlock}`,
    '',
    fregBlock,
    akgBlock,
  ]
    .filter((s) => s.length > 0)
    .join('\n');
}

function childTicketToParent(child: ChildTicket, parentOfChild: ParentNode): ParentNode {
  return {
    id: child.id,
    scope: child.scope,
    title: child.title,
    description: child.description,
    inScope: child.inScope,
    outOfScope: child.outOfScope,
    ...(child.acceptanceCriteria && child.acceptanceCriteria.length > 0
      ? { acceptanceCriteria: child.acceptanceCriteria }
      : {}),
    ...(parentOfChild.projectSlug ? { projectSlug: parentOfChild.projectSlug } : {}),
    ...(parentOfChild.techSubDomains
      ? { techSubDomains: parentOfChild.techSubDomains }
      : {}),
  };
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}
