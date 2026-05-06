/**
 * CanaryRouter — writes + reads <canaryRoutingConfigPath>. Deterministic
 * request-id-hashed routing so the same request always hits the same model
 * (no flapping under retries).
 */

import { createHash } from 'node:crypto';
import * as path from 'node:path';
import type {
  CanaryRouterConfig,
  CanaryRoutingCanaryEntry,
  CanaryRoutingConfigFile,
  CanaryRoutingProductionEntry,
  FsAccess,
  ResolvedCanaryRouterConfig,
  RoutingDecision
} from './types.js';
import { resolveCanaryRouterConfig } from './config.js';

export interface CanaryRoutingWrite {
  production: CanaryRoutingProductionEntry | null;
  canary: CanaryRoutingCanaryEntry | null;
}

export class CanaryRouter {
  private readonly cfg: ResolvedCanaryRouterConfig;
  private cached: CanaryRoutingConfigFile | null = null;
  private cachedMtime: number = -1;

  constructor(config: CanaryRouterConfig = {}) {
    this.cfg = resolveCanaryRouterConfig(config);
  }

  /** Atomic write: tmp + rename. */
  write(payload: CanaryRoutingWrite): void {
    const fs = this.cfg.fs;
    const file: CanaryRoutingConfigFile = {
      version: 1,
      generatedAt: this.cfg.clock().toISOString(),
      production: payload.production,
      canary: payload.canary
    };
    const dir = path.dirname(this.cfg.canaryRoutingConfigPath);
    if (!fs.exists(dir)) fs.mkdir(dir);
    const tmp = this.cfg.canaryRoutingConfigPath + '.tmp';
    fs.writeFile(tmp, JSON.stringify(file, null, 2) + '\n');
    fs.rename(tmp, this.cfg.canaryRoutingConfigPath);
    // Invalidate cache.
    this.cached = null;
    this.cachedMtime = -1;
  }

  /** Read the latest config. Cached per-instance via mtime check. */
  read(): CanaryRoutingConfigFile | null {
    const fs = this.cfg.fs;
    const p = this.cfg.canaryRoutingConfigPath;
    if (!fs.exists(p)) return null;
    const st = fs.stat(p);
    if (this.cached !== null && this.cachedMtime === st.mtimeMs) return this.cached;
    const raw = fs.readFile(p);
    try {
      const parsed = JSON.parse(raw) as CanaryRoutingConfigFile;
      if (parsed.version !== 1) return null;
      this.cached = parsed;
      this.cachedMtime = st.mtimeMs;
      return parsed;
    } catch {
      return null;
    }
  }

  /** Resolve the current routing decision; reads through the cache. */
  resolve(): RoutingDecision {
    const f = this.read();
    if (f === null || f.production === null) {
      return { kind: 'no-production', production: null, canary: null };
    }
    if (f.canary === null) {
      return { kind: 'production-only', production: f.production, canary: null };
    }
    return { kind: 'production-with-canary', production: f.production, canary: f.canary };
  }

  /**
   * Hash requestId; route to canary iff hash%100 < canary.percent.
   * Otherwise route to production. Returns null only when no production
   * is configured (the consumer must fall back to base model).
   */
  routeRequest(requestId: string): string | null {
    const decision = this.resolve();
    switch (decision.kind) {
      case 'no-production':
        return null;
      case 'production-only':
        return decision.production.ollamaModelName;
      case 'production-with-canary': {
        const bucket = canaryBucket(requestId);
        if (bucket < decision.canary.percent) return decision.canary.ollamaModelName;
        return decision.production.ollamaModelName;
      }
    }
  }
}

/** Returns 0..99 inclusive, deterministic over requestId. */
export function canaryBucket(requestId: string): number {
  const hex = createHash('sha256').update(requestId).digest('hex');
  // Take the first 8 hex chars → 32-bit unsigned integer; mod 100.
  const n = parseInt(hex.slice(0, 8), 16);
  return n % 100;
}

/** Convenience: write directly through an FsAccess (no router instance). */
export function writeCanaryRouting(
  fs: FsAccess,
  filePath: string,
  payload: CanaryRoutingWrite,
  generatedAt: string
): void {
  const file: CanaryRoutingConfigFile = {
    version: 1,
    generatedAt,
    production: payload.production,
    canary: payload.canary
  };
  const dir = path.dirname(filePath);
  if (!fs.exists(dir)) fs.mkdir(dir);
  const tmp = filePath + '.tmp';
  fs.writeFile(tmp, JSON.stringify(file, null, 2) + '\n');
  fs.rename(tmp, filePath);
}
