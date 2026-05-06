/**
 * Static manifest of every subagent shipped by @chiefaia/claude-subagents.
 *
 * The .md files themselves live under the package's `agents/` dir (copied
 * into `dist/agents/` at build-time by `scripts/copy-agents.mjs`). This
 * manifest is the canonical pointer the installer + verifier read from.
 *
 * Adding a new entry:
 *   1. Drop the `<name>.md` file under `agents/`.
 *   2. Add the entry below.
 *   3. Re-run `pnpm build`.
 */

import type { SubagentManifest, SubagentManifestEntry } from './types.js';

const ENTRIES: readonly SubagentManifestEntry[] = [
  {
    name: 'caia-po',
    description:
      'CAIA Product Owner (Tier-2). Classify the prompt domain (BUCKET-002 9-axis taxonomy) and decompose into Initiative → Epic → Story → Task hierarchy. MUST BE USED before any BA-Agent or EA-Agent activity.',
    tools: ['Read', 'Grep', 'Glob', 'Bash'],
    model: 'sonnet',
    tier: 2,
    filename: 'caia-po.md'
  },
  {
    name: 'caia-ba',
    description:
      'CAIA Business Analyst (Tier-2). Use proactively after a story has been decomposed by the PO Agent to enrich it with deterministic acceptance criteria, implementation notes, and per-domain consultant sections.',
    tools: ['Read', 'Grep', 'Glob', 'Bash'],
    model: 'sonnet',
    tier: 2,
    filename: 'caia-ba.md'
  },
  {
    name: 'caia-ea',
    description:
      'CAIA Enterprise Architect (Tier-3). Use proactively for architecture decisions — choosing between candidate approaches, classifying a story by primary architecture domain, producing the architecture sections of a TicketTemplateV1.',
    tools: ['Read', 'Grep', 'Glob', 'Bash', 'WebSearch'],
    model: 'opus',
    tier: 3,
    filename: 'caia-ea.md'
  },
  {
    name: 'caia-validator',
    description:
      'CAIA Story Validator (Tier-3). Use proactively whenever a story claims to be "done" — verifies acceptance criteria are testably satisfied + the DoD 15-point checklist + adversarial-injection regression suite + premature-completion red flags.',
    tools: ['Read', 'Grep', 'Glob', 'Bash'],
    model: 'sonnet',
    tier: 3,
    filename: 'caia-validator.md'
  },
  {
    name: 'caia-test-design',
    description:
      'CAIA Test Designer (Tier-3). Use proactively before any new feature implementation begins — generates a comprehensive test plan covering unit, integration, end-to-end, and adversarial-injection cases.',
    tools: ['Read', 'Grep', 'Glob'],
    model: 'sonnet',
    tier: 3,
    filename: 'caia-test-design.md'
  },
  {
    name: 'caia-coding',
    description:
      'CAIA Coding Worker (Tier-4). Use to actually implement a story end-to-end — write code, write tests, run lint/typecheck/test, push branch, open PR. Honours Git Flow + Evidence Gate + Steward Gatekeeper.',
    tools: ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash'],
    model: 'sonnet',
    tier: 4,
    filename: 'caia-coding.md'
  },
  {
    name: 'caia-fix-it',
    description:
      'CAIA Fix-It Agent (Tier-4). Use proactively whenever a CI check fails on a PR, a test goes red, or a build breaks. Diagnoses + fixes the failure without altering the original PR\'s intent.',
    tools: ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash'],
    model: 'sonnet',
    tier: 4,
    filename: 'caia-fix-it.md'
  },
  {
    name: 'caia-steward',
    description:
      'CAIA Steward Gatekeeper. Use proactively before merging any PR — runs the codified 15-failure-mode analysis from the steward_gatekeeper_directive and produces a gatekeeper verdict (BLOCK / WARN / PASS).',
    tools: ['Read', 'Grep', 'Glob', 'Bash'],
    model: 'sonnet',
    tier: 4,
    filename: 'caia-steward.md'
  },
  {
    name: 'caia-mentor',
    description:
      'CAIA Mentor (Tier-5 self-improvement). Use proactively after any incident — failed PR, bug discovered post-merge, regression. Captures the lesson + classification, indexes it for pre-spawn injection.',
    tools: ['Read', 'Grep', 'Glob', 'Bash'],
    model: 'sonnet',
    tier: 5,
    filename: 'caia-mentor.md'
  },
  {
    name: 'caia-curator',
    description:
      'CAIA Curator (Tier-5 proactive quality scanning). Use proactively for daily platform health scans across measurable quality dimensions (dep CVEs, memory drift, open PR age, stale TODOs, worktree count).',
    tools: ['Read', 'Grep', 'Glob', 'Bash'],
    model: 'sonnet',
    tier: 5,
    filename: 'caia-curator.md'
  }
];

/** Frozen manifest of every shipped CAIA subagent. */
export const MANIFEST: SubagentManifest = Object.freeze({
  version: '0.1.0',
  entries: ENTRIES
});

/** Convenience accessor — find a manifest entry by name. */
export function findEntryByName(name: string): SubagentManifestEntry | null {
  return ENTRIES.find((e) => e.name === name) ?? null;
}

/** Convenience accessor — list all subagent names. */
export function listAvailable(): string[] {
  return ENTRIES.map((e) => e.name);
}
