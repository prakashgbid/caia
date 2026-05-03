// packages/skills-registry/tests/store.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createSkillStore, type SkillManifest } from '../src/index.js';

const validAgent: SkillManifest = {
  kind: 'agent',
  id: 'po-agent',
  version: '1.0.0',
  description: 'Product owner decomposer agent',
  capabilities: ['decompose-story', 'mece-judge'],
  tags: ['decomposition', 'planning'],
  costClass: 'standard',
  deprecated: false,
  metadata: {},
  runnerId: 'po-agent',
};

const validTool: SkillManifest = {
  kind: 'tool',
  id: 'gh-cli',
  version: '2.40.0',
  description: 'GitHub CLI tool',
  capabilities: ['pr-create', 'pr-merge'],
  tags: ['ci', 'github'],
  costClass: 'free',
  deprecated: false,
  metadata: {},
  transport: 'cli',
  endpoint: 'gh',
};

describe('skills-registry store', () => {
  let store = createSkillStore();
  beforeEach(() => {
    store = createSkillStore();
  });

  describe('register', () => {
    it('accepts a valid agent manifest', () => {
      const r = store.register(validAgent);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.status).toBe('registered');
        expect(r.manifest.id).toBe('po-agent');
      }
      expect(store.size()).toBe(1);
    });

    it('accepts a valid tool manifest', () => {
      const r = store.register(validTool);
      expect(r.ok).toBe(true);
    });

    it('rejects malformed manifest (missing capabilities)', () => {
      const bad = { ...validAgent, capabilities: [] };
      const r = store.register(bad);
      expect(r.ok).toBe(false);
    });

    it('rejects manifest with invalid id (uppercase)', () => {
      const bad = { ...validAgent, id: 'PO-Agent' };
      const r = store.register(bad);
      expect(r.ok).toBe(false);
    });

    it('returns exists on duplicate (id, version)', () => {
      store.register(validAgent);
      const r = store.register(validAgent);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.status).toBe('exists');
      expect(store.size()).toBe(1);
    });
  });
});

describe('lookup', () => {
  it('latest() returns highest semver', () => {
    const s = createSkillStore();
    s.register({ ...validAgent, version: '1.0.0' });
    s.register({ ...validAgent, version: '1.10.0' });
    expect(s.latest('po-agent')?.version).toBe('1.10.0');
  });
});

describe('byCapability', () => {
  it('filters and excludes deprecated', () => {
    const s = createSkillStore();
    s.register(validAgent);
    s.register(validTool);
    expect(s.byCapability('decompose-story').length).toBe(1);
    s.deprecate('po-agent', '1.0.0');
    expect(s.byCapability('decompose-story').length).toBe(0);
  });
});
