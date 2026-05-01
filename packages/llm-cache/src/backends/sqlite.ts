// SQLite-backed CacheBackend. Wraps the existing synchronous CacheStore
// in the async CacheBackend interface so callers treat all backends uniformly.

import { CacheStore } from '../store.js';
import type { CachedResponse } from '../types.js';
import type { CacheBackend, SemanticRow } from './interface.js';

export class SqliteBackend implements CacheBackend {
  private readonly store: CacheStore;

  constructor(dbPath: string) {
    this.store = new CacheStore(dbPath);
  }

  async getExactByHash(hash: string): Promise<{ value: CachedResponse; createdAt: number } | undefined> {
    return this.store.getExactByHash(hash);
  }

  async putExact(
    hash: string,
    namespace: string,
    model: string,
    value: CachedResponse,
    createdAt: number,
  ): Promise<void> {
    this.store.putExact(hash, namespace, model, value, createdAt);
  }

  async listSemanticRows(namespace: string, model: string, limit: number): Promise<SemanticRow[]> {
    return this.store.listSemanticRows(namespace, model, limit);
  }

  async putSemantic(
    namespace: string,
    model: string,
    prompt: string,
    embedding: Float32Array,
    value: CachedResponse,
    createdAt: number,
  ): Promise<void> {
    this.store.putSemantic(namespace, model, prompt, embedding, value, createdAt);
  }

  async countAll(): Promise<{ exact: number; semantic: number }> {
    return this.store.countAll();
  }

  async evictOlderThan(cutoffMs: number): Promise<{ exact: number; semantic: number }> {
    return this.store.evictOlderThan(cutoffMs);
  }

  async close(): Promise<void> {
    this.store.close();
  }
}
