'use client';

/**
 * Client-side AI response cache.
 *
 * Prevents redundant AI calls when a user re-mounts a component or
 * navigates back. Keyed by SHA-256(purpose + '|' + prompt). TTL 24h.
 */

const KEY_PREFIX = 'caia.aicache.';
const TTL_MS = 24 * 60 * 60 * 1000;

interface CacheEntry<T> { v: T; ts: number; }

async function hashKey(purpose: string, prompt: string): Promise<string> {
  const enc = new TextEncoder().encode(purpose + '|' + prompt);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

export async function readCache<T>(purpose: string, prompt: string): Promise<T | null> {
  if (typeof window === 'undefined') return null;
  const k = KEY_PREFIX + (await hashKey(purpose, prompt));
  const raw = window.localStorage.getItem(k);
  if (!raw) return null;
  try {
    const e = JSON.parse(raw) as CacheEntry<T>;
    if (Date.now() - e.ts > TTL_MS) { window.localStorage.removeItem(k); return null; }
    return e.v;
  } catch { return null; }
}

export async function writeCache<T>(purpose: string, prompt: string, value: T): Promise<void> {
  if (typeof window === 'undefined') return;
  const k = KEY_PREFIX + (await hashKey(purpose, prompt));
  try {
    window.localStorage.setItem(k, JSON.stringify({ v: value, ts: Date.now() }));
  } catch {
    // localStorage full — evict oldest entries
    const entries: Array<{ k: string; ts: number }> = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const kk = window.localStorage.key(i);
      if (kk && kk.startsWith(KEY_PREFIX)) {
        try {
          const e = JSON.parse(window.localStorage.getItem(kk) || '{}') as { ts?: number };
          entries.push({ k: kk, ts: e.ts || 0 });
        } catch {}
      }
    }
    entries.sort((a, b) => a.ts - b.ts);
    for (const e of entries.slice(0, Math.max(1, Math.floor(entries.length / 3)))) {
      window.localStorage.removeItem(e.k);
    }
    try { window.localStorage.setItem(k, JSON.stringify({ v: value, ts: Date.now() })); } catch {}
  }
}

/**
 * Wraps a fetch to an AI endpoint with cache + dedupe. Returns the cached
 * response if present; otherwise fires the fetch, caches the response,
 * and returns it. Concurrent callers with the same key share the same
 * promise.
 */
const inflight = new Map<string, Promise<unknown>>();

export async function cachedAiFetch<T>(purpose: string, prompt: string, fetcher: () => Promise<T>): Promise<T> {
  const cached = await readCache<T>(purpose, prompt);
  if (cached !== null) return cached;
  const k = await hashKey(purpose, prompt);
  const existing = inflight.get(k);
  if (existing) return existing as Promise<T>;
  const p = (async () => {
    try {
      const v = await fetcher();
      await writeCache(purpose, prompt, v);
      return v;
    } finally {
      inflight.delete(k);
    }
  })();
  inflight.set(k, p);
  return p;
}
