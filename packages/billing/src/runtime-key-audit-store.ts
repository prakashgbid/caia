/**
 * `runtime-key-audit-store.ts` — abstraction over `audit_runtime_key_reads`.
 */

import type { ByokProvider, RuntimeKeyReadAuditEntry } from './types.js';

export interface RuntimeKeyAuditStore {
  record(entry: RuntimeKeyReadAuditEntry): Promise<void>;
  list(
    tenantId: string,
    opts?: {
      provider?: ByokProvider;
      since?: Date;
      until?: Date;
      limit?: number;
    },
  ): Promise<RuntimeKeyReadAuditEntry[]>;
}

export class InMemoryRuntimeKeyAuditStore implements RuntimeKeyAuditStore {
  private readonly rows: RuntimeKeyReadAuditEntry[] = [];

  async record(entry: RuntimeKeyReadAuditEntry): Promise<void> {
    this.rows.push({ ...entry, readAt: new Date(entry.readAt) });
  }

  async list(
    tenantId: string,
    opts: {
      provider?: ByokProvider;
      since?: Date;
      until?: Date;
      limit?: number;
    } = {},
  ): Promise<RuntimeKeyReadAuditEntry[]> {
    let out = this.rows.filter((r) => r.tenantId === tenantId);
    if (opts.provider) out = out.filter((r) => r.provider === opts.provider);
    if (opts.since) out = out.filter((r) => r.readAt >= opts.since!);
    if (opts.until) out = out.filter((r) => r.readAt <= opts.until!);
    out = out.sort((a, b) => b.readAt.getTime() - a.readAt.getTime());
    if (opts.limit !== undefined) out = out.slice(0, opts.limit);
    return out.map((r) => ({ ...r }));
  }

  size(): number {
    return this.rows.length;
  }

  clear(): void {
    this.rows.length = 0;
  }
}
