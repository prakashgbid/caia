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

export function createApp(db: Db): Hono {
  const app = new Hono();

  app.use('*', cors({ origin: '*', allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'] }));

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

  return app;
}
