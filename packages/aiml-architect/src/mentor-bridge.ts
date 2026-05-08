/**
 * Default Mentor reader — wraps `@chiefaia/mentor-event-bus`'s Client.
 */

import { existsSync } from 'node:fs';

import { Client as MentorClient } from '@chiefaia/mentor-event-bus';

import type { MentorEventRecord, MentorReader } from './types.js';

export interface DefaultMentorReaderOptions {
  readonly dbPath: string;
  readonly hostname?: string;
  readonly processName?: string;
}

export function createDefaultMentorReader(
  options: DefaultMentorReaderOptions
): MentorReader {
  if (!existsSync(options.dbPath)) {
    return {
      readSince(): MentorEventRecord[] {
        return [];
      }
    };
  }

  let client: MentorClient | null = null;
  function getClient(): MentorClient {
    if (client === null) {
      client = new MentorClient(
        options.processName !== undefined
          ? {
              dbPath: options.dbPath,
              ...(options.hostname !== undefined
                ? { hostname: options.hostname }
                : {}),
              processName: options.processName,
              skipSchemaRegistration: true
            }
          : {
              dbPath: options.dbPath,
              ...(options.hostname !== undefined
                ? { hostname: options.hostname }
                : {}),
              skipSchemaRegistration: true
            }
      );
    }
    return client;
  }

  return {
    readSince(sinceMs: number, limit = 500): MentorEventRecord[] {
      const sinceIso = new Date(sinceMs).toISOString();
      const events = getClient().getRecent({
        order: 'desc',
        limit,
        sinceIso
      });
      return events.map((e) => ({
        id: e.id,
        type: e.type,
        emittedAtMs: new Date(e.emittedAt).getTime(),
        payload:
          typeof e.payload === 'object' && e.payload !== null
            ? (e.payload as Record<string, unknown>)
            : {}
      }));
    }
  };
}
