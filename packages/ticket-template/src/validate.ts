/**
 * Validation helpers — wrap Zod parse errors into a flat, JSON-serialisable
 * shape so consumers (route handlers, agents, the dashboard) can surface
 * field-level validation errors consistently.
 */

import { z } from 'zod';
import { TicketTemplateV1, TicketTemplateV1Schema } from './schema';

export interface ValidationError {
  /** Dotted path into the ticket payload (e.g. `acceptanceCriteria` or `agentSections.api.routes.0.method`). */
  path: string;
  /** Human-readable Zod message. */
  message: string;
  /** Zod issue code (e.g. `too_small`, `invalid_type`). */
  code: string;
}

export type ValidationResult =
  | { ok: true; value: TicketTemplateV1 }
  | { ok: false; errors: ValidationError[] };

function flattenIssues(error: z.ZodError): ValidationError[] {
  return error.issues.map((issue) => ({
    path: issue.path.length > 0 ? issue.path.join('.') : '<root>',
    message: issue.message,
    code: issue.code,
  }));
}

/**
 * Validate a candidate ticket payload against the v1 schema.
 *
 * Returns a discriminated union — `ok: true` on success with the typed
 * payload, or `ok: false` with a flat list of field-level errors.
 */
export function validateTicket(payload: unknown): ValidationResult {
  const parsed = TicketTemplateV1Schema.safeParse(payload);
  if (parsed.success) {
    return { ok: true, value: parsed.data };
  }
  return { ok: false, errors: flattenIssues(parsed.error) };
}

/**
 * Convenience predicate — true if a payload is structurally valid.
 * Use {@link validateTicket} when you need the parsed value or errors.
 */
export function isValidTicket(payload: unknown): boolean {
  return TicketTemplateV1Schema.safeParse(payload).success;
}

/**
 * Throws a descriptive error if the payload is invalid; returns the typed
 * payload otherwise. Useful at agent boundaries where invariants must hold.
 */
export function assertValidTicket(payload: unknown): TicketTemplateV1 {
  const result = validateTicket(payload);
  if (!result.ok) {
    const summary = result.errors
      .slice(0, 5)
      .map((e) => `${e.path}: ${e.message}`)
      .join('; ');
    throw new Error(`ticket-template: invalid payload — ${summary}`);
  }
  return result.value;
}
