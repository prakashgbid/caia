/**
 * Behavioural tests for the agent-collaboration request/response protocol.
 *
 * Uses an in-memory SQLite via drizzle to run the migrations and exercise
 * sendInputRequest / replyToRequest / awaitReplies end-to-end. The event bus
 * is left enabled — events post-and-go in the in-process bus and don't need
 * mocking for these tests, but `emitEvent: false` keeps unit-level tests
 * focused on DB state.
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq, and } from 'drizzle-orm';
import * as path from 'path';
import * as schema from '../../src/db/schema';
import { agentMessages, prompts } from '../../src/db/schema';
import {
  awaitReplies,
  emitInputReceived,
  replyToRequest,
  sendInputRequest,
} from '../../src/agents/agent-collab';

const MIGRATIONS_DIR = path.join(__dirname, '../../src/db/migrations');

function createTestDb() {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return db;
}

function nowIso() {
  return new Date().toISOString();
}

function seedPrompt(db: ReturnType<typeof createTestDb>, id: string) {
  db.insert(prompts)
    .values({
      id,
      body: 'do thing',
      receivedAt: nowIso(),
      receivedVia: 'api',
      correlationId: `cor_${id}`,
      hash: `hash_${id}`,
      status: 'received',
    })
    .run();
}

// ─── sendInputRequest ────────────────────────────────────────────────────────

describe('sendInputRequest', () => {
  it('inserts an input-requested row with the protocol fields populated', () => {
    const db = createTestDb();
    seedPrompt(db, 'prm_send');
    const id = sendInputRequest(
      {
        fromAgent: 'ba-agent',
        toAgent: 'ea-agent',
        correlationId: 'cor_1',
        expectedReplyBy: 1_700_001_000_000,
        payload: { question: 'arch?' },
        emitEvent: false,
      },
      db,
    );

    expect(id).toMatch(/^msg_req_/);
    const row = db.select().from(agentMessages).where(eq(agentMessages.id, id)).get();
    expect(row).toBeDefined();
    expect(row!.fromAgent).toBe('ba-agent');
    expect(row!.toAgent).toBe('ea-agent');
    expect(row!.messageType).toBe('input-requested');
    expect(row!.status).toBe('pending');
    expect(row!.correlationId).toBe('cor_1');
    expect(row!.expectedReplyBy).toBe(1_700_001_000_000);
    expect(JSON.parse(row!.payload)).toEqual({ question: 'arch?' });
  });
});

// ─── replyToRequest ──────────────────────────────────────────────────────────

describe('replyToRequest', () => {
  it('flips request to replied + inserts the reply with parent_message_id', () => {
    const db = createTestDb();
    seedPrompt(db, 'prm_reply');
    const reqId = sendInputRequest(
      {
        fromAgent: 'ba-agent',
        toAgent: 'dba-agent',
        correlationId: 'cor_2',
        expectedReplyBy: 1_700_002_000_000,
        payload: {},
        emitEvent: false,
      },
      db,
    );

    const replyId = replyToRequest(
      {
        requestMessageId: reqId,
        fromAgent: 'dba-agent',
        payload: { sectionKey: 'database', section: { reversibility: 'reversible' } },
        repliedAt: 1_700_001_500_000,
      },
      db,
    );

    expect(replyId).toMatch(/^msg_rep_/);
    const reqRow = db
      .select()
      .from(agentMessages)
      .where(eq(agentMessages.id, reqId))
      .get();
    expect(reqRow!.status).toBe('replied');
    expect(reqRow!.repliedAt).toBe(1_700_001_500_000);

    const replyRow = db
      .select()
      .from(agentMessages)
      .where(eq(agentMessages.id, replyId))
      .get();
    expect(replyRow!.messageType).toBe('input-received');
    expect(replyRow!.parentMessageId).toBe(reqId);
    expect(replyRow!.fromAgent).toBe('dba-agent');
    expect(replyRow!.toAgent).toBe('ba-agent'); // routed back to the requester
    const parsed = JSON.parse(replyRow!.payload);
    expect(parsed.sectionKey).toBe('database');
  });

  it('throws if the request id does not exist', () => {
    const db = createTestDb();
    expect(() =>
      replyToRequest(
        { requestMessageId: 'missing', fromAgent: 'x', payload: {} },
        db,
      ),
    ).toThrow(/not found/);
  });
});

// ─── awaitReplies ────────────────────────────────────────────────────────────

describe('awaitReplies', () => {
  it('resolves immediately when every consultant has already replied', async () => {
    const db = createTestDb();
    seedPrompt(db, 'prm_aw1');
    const aId = sendInputRequest(
      {
        fromAgent: 'ba-agent',
        toAgent: 'ea-agent',
        correlationId: 'cor_aw1',
        expectedReplyBy: 0,
        payload: {},
        emitEvent: false,
      },
      db,
    );
    const bId = sendInputRequest(
      {
        fromAgent: 'ba-agent',
        toAgent: 'security-agent',
        correlationId: 'cor_aw1',
        expectedReplyBy: 0,
        payload: {},
        emitEvent: false,
      },
      db,
    );
    replyToRequest(
      { requestMessageId: aId, fromAgent: 'ea-agent', payload: { sectionKey: 'architecture', section: {} } },
      db,
    );
    replyToRequest(
      { requestMessageId: bId, fromAgent: 'security-agent', payload: { sectionKey: 'security', section: {} } },
      db,
    );

    const result = await awaitReplies(
      { fromAgent: 'ba-agent', correlationId: 'cor_aw1', expectedAgents: ['ea-agent', 'security-agent'] },
      db,
      { timeoutMs: 1_000, pollIntervalMs: 5 },
    );

    expect(result.timedOutAgents).toEqual([]);
    expect(result.replies.map((r) => r.fromAgent).sort()).toEqual(['ea-agent', 'security-agent']);
  });

  it('reports timed-out agents and flips their request rows', async () => {
    const db = createTestDb();
    seedPrompt(db, 'prm_aw2');
    let fakeNow = 1_700_000_000_000;
    const advance = (ms: number) => {
      fakeNow += ms;
    };
    sendInputRequest(
      {
        fromAgent: 'ba-agent',
        toAgent: 'ea-agent',
        correlationId: 'cor_aw2',
        expectedReplyBy: fakeNow + 200,
        payload: {},
        emitEvent: false,
      },
      db,
    );
    sendInputRequest(
      {
        fromAgent: 'ba-agent',
        toAgent: 'release-agent',
        correlationId: 'cor_aw2',
        expectedReplyBy: fakeNow + 200,
        payload: {},
        emitEvent: false,
      },
      db,
    );

    const result = await awaitReplies(
      { fromAgent: 'ba-agent', correlationId: 'cor_aw2', expectedAgents: ['ea-agent', 'release-agent'] },
      db,
      {
        timeoutMs: 100,
        pollIntervalMs: 5,
        now: () => fakeNow,
        sleep: async (ms: number) => { advance(ms); },
      },
    );

    expect(result.replies).toEqual([]);
    expect(result.timedOutAgents.sort()).toEqual(['ea-agent', 'release-agent']);

    const timedOut = db
      .select()
      .from(agentMessages)
      .where(
        and(
          eq(agentMessages.correlationId, 'cor_aw2'),
          eq(agentMessages.messageType, 'input-requested'),
          eq(agentMessages.status, 'timed_out'),
        ),
      )
      .all();
    expect(timedOut).toHaveLength(2);
  });

  it('isolates rounds by correlation_id', async () => {
    const db = createTestDb();
    seedPrompt(db, 'prm_isol');
    const aId = sendInputRequest(
      {
        fromAgent: 'ba-agent',
        toAgent: 'ea-agent',
        correlationId: 'cor_round_A',
        expectedReplyBy: 0,
        payload: {},
        emitEvent: false,
      },
      db,
    );
    const bId = sendInputRequest(
      {
        fromAgent: 'ba-agent',
        toAgent: 'ea-agent',
        correlationId: 'cor_round_B',
        expectedReplyBy: 0,
        payload: {},
        emitEvent: false,
      },
      db,
    );
    replyToRequest({ requestMessageId: aId, fromAgent: 'ea-agent', payload: { sectionKey: 'architecture', section: {} } }, db);

    const roundA = await awaitReplies(
      { fromAgent: 'ba-agent', correlationId: 'cor_round_A', expectedAgents: ['ea-agent'] },
      db,
      { timeoutMs: 100, pollIntervalMs: 5 },
    );
    expect(roundA.replies.map((r) => r.fromAgent)).toEqual(['ea-agent']);

    // Round B's request is still open.
    const bRow = db.select().from(agentMessages).where(eq(agentMessages.id, bId)).get();
    expect(bRow!.status).toBe('pending');
  });

  it('returns replies in arrival order', async () => {
    const db = createTestDb();
    seedPrompt(db, 'prm_order');
    const aId = sendInputRequest(
      { fromAgent: 'ba-agent', toAgent: 'ea-agent', correlationId: 'cor_ord', expectedReplyBy: 0, payload: {}, emitEvent: false },
      db,
    );
    const bId = sendInputRequest(
      { fromAgent: 'ba-agent', toAgent: 'security-agent', correlationId: 'cor_ord', expectedReplyBy: 0, payload: {}, emitEvent: false },
      db,
    );
    replyToRequest({ requestMessageId: bId, fromAgent: 'security-agent', payload: { sectionKey: 'security', section: {} }, repliedAt: 1000 }, db);
    replyToRequest({ requestMessageId: aId, fromAgent: 'ea-agent', payload: { sectionKey: 'architecture', section: {} }, repliedAt: 2000 }, db);

    const result = await awaitReplies(
      { fromAgent: 'ba-agent', correlationId: 'cor_ord', expectedAgents: ['ea-agent', 'security-agent'] },
      db,
      { timeoutMs: 100, pollIntervalMs: 5 },
    );
    expect(result.replies[0]!.fromAgent).toBe('security-agent'); // earlier repliedAt wins
    expect(result.replies[1]!.fromAgent).toBe('ea-agent');
  });
});

// ─── emitInputReceived ───────────────────────────────────────────────────────

describe('emitInputReceived', () => {
  it('does not throw when emitting an aggregation event', () => {
    expect(() =>
      emitInputReceived({
        promptId: 'prm_em',
        storyId: 'story_em',
        correlationId: 'cor_em',
        result: { replies: [], timedOutAgents: ['ea-agent'] },
      }),
    ).not.toThrow();
  });
});
