/**
 * Curator Phase-2 — action layer public surface.
 *
 * Phase-2 closes the directive's output modes 5..8:
 *
 *   - PR-1: action types + `findingsToActions` classifier + `writeAlarms`
 *           (mode 7).
 *   - PR-2: `writePrProposals` (mode 5) + `writeBacklogDirectives`
 *           (mode 6).
 *   - PR-3 (THIS): `loadWatchlist` + `writeIndustryBriefings` (mode 8)
 *                  + `runActDay` unified runner that does all 4 in one
 *                  call.
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

export {
  defaultIndustryBriefingsDir,
  renderIndustryBriefingMarkdown,
  writeIndustryBriefings
} from './industry-briefing-emitter.js';

export type { WriteIndustryBriefingsOptions } from './industry-briefing-emitter.js';

export {
  defaultWatchlistPath,
  loadWatchlist
} from './watchlist.js';

export type {
  LoadWatchlistOptions,
  WatchlistEntry,
  WatchlistFile
} from './watchlist.js';

export { runActDay } from './runner.js';
export type { RunActDayOptions, RunActDayResult } from './runner.js';

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
