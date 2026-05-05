/**
 * Curator Phase-2 — action layer public surface.
 *
 * Exports:
 *
 *   - The `Action` type system (4 output modes from the directive).
 *   - `findingsToActions` — pure classifier that maps Findings to
 *     Actions per the routing rules in `classifier.ts`.
 *   - `slugify`, `actionSlugForFinding`, `classifyKind` — small
 *     helpers used by the classifier; exported so emitters and the
 *     industry-briefing scanner (PR-3) can reuse them without
 *     re-defining the rules.
 *   - `writeAlarms`, `renderAlarmMarkdown`, `defaultAlarmsDir` — the
 *     alarm emitter (output mode 7).
 *   - `writePrProposals`, `renderPrProposalMarkdown`,
 *     `defaultPrProposalsDir` — the PR-proposal emitter (output mode 5).
 *   - `writeBacklogDirectives`, `renderBacklogDirectiveMarkdown`,
 *     `defaultBacklogDirectivesDir` — the backlog-directive emitter
 *     (output mode 6).
 *
 * Phase-2 PR-3 will add the industry-briefing scanner (output mode 8)
 * + a unified `caia-curator act` runner that calls all four emitters
 * in one pass.
 */

export {
  actionSlugForFinding,
  classifyKind,
  findingsToActions,
  slugify
} from './classifier.js';

export {
  defaultAlarmsDir,
  renderAlarmMarkdown,
  writeAlarms
} from './alarm-emitter.js';

export type { WriteAlarmsOptions } from './alarm-emitter.js';

export {
  defaultPrProposalsDir,
  renderPrProposalMarkdown,
  writePrProposals
} from './pr-proposal-emitter.js';

export type { WritePrProposalsOptions } from './pr-proposal-emitter.js';

export {
  defaultBacklogDirectivesDir,
  renderBacklogDirectiveMarkdown,
  writeBacklogDirectives
} from './backlog-directive-emitter.js';

export type { WriteBacklogDirectivesOptions } from './backlog-directive-emitter.js';

export type {
  Action,
  ActionKind,
  AlarmAction,
  BacklogDirectiveAction,
  BaseAction,
  EmitResult,
  EmittedActionRef,
  IndustryBriefingAction,
  PrProposalAction
} from './types.js';
