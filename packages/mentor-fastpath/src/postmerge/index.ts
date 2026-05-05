/**
 * Mentor Phase-2 postmerge module — public surface.
 *
 * Phase 2 (per `mentor_agent_directive.md` ## Phased rollout) extends
 * Mentor to react to event-driven signals from the platform itself:
 *
 *   - PRMerged          — a PR landed
 *   - EvidenceGateFailure — a required CI check failed (pre-merge)
 *   - RegressionDetected — CI red on a SHA that includes a merge commit
 *   - PostMergeBugReport — operator filed a bug after merge
 *
 * This PR ships the *data layer*: a pure-function classifier + pure-
 * function synthesizer that take structured event payloads and produce
 * the same `SynthesizedLesson` shape the Phase-1 memory-writer
 * already understands. Producer (event-bus emitter from `gh` polling)
 * + consumer (subscriber that wires this classifier into the existing
 * fastpath consumer's onClassified callback) ship in subsequent PRs.
 *
 * Usage today (Phase-2 PR-1, data-layer only):
 *
 *     import {
 *       classifyPostMerge,
 *       synthesizePostMerge,
 *       type PostMergeInput,
 *       type PostMergeEventRow
 *     } from '@chiefaia/mentor-fastpath/postmerge';
 *
 *     const input: PostMergeInput = {
 *       prNumber: 325,
 *       sha: 'e6b8811',
 *       branch: 'develop',
 *       failedJobs: ['integration-tests'],
 *       postMergeAgeSec: 480,
 *       signal: 'regression-after-merge'
 *     };
 *     const cls = classifyPostMerge(input);
 *     const lesson = synthesizePostMerge(eventRow, input, cls);
 *     // lesson.markdown is ready for memory-writer.writeProposal()
 *
 * Future PRs (Phase-2 PR-2, PR-3) wire this into a long-running
 * subscriber and a producer that polls `gh pr list` / `gh run list`.
 */

export {
  classifyPostMerge,
  _jobTagCount as _postmergeJobTagCount
} from './classifier.js';

export { synthesizePostMerge } from './synthesizer.js';

export type {
  PostMergeInput,
  PostMergeEventRow,
  ClassificationResult,
  FailureMode,
  Generalizability,
  Severity
} from './types.js';
