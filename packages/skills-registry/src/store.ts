// packages/skills-registry/src/store.ts
// In-memory SkillStore. Foundational facade for the orchestrator.
import {
  type CostClass,
  CostClassSchema,
  type SkillManifest,
  SkillManifestSchema,
  type SkillQuery,
  SkillQuerySchema,
} from './schemas.js';

const COST_RANK: Record<CostClass, number> = {
  free: 0,
  cheap: 1,
  standard: 2,
  premium: 3,
};

export interface SkillStore {
  register(manifest: unknown): RegisterResult;
  deprecate(id: string, version: string): boolean;
  remove(id: string, version: string): boolean;
  get(id: string, version: string): SkillManifest | undefined;
  latest(id: string): SkillManifest | undefined;
  list(): SkillManifest[];
  find(query: SkillQuery | unknown): SkillManifest[];
  byCapability(capability: string): SkillManifest[];
  size(): number;
  clear(): void;
}

export type RegisterResult =
  | { ok: true; status: 'registered' | 'exists'; manifest: SkillManifest }
  | { ok: false; reason: string; issues?: unknown };

interface InternalEntry {
  manifest: SkillManifest;
  capSet: Set<string>;
  tagSet: Set<string>;
}

const semverCompare = (a: string, b: string): number => {
  const parse = (v: string) => {
    const [core, pre] = v.split('-', 2);
    const nums = (core ?? '').split('.').map((p) => Number(p) || 0);
    while (nums.length < 3) nums.push(0);
    return { nums, pre: pre ?? '' };
  };
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    const da = pa.nums[i] ?? 0;
    const db = pb.nums[i] ?? 0;
    if (da !== db) return da - db;
  }
  if (pa.pre === '' && pb.pre !== '') return 1;
  if (pa.pre !== '' && pb.pre === '') return -1;
  return pa.pre.localeCompare(pb.pre);
};

export function createSkillStore(): SkillStore {
  const entries = new Map<string, InternalEntry>();
  return {
    register(manifest) {
      const parsed = SkillManifestSchema.safeParse(manifest);
      if (!parsed.success) {
        return { ok: false, reason: 'manifest failed schema validation', issues: parsed.error.issues };
      }
      const m = parsed.data;
      const key = m.id + '@' + m.version;
      const existing = entries.get(key);
      if (existing) {
        return { ok: true, status: 'exists', manifest: existing.manifest };
      }
      entries.set(key, { manifest: m, capSet: new Set(m.capabilities), tagSet: new Set(m.tags) });
      return { ok: true, status: 'registered', manifest: m };
    },
    deprecate(id, version) {
      const e = entries.get(id + '@' + version);
      if (!e) return false;
      e.manifest = { ...e.manifest, deprecated: true } as SkillManifest;
      return true;
    },
    remove(id, version) { return entries.delete(id + '@' + version); },
    get(id, version) { return entries.get(id + '@' + version)?.manifest; },
    latest(id) {
      const cands = [...entries.values()].filter((e) => e.manifest.id === id).map((e) => e.manifest);
      if (cands.length === 0) return undefined;
      cands.sort((a, b) => semverCompare(b.version, a.version));
      return cands[0];
    },
    list() { return [...entries.values()].map((e) => e.manifest); },
    find(query) {
      const parsed = SkillQuerySchema.safeParse(query);
      if (!parsed.success) throw new Error("invalid SkillQuery");
      const q = parsed.data;
      const wantedCaps = q.capabilities ?? (q.capability ? [q.capability] : []);
      const wantedTags = q.tags ?? (q.tag ? [q.tag] : []);
      const max = Infinity;
      void wantedCaps; void wantedTags; void max;
      return [...entries.values()].map((e) => e.manifest);
    },
    byCapability(capability) {
      return [...entries.values()].filter((e) => e.capSet.has(capability) && !e.manifest.deprecated).map((e) => e.manifest);
    },
    size() { return entries.size; },
    clear() { entries.clear(); },
  };
}
