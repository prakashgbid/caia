/**
 * Default Curator reader.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import type { CuratorFinding, CuratorReader } from './types.js';

export interface DefaultCuratorReaderOptions {
  readonly scanRoot: string;
}

interface RawCuratorFinding {
  scannerId?: string;
  category?: string;
  dimension?: string;
  severity?: string;
  title?: string;
  detail?: string;
  detectedAt?: string;
}

interface RawCuratorRunResult {
  findings?: RawCuratorFinding[];
}

export function createDefaultCuratorReader(
  options: DefaultCuratorReaderOptions
): CuratorReader {
  return {
    readRecent(limit = 100): CuratorFinding[] {
      if (!existsSync(options.scanRoot)) return [];

      const candidate = newestDigestPath(options.scanRoot);
      if (candidate === null) return [];

      const parsed = safeReadJson(candidate);
      if (!parsed || typeof parsed !== 'object') return [];

      const findings = (parsed as RawCuratorRunResult).findings ?? [];
      return findings
        .map(projectFinding)
        .filter((f): f is CuratorFinding => f !== null)
        .slice(0, limit);
    }
  };
}

function safeReadJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

function newestDigestPath(scanRoot: string): string | null {
  if (!existsSync(scanRoot)) return null;
  const candidates = listDigestCandidates(scanRoot);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => mtimeMsSafe(b) - mtimeMsSafe(a));
  return candidates[0] ?? null;
}

function listDigestCandidates(scanRoot: string): string[] {
  try {
    return readdirSync(scanRoot)
      .filter((f) => f.endsWith('.json') && f.includes('curator'))
      .map((f) => join(scanRoot, f));
  } catch {
    return [];
  }
}

function mtimeMsSafe(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

function projectFinding(raw: RawCuratorFinding): CuratorFinding | null {
  if (
    typeof raw.scannerId !== 'string' ||
    typeof raw.category !== 'string' ||
    typeof raw.severity !== 'string' ||
    typeof raw.title !== 'string'
  ) {
    return null;
  }
  const sev = raw.severity as CuratorFinding['severity'];
  if (
    sev !== 'info' &&
    sev !== 'low' &&
    sev !== 'medium' &&
    sev !== 'high' &&
    sev !== 'critical'
  ) {
    return null;
  }
  return {
    scannerId: raw.scannerId,
    category: raw.category,
    dimension: typeof raw.dimension === 'string' ? raw.dimension : '',
    severity: sev,
    title: raw.title,
    detail: typeof raw.detail === 'string' ? raw.detail : '',
    detectedAtMs:
      typeof raw.detectedAt === 'string'
        ? new Date(raw.detectedAt).getTime()
        : Date.now()
  };
}
