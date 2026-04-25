/**
 * TRACE-001/002 enforcement — ensures `prompt_create` has been called and a
 * `root_prompt_id` is available before any orchestrator decomposition or
 * `start_task` / `start_code_task` dispatch occurs.
 *
 * This module does NOT call any MCP tools or HTTP APIs. It tracks state and
 * records violations. The actual `prompt_create` tool call is made by the
 * caller; the context is notified via `setRootPromptId`.
 *
 * @no-events — enforcement/tracking layer only; no domain events emitted.
 */

import { createHash } from 'crypto';
import type { PromptRecord, MiddlewareViolation } from './types.js';
import { MissingRootPromptError } from './errors.js';

/** Window within which an identical prompt body is treated as a duplicate. */
const DEDUP_WINDOW_MS = 10_000;

interface PromptEntry {
  record: PromptRecord;
  id: string;
  recordedAt: number; // ms epoch
}

/**
 * Computes the SHA-256 hex digest of a UTF-8 string.
 *
 * @no-events
 */
function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * Session-scoped context that enforces TRACE-001/002.
 *
 * One `PromptContext` per orchestrator session. Callers must:
 *   1. Call `ensurePromptCreated` before decomposing or spawning tasks.
 *   2. Call `setRootPromptId` once the `prompt_create` MCP tool returns its ID.
 *   3. Call `assertHasRootPromptId` immediately before any spawn to block
 *      out-of-order operations.
 *
 * @no-events — pure state container; no domain events emitted.
 */
export class PromptContext {
  private rootPromptId: string | undefined;
  private readonly promptHistory = new Map<string, PromptEntry>();
  private readonly violations: MiddlewareViolation[] = [];
  private idCounter = 0;

  /**
   * Checks whether the given prompt body has been created within the dedup
   * window. If yes, returns the existing pseudo-ID. If no, records it and
   * returns a new pseudo-ID.
   *
   * NOTE: This method records state but does NOT call `prompt_create`. The
   * caller is responsible for invoking the MCP tool and then calling
   * `setRootPromptId` with the returned ID.
   *
   * @no-events
   * @param body - Raw prompt text.
   * @param receivedVia - Channel through which the prompt arrived.
   * @returns A pseudo-ID string. Callers should replace this with the real ID
   *          returned by the `prompt_create` MCP tool.
   */
  async ensurePromptCreated(
    body: string,
    receivedVia: PromptRecord['receivedVia'],
  ): Promise<string> {
    const hash = sha256(body);
    const now = Date.now();

    const existing = this.promptHistory.get(hash);
    if (existing && now - existing.recordedAt < DEDUP_WINDOW_MS) {
      return existing.id;
    }

    const id = `prompt-${++this.idCounter}-${hash.slice(0, 8)}`;
    const record: PromptRecord = {
      body,
      receivedVia,
      hash,
      createdAt: new Date(now).toISOString(),
    };
    this.promptHistory.set(hash, { record, id, recordedAt: now });
    return id;
  }

  /**
   * Returns the current `root_prompt_id`, or `undefined` if not yet set.
   *
   * @no-events
   */
  getRootPromptId(): string | undefined {
    return this.rootPromptId;
  }

  /**
   * Sets the `root_prompt_id` returned by the `prompt_create` MCP tool.
   * Must be called before any `start_task` / `start_code_task` dispatch.
   *
   * @no-events
   */
  setRootPromptId(id: string): void {
    this.rootPromptId = id;
  }

  /**
   * Asserts that a `root_prompt_id` has been set.
   * Throws `MissingRootPromptError` and records a TRACE-001 violation if not.
   *
   * @no-events
   * @throws {MissingRootPromptError} when no root_prompt_id is available.
   */
  assertHasRootPromptId(): void {
    if (this.rootPromptId !== undefined) { return; }

    const error = new MissingRootPromptError(
      'assertHasRootPromptId called before setRootPromptId',
    );
    this.violations.push({
      ruleId: 'TRACE-001',
      severity: 'block',
      message: error.message,
      context: { promptHistorySize: this.promptHistory.size },
      timestamp: new Date().toISOString(),
    });
    throw error;
  }

  /**
   * Returns all TRACE-001/002 violations recorded in this session.
   *
   * @no-events
   */
  getViolations(): MiddlewareViolation[] {
    return [...this.violations];
  }

  /**
   * Resets all internal state. Intended for use between test cases.
   *
   * @no-events
   */
  reset(): void {
    this.rootPromptId = undefined;
    this.promptHistory.clear();
    this.violations.length = 0;
    this.idCounter = 0;
  }
}
