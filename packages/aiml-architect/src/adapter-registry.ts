/**
 * Default Apprentice adapter registry reader.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import type { AdapterRegistryEntry, AdapterRegistryReader } from './types.js';

export interface DefaultAdapterRegistryOptions {
  readonly registryRoot: string;
}

interface RawEvalResult {
  winRate?: number;
  forgettingFlags?: number;
  blessedAt?: string;
}

export function createDefaultAdapterRegistry(
  options: DefaultAdapterRegistryOptions
): AdapterRegistryReader {
  return {
    list(): AdapterRegistryEntry[] {
      if (!existsSync(options.registryRoot)) return [];
      const dirEntries = safeReaddir(options.registryRoot);
      const out: AdapterRegistryEntry[] = [];
      for (const name of dirEntries) {
        const full = join(options.registryRoot, name);
        if (!safeIsDir(full)) continue;
        const evalPath = join(full, 'eval-result.json');
        const raw = existsSync(evalPath) ? safeReadJson(evalPath) : {};
        const entry: AdapterRegistryEntry = {
          name,
          path: full,
          ...(typeof raw.winRate === 'number' ? { winRate: raw.winRate } : {}),
          ...(typeof raw.forgettingFlags === 'number'
            ? { forgettingFlags: raw.forgettingFlags }
            : {}),
          ...(typeof raw.blessedAt === 'string'
            ? { blessedAtMs: new Date(raw.blessedAt).getTime() }
            : {})
        };
        out.push(entry);
      }
      return out;
    }
  };
}

function safeReaddir(path: string): string[] {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

function safeIsDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function safeReadJson(path: string): RawEvalResult {
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as RawEvalResult;
  } catch {
    return {};
  }
}
