/**
 * Public type surface for `@caia/atlas-prompt-router`.
 *
 * Spec anchors:
 *   - research/atlas_module_spec_2026.md §4 (per-scope prompt box)
 *   - research/atlas_module_spec_2026.md §5.3 (POST /prompt)
 *   - research/atlas_module_spec_2026.md §11.1 (EA-Dispatcher handoff)
 */

import type { Clock } from './clock.js';
import type { IdGen } from './id.js';

/* ─── Wire shapes (mirrored from @caia/atlas-ui §5) ─────────────── */

export type TicketState =
  | 'proposed'
  | 'approved'
  | 'change-requested'
  | 'in-progress'
  | 'implemented'
  | 'verified'
  | 'orphaned'
  | 'failed';

export interface AtlasSubmitPromptRequest {
  prompt: string;
  selection: string[];
  promptGroupId?: string | null;
  ts: string;
}

export interface AtlasSubmitPromptResponse {
  versionId: string;
  ticketState: TicketState;
  expectedChangeDescription: string;
  dispatchedTo: string[];
  enqueuedAt: string;
}

/* ─── Mapper port ───────────────────────────────────────────────── */

export interface MapperTicket {
  readonly id: string;
  readonly domId?: string;
  readonly parentId?: string;
}

export interface MapperPort {
  ticketByDomId(domId: string): MapperTicket | null;
  descendantTickets(domId: string): MapperTicket[];
}

/* ─── Scope-resolver port ───────────────────────────────────────── */

export type ScopeKind = 'self-only' | 'subtree' | 'page';

export interface ScopeClassification {
  readonly kind: ScopeKind;
  readonly reason: string;
}

export interface IntentClassifierInput {
  readonly prompt: string;
  readonly ticket: MapperTicket;
  readonly selection: ReadonlyArray<string>;
}

export type IntentClassifier = (
  input: IntentClassifierInput,
) => Promise<ScopeClassification> | ScopeClassification;

/* ─── Expected-change writer port ───────────────────────────────── */

export interface ExpectedChangeWriterInput {
  readonly prompt: string;
  readonly ticket: MapperTicket;
  readonly scope: ScopeKind;
}

export type ExpectedChangeWriter = (
  input: ExpectedChangeWriterInput,
) => Promise<string> | string;

/* ─── Version store port ────────────────────────────────────────── */

export interface TicketVersionInsert {
  readonly versionId: string;
  readonly ticketId: string;
  readonly designVersionId: string;
  readonly operatorUserId: string;
  readonly prompt: string;
  readonly selection: ReadonlyArray<string>;
  readonly promptGroupId: string | null;
  readonly operatorTs: string;
  readonly enqueuedAt: string;
  readonly previousState: TicketState;
  readonly newState: TicketState;
  readonly scope: ScopeKind;
  readonly scopeReason: string;
  readonly expectedChangeDescription: string;
  readonly dispatchedTo: ReadonlyArray<string>;
  readonly extra: Readonly<Record<string, unknown>>;
}

export interface VersionStorePort {
  insertVersion(input: TicketVersionInsert): Promise<void> | void;
}

/* ─── State-machine port ────────────────────────────────────────── */

export type TriggeredByOperator = { readonly kind: 'operator'; readonly id: string };

export interface TicketTransitionInput {
  readonly ticketId: string;
  readonly fromState: TicketState;
  readonly toState: TicketState;
  readonly triggeredBy: TriggeredByOperator;
  readonly ts: string;
  readonly reason: string;
  readonly designVersionId: string;
}

export interface StateMachinePort {
  transitionTicket(input: TicketTransitionInput): Promise<void> | void;
}

/* ─── Dispatcher port ───────────────────────────────────────────── */

export interface DispatchInput {
  readonly ticketIds: ReadonlyArray<string>;
  readonly primaryTicketId: string;
  readonly scope: ScopeKind;
  readonly versionId: string;
  readonly prompt: string;
  readonly expectedChangeDescription: string;
  readonly operatorUserId: string;
  readonly designVersionId: string;
  readonly enqueuedAt: string;
}

export interface DispatchResult {
  readonly dispatchedTo: ReadonlyArray<string>;
  readonly enqueuedAt: string;
}

export interface DispatcherPort {
  enqueue(input: DispatchInput): Promise<DispatchResult> | DispatchResult;
}

/* ─── Router deps + options ─────────────────────────────────────── */

export interface RouterDeps {
  readonly mapper: MapperPort;
  readonly versionStore: VersionStorePort;
  readonly stateMachine: StateMachinePort;
  readonly dispatcher: DispatcherPort;
  readonly intentClassifier: IntentClassifier;
  readonly expectedChangeWriter: ExpectedChangeWriter;
  readonly clock: Clock;
  readonly idGen: IdGen;
}

export interface RouterOptions {
  readonly designVersionId?: string;
  readonly previousState?: TicketState;
  readonly maxBodyBytes?: number;
  readonly maxPromptChars?: number;
  readonly minPromptChars?: number;
  readonly maxSelection?: number;
  readonly maxTicketIdChars?: number;
}

export interface SubmitPromptInput {
  readonly ticketId: string;
  readonly operatorUserId: string;
  readonly body: AtlasSubmitPromptRequest;
  readonly designVersionId?: string;
  readonly previousState?: TicketState;
}

/* ─── Router error model ────────────────────────────────────────── */

export type RouterErrorKind =
  | 'invalid-body'
  | 'invalid-prompt'
  | 'invalid-selection'
  | 'invalid-ts'
  | 'invalid-prompt-group-id'
  | 'body-too-large'
  | 'unknown-ticket'
  | 'invalid-transition'
  | 'dispatcher-failed'
  | 'classifier-failed'
  | 'description-writer-failed'
  | 'persistence-failed';

export interface RouterErrorDetail {
  readonly field?: string;
  readonly limit?: number;
  readonly got?: number | string;
  readonly cause?: string;
  readonly originalMessage?: string;
}

export class RouterError extends Error {
  readonly kind: RouterErrorKind;
  readonly detail: RouterErrorDetail;
  constructor(kind: RouterErrorKind, message: string, detail: RouterErrorDetail = {}) {
    super(message);
    this.name = 'RouterError';
    this.kind = kind;
    this.detail = detail;
  }
}

export interface AtlasPromptRouter {
  submitPrompt(input: SubmitPromptInput): Promise<AtlasSubmitPromptResponse>;
}
