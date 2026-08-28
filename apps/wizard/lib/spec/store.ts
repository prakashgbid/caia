'use client';

/**
 * Store for the canonical ProjectSpec. localStorage + optional cloud sync
 * (debounced 500ms) to wizard_projects.state_json when logged in.
 */

import { useCallback, useEffect, useState } from 'react';
import { newSpec, type ProjectSpec, type Stage } from './schema';

const KEY_PREFIX = 'caia.spec.';
const ACTIVE_KEY = 'caia.activeSpecId';
const EVENT = 'caia:spec-change';
const isBrowser = typeof window !== 'undefined';

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

export function getActiveSpecId(): string {
  if (!isBrowser) return 'anon';
  const id = window.localStorage.getItem(ACTIVE_KEY);
  if (id) return id;
  window.localStorage.setItem(ACTIVE_KEY, 'anon');
  return 'anon';
}

export function setActiveSpecId(id: string): void {
  if (!isBrowser) return;
  window.localStorage.setItem(ACTIVE_KEY, id);
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function readSpec(id?: string): ProjectSpec {
  const pid = id || getActiveSpecId();
  if (!isBrowser) return newSpec(pid);
  const raw = window.localStorage.getItem(KEY_PREFIX + pid);
  if (!raw) {
    const fresh = newSpec(pid);
    writeSpec(fresh);
    return fresh;
  }
  try {
    const parsed = JSON.parse(raw) as ProjectSpec;
    return { ...newSpec(pid), ...parsed, id: pid };
  } catch {
    const fresh = newSpec(pid);
    writeSpec(fresh);
    return fresh;
  }
}

export function writeSpec(spec: ProjectSpec): void {
  if (!isBrowser) return;
  const updated = { ...spec, updatedAt: Date.now() };
  window.localStorage.setItem(KEY_PREFIX + spec.id, JSON.stringify(updated));
  window.dispatchEvent(new CustomEvent(EVENT));
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => { void cloudSync(updated); }, 500);
}

async function cloudSync(spec: ProjectSpec): Promise<void> {
  if (!isBrowser || spec.id === 'anon') return;
  try {
    const res = await fetch(`/api/wizard/project/${encodeURIComponent(spec.id)}`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: spec.name, stateJson: spec }),
    });
    if (res.status === 404) {
      const c = await fetch('/api/wizard/project/create', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: spec.name, stateJson: spec }),
      });
      if (c.ok) {
        const j = await c.json() as { ok: boolean; id?: string };
        if (j.ok && j.id) {
          window.localStorage.removeItem(KEY_PREFIX + spec.id);
          const migrated = { ...spec, id: j.id };
          window.localStorage.setItem(KEY_PREFIX + j.id, JSON.stringify(migrated));
          setActiveSpecId(j.id);
        }
      }
    }
  } catch { /* silent — offline is fine */ }
}

export function mutateSpec(fn: (draft: ProjectSpec) => void): ProjectSpec {
  const cur = readSpec();
  fn(cur);
  writeSpec(cur);
  return cur;
}

export function useSpec(): [ProjectSpec, (fn: (draft: ProjectSpec) => void) => void] {
  const [spec, setSpec] = useState<ProjectSpec>(() => (isBrowser ? readSpec() : newSpec('ssr')));
  useEffect(() => {
    setSpec(readSpec());
    const on = () => setSpec(readSpec());
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  const mutate = useCallback((fn: (draft: ProjectSpec) => void) => {
    mutateSpec(fn);
  }, []);
  return [spec, mutate];
}

export function advanceStage(stage: Stage): void {
  mutateSpec((s) => { s.currentStage = stage; });
}

/** List every project spec in localStorage — newest first. */
export function listSpecs(): Array<{ id: string; name?: string; updatedAt: number; currentStage?: string }> {
  if (!isBrowser) return [];
  const out: Array<{ id: string; name?: string; updatedAt: number; currentStage?: string }> = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i);
    if (!k || !k.startsWith(KEY_PREFIX)) continue;
    try {
      const p = JSON.parse(window.localStorage.getItem(k) || '{}') as ProjectSpec;
      if (p.id) out.push({ id: p.id, name: p.name, updatedAt: p.updatedAt || 0, currentStage: p.currentStage });
    } catch { /* skip corrupt entries */ }
  }
  out.sort((a, b) => b.updatedAt - a.updatedAt);
  return out;
}

/** Create a fresh project spec with a new id. */
export function createSpec(name?: string): ProjectSpec {
  const id = 'proj_' + Math.random().toString(36).slice(2, 10);
  setActiveSpecId(id);
  const s = readSpec(id);
  if (name) { s.name = name; writeSpec(s); }
  return s;
}

/** Delete a project spec (local only). */
export function deleteSpec(id: string): void {
  if (!isBrowser) return;
  window.localStorage.removeItem(KEY_PREFIX + id);
  if (window.localStorage.getItem(ACTIVE_KEY) === id) window.localStorage.removeItem(ACTIVE_KEY);
  window.dispatchEvent(new CustomEvent(EVENT));
}

/**
 * Upsert a doc into the active project by type — never duplicates.
 * If a doc of the same type exists, replace its content + bump updatedAt.
 * If not, push a new one.
 */
export function upsertDoc(doc: { type: string; title: string; format: 'markdown' | 'pdf' | 'pptx' | 'html'; content: string; tokens?: number }): void {
  mutateSpec((p) => {
    const existing = p.docs.find((d) => d.type === doc.type);
    if (existing) {
      existing.title = doc.title;
      existing.format = doc.format;
      existing.content = doc.content;
      existing.tokens = doc.tokens ?? existing.tokens;
      existing.createdAt = Date.now();
    } else {
      p.docs.push({
        id: 'doc_' + doc.type + '_' + Math.random().toString(36).slice(2, 9),
        type: doc.type, title: doc.title, format: doc.format, content: doc.content,
        createdAt: Date.now(), tokens: doc.tokens ?? 0,
      });
    }
  });
}

