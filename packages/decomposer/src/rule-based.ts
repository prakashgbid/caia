import { nanoid } from 'nanoid';
import type { DecompositionNode, DecompositionResult, DecomposerConfig } from './types';

/**
 * Verb-intent classification used by the rule-based decomposer to pick
 * a story template. The orchestrator's scaffolder also classifies
 * request type, but it doesn't influence story content — only agent
 * activation. This file owns the per-verb story templates.
 *
 * Live-pipeline validation 2026-04-30 surfaced the gap: prompts whose
 * primary verb was fix / refactor / audit / extract stalled with zero
 * stories because the decomposer's only template was the generic
 * "Implement core / Add UI/UX / Write tests / Document" set. This file
 * widens the template library to cover those verbs explicitly.
 */
export type VerbIntent =
  | 'fix' // bug-fix: investigate, repro test, fix, verify
  | 'refactor' // restructure existing code without behaviour change
  | 'extract' // pull a module/function/component out into its own unit
  | 'audit' // enumerate scope, automated checks, manual pass, report
  | 'add'; // default: feature-add (the original template set)

const FIX_VERBS = ['fix', 'broken', 'bug', 'crash', 'regress', 'not working', "doesn't work", "won't load", 'error', 'unresponsive'];
const REFACTOR_VERBS = ['refactor', 'restructure', 'simplify', 'clean up', 'consolidate', 'decouple', 'modularize'];
const EXTRACT_VERBS = ['extract', 'pull out', 'split out', 'move into a package', 'move to a package', 'separate package'];
const AUDIT_VERBS = ['audit', 'review', 'assess', 'inspect', 'compliance', 'wcag', 'a11y', 'accessibility audit', 'security audit', 'inventory'];

function detectVerbIntent(prompt: string): VerbIntent {
  const lower = prompt.toLowerCase();

  // Order matters: extract is more specific than refactor, audit is more
  // specific than fix (an "audit for bugs" should not become a fix story).
  if (EXTRACT_VERBS.some((v) => lower.includes(v))) return 'extract';
  if (AUDIT_VERBS.some((v) => lower.includes(v))) return 'audit';
  if (REFACTOR_VERBS.some((v) => lower.includes(v))) return 'refactor';
  if (FIX_VERBS.some((v) => lower.includes(v))) return 'fix';
  return 'add';
}

function estimateEffort(description: string): 'trivial' | 'small' | 'medium' | 'large' | 'xl' {
  const words = description.split(/\s+/).length;
  if (words < 5) return 'trivial';
  if (words < 15) return 'small';
  if (words < 30) return 'medium';
  if (words < 60) return 'large';
  return 'xl';
}

/**
 * Maximum number of logical sections the rule-based decomposer will
 * produce per prompt. Each section becomes one Epic with up to 4 Stories
 * (each with 2 Tasks), so cap=20 produces at most 20 epics × 9 nodes/epic
 * + 1 initiative = 181 descendants. Generous for any legitimate prompt.
 *
 * Failure mode (Phase-2 stability audit, 2026-04-30): an 11859-byte
 * "very-long" prompt produced 2070+ descendants when no cap was applied,
 * saturating the SQLite write path and intermittently timing out
 * /health. PR #296 added an 8000-char body cap at the API gateway;
 * this cap is the defense-in-depth fallback when very-long bodies
 * somehow get past the gateway (e.g. via direct DB insert / future
 * webhook ingest path / migration of legacy long prompts).
 *
 * Override via DecomposerConfig.maxSections or DECOMPOSER_MAX_SECTIONS env.
 */
export const DEFAULT_MAX_SECTIONS = 20;

function applyMaxSections(sections: string[], cap: number): string[] {
  if (sections.length <= cap) return sections;
  // Coalesce overflow into the last retained section so no content is lost.
  const head = sections.slice(0, cap - 1);
  const tail = sections.slice(cap - 1).join(' ');
  console.warn(
    `[decomposer] prompt produced ${String(sections.length)} sections; capped at ${String(cap)} (overflow merged into final section). Increase via DecomposerConfig.maxSections if intentional.`,
  );
  return [...head, tail];
}

// Extract logical sections from a prompt using heuristics
function extractSections(prompt: string): string[] {
  // Split on common separators: newlines, "and", semicolons, commas in lists
  const lines = prompt.split(/\n+/).filter((l) => l.trim().length > 5);
  if (lines.length > 1) return lines.map((l) => l.trim());

  // Single line — split on conjunctions
  const parts = prompt.split(/,\s+(?:and\s+)?|\s+and\s+|\s*;\s*/i).filter((p) => p.trim().length > 3);
  return parts.length > 1 ? parts : [prompt];
}

/**
 * Verb-aware story template. Each verb has its own ordered set of
 * story titles + acceptance criteria so the orchestrator's PO agent
 * persists meaningful stories instead of the generic "Implement core"
 * placeholder set that produced 0 useful work for fix/refactor/audit
 * prompts in the 2026-04-30 validation.
 */
function templatesFor(verb: VerbIntent, sectionLabel: string): Array<{
  title: string;
  description: string;
  acceptance: string[];
}> {
  const trimmed = sectionLabel.slice(0, 60);
  switch (verb) {
    case 'fix':
      return [
        {
          title: `Investigate root cause: ${trimmed}`,
          description: `Reproduce the failing behaviour locally and trace it to the originating module / function. Document the failure mode and the smallest input set that triggers it.`,
          acceptance: [
            'A reproducible local repro is documented in the PR description.',
            'The owning module / function is identified by file path and line range.',
          ],
        },
        {
          title: `Write a reproducing test: ${trimmed}`,
          description: `Add a failing test that captures the bug. The test must fail on main without the fix and pass after the fix lands.`,
          acceptance: [
            'A new test exists that fails on the unfixed branch.',
            'The test runs in <5s and is hermetic (no network / DB dependency).',
          ],
        },
        {
          title: `Apply the fix: ${trimmed}`,
          description: `Implement the smallest change that makes the reproducing test pass. Avoid drive-by refactors — keep the diff scoped to the bug.`,
          acceptance: [
            'The reproducing test passes.',
            'No unrelated tests regress.',
            'Change is < 50 LOC unless explicitly justified.',
          ],
        },
        {
          title: `Verify and add a regression guard: ${trimmed}`,
          description: `Run the full test suite locally + confirm the fix in a manual smoke test path. Promote the reproducing test to the regression suite so the bug never silently returns.`,
          acceptance: [
            'Full test suite green.',
            'The reproducing test is tagged for the regression suite.',
            'A short post-mortem note is added to the PR (root cause + prevention).',
          ],
        },
      ];

    case 'refactor':
      return [
        {
          title: `Identify boundaries: ${trimmed}`,
          description: `Map the current module's surface area: public exports, callers, and shared state. Decide on the new boundary and document the planned structure.`,
          acceptance: [
            'A short ADR or PR description documents the new boundary.',
            'All current callers are enumerated with file paths.',
          ],
        },
        {
          title: `Write characterisation tests: ${trimmed}`,
          description: `Before changing any code, capture current behaviour with a set of tests that describe what the module does today (not what it should do). These tests are the safety net for the refactor.`,
          acceptance: [
            'New tests cover every public exit of the module.',
            'All characterisation tests pass on the current main.',
          ],
        },
        {
          title: `Apply the refactor in incremental commits: ${trimmed}`,
          description: `Make the structural change in small, mechanically reviewable commits. Each commit should leave the test suite green and the public API unchanged.`,
          acceptance: [
            'Each commit individually leaves the suite green.',
            'No public-API change unless explicitly called out in the PR.',
            'Commits are squash-mergeable but each is independently revertible.',
          ],
        },
        {
          title: `Verify behaviour unchanged: ${trimmed}`,
          description: `Run the full test suite + any relevant integration / E2E checks. Compare the public-API surface area before vs after — they should match.`,
          acceptance: [
            'Full unit + integration suite green.',
            'Public-API diff is empty (or each addition is documented).',
            'No performance regression > 5% on the affected hot path.',
          ],
        },
      ];

    case 'extract':
      return [
        {
          title: `Map the extraction surface: ${trimmed}`,
          description: `Identify the unit to extract (function / module / package) and enumerate every consumer. Record the new public API the extracted unit will expose.`,
          acceptance: [
            'The extraction boundary is documented (file paths in scope + out of scope).',
            'Every consumer is enumerated with the symbol they depend on.',
            'The new public API is committed as a typed signature draft.',
          ],
        },
        {
          title: `Move the unit + its tests: ${trimmed}`,
          description: `Cut the code over to its new home and move the corresponding tests with it. Keep the import path stable via a re-export shim where consumers haven't been migrated yet.`,
          acceptance: [
            'The unit and its tests live at the new location.',
            'A re-export shim (or codemod) preserves consumer compatibility.',
            'The original location is either empty or contains only the shim.',
          ],
        },
        {
          title: `Update consumers: ${trimmed}`,
          description: `Migrate every consumer to the new import path. Remove the re-export shim once no consumers remain on the old path.`,
          acceptance: [
            'All consumers import from the new path.',
            'The shim is deleted (or has a deprecation comment with removal-by date).',
            'Bundle / dependency graph reflects the new boundary.',
          ],
        },
        {
          title: `Verify isolation: ${trimmed}`,
          description: `Confirm the extracted unit has no hidden dependency on its former home. Run the full suite + a clean build to surface any latent coupling.`,
          acceptance: [
            'A clean build of the extracted unit succeeds with no reverse imports.',
            'Full test suite green.',
            'Architecture diagram (or import-graph snapshot) is updated.',
          ],
        },
      ];

    case 'audit':
      return [
        {
          title: `Enumerate audit scope: ${trimmed}`,
          description: `List the files / modules / endpoints / pages in scope for the audit. Decide which automated checks apply and what the manual review pass needs to cover.`,
          acceptance: [
            'A scoped inventory exists (file list or URL list).',
            'The set of automated checks (linters, scanners, axe runs, dep audits) is committed.',
            'The manual review checklist is committed.',
          ],
        },
        {
          title: `Run automated checks: ${trimmed}`,
          description: `Execute the chosen automated checks. Capture findings in a machine-parseable format (SARIF, JSON) so they can feed the report.`,
          acceptance: [
            'Every automated check has a result file in the audit folder.',
            'False-positives are triaged with a one-line note per dismissal.',
            'Real findings are filed as backlog issues with severity tags.',
          ],
        },
        {
          title: `Manual review pass: ${trimmed}`,
          description: `Walk the manual checklist with at least one reviewer. Combine human findings with the automated output into the unified findings list.`,
          acceptance: [
            'Every checklist item is marked PASS / FAIL / N/A with a one-line rationale.',
            'Findings are appended to the unified list with reproduction steps.',
            'Reviewer signs off on the manual pass in the PR description.',
          ],
        },
        {
          title: `Produce audit report: ${trimmed}`,
          description: `Write the audit report: scope, methodology, findings (categorised + prioritised), recommendations, and a remediation plan. Land it in caia/docs/.`,
          acceptance: [
            'A dated report exists at caia/docs/.',
            'Each finding has owner + severity + a linked backlog item.',
            'A high-level executive summary is at the top of the report.',
          ],
        },
      ];

    case 'add':
    default:
      return [
        {
          title: `Implement core ${trimmed} functionality`,
          description: `Write the core implementation for: ${trimmed}.`,
          acceptance: [
            `The ${trimmed.slice(0, 30)} feature works as expected.`,
            'All tests pass.',
          ],
        },
        {
          title: `Add UI/UX for ${trimmed}`,
          description: `Wire the user-facing surface for: ${trimmed}.`,
          acceptance: ['UI matches the design spec.', 'Accessible by keyboard and screen reader.'],
        },
        {
          title: `Write tests for ${trimmed}`,
          description: `Unit + integration coverage for: ${trimmed}.`,
          acceptance: ['Coverage meets the package threshold.', 'Edge cases covered.'],
        },
        {
          title: `Document ${trimmed} implementation`,
          description: `Update the README + relevant docs for: ${trimmed}.`,
          acceptance: ['Public API documented.', 'Usage example included.'],
        },
      ];
  }
}

export function decomposeRuleBased(prompt: string, _config: DecomposerConfig = {}): DecompositionResult {
  const rawSections = extractSections(prompt);
  // Resolve cap: per-call config > env override > built-in default.
  const envCap = process.env['DECOMPOSER_MAX_SECTIONS'];
  const cap =
    _config.maxSections ??
    (envCap !== undefined && /^\d+$/.test(envCap) ? parseInt(envCap, 10) : DEFAULT_MAX_SECTIONS);
  const sections = applyMaxSections(rawSections, cap);
  const verb = detectVerbIntent(prompt);

  // Create one Initiative for the whole prompt
  const initiative: DecompositionNode = {
    id: `init-${nanoid(6)}`,
    level: 'initiative',
    title: prompt.length > 60 ? prompt.slice(0, 57) + '...' : prompt,
    description: prompt,
    estimatedEffort: 'large',
    children: [],
    metadata: { verbIntent: verb },
  };

  // Create one Epic per major section
  const epics: DecompositionNode[] = sections.map((section, i) => {
    const epicId = `epic-${nanoid(6)}`;

    const templates = templatesFor(verb, section);
    // Story count: at minimum 3 per the user's requirement (must emit ≥3
    // stories for fix/refactor/audit/extract). Originally we capped by
    // section word count which produced 0-2 stories for short prompts —
    // hence the 2026-04-30 stall. New formula:
    //   feature-add: keep historical 2..4 sizing
    //   fix/refactor/extract/audit: always emit the full template set (4)
    //     because each step is an irreducible part of the workflow.
    let storyCount: number;
    if (verb === 'add') {
      storyCount = Math.min(Math.max(2, Math.ceil(section.split(/\s+/).length / 10)), 4);
    } else {
      storyCount = templates.length;
    }
    const stories: DecompositionNode[] = [];

    for (let s = 0; s < storyCount; s++) {
      const storyId = `story-${nanoid(6)}`;
      const tpl = templates[s] ?? templates[templates.length - 1]!;

      // Per-verb task pair. For fix/refactor/extract/audit the second
      // task is "verify" rather than "tests" because the work itself is
      // already test-centric (write reproducing test, characterisation
      // test, etc).
      const tasks: DecompositionNode[] = [
        {
          id: `task-${nanoid(6)}`,
          level: 'task',
          title: `${tpl.title} — implementation`,
          description: tpl.description,
          estimatedEffort: 'small',
          canParallelize: false,
        },
        {
          id: `task-${nanoid(6)}`,
          level: 'task',
          title: `${tpl.title} — verification`,
          description:
            verb === 'add'
              ? `Write unit and integration tests for: ${tpl.title}`
              : `Run the verification step described above and capture evidence.`,
          estimatedEffort: 'small',
          canParallelize: false,
        },
      ];

      stories.push({
        id: storyId,
        level: 'story',
        title: tpl.title,
        description:
          verb === 'add'
            ? `As a user, I want to ${section} so that I can achieve my goal.`
            : tpl.description,
        acceptanceCriteria: tpl.acceptance,
        estimatedEffort: estimateEffort(section),
        canParallelize: s > 0, // First story is foundational, rest can parallelize
        children: tasks,
        metadata: { verbIntent: verb, templateIndex: s },
      });
    }

    return {
      id: epicId,
      level: 'epic',
      title: `Epic ${String(i + 1)}: ${section.slice(0, 50)}`,
      description: section,
      estimatedEffort: 'large',
      canParallelize: i > 0,
      children: stories,
      metadata: { verbIntent: verb },
    };
  });

  initiative.children = epics;

  const countDescendants = (nodes: DecompositionNode[]): number =>
    nodes.reduce((sum, n) => sum + 1 + countDescendants(n.children ?? []), 0);

  const totalNodes = 1 + countDescendants(epics);

  return {
    originalPrompt: prompt,
    hierarchy: [initiative],
    totalNodes,
    estimatedDays: epics.length * 3,
    recommendedParallelTracks: Math.min(epics.length, 3),
    summary: `Decomposed (verb=${verb}) into ${String(epics.length)} epic(s) with ${String(totalNodes)} total nodes. Estimated ${String(epics.length * 3)} days.`,
  };
}
