// In-memory CacheBackend. Zero dependencies; useful for unit tests and
// ephemeral single-request caches where SQLite or Redis is overkill.

import type { CachedResponse } from '../types.js';
import type { CacheBackend, SemanticRow } from './interface.js';

interface ExactEntry {
  value: CachedResponse;
  createdAt: number;
}

interface MemSemanticRow {
  id: number;
  prompt: string;
  embedding: Float32Array;
  value: CachedResponse;
  createdAt: number;
}

export class InMemoryBackend implements CacheBackend {
  private readonly exact = new Map<string, ExactEntry>();
  private readonly semantic = new Map<string, MemSemanticRow[]>();
  private idSeq = 0;

  async getExactByHash(hash: string): Promise<{ value: CachedResponse; createdAt: number } | undefined> {
    return this.exact.get(hash);
  }

  async putExact(
    hash: string,
    _namespace: string,
    _model: string,
    value: CachedResponse,
    createdAt: number,
  ): Promise<void> {
    this.exact.set(hash, { value, createdAt });
  }

  async listSemanticRows(namespace: string, model: string, limit: number): Promise<SemanticRow[]> {
    const key = `${namespace}:${model}`;
    const rows = this.semantic.get(key) ?? [];
    // newest-first
    return [...rows].sort((a, b) => b.id - a.id).slice(0, limit);
  }

  async putSemantic(
    namespace: string,
    model: string,
    prompt: string,
    embedding: Float32Array,
    value: CachedResponse,
    createdAt: number,
  ): Promise<void> {
    const key = `${namespace}:${model}`;
    const rows = this.semantic.get(key) ?? [];
    rows.push({ id: ++this.idSeq, prompt, embedding, value, createdAt });
    this.semantic.set(key, rows);
  }

  async countAll(): Promise<{ exact: number; semantic: number }> {
    let semantic = 0;
    for (const rows of this.semantic.values()) semantic += rows.length;
    return { exact: this.exact.size, semantic };
  }

  async evictOlderThan(cutoffMs: number): Promise<{ exact: number; semantic: number }> {
    let exactRemoved = 0;
    for (const [hash, entry] of this.exact) {
      if (entry.createdAt < cutoffMs) {
        this.exact.delete(hash);
        exactRemoved++;
      }
    }
    let semanticRemoved = 0;
    for (const [key, rows] of this.semantic) {
      const before = rows.length;
      const kept = rows.filter((r) => r.createdAt >= cutoffMs);
      semanticRemoved += before - kept.length;
      this.semantic.set(key, kept);
    }
    return { exact: exactRemoved, semantic: semanticRemoved };
  }

  async close(): Promise<void> {
    // no-op
  }
}
