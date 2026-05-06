/**
 * In-memory fake of `Mem0MemoryLike` for unit tests of the Mem0
 * backend. Implements the surface used by the production backend
 * (`add`, `search`, `getAll`, `delete`) without touching the real
 * `mem0ai` package, Ollama, or any filesystem.
 *
 * Embedding strategy: a deterministic 32-dim hashed bag-of-words —
 * the same toy embedder Librarian's existing end-to-end test uses,
 * so similarity numbers are predictable and the tests are stable.
 *
 * Filter coverage: `eq` on string fields (e.g., `user_id: 'caia'`)
 * and `in` on `kind` are supported. Anything more elaborate is
 * out-of-scope for the fake — the production `Mem0Backend` only
 * uses these two operators.
 */

import { randomUUID } from 'node:crypto';

import type { Mem0MemoryLike } from '../../src/backends/mem0-backend.js';

interface Row {
  id: string;
  memory: string;
  vector: Float32Array;
  metadata: Record<string, unknown>;
}

export interface FakeMemoryOptions {
  /** Vector dimensionality for the toy embedder. Default 32. */
  dimension?: number;
  /** Override the random id generator for fully deterministic tests. */
  idGenerator?: () => string;
}

export function createFakeMemory(opts: FakeMemoryOptions = {}): Mem0MemoryLike & {
  rows: Map<string, Row>;
  reset: () => void;
} {
  const dim = opts.dimension ?? 32;
  const idGen = opts.idGenerator ?? randomUUID;
  const rows = new Map<string, Row>();

  const embed = (text: string): Float32Array => {
    const v = new Float32Array(dim);
    const tokens = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    for (const t of tokens) {
      let h = 0;
      for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0;
      const idx = ((h % dim) + dim) % dim;
      v[idx] = (v[idx] ?? 0) + 1;
    }
    let norm = 0;
    for (let i = 0; i < dim; i++) norm += (v[i] ?? 0) * (v[i] ?? 0);
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let i = 0; i < dim; i++) v[i] = (v[i] ?? 0) / norm;
    }
    return v;
  };

  const cosine = (a: Float32Array, b: Float32Array): number => {
    let dot = 0;
    for (let i = 0; i < a.length; i++) dot += (a[i] ?? 0) * (b[i] ?? 0);
    return dot;
  };

  const matchFilters = (md: Record<string, unknown>, filters: Record<string, unknown>): boolean => {
    for (const [k, v] of Object.entries(filters)) {
      if (k === 'user_id') {
        if (md['user_id'] !== v) return false;
        continue;
      }
      if (typeof v === 'object' && v !== null && 'in' in v) {
        const arr = (v as { in: unknown[] }).in;
        if (!Array.isArray(arr) || !arr.includes(md[k])) return false;
        continue;
      }
      if (md[k] !== v) return false;
    }
    return true;
  };

  return {
    rows,
    reset() { rows.clear(); },

    async add(content, config) {
      const userId = config.userId;
      const md: Record<string, unknown> = { ...(config.metadata ?? {}), user_id: userId };
      const id = idGen();
      rows.set(id, { id, memory: content, vector: embed(content), metadata: md });
      return { results: [{ id, memory: content, metadata: { event: 'ADD' } }] };
    },

    async search(query, config) {
      const queryVec = embed(query);
      const limit = config.limit ?? 5;
      const scored: Array<{ id: string; memory: string; score: number; metadata: Record<string, unknown> }> = [];
      for (const row of rows.values()) {
        if (!matchFilters(row.metadata, config.filters)) continue;
        scored.push({
          id: row.id,
          memory: row.memory,
          score: cosine(queryVec, row.vector),
          metadata: { ...row.metadata }
        });
      }
      scored.sort((a, b) => b.score - a.score);
      return { results: scored.slice(0, limit) };
    },

    async getAll(config) {
      const limit = config.limit ?? 100;
      const out: Array<{ id: string; memory: string; metadata: Record<string, unknown> }> = [];
      for (const row of rows.values()) {
        if (!matchFilters(row.metadata, config.filters)) continue;
        out.push({ id: row.id, memory: row.memory, metadata: { ...row.metadata } });
        if (out.length >= limit) break;
      }
      return { results: out };
    },

    async delete(id) {
      rows.delete(id);
      return { id };
    }
  };
}
