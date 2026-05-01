// Storage backend contract for @chiefaia/llm-cache.
//
// All methods are async so that both synchronous (SQLite via better-sqlite3)
// and network-based (Redis) implementations satisfy the same interface.

import type { CachedResponse } from '../types.js';

export interface SemanticRow {
  id: number;
  prompt: string;
  embedding: Float32Array;
  value: CachedResponse;
  createdAt: number;
}

export interface CacheBackend {
  getExactByHash(hash: string): Promise<{ value: CachedResponse; createdAt: number } | undefined>;
  putExact(
    hash: string,
    namespace: string,
    model: string,
    value: CachedResponse,
    createdAt: number,
  ): Promise<void>;
  listSemanticRows(namespace: string, model: string, limit: number): Promise<SemanticRow[]>;
  putSemantic(
    namespace: string,
    model: string,
    prompt: string,
    embedding: Float32Array,
    value: CachedResponse,
    createdAt: number,
  ): Promise<void>;
  countAll(): Promise<{ exact: number; semantic: number }>;
  evictOlderThan(cutoffMs: number): Promise<{ exact: number; semantic: number }>;
  close(): Promise<void>;
}
