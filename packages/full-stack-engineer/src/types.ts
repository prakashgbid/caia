/**
 * Public type surface for @caia/full-stack-engineer (Stage 13).
 *
 * The Full-Stack Engineer is a per-ticket coding worker. It consumes the
 * 17 architects' composed `ticket.architecture` blob + the Test Author's
 * `ticket.testCases`, emits frontend / backend / database / test code,
 * runs a local gate, and opens a PR. Stage 14 (per-story-tester) takes
 * over from there.
 */

import type {
  ArchitectOutput,
  Ticket,
} from '@caia/architect-kit';
import type {
  ProjectState,
  StateMachine,
  TransitionResult,
  TriggeredBy,
} from '@caia/state-machine';
import type {
  TestCase,
  TestCaseCategory,
  TestCaseLayer,
} from '@chiefaia/ticket-template';

// ─── Worker-local sub-states ──────────────────────────────────────────────

/**
 * Worker-local lifecycle marker. NOT part of the canonical FSM (which
 * remains `scheduled → coding-in-progress → code-complete | coding-failed`).
 *
 * These are emitted as payload on the FSM transitions and used by the
 * package's own callers for fine-grained progress observability.
 */
export type WorkerSubState =
  | 'unclaimed'
  | 'claimed'
  | 'implementing'
  | 'tests-passing-locally'
  | 'pr-opened'
  | 'implementation-failed'
  | 'idempotent-noop';

// ─── Ticket loading ────────────────────────────────────────────────────────

/**
 * Snapshot of the ticket the worker is about to implement. Loaded by the
 * `TicketStore.loadTicket(ticketId)` adapter. The store is responsible
 * for materialising `architecture` (the disjoint JSONB written by the 17
 * architects) and `testCases` (the Test Author's output).
 */
export interface LoadedTicket {
  ticketId: string;
  projectId: string;
  /** Filesystem root of the project repo the worker will write into. */
  repoPath: string;
  /** Branch the worker should commit on. */
  branchName: string;
  /** Conventional-commit prefix, e.g. `feat(checkout)` or `fix(api)`. */
  commitScope: string;
  /** Free-form ticket metadata (title, scope, parent, etc.). */
  ticket: Ticket;
  /** Disjoint JSONB written by the 17 architects (composed by EA Dispatcher). */
  architecture: Record<string, unknown>;
  /** Acceptance criteria authored by BA + EA. */
  acceptanceCriteria: readonly string[];
  /** Test cases authored by Test Author. */
  testCases: readonly TestCase[];
  /** Per-architect outputs preserved for the spec reader. */
  architectOutputs?: readonly ArchitectOutput[];
  /** Optional ticket-scoped file allowlist (relative to repoPath). */
  fileAllowlist?: readonly string[];
}

export interface TicketStore {
  loadTicket(ticketId: string): Promise<LoadedTicket>;
}

// ─── ImplementationBrief (spec-reader output) ─────────────────────────────

/**
 * The consolidated, focused brief handed to the emitter subagent. Built
 * from `LoadedTicket` by `spec-reader.ts`. Keys mirror the canonical
 * architect families so the subagent can read them deterministically.
 */
export interface ImplementationBrief {
  ticketId: string;
  projectId: string;
  ticketTitle: string;
  acceptanceCriteria: readonly string[];
  frontend: FrontendBriefSection;
  backend: BackendBriefSection;
  database: DatabaseBriefSection;
  tests: TestsBriefSection;
  crosscutting: CrosscuttingBriefSection;
  /** Stack lock — emitted into the prompt verbatim. */
  stackLock: StackLockBlock;
  /** Sibling architect notes that don't belong in any single bucket. */
  miscArchitectNotes: readonly { architect: string; note: string }[];
}

export interface FrontendBriefSection {
  /** Component tree node specs (path → spec). */
  componentTree: readonly ComponentSpec[];
  /** Design tokens (Tailwind theme overrides). */
  tokens: Record<string, unknown> | undefined;
  /** Pages / routes to scaffold. */
  routes: readonly RouteSpec[];
  /** State-management module specs. */
  stateModules: readonly StateModuleSpec[];
}

export interface ComponentSpec {
  path: string;
  componentName: string;
  shadcnPrimitives: readonly string[];
  /** Anchor IDs from RenderableDesign to wire into the component. */
  anchors: readonly string[];
  /** Free-form behaviour notes from the architect. */
  notes: string;
}

export interface RouteSpec {
  path: string;
  /** Tailwind layout class string (architect-supplied). */
  layoutClass?: string;
  /** Component path to render. */
  rendersComponent: string;
  /** True for server components, false for client. Default: true. */
  serverComponent?: boolean;
}

export interface StateModuleSpec {
  path: string;
  storeName: string;
  /** State slice keys (architect-supplied). */
  sliceKeys: readonly string[];
}

export interface BackendBriefSection {
  /** API endpoints to implement. */
  endpoints: readonly EndpointSpec[];
  /** Service modules to scaffold. */
  services: readonly ServiceSpec[];
  /** Auth/authz constraints from the security architect. */
  authConstraints: readonly string[];
}

export interface EndpointSpec {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  handlerPath: string;
  requestShape: string;
  responseShape: string;
  notes: string;
}

export interface ServiceSpec {
  path: string;
  serviceName: string;
  notes: string;
}

export interface DatabaseBriefSection {
  /** Migrations to author. */
  migrations: readonly MigrationSpec[];
  /** Repository modules to scaffold. */
  repositories: readonly RepositorySpec[];
}

export interface MigrationSpec {
  filename: string;
  /** SQL body, fully composed by the database architect. */
  sql: string;
  notes: string;
}

export interface RepositorySpec {
  path: string;
  repoName: string;
  notes: string;
}

export interface TestsBriefSection {
  /** Test cases the implementation must satisfy. */
  cases: readonly TestCase[];
  /** Local gate spec — what the worker runs before opening the PR. */
  localGate: {
    typecheck: boolean;
    lint: boolean;
    vitest: boolean;
  };
}

export interface CrosscuttingBriefSection {
  accessibility: readonly string[];
  performanceBudgets: readonly string[];
  observability: readonly string[];
  security: readonly string[];
  i18n: readonly string[];
  seo: readonly string[];
}

export interface StackLockBlock {
  /** Always true in this build. */
  shadcnReactFirst: true;
  /** UI primitives source. */
  uiPrimitives: 'shadcn/ui';
  /** Styling system. */
  styling: 'tailwind';
  /** Disallowed import patterns. */
  forbidden: readonly string[];
}

// ─── Code emitter ──────────────────────────────────────────────────────────

export interface EmittedFile {
  /** Path relative to repoPath. */
  path: string;
  contents: string;
  /** Free-form architect attribution — which architect's section this fulfils. */
  attribution: readonly string[];
}

export interface EmittedFiles {
  frontend: readonly EmittedFile[];
  backend: readonly EmittedFile[];
  database: readonly EmittedFile[];
  tests: readonly EmittedFile[];
}

export interface Emitter {
  /** Pure function: brief → file plan. Production uses a spawned subagent. */
  emit(brief: ImplementationBrief): Promise<EmittedFiles>;
}

// ─── PR opener ─────────────────────────────────────────────────────────────

export interface GitAdapter {
  /** Stage and commit the given files on the worker's branch. */
  stageAndCommit(input: {
    repoPath: string;
    branchName: string;
    files: readonly EmittedFile[];
    message: string;
  }): Promise<{ commitSha: string }>;
  /** Push the branch to origin. */
  push(input: { repoPath: string; branchName: string }): Promise<void>;
  /** Open a PR via `gh pr create`. Returns the PR url + number. */
  openPr(input: {
    repoPath: string;
    branchName: string;
    title: string;
    body: string;
    base: string;
  }): Promise<{ prNumber: number; prUrl: string }>;
  /** True if a PR is already open for the branch (idempotent re-entry). */
  prExists(input: {
    repoPath: string;
    branchName: string;
  }): Promise<{ prNumber: number; prUrl: string } | null>;
}

export interface LocalGateRunner {
  typecheck(input: { repoPath: string }): Promise<LocalGateResult>;
  lint(input: { repoPath: string }): Promise<LocalGateResult>;
  vitest(input: { repoPath: string }): Promise<LocalGateResult>;
}

export interface LocalGateResult {
  passed: boolean;
  durationMs: number;
  /** Captured stderr if it failed. Empty when passed. */
  output: string;
}

export interface PrOutcome {
  prNumber: number;
  prUrl: string;
  commitSha: string;
  /** Aggregated local-gate result (sum across typecheck / lint / vitest). */
  localGate: {
    passed: boolean;
    durationMs: number;
    failures: readonly { gate: 'typecheck' | 'lint' | 'vitest'; output: string }[];
  };
}

// ─── Work claimer ──────────────────────────────────────────────────────────

export interface ClaimOutcome {
  claimed: boolean;
  /** Reason for failure (or 'already-in-progress' for idempotent re-entry). */
  reason: string;
  workerId: string;
  ticketId: string;
  projectId: string;
  /** TTL in seconds, mirrored from state-machine. */
  ttlSeconds?: number;
  /** Transition result for the `scheduled → coding-in-progress` move. */
  transition?: ClaimTransitionOutcome;
}

export interface ClaimTransitionOutcome {
  attempted: true;
  fromState: ProjectState;
  toState: ProjectState;
  applied: boolean;
  reason: string;
  transitionResult: TransitionResult;
}

// ─── Engineer result ───────────────────────────────────────────────────────

export interface EngineerResult {
  ticketId: string;
  projectId: string;
  workerId: string;
  branchName: string;
  worktreePath: string;
  subState: WorkerSubState;
  emittedFiles: EmittedFiles;
  /** Present when subState === 'pr-opened' or 'idempotent-noop'. */
  pr?: PrOutcome;
  /** Present whenever the worker attempted a transition. */
  claimTransition?: ClaimTransitionOutcome;
  /** Present when the worker drove the second transition (to `code-complete` or `coding-failed`). */
  completionTransition?: ClaimTransitionOutcome;
  failureReason?: string;
  startedAtIso: string;
  finishedAtIso: string;
}

// ─── Config ────────────────────────────────────────────────────────────────

export interface FullStackEngineerConfig {
  store: TicketStore;
  emitter: Emitter;
  git: GitAdapter;
  localGate: LocalGateRunner;
  stateMachine?: StateMachine;
  triggeredBy?: TriggeredBy;
  /** Override the worker id; defaults to deterministic per ticket. */
  workerId?: string;
  /** Override the PR base branch; defaults to `develop`. */
  prBaseBranch?: string;
  /** Skip the state-machine driver (test-only). */
  skipStateMachine?: boolean;
  /** Skip the local gate (test-only). */
  skipLocalGate?: boolean;
  /** Deterministic clock for time-based fields. */
  clock?: () => Date;
  /**
   * Optional ID nonce — appended to the workerId to disambiguate parallel
   * workers for the same ticket. Defaults to a short timestamp.
   */
  nonce?: string;
}
