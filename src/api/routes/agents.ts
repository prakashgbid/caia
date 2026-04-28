/**
 * Agent Registry API Routes
 * Provides CRUD and messaging endpoints for the CAIA agent registry.
 * Also exposes action endpoints for Tier-4 agents (Testing, Release).
 */

import type { Hono } from 'hono';
import { eq, desc, and } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { Db } from '../../db/connection';
import {
  agentRegistry,
  agentSystemPrompts,
  agentArtifacts,
  agentMessages,
} from '../../db/schema';
import { runTestingAgent } from '../../agents/testing-agent';
import { runReleaseAgent } from '../../agents/release-agent';

// @no-events — route registration wrapper
export function registerAgentRoutes(app: Hono, db: Db): void {

  // ─── GET /agents — list all agents with current status ───────────────────
  app.get('/agents', (c) => {
    const { tier, status } = c.req.query() as Record<string, string>;

    const query = db.select().from(agentRegistry);

    // Apply filters in-memory after fetch (Drizzle SQLite doesn't chain .where easily here)
    const rows = query.orderBy(agentRegistry.tier, agentRegistry.name).all();

    const filtered = rows
      .filter(r => !tier || r.tier === tier)
      .filter(r => !status || r.status === status)
      .map(r => ({
        ...r,
        capabilities: safeJsonParse(r.capabilities, []),
        toolManifest: safeJsonParse(r.toolManifest, []),
        triggerEvents: safeJsonParse(r.triggerEvents, []),
        metadata: r.metadata ? safeJsonParse(r.metadata, {}) : null,
      }));

    return c.json({ agents: filtered, total: filtered.length });
  });

  // ─── GET /agents/:name — agent detail + latest active system prompt ───────
  app.get('/agents/:name', (c) => {
    const { name } = c.req.param();

    const agent = db.select().from(agentRegistry)
      .where(eq(agentRegistry.name, name))
      .get();

    if (!agent) return c.json({ error: 'Agent not found' }, 404);

    const systemPrompt = db.select().from(agentSystemPrompts)
      .where(and(
        eq(agentSystemPrompts.agentName, name),
        eq(agentSystemPrompts.isActive, true),
      ))
      .orderBy(desc(agentSystemPrompts.createdAt))
      .limit(1)
      .get();

    const recentMessages = db.select().from(agentMessages)
      .where(eq(agentMessages.toAgent, name))
      .orderBy(desc(agentMessages.createdAt))
      .limit(20)
      .all();

    return c.json({
      agent: {
        ...agent,
        capabilities: safeJsonParse(agent.capabilities, []),
        toolManifest: safeJsonParse(agent.toolManifest, []),
        triggerEvents: safeJsonParse(agent.triggerEvents, []),
        metadata: agent.metadata ? safeJsonParse(agent.metadata, {}) : null,
      },
      systemPrompt: systemPrompt ?? null,
      recentMessages,
    });
  });

  // ─── PATCH /agents/:name — update agent status or metadata ───────────────
  app.patch('/agents/:name', async (c) => {
    const { name } = c.req.param();
    const body = await c.req.json() as {
      status?: string;
      metadata?: Record<string, unknown>;
      endpointUrl?: string;
      lastHeartbeat?: number;
    };

    const existing = db.select().from(agentRegistry)
      .where(eq(agentRegistry.name, name))
      .get();

    if (!existing) return c.json({ error: 'Agent not found' }, 404);

    const update: Partial<typeof agentRegistry.$inferInsert> = {
      updatedAt: Date.now(),
    };

    if (body.status !== undefined) update.status = body.status;
    if (body.endpointUrl !== undefined) update.endpointUrl = body.endpointUrl;
    if (body.lastHeartbeat !== undefined) update.lastHeartbeat = body.lastHeartbeat;
    if (body.metadata !== undefined) {
      // Merge metadata
      const existing_meta = existing.metadata ? safeJsonParse(existing.metadata, {}) : {};
      update.metadata = JSON.stringify({ ...existing_meta, ...body.metadata });
    }

    db.update(agentRegistry)
      .set(update)
      .where(eq(agentRegistry.name, name))
      .run();

    const updated = db.select().from(agentRegistry)
      .where(eq(agentRegistry.name, name))
      .get();

    return c.json({ agent: updated });
  });

  // ─── GET /agents/:name/messages — recent inter-agent messages ────────────
  app.get('/agents/:name/messages', (c) => {
    const { name } = c.req.param();
    const { direction = 'both', limit } = c.req.query() as Record<string, string>;
    const n = limit ? parseInt(limit, 10) : 50;

    let rows;
    if (direction === 'sent') {
      rows = db.select().from(agentMessages)
        .where(eq(agentMessages.fromAgent, name))
        .orderBy(desc(agentMessages.createdAt))
        .limit(n)
        .all();
    } else if (direction === 'received') {
      rows = db.select().from(agentMessages)
        .where(eq(agentMessages.toAgent, name))
        .orderBy(desc(agentMessages.createdAt))
        .limit(n)
        .all();
    } else {
      // both — fetch sent and received, merge and sort
      const sent = db.select().from(agentMessages)
        .where(eq(agentMessages.fromAgent, name))
        .orderBy(desc(agentMessages.createdAt))
        .limit(n)
        .all();
      const received = db.select().from(agentMessages)
        .where(eq(agentMessages.toAgent, name))
        .orderBy(desc(agentMessages.createdAt))
        .limit(n)
        .all();
      rows = [...sent, ...received].sort((a, b) => b.createdAt - a.createdAt).slice(0, n);
    }

    return c.json({ agent: name, messages: rows, total: rows.length });
  });

  // ─── POST /agents/messages — create an inter-agent message ───────────────
  app.post('/agents/messages', async (c) => {
    const body = await c.req.json() as {
      fromAgent: string;
      toAgent: string;
      messageType: string;
      correlationId: string;
      payload: Record<string, unknown>;
    };

    if (!body.fromAgent || !body.toAgent || !body.messageType || !body.correlationId) {
      return c.json({ error: 'fromAgent, toAgent, messageType, and correlationId are required' }, 400);
    }

    const id = `msg-${nanoid(12)}`;
    db.insert(agentMessages).values({
      id,
      fromAgent: body.fromAgent,
      toAgent: body.toAgent,
      messageType: body.messageType,
      correlationId: body.correlationId,
      payload: JSON.stringify(body.payload ?? {}),
      status: 'pending',
      createdAt: Date.now(),
    }).run();

    return c.json({ message_id: id }, 201);
  });

  // ─── GET /agents/artifacts — search artifacts ─────────────────────────────
  app.get('/agents/artifacts', (c) => {
    const { promptId, agentName, type, status } = c.req.query() as Record<string, string>;

    const rows = db.select().from(agentArtifacts)
      .orderBy(desc(agentArtifacts.createdAt))
      .all()
      .filter(r => !promptId || r.promptId === promptId)
      .filter(r => !agentName || r.agentName === agentName)
      .filter(r => !type || r.artifactType === type)
      .filter(r => !status || r.status === status);

    return c.json({ artifacts: rows, total: rows.length });
  });

  // ─── POST /agents/artifacts — create an artifact ──────────────────────────
  app.post('/agents/artifacts', async (c) => {
    const body = await c.req.json() as {
      agentName: string;
      artifactType: string;
      promptId?: string;
      requirementId?: string;
      content: string;
      contentType?: string;
    };

    if (!body.agentName || !body.artifactType || !body.content) {
      return c.json({ error: 'agentName, artifactType, and content are required' }, 400);
    }

    const id = `art-${nanoid(12)}`;
    db.insert(agentArtifacts).values({
      id,
      agentName: body.agentName,
      artifactType: body.artifactType,
      promptId: body.promptId ?? null,
      requirementId: body.requirementId ?? null,
      content: body.content,
      contentType: body.contentType ?? 'application/json',
      status: 'draft',
      createdAt: Date.now(),
    }).run();

    return c.json({ artifact_id: id }, 201);
  });

  // ─── GET /agents/system-prompts/:agentName — all versions for an agent ───
  app.get('/agents/system-prompts/:agentName', (c) => {
    const { agentName } = c.req.param();

    const rows = db.select().from(agentSystemPrompts)
      .where(eq(agentSystemPrompts.agentName, agentName))
      .orderBy(desc(agentSystemPrompts.createdAt))
      .all();

    return c.json({ agentName, prompts: rows, total: rows.length });
  });

  // ─── POST /agents/testing/run — trigger Testing Agent for a task run ────────
  app.post('/agents/testing/run', async (c) => {
    const body = await c.req.json() as {
      taskId: string;
      taskRunId: string;
      promptId?: string | null;
      correlationId?: string;
    };

    if (!body.taskId || !body.taskRunId) {
      return c.json({ error: 'taskId and taskRunId are required' }, 400);
    }

    const correlationId = body.correlationId ?? `test-${body.taskRunId}`;

    try {
      const result = await runTestingAgent(
        {
          taskId: body.taskId,
          taskRunId: body.taskRunId,
          promptId: body.promptId ?? null,
          correlationId,
        },
        db,
      );
      return c.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  // ─── POST /agents/release/report — generate a release report for a prompt ──
  app.post('/agents/release/report', async (c) => {
    const body = await c.req.json() as {
      promptId: string;
      correlationId?: string;
    };

    if (!body.promptId) {
      return c.json({ error: 'promptId is required' }, 400);
    }

    const correlationId = body.correlationId ?? `release-${body.promptId}`;

    try {
      const report = await runReleaseAgent({ promptId: body.promptId, correlationId }, db);

      // Persist the report as an agent artifact so it can be retrieved later
      const artifactId = `art-rel-${nanoid(10)}`;
      db.insert(agentArtifacts).values({
        id: artifactId,
        agentName: 'release-agent',
        artifactType: 'release-report',
        promptId: body.promptId,
        content: JSON.stringify(report),
        contentType: 'application/json',
        status: 'draft',
        createdAt: Date.now(),
      }).run();

      return c.json({ ...report, artifactId });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  // ─── GET /agents/release/report/:promptId — latest release report ──────────
  app.get('/agents/release/report/:promptId', (c) => {
    const { promptId } = c.req.param();

    const artifact = db.select().from(agentArtifacts)
      .where(
        and(
          eq(agentArtifacts.agentName, 'release-agent'),
          eq(agentArtifacts.artifactType, 'release-report'),
          eq(agentArtifacts.promptId, promptId),
        ),
      )
      .orderBy(desc(agentArtifacts.createdAt))
      .limit(1)
      .get();

    if (!artifact) {
      return c.json({ error: 'No release report found for this promptId' }, 404);
    }

    try {
      const report = JSON.parse(artifact.content) as Record<string, unknown>;
      return c.json({ ...report, artifactId: artifact.id, generatedAt: artifact.createdAt });
    } catch {
      return c.json({ error: 'Failed to parse stored release report' }, 500);
    }
  });

  // ─── POST /agents/system-prompts — add a new system prompt version ────────
  app.post('/agents/system-prompts', async (c) => {
    const body = await c.req.json() as {
      agentName: string;
      version: string;
      promptText: string;
    };

    if (!body.agentName || !body.version || !body.promptText) {
      return c.json({ error: 'agentName, version, and promptText are required' }, 400);
    }

    const id = `asp-${body.agentName}-v${body.version.replace(/\./g, '')}`;

    // Deactivate previous active prompts for this agent
    db.update(agentSystemPrompts)
      .set({ isActive: false })
      .where(and(
        eq(agentSystemPrompts.agentName, body.agentName),
        eq(agentSystemPrompts.isActive, true),
      ))
      .run();

    db.insert(agentSystemPrompts).values({
      id,
      agentName: body.agentName,
      version: body.version,
      promptText: body.promptText,
      isActive: true,
      createdAt: Date.now(),
    }).run();

    // Update agent registry to point to new prompt
    db.update(agentRegistry)
      .set({ systemPromptId: id, updatedAt: Date.now() })
      .where(eq(agentRegistry.name, body.agentName))
      .run();

    return c.json({ prompt_id: id }, 201);
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
