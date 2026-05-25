/**
 * HTTP adapter for the Principal Engineer.
 *
 * Exposes POST /api/principal-engineer/schedule as a framework-agnostic
 * { method, body } -> { status, headers, body } function so the
 * orchestrator can wire it into Express, Fastify, Bun, Hono, or any
 * other HTTP runtime without forcing a transitive dep on this package.
 *
 * Validation is hand-rolled (no Zod) to keep the dep graph clean.
 */

import { schedule } from './scheduler.js';
import type {
  ScheduleInput,
  ScheduleRequestShape,
  ScheduleResponseShape,
  SchedulerConfig,
  TenantTier,
  Ticket,
} from './types.js';

const ROUTE = '/api/principal-engineer/schedule';

/** Build the framework-agnostic handler. */
export function createScheduleHandler(config: SchedulerConfig) {
  return async function handleSchedule(
    request: ScheduleRequestShape,
  ): Promise<ScheduleResponseShape> {
    if (request.method.toUpperCase() !== 'POST') {
      return jsonResponse(405, {
        error: 'method-not-allowed',
        message: `${ROUTE} only accepts POST`,
      });
    }

    const parsed = parseScheduleBody(request.body);
    if (!parsed.ok) {
      return jsonResponse(400, {
        error: 'invalid-body',
        message: parsed.message,
        field: parsed.field,
      });
    }

    try {
      const result = await schedule(parsed.input, config);
      if (result.cycles.length > 0) {
        return jsonResponse(422, {
          error: 'dependency-cycle',
          message: `cannot schedule: ${result.cycles.length} cycle(s) in input`,
          cycles: result.cycles,
        });
      }
      return jsonResponse(200, {
        wavePlan: result.wavePlan,
        dispatched: result.dispatched,
        transitions: result.transitions,
        failures: result.failures,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return jsonResponse(500, { error: 'schedule-failed', message: msg });
    }
  };
}

/** The route literal exported for orchestrator wiring. */
export const SCHEDULE_ROUTE = ROUTE;

// ─── Validation ─────────────────────────────────────────────────────────────

interface ParseOk {
  readonly ok: true;
  readonly input: ScheduleInput;
}
interface ParseErr {
  readonly ok: false;
  readonly message: string;
  readonly field?: string;
}

const VALID_TIERS: readonly TenantTier[] = ['free', 'pro', 'enterprise'];

export function parseScheduleBody(body: unknown): ParseOk | ParseErr {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, message: 'body must be a JSON object' };
  }
  const b = body as Record<string, unknown>;

  if (!Array.isArray(b['tickets'])) {
    return { ok: false, message: 'tickets must be an array', field: 'tickets' };
  }
  const tickets: Ticket[] = [];
  for (const [i, raw] of (b['tickets'] as unknown[]).entries()) {
    if (typeof raw !== 'object' || raw === null) {
      return { ok: false, message: `tickets[${i}] must be an object`, field: `tickets[${i}]` };
    }
    const t = raw as Record<string, unknown>;
    if (typeof t['ticketId'] !== 'string' || (t['ticketId'] as string).length === 0) {
      return {
        ok: false,
        message: `tickets[${i}].ticketId must be a non-empty string`,
        field: `tickets[${i}].ticketId`,
      };
    }
    if (!Array.isArray(t['dependsOn'])) {
      return {
        ok: false,
        message: `tickets[${i}].dependsOn must be an array of strings`,
        field: `tickets[${i}].dependsOn`,
      };
    }
    for (const [j, dep] of (t['dependsOn'] as unknown[]).entries()) {
      if (typeof dep !== 'string') {
        return {
          ok: false,
          message: `tickets[${i}].dependsOn[${j}] must be a string`,
          field: `tickets[${i}].dependsOn[${j}]`,
        };
      }
    }
    let resourceLocks: readonly string[] | undefined;
    if (t['resourceLocks'] !== undefined) {
      if (!Array.isArray(t['resourceLocks'])) {
        return {
          ok: false,
          message: `tickets[${i}].resourceLocks must be an array of strings if set`,
          field: `tickets[${i}].resourceLocks`,
        };
      }
      for (const [j, lock] of (t['resourceLocks'] as unknown[]).entries()) {
        if (typeof lock !== 'string') {
          return {
            ok: false,
            message: `tickets[${i}].resourceLocks[${j}] must be a string`,
            field: `tickets[${i}].resourceLocks[${j}]`,
          };
        }
      }
      resourceLocks = (t['resourceLocks'] as unknown[]).slice() as readonly string[];
    }
    let effort: number | undefined;
    if (t['effort'] !== undefined) {
      if (typeof t['effort'] !== 'number' || !Number.isFinite(t['effort'])) {
        return {
          ok: false,
          message: `tickets[${i}].effort must be a finite number if set`,
          field: `tickets[${i}].effort`,
        };
      }
      effort = t['effort'];
    }
    const ticket: Ticket = {
      ticketId: t['ticketId'] as string,
      dependsOn: ((t['dependsOn'] as unknown[]).slice() as readonly string[]),
      ...(resourceLocks !== undefined ? { resourceLocks } : {}),
      ...(effort !== undefined ? { effort } : {}),
    };
    tickets.push(ticket);
  }

  if (
    typeof b['projectIdByTicket'] !== 'object' ||
    b['projectIdByTicket'] === null
  ) {
    return {
      ok: false,
      message: 'projectIdByTicket must be a string->string object',
      field: 'projectIdByTicket',
    };
  }
  const projectIdByTicket: Record<string, string> = {};
  for (const [k, v] of Object.entries(b['projectIdByTicket'] as Record<string, unknown>)) {
    if (typeof v !== 'string' || v.length === 0) {
      return {
        ok: false,
        message: `projectIdByTicket[${k}] must be a non-empty string`,
        field: `projectIdByTicket.${k}`,
      };
    }
    projectIdByTicket[k] = v;
  }
  for (const t of tickets) {
    if (!(t.ticketId in projectIdByTicket)) {
      return {
        ok: false,
        message: `projectIdByTicket missing entry for ticket ${t.ticketId}`,
        field: `projectIdByTicket.${t.ticketId}`,
      };
    }
  }

  if (
    typeof b['tenantTier'] !== 'string' ||
    !VALID_TIERS.includes(b['tenantTier'] as TenantTier)
  ) {
    return {
      ok: false,
      message: `tenantTier must be one of ${VALID_TIERS.join(', ')}`,
      field: 'tenantTier',
    };
  }
  let tenantOverrideCap: number | undefined;
  if (b['tenantOverrideCap'] !== undefined) {
    if (
      typeof b['tenantOverrideCap'] !== 'number' ||
      !Number.isFinite(b['tenantOverrideCap']) ||
      (b['tenantOverrideCap'] as number) < 1
    ) {
      return {
        ok: false,
        message: 'tenantOverrideCap must be a positive finite number if set',
        field: 'tenantOverrideCap',
      };
    }
    tenantOverrideCap = Math.floor(b['tenantOverrideCap'] as number);
  }

  const input: ScheduleInput = {
    tickets,
    projectIdByTicket,
    tenantTier: b['tenantTier'] as TenantTier,
    ...(tenantOverrideCap !== undefined ? { tenantOverrideCap } : {}),
  };
  return { ok: true, input };
}

function jsonResponse(status: number, body: unknown): ScheduleResponseShape {
  return Object.freeze({
    status,
    headers: Object.freeze({ 'content-type': 'application/json; charset=utf-8' }),
    body,
  });
}
