/**
 * Event-bus reader — wraps `@chiefaia/mentor-event-bus`'s `queryEvents`.
 *
 * Returns a `SourceReader` that pulls events newer than the cutoff and
 * normalises them into `RawArtifact[]`. The actual `EventBusClient`
 * implementation is injected via the config; the default constructor
 * builds one against the events.sqlite path.
 */

import type {
  EventBusClient,
  EventBusRecord,
  RawArtifact,
  ReaderContext,
  SourceReader
} from './types.js';

export interface EventBusReaderOptions {
  client: EventBusClient;
}

export function createEventBusReader(opts: EventBusReaderOptions): SourceReader {
  return {
    source: 'events',
    async read(ctx: ReaderContext): Promise<RawArtifact[]> {
      const cutoffMs = ctx.nowMs - ctx.maxAgeDays * 24 * 60 * 60 * 1000;
      let records: EventBusRecord[];
      try {
        records = await opts.client.readSince(cutoffMs);
      } catch {
        return [];
      }
      const out: RawArtifact[] = [];
      for (const r of records) {
        const text = projectEventToText(r);
        if (text === '') continue;
        out.push({
          source: 'events',
          sourceId: r.id,
          ...(r.correlationId !== undefined ? { correlationId: r.correlationId } : {}),
          kind: r.type,
          text,
          sidecar: { ...r.payload },
          createdAtMs: r.emittedAtMs
        });
      }
      return out;
    }
  };
}

/**
 * Project an event payload into a textual artifact. The normaliser will
 * later decide instruction/response shape based on `kind`; this function
 * only flattens the payload into a stable, human-readable string.
 */
export function projectEventToText(r: EventBusRecord): string {
  const lines: string[] = [];
  lines.push(`Event: ${r.type}`);
  for (const [k, v] of Object.entries(r.payload)) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'string') {
      lines.push(`${k}: ${v}`);
    } else if (typeof v === 'number' || typeof v === 'boolean') {
      lines.push(`${k}: ${String(v)}`);
    } else {
      lines.push(`${k}: ${JSON.stringify(v)}`);
    }
  }
  // Drop "Event: X" alone — needs at least one detail line to be useful
  if (lines.length === 1) return '';
  return lines.join('\n');
}

/**
 * Default real-mentor-event-bus-backed client.
 *
 * Imports lazily — the package depends on `@chiefaia/mentor-event-bus`
 * but tests don't need to load it. We keep the import inside the
 * factory so vitest test suites that inject a fake client never touch
 * the real better-sqlite3 module.
 *
 * The mentor-event-bus stores `payload_json` as a string; we parse it
 * here. Malformed payloads are surfaced as empty objects (the artifact
 * still has a useful event_type for the normaliser).
 */
export async function defaultEventBusClient(eventsDbPath: string): Promise<EventBusClient> {
  // Lazy import keeps tests fast and avoids native-module init at import time.
  const mod = await import('@chiefaia/mentor-event-bus');
  const db = mod.openDatabase(eventsDbPath);
  return {
    async readSince(sinceMs: number): Promise<EventBusRecord[]> {
      const sinceIso = new Date(sinceMs).toISOString();
      const rows = mod.queryEvents(db, { sinceIso, limit: 100_000 });
      return rows.map((row) => {
        let payload: Record<string, unknown> = {};
        try {
          const parsed = JSON.parse(row.payload_json);
          if (parsed !== null && typeof parsed === 'object') {
            payload = parsed as Record<string, unknown>;
          }
        } catch {
          // leave as empty object; type alone is still useful
        }
        const rec: EventBusRecord = {
          id: row.id,
          type: row.event_type,
          emittedAtMs: Date.parse(row.emitted_at),
          payload
        };
        if (row.correlation_id !== null) {
          rec.correlationId = row.correlation_id;
        }
        return rec;
      });
    }
  };
}
