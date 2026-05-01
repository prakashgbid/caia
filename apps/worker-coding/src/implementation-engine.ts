/**
 * ImplementationEngine — CODING-003 (Phase 2C).
 *
 * Drives the actual code-writing loop for one assigned story. Wraps an
 * `LlmAdapter` (default: Claude Agent SDK; pluggable for tests + future
 * routing rules) and a system prompt built from the bundle's
 * architecturalInstructions + agentSections + testCases + claims.
 *
 * The session lifecycle is critical:
 *   1. construct — capture the bundle + worktree path + SDK config.
 *   2. start() — open the SDK session with a stable session id (recorded
 *      on stories.coding_session_id so Fix-It Agent can reuse it).
 *   3. implement() — drive the SDK; the model writes code into the
 *      worktree until it prints the well-known terminator
 *      "CODING_AGENT_DONE" on its own line. Returns the resulting state.
 *   4. applyFix(fixRequest) — Fix-It Agent invokes this through IPC
 *      (CODING-007); resumes the same SDK session with a new user turn
 *      describing the failing test_case + diagnosis.
 *   5. shutdown() — cleanly end the SDK session.
 *
 * The actual `@anthropic-ai/claude-agent-sdk` wire-up lives in the
 * `ClaudeSdkAdapter` (separate file, follow-up PR) — this PR ships the
 * engine + prompt builder + session state machine + a `MockLlmAdapter`
 * to make the contract testable.
 *
 * @owner coding-agent (Phase 2C worker track)
 */

import { randomBytes } from 'crypto';
import type { Bundle } from './bundle-reader';
import type { Worktree } from './worktree-manager';
import * as codingMetrics from './coding-metrics';

function nanoSessionId(): string {
  return `sess_${randomBytes(8).toString('hex')}`;
}

// ─── Adapter contract ───────────────────────────────────────────────────────

/**
 * Discriminator the SDK adapter uses to flag the model's terminator. The
 * engine watches every chunk and stops the loop the first time a chunk
 * contains this exact string on its own line.
 */
export const DONE_MARKER = 'CODING_AGENT_DONE';
export const FIX_APPLIED_MARKER_PREFIX = 'FIX_APPLIED';

export interface LlmTurnResult {
  /** Concatenated assistant text emitted in this turn. */
  text: string;
  /** True if the assistant printed the DONE_MARKER terminator. */
  done: boolean;
  /** True if the assistant printed FIX_APPLIED <sha> marker. */
  fixApplied: boolean;
  /** sha extracted from the FIX_APPLIED line, when present. */
  fixSha: string | null;
  /** Tokens used (input + output) for cost / budget tracking. */
  tokens: { input: number; output: number };
}

export interface LlmAdapter {
  /** Opens a new SDK session and returns its id. */
  start(opts: { sessionId: string; systemPrompt: string; cwd: string }): Promise<void>;
  /** Sends a user turn; returns the assistant's response. */
  send(message: string): Promise<LlmTurnResult>;
  /** Tears down the SDK session. */
  end(): Promise<void>;
}

// ─── Engine ─────────────────────────────────────────────────────────────────

export interface EngineOptions {
  bundle: Bundle;
  worktree: Worktree;
  adapter: LlmAdapter;
  /** Override session id (default: generated). */
  sessionId?: string;
  /** Max user turns the implement loop will issue before bailing. Default 10. */
  maxImplementTurns?: number;
  /** Max user turns the applyFix loop will issue. Default 3. */
  maxFixTurns?: number;
}

export interface ImplementResult {
  status: 'done' | 'turn-limit' | 'adapter-error';
  turns: number;
  totalTokens: { input: number; output: number };
  finalText: string;
}

export interface FixResult {
  status: 'fix-applied' | 'turn-limit' | 'adapter-error';
  turns: number;
  sha: string | null;
  totalTokens: { input: number; output: number };
}

export class ImplementationEngine {
  private readonly bundle: Bundle;
  private readonly worktree: Worktree;
  private readonly adapter: LlmAdapter;
  readonly sessionId: string;
  private readonly maxImplementTurns: number;
  private readonly maxFixTurns: number;
  private started = false;
  private ended = false;

  constructor(opts: EngineOptions) {
    this.bundle = opts.bundle;
    this.worktree = opts.worktree;
    this.adapter = opts.adapter;
    this.sessionId = opts.sessionId ?? nanoSessionId();
    this.maxImplementTurns = opts.maxImplementTurns ?? 10;
    this.maxFixTurns = opts.maxFixTurns ?? 3;
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (this.ended) throw new Error('ImplementationEngine cannot start after end()');
    if (this.started) throw new Error('ImplementationEngine.start() called twice');
    await this.adapter.start({
      sessionId: this.sessionId,
      systemPrompt: this.buildSystemPrompt(),
      cwd: this.worktree.path,
    });
    this.started = true;
  }

  async end(): Promise<void> {
    if (this.ended) return;
    if (this.started) await this.adapter.end();
    this.ended = true;
  }

  // ─── Drive code generation ────────────────────────────────────────────────

  /**
   * Drives the SDK in a loop until the model emits DONE_MARKER. Each
   * "turn" is one user → assistant exchange; the user message is the
   * acceptance criteria reminder + a brief progress prompt. The loop
   * exits early on the marker; otherwise it bails after maxImplementTurns.
   */
  async implement(): Promise<ImplementResult> {
    if (!this.started) throw new Error('ImplementationEngine.implement() requires start() first');
    const t0 = Date.now();
    let totalIn = 0;
    let totalOut = 0;
    let lastText = '';
    for (let i = 1; i <= this.maxImplementTurns; i++) {
      const userMsg =
        i === 1 ? this.firstUserMessage() : 'Continue. When you have finished and local tests pass, print CODING_AGENT_DONE on its own line.';
      let result: LlmTurnResult;
      try {
        result = await this.adapter.send(userMsg);
      } catch (e) {
        const out: ImplementResult = {
          status: 'adapter-error',
          turns: i,
          totalTokens: { input: totalIn, output: totalOut },
          finalText: lastText,
        };
        this.recordImplementMetrics(out, Date.now() - t0);
        return out;
      }
      totalIn += result.tokens.input;
      totalOut += result.tokens.output;
      lastText = result.text;
      if (result.done) {
        const out: ImplementResult = {
          status: 'done',
          turns: i,
          totalTokens: { input: totalIn, output: totalOut },
          finalText: result.text,
        };
        this.recordImplementMetrics(out, Date.now() - t0);
        return out;
      }
    }
    const out: ImplementResult = {
      status: 'turn-limit',
      turns: this.maxImplementTurns,
      totalTokens: { input: totalIn, output: totalOut },
      finalText: lastText,
    };
    this.recordImplementMetrics(out, Date.now() - t0);
    return out;
  }

  private recordImplementMetrics(result: ImplementResult, durationMs: number): void {
    codingMetrics.implementTotal.inc({ status: result.status });
    codingMetrics.implementTurns.observe(result.turns);
    codingMetrics.implementDurationMs.observe(durationMs);
    codingMetrics.llmTokensTotal.inc({ kind: 'input' }, result.totalTokens.input);
    codingMetrics.llmTokensTotal.inc({ kind: 'output' }, result.totalTokens.output);
  }

  /**
   * Applies one fix request from the Fix-It Agent. Resumes the same SDK
   * session (the underlying adapter holds the session); the engine just
   * sends a new user turn formatted from the FixRequest. Returns the
   * outcome including the new sha (parsed from FIX_APPLIED <sha>).
   */
  async applyFix(req: {
    testCaseId: string;
    whatFailed: string;
    hypothesis: string;
    testSpecPath?: string;
    artifactsRef?: { screenshotUrl?: string; tracePath?: string };
    hintFiles?: string[];
  }): Promise<FixResult> {
    if (!this.started) throw new Error('ImplementationEngine.applyFix() requires start() first');
    let totalIn = 0;
    let totalOut = 0;
    const message = this.buildFixMessage(req);
    for (let i = 1; i <= this.maxFixTurns; i++) {
      const userMsg = i === 1 ? message : 'Continue. When you have applied the fix, print FIX_APPLIED <sha> on its own line.';
      let result: LlmTurnResult;
      try {
        result = await this.adapter.send(userMsg);
      } catch (e) {
        const out: FixResult = {
          status: 'adapter-error',
          turns: i,
          sha: null,
          totalTokens: { input: totalIn, output: totalOut },
        };
        this.recordFixMetrics(out);
        return out;
      }
      totalIn += result.tokens.input;
      totalOut += result.tokens.output;
      if (result.fixApplied) {
        const out: FixResult = {
          status: 'fix-applied',
          turns: i,
          sha: result.fixSha,
          totalTokens: { input: totalIn, output: totalOut },
        };
        this.recordFixMetrics(out);
        return out;
      }
    }
    const out: FixResult = {
      status: 'turn-limit',
      turns: this.maxFixTurns,
      sha: null,
      totalTokens: { input: totalIn, output: totalOut },
    };
    this.recordFixMetrics(out);
    return out;
  }

  private recordFixMetrics(result: FixResult): void {
    codingMetrics.applyFixTotal.inc({ status: result.status });
    codingMetrics.applyFixTurns.observe(result.turns);
    codingMetrics.llmTokensTotal.inc({ kind: 'input' }, result.totalTokens.input);
    codingMetrics.llmTokensTotal.inc({ kind: 'output' }, result.totalTokens.output);
  }

  // ─── Prompt builders (public for snapshot testing) ────────────────────────

  buildSystemPrompt(): string {
    const ticket = (this.bundle.ticket ?? {}) as Record<string, unknown>;
    const ac = Array.isArray(ticket.acceptanceCriteria) ? ticket.acceptanceCriteria : [];
    const claims = (ticket.claims ?? {}) as Record<string, unknown>;
    const archInstr = Array.isArray(ticket.architecturalInstructions)
      ? ticket.architecturalInstructions
      : [];
    const agentSections = (ticket.agentSections ?? {}) as Record<string, unknown>;
    const testCases = Array.isArray(ticket.testCases) ? ticket.testCases : [];

    return `You are CAIA's Coding Agent. You are implementing exactly one story end-to-end.

  Story id:    ${this.bundle.story.id}
  Title:       ${this.bundle.story.title}
  Bucket:      ${this.bundle.bucket?.id ?? '(none)'}
  Worktree:    ${this.worktree.path}
  Branch:      ${this.worktree.branch}
  Integration: ${this.worktree.integrationBranch}

ACCEPTANCE CRITERIA (the test design depends on these):
${ac.length > 0 ? ac.map((a, i) => `  ${i + 1}. ${formatAc(a)}`).join('\n') : '  (none — pull from agentSections)'}

EA's ARCHITECTURAL INSTRUCTIONS (per-domain technical implementation):
${
  archInstr.length === 0
    ? '  (none yet — fall back to agentSections)'
    : archInstr.map((x) => `  - ${formatArchInstruction(x)}`).join('\n')
}

BA's PER-DOMAIN FUNCTIONAL REQUIREMENTS:
${formatAgentSections(agentSections)}

RESOURCE CLAIMS (must stay within these):
  files:       ${formatList((claims.files ?? []) as string[])}
  schemas:     ${formatList((claims.schemas ?? []) as string[])}
  apiRoutes:   ${formatList((claims.apiRoutes ?? []) as string[])}
  domains:     ${formatList((claims.domains ?? []) as string[])}

TEST CASES (the Fix-It Test Agent will run these; you must satisfy ALL of them):
${
  testCases.length === 0
    ? '  (none yet)'
    : testCases.map((t, i) => `  ${i + 1}. ${formatTestCase(t)}`).join('\n')
}

PROCESS:
1. Read the architectural instructions exactly. Reuse referenced
   components/APIs/schemas; do not re-implement what already exists.
2. Stay within the resource claims. If a fix requires touching a file
   outside claims, stop and emit "OUT_OF_SCOPE" with the file path.
3. After every meaningful change, run the appropriate package's
   pnpm lint && pnpm typecheck. After implementing the full surface,
   run the local unit + integration tests in the touched packages and
   fix any failures before declaring done.
4. When confident the implementation is complete and local tests pass,
   print "${DONE_MARKER}" on its own line and stop.

If the Fix-It Test Agent later asks you to fix a failing test_case via
the IPC apply_fix protocol, apply a minimal fix that makes that case
pass without breaking other tests; when done, print
"${FIX_APPLIED_MARKER_PREFIX} <sha>" on its own line and stop.`;
  }

  firstUserMessage(): string {
    return `Begin implementing the story now. Start by reading the relevant existing files referenced in the architectural instructions; then make the changes; then run the local tests in the touched packages. When you are confident the implementation is complete and local tests pass, print ${DONE_MARKER} on its own line and stop.`;
  }

  buildFixMessage(req: {
    testCaseId: string;
    whatFailed: string;
    hypothesis: string;
    testSpecPath?: string;
    artifactsRef?: { screenshotUrl?: string; tracePath?: string };
    hintFiles?: string[];
  }): string {
    return `The Fix-It Test Agent reports test_case ${req.testCaseId} failed.

WHAT FAILED:
${req.whatFailed}

HYPOTHESIS:
${req.hypothesis}

${req.testSpecPath ? `Generated spec: ${req.testSpecPath}\n` : ''}${
      req.artifactsRef?.screenshotUrl ? `Screenshot: ${req.artifactsRef.screenshotUrl}\n` : ''
    }${req.artifactsRef?.tracePath ? `Trace: ${req.artifactsRef.tracePath}\n` : ''}${
      req.hintFiles && req.hintFiles.length > 0
        ? `Hint files (likely involve the failing surface):\n${req.hintFiles.map((f) => `  - ${f}`).join('\n')}\n`
        : ''
    }
Apply a minimal fix that makes this test case pass without breaking
other tests. When done, print "${FIX_APPLIED_MARKER_PREFIX} <sha>" on
its own line and stop.`;
  }
}

// ─── Mock adapter for tests ─────────────────────────────────────────────────

/**
 * Fully-mocked adapter that exposes a queue of pre-canned turn results.
 * Tests script the agent's behavior by pushing turns; the engine reads
 * them in order. Throws if the queue is empty when send() is called
 * (signals a test bug — engine over-iterated).
 */
export class MockLlmAdapter implements LlmAdapter {
  private queue: LlmTurnResult[] = [];
  startCalls: Array<{ sessionId: string; cwd: string }> = [];
  sendCalls: string[] = [];
  endCalls = 0;

  enqueue(turn: Partial<LlmTurnResult>): this {
    this.queue.push({
      text: turn.text ?? '',
      done: turn.done ?? false,
      fixApplied: turn.fixApplied ?? false,
      fixSha: turn.fixSha ?? null,
      tokens: turn.tokens ?? { input: 100, output: 50 },
    });
    return this;
  }

  async start(opts: { sessionId: string; systemPrompt: string; cwd: string }): Promise<void> {
    this.startCalls.push({ sessionId: opts.sessionId, cwd: opts.cwd });
  }

  async send(message: string): Promise<LlmTurnResult> {
    this.sendCalls.push(message);
    const next = this.queue.shift();
    if (!next) throw new Error('MockLlmAdapter: queue exhausted (test enqueued too few turns)');
    return next;
  }

  async end(): Promise<void> {
    this.endCalls++;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatAc(a: unknown): string {
  if (typeof a === 'string') return a;
  if (a && typeof a === 'object') {
    const obj = a as Record<string, unknown>;
    return String(obj.title ?? obj.statement ?? obj.given ?? JSON.stringify(a));
  }
  return JSON.stringify(a);
}

function formatArchInstruction(x: unknown): string {
  if (!x || typeof x !== 'object') return JSON.stringify(x);
  const obj = x as Record<string, unknown>;
  const kind = String(obj.kind ?? obj.type ?? 'note');
  const domain = String(obj.domain ?? obj.techSubDomain ?? 'general');
  const text = String(obj.text ?? obj.instruction ?? obj.description ?? JSON.stringify(obj));
  return `[${kind}/${domain}] ${text}`;
}

function formatAgentSections(s: Record<string, unknown>): string {
  const keys = Object.keys(s);
  if (keys.length === 0) return '  (none)';
  return keys
    .map((k) => {
      const v = s[k];
      if (typeof v === 'string') return `  ${k}: ${v}`;
      return `  ${k}: ${JSON.stringify(v)}`;
    })
    .join('\n');
}

function formatList(xs: string[]): string {
  if (xs.length === 0) return '(none — only allowed to read)';
  return xs.join(', ');
}

function formatTestCase(t: unknown): string {
  if (!t || typeof t !== 'object') return JSON.stringify(t);
  const obj = t as Record<string, unknown>;
  const id = String(obj.id ?? '');
  const title = String(obj.title ?? obj.summary ?? '');
  const category = String(obj.category ?? '');
  return `${id} ${category ? `[${category}] ` : ''}${title}`;
}
