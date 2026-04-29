/**
 * ACR-010 — Multi-scope E2E for the Agent Section Contract Registry.
 *
 * Drives the registry through a representative scenario for each canonical
 * StoryScope, asserting:
 *
 *   1. Bootstrap registers all 4 Phase-1 contracts (PO/BA/EA/Test-Design).
 *   2. composeTemplate(scope) for every scope produces the expected
 *      per-agent ownership union — initiative is PO-only, story has all 4,
 *      subtask has PO + EA only.
 *   3. The composed template signature is stable across calls and distinct
 *      across scopes.
 *   4. The orchestrator's /api/contracts/composed/:scope route returns the
 *      same composed template the registry produces (frontend parity).
 *   5. Story rows persisted with different `story_scope` values round-trip
 *      cleanly through the migration 0030 column.
 *   6. Per-scope behaviour: rubrics scale (initiative requires more words
 *      on `scope`; subtask relaxes most BA/Test-Design requirements).
 *
 * This is the integration test the architecture report's section 13 calls
 * for. The Validator-side end-to-end (composed template driving the
 * Validator) ships with ACR-007 once the VAL-### track merges.
 */

import { Hono } from 'hono';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import * as path from 'path';
import * as schema from '../../src/db/schema';
import { stories } from '../../src/db/schema';
import { composeTemplate, resetDefaultRegistry } from '@chiefaia/agent-contract-registry';
import { STORY_SCOPES, type StoryScope } from '@chiefaia/ticket-template';
import {
  bootstrapAgentContracts,
  resetBootstrapFlag,
  PHASE1_CONTRACTS,
} from '../../src/agents/contract-bootstrap';
import { registerContractsRoutes } from '../../src/api/routes/contracts';

const MIGRATIONS_DIR = path.join(__dirname, '../../src/db/migrations');

function createTestDb() {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return { db, sqlite };
}

function nowIso() {
  return new Date().toISOString();
}

beforeEach(() => {
  resetDefaultRegistry();
  resetBootstrapFlag();
});

describe('ACR-010 — bootstrap + composition multi-scope E2E', () => {
  it('bootstrap registers all 4 Phase-1 contracts on the default registry', () => {
    const reg = bootstrapAgentContracts();
    expect(reg.size()).toBe(4);
    const owners = reg.list().map((c) => c.ownerAgent).sort();
    expect(owners).toEqual(['ba', 'ea', 'po', 'test-design']);
    expect(PHASE1_CONTRACTS.map((c) => c.ownerAgent)).toEqual([
      'po', 'ba', 'ea', 'test-design',
    ]);
  });

  it('bootstrap is idempotent (second call is a no-op)', () => {
    bootstrapAgentContracts();
    expect(() => bootstrapAgentContracts()).not.toThrow();
    expect(bootstrapAgentContracts().size()).toBe(4);
  });

  it('every canonical scope composes without warnings', () => {
    bootstrapAgentContracts();
    for (const scope of STORY_SCOPES) {
      const t = composeTemplate(scope);
      expect(t.warnings).toEqual([]);
      expect(t.sections.size).toBeGreaterThan(0);
    }
  });

  it('per-scope agent ownership matches the architecture matrix', () => {
    bootstrapAgentContracts();
    function ownersFor(scope: StoryScope): Set<string> {
      return new Set(
        [...composeTemplate(scope).sections.values()].map((s) => s.ownerAgent),
      );
    }
    expect(ownersFor('initiative')).toEqual(new Set(['po']));
    expect(ownersFor('epic')).toEqual(new Set(['po', 'ba']));
    expect(ownersFor('module')).toEqual(new Set(['po', 'ba', 'ea']));
    expect(ownersFor('story')).toEqual(new Set(['po', 'ba', 'ea', 'test-design']));
    expect(ownersFor('task')).toEqual(new Set(['po', 'ba', 'ea', 'test-design']));
    expect(ownersFor('subtask')).toEqual(new Set(['po', 'ea']));
  });

  it('signatures are deterministic and per-scope distinct', () => {
    bootstrapAgentContracts();
    const sigs1 = STORY_SCOPES.map((s) => composeTemplate(s).signature);
    const sigs2 = STORY_SCOPES.map((s) => composeTemplate(s).signature);
    expect(sigs1).toEqual(sigs2);
    expect(new Set(sigs1).size).toBe(STORY_SCOPES.length);
  });

  it('per-scope rubric scaling: scope minWords scales coarse->fine', () => {
    bootstrapAgentContracts();
    const initScope = composeTemplate('initiative').sections.get('scope')!;
    const storyScope = composeTemplate('story').sections.get('scope')!;
    const subScope = composeTemplate('subtask').sections.get('scope')!;
    expect(initScope.effectiveRubric.minWords ?? 0).toBeGreaterThan(
      storyScope.effectiveRubric.minWords ?? 0,
    );
    expect(storyScope.effectiveRubric.minWords ?? 0).toBeGreaterThan(
      subScope.effectiveRubric.minWords ?? 0,
    );
  });

  it('story scope has hard required: scope, lifecycle, priority, AC, techSubDomains, testCases', () => {
    bootstrapAgentContracts();
    const t = composeTemplate('story');
    const hardRequired = [
      'scope',
      'taxonomy.lifecycle',
      'taxonomy.priorityBucket',
      'acceptanceCriteria',
      'taxonomy.techSubDomains',
      'testCases',
    ];
    for (const name of hardRequired) {
      const entry = t.sections.get(name);
      expect(entry).toBeDefined();
      expect(entry!.effectiveRequired).toBe(true);
      expect(entry!.effectiveRubric.severityOnFail).toBe('hard');
    }
  });

  it('subtask scope strips BA + Test-Design contributions', () => {
    bootstrapAgentContracts();
    const t = composeTemplate('subtask');
    expect(t.sections.has('acceptanceCriteria')).toBe(false);
    expect(t.sections.has('testCases')).toBe(false);
    expect(t.sections.has('agentSections.api')).toBe(false);
    // EA still contributes
    expect(t.sections.has('agentSections.architecture')).toBe(true);
  });
});

describe('ACR-010 — orchestrator route ↔ registry parity', () => {
  it('GET /api/contracts/composed/:scope mirrors composeTemplate output', async () => {
    bootstrapAgentContracts();
    const app = new Hono();
    registerContractsRoutes(app);
    for (const scope of STORY_SCOPES) {
      const direct = composeTemplate(scope);
      const res = await app.request(`/api/contracts/composed/${scope}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const body: any = await res.json();
      expect(res.status).toBe(200);
      expect(body.scope).toBe(scope);
      expect(body.signature).toBe(direct.signature);
      expect(body.sectionCount).toBe(direct.sections.size);
    }
  });
});

describe('ACR-010 — story_scope DB column round-trip (migration 0030)', () => {
  it('persists each canonical scope and reads back unchanged', () => {
    const { db } = createTestDb();
    for (const scope of STORY_SCOPES) {
      const id = `st_acr010_${scope}`;
      db.insert(stories)
        .values({
          id,
          title: `ACR-010 ${scope}`,
          description: '',
          createdAt: nowIso(),
          storyScope: scope,
        })
        .run();
      const row = db.select().from(stories).where(eq(stories.id, id)).get()!;
      expect(row.storyScope).toBe(scope);
    }
  });

  it("legacy rows (no storyScope set) default to 'story' via migration 0030", () => {
    const { db } = createTestDb();
    db.insert(stories)
      .values({
        id: 'st_acr010_legacy',
        title: 'legacy row',
        description: '',
        createdAt: nowIso(),
        // intentionally omit storyScope
      })
      .run();
    const row = db.select().from(stories).where(eq(stories.id, 'st_acr010_legacy')).get()!;
    expect(row.storyScope).toBe('story');
  });
});
