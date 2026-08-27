'use client';

/**
 * Project session store — the single durable place for a founder's work.
 *
 * Everything the founder does — idea, interview transcript, generated
 * documents, MVP scope, chosen screens, generated code — is stored here.
 * Persisted to localStorage under `caia.project.<projectId>`. On login,
 * `syncToBackend()` uploads the state to the tenant's row-level record.
 *
 * Anonymous mode: a single "anon" project id.
 * Logged-in mode: server-generated project id per project.
 */

import { readSession, writeSession, type Session } from './tokens';

export interface StartupDoc {
  id: string;
  type: string;            // 'executive-summary' | 'business-plan' | 'pitch-deck' | ...
  title: string;
  format: 'markdown' | 'pdf' | 'pptx' | 'html';
  content: string;         // markdown source, PDF bytes as base64, or HTML source
  createdAt: number;
  tokens: number;          // rough token cost estimate
}

export interface MvpStory {
  id: string;
  title: string;
  purpose: string;
  status: 'todo' | 'in-progress' | 'done';
  code?: string;           // generated React code if any
}

export interface MvpEpic {
  id: string;
  title: string;
  purpose: string;
  stories: MvpStory[];
}

export interface MvpInitiative {
  id: string;
  title: string;
  purpose: string;
  epics: MvpEpic[];
}

export interface DesignChoices {
  designSystem?: 'shadcn' | 'mui' | 'chakra' | 'ant' | 'custom';
  styleGuide?: 'minimal' | 'warm' | 'corporate' | 'playful' | 'editorial' | 'brutalist';
  theme?: 'light' | 'dark' | 'auto';
  accentColor?: string;
  radius?: 'sm' | 'md' | 'lg' | 'full';
  fontFamily?: 'inter' | 'geist' | 'satoshi' | 'system';
}

export interface ProjectState {
  id: string;
  createdAt: number;
  updatedAt: number;
  name?: string;
  idea?: string;
  landingHtml?: string;
  proposal?: string;
  interviewTurns?: Array<{ role: 'user' | 'assistant'; text: string; ts: number }>;
  productName?: string;
  initiatives?: MvpInitiative[];
  docs: StartupDoc[];
  design: DesignChoices;
  builtScreens?: Record<string, { code: string; ts: number }>;
  currentStage?: string;
}

const KEY_PREFIX = 'caia.project.';
const ACTIVE_KEY = 'caia.activeProjectId';
const EVENT = 'caia:project-change';

const isBrowser = typeof window !== 'undefined';

function safeParse<T>(s: string | null): T | null {
  if (!s) return null;
  try { return JSON.parse(s) as T; } catch { return null; }
}

export function getActiveProjectId(): string {
  if (!isBrowser) return 'anon';
  const id = window.localStorage.getItem(ACTIVE_KEY);
  if (id) return id;
  window.localStorage.setItem(ACTIVE_KEY, 'anon');
  return 'anon';
}

export function setActiveProjectId(id: string): void {
  if (!isBrowser) return;
  window.localStorage.setItem(ACTIVE_KEY, id);
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function readProject(id?: string): ProjectState {
  const pid = id || getActiveProjectId();
  const raw = isBrowser ? window.localStorage.getItem(KEY_PREFIX + pid) : null;
  const parsed = safeParse<ProjectState>(raw);
  if (parsed && parsed.id === pid) return parsed;
  const fresh: ProjectState = {
    id: pid, createdAt: Date.now(), updatedAt: Date.now(),
    docs: [], design: {}, initiatives: [], builtScreens: {},
  };
  writeProject(fresh);
  return fresh;
}

export function writeProject(p: ProjectState): void {
  if (!isBrowser) return;
  const updated = { ...p, updatedAt: Date.now() };
  window.localStorage.setItem(KEY_PREFIX + p.id, JSON.stringify(updated));
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function updateProject(mut: (p: ProjectState) => void): ProjectState {
  const p = readProject();
  mut(p);
  writeProject(p);
  return p;
}

export function addDoc(doc: StartupDoc): void {
  updateProject((p) => { p.docs.push(doc); });
}

export function newProject(name?: string): ProjectState {
  const id = 'proj_' + Math.random().toString(36).slice(2, 10);
  setActiveProjectId(id);
  const p = readProject(id);
  if (name) { p.name = name; writeProject(p); }
  return p;
}

export function listProjects(): Array<{ id: string; name?: string; updatedAt: number }> {
  if (!isBrowser) return [];
  const out: Array<{ id: string; name?: string; updatedAt: number }> = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i);
    if (!k || !k.startsWith(KEY_PREFIX)) continue;
    const p = safeParse<ProjectState>(window.localStorage.getItem(k));
    if (p) out.push({ id: p.id, name: p.name, updatedAt: p.updatedAt });
  }
  out.sort((a, b) => b.updatedAt - a.updatedAt);
  return out;
}

/**
 * When the user logs in, migrate the anon project to a real project id and
 * (in the future) push state to backend. Today it just renames the id.
 */
export function migrateAnonOnLogin(session: Session): void {
  if (!isBrowser) return;
  if (getActiveProjectId() !== 'anon') return;
  const anon = readProject('anon');
  if (!anon.idea && anon.docs.length === 0) return; // nothing to migrate
  const newId = 'proj_' + (session.email ? btoa(session.email).slice(0, 8) : Math.random().toString(36).slice(2, 10));
  const migrated: ProjectState = { ...anon, id: newId };
  writeProject(migrated);
  window.localStorage.removeItem(KEY_PREFIX + 'anon');
  setActiveProjectId(newId);
  // TODO: server sync — POST /api/wizard/project/sync when backend endpoint exists.
}

export function subscribeProject(cb: () => void): () => void {
  if (!isBrowser) return () => undefined;
  const handler = () => cb();
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}

// Re-export session helpers so callers only need one import path.
export { readSession, writeSession };

/**
 * Sync the currently active project to the backend. Requires a live session
 * cookie. Returns the server id (may differ from local id if created fresh).
 */
export async function syncToBackend(): Promise<{ ok: boolean; id?: string; error?: string }> {
  if (!isBrowser) return { ok: false, error: 'ssr' };
  const p = readProject();
  try {
    // Try PUT first (id may already exist on server)
    let res = await fetch(`/api/wizard/project/${encodeURIComponent(p.id)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ name: p.name, stateJson: p }),
    });
    if (res.status === 404) {
      // Doesn't exist on server yet — create it and adopt the returned id
      res = await fetch('/api/wizard/project/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: p.name, stateJson: p }),
      });
      if (!res.ok) return { ok: false, error: `create_${res.status}` };
      const j = (await res.json()) as { ok?: boolean; id?: string };
      if (j.ok && j.id) {
        // Move local key to the server id so subsequent PUTs land in the same row
        const migrated: ProjectState = { ...p, id: j.id };
        window.localStorage.removeItem(KEY_PREFIX + p.id);
        writeProject(migrated);
        setActiveProjectId(j.id);
        return { ok: true, id: j.id };
      }
      return { ok: false, error: 'create_no_id' };
    }
    if (!res.ok) return { ok: false, error: `put_${res.status}` };
    return { ok: true, id: p.id };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

/**
 * Load a project from the backend by id and write it into localStorage.
 */
export async function loadFromBackend(id: string): Promise<ProjectState | null> {
  if (!isBrowser) return null;
  try {
    const res = await fetch(`/api/wizard/project/${encodeURIComponent(id)}`, { credentials: 'include' });
    if (!res.ok) return null;
    const j = (await res.json()) as { ok?: boolean; project?: { id: string; name: string | null; state_json: unknown } };
    if (!j.ok || !j.project) return null;
    const state = j.project.state_json as ProjectState;
    // Coerce to a ProjectState shape (in case of drift)
    const merged: ProjectState = {
      ...state,
      id: j.project.id,
      docs: state?.docs || [],
      design: state?.design || {},
      initiatives: state?.initiatives || [],
      builtScreens: state?.builtScreens || {},
      createdAt: state?.createdAt || Date.now(),
      updatedAt: Date.now(),
    };
    writeProject(merged);
    setActiveProjectId(j.project.id);
    return merged;
  } catch { return null; }
}

