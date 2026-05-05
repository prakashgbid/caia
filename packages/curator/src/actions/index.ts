/**
 * Curator Phase-2 — action layer public surface.
 *
 * Exports:
 *
 *   - The `Action` type system (4 output modes from the directive).
 *   - `findingsToActions` — pure classifier that maps Findings to
 *     Actions per the routing rules in `classifier.ts`.
 *   - `slugify`, `actionSlugForFinding`, `classifyKind` — small
 *     helpers used by the classifier; exported so future emitters
 *     (PR-2 + PR-3) can reuse them without re-defining the rules.
 *   - `writeAlarms`, `renderAlarmMarkdown`, `defaultAlarmsDir` — the
 *     alarm emitter (output mode 7).
 *
 * Phase-2 PR-2 will add `writePrProposals` + `writeBacklogDirectives`.
 * Phase-2 PR-3 will add the industry-briefing scanner + a unified
 * `caia-curator act` runner that calls all four emitters in one pass.
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
