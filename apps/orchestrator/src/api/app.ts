import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Db } from '../db/connection';
import { registerProjectRoutes } from './routes/projects';
import { registerAdrRoutes } from './routes/adrs';
import { registerFeatureRoutes } from './routes/features';
import { registerSuggestionRoutes } from './routes/suggestions';
import { registerTimelineRoutes } from './routes/timeline';
import { registerAuditRoutes } from './routes/audit';
import { registerMetricsRoutes } from './routes/metrics';
import { registerLegacyRoutes } from './routes/legacy';
import { registerDomainRoutes } from './routes/domains';
import { registerTaskRunRoutes } from './routes/task-runs';
import { registerBehaviorTestRoutes } from './routes/behavior-tests';
import { registerStoriesRoutes, registerCompletenessRoutes, registerLockContractRoutes } from './routes/stories';
import { registerExecutorRoutes } from './routes/executor';
import { registerEventsRoutes } from './routes/events';
import { registerBuildsRoutes } from './routes/builds';
import { registerPromptsRoutes } from './routes/prompts';
import { registerPriorityRoutes } from './routes/priority';
import { registerPulseRoutes } from './routes/pulse';
import { registerLlmRoutes } from './routes/llm';
import { registerStatsRoutes } from './routes/stats';
import { registerAgentRoutes } from './routes/agents';
import { registerBucketsRoutes } from './routes/buckets';
import { registerMetricsPhase1Routes } from './routes/metrics-phase1';
import { registerDagRoutes } from './routes/dag';
import { registerFeatureRegistryRoutes } from './routes/feature-registry';
import { registerContractsRoutes } from './routes/contracts';
import { registerArchitectureRoutes } from './routes/architecture';
import { registerWorkerRoutes } from './routes/workers';
import { registerUserRoutes } from './routes/users';
import { promRegistry, httpRequestsTotal } from '../metrics/prometheus';
import type { Phase2Context } from '../agents/wire-phase2';

/**
 * Optional Phase 2 context. When provided, the `/api/workers/*` lifecycle
 * routes go through the WorkerPoolRegistry so worker.* events are emitted
 * on the bus. When omitted, the lifecycle routes fall back to direct DB
 * writes (still functional, but no events).
 */
export interface CreateAppOptions {
  phase2?: Phase2Context;
}

export function createApp(db: Db, opts: CreateAppOptions = {}): Hono {
  const app = new Hono();

  app.use('*', cors({ origin: '*', allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'] }));

  // Prometheus metrics — separate from the JSON /metrics endpoint
  app.get('/prom-metrics', async (c) => {
    const metrics = await promRegistry.metrics();
    c.header('Content-Type', promRegistry.contentType);
    return c.body(metrics);
  });

  // Count all HTTP requests
  app.use('*', async (c, next) => {
    await next();
    httpRequestsTotal.inc({ method: c.req.method, path: c.req.routePath ?? c.req.path, status: String(c.res.status) });
  });

  app.get('/health', (c) => c.json({ ok: true, db: 'connected', schema: 'v2' }));

  registerDomainRoutes(app, db);
  registerProjectRoutes(app, db);
  registerAdrRoutes(app, db);
  registerFeatureRoutes(app, db);
  registerSuggestionRoutes(app, db);
  registerTimelineRoutes(app, db);
  registerAuditRoutes(app, db);
  registerMetricsRoutes(app, db);
  registerLegacyRoutes(app, db);
  registerTaskRunRoutes(app, db);
  registerBehaviorTestRoutes(app, db);
  registerStoriesRoutes(app, db);
  registerCompletenessRoutes(app, db);
  registerLockContractRoutes(app, db);
  registerExecutorRoutes(app, db);
  registerEventsRoutes(app, db);
  registerBuildsRoutes(app, db);
  registerPromptsRoutes(app, db);
  registerPriorityRoutes(app, db);
  registerPulseRoutes(app, db);
  registerLlmRoutes(app);
  registerStatsRoutes(app);
  registerAgentRoutes(app, db);
  registerBucketsRoutes(app, db);
  registerMetricsPhase1Routes(app, db);
  // FREG-007 — feature registry dashboard backend
  registerFeatureRegistryRoutes(app, db);
  // ACR-009 — Agent Section Contract Registry dashboard backend
  registerContractsRoutes(app);
  registerArchitectureRoutes(app, db);
  registerDagRoutes(app, db);
  // TASKMGR-006 + CODING-007 — Phase 2 worker pool dashboard + lifecycle
  registerWorkerRoutes(app, db, { registry: opts.phase2?.registry });
  registerUserRoutes(app, db);

  return app;
}
