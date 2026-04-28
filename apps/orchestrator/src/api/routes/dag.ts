import type { Hono } from 'hono';
import type { Db } from '../../db/connection';
import { tasks } from '../../db/schema';

/**
 * DASH-309 — GET /dag
 *
 * Builds a tasks-DAG view ({nodes, edges}) from the `tasks.depends_on` JSON
 * column. Used by the dashboard's `/dag` page (`DagView.tsx` component).
 *
 * Each row's `dependsOn` is a stringified JSON array of upstream task ids;
 * the route emits one edge per `dep -> task.id` pair. Filters:
 *   - root=<task_id> — restrict to the dependency cone reachable from `root`
 *     (BFS over edges in either direction). Useful for very large queues.
 *
 * Terminal-status tasks (done/completed/failed/cancelled) are included so
 * upstream history is visible — the consumer can filter client-side.
 */
// @no-events — read-only view, individual handlers do not emit events
export function registerDagRoutes(app: Hono, db: Db): void {
  app.get('/dag', (c) => {
    const root = c.req.query('root');

    const all = db.select({
      id: tasks.id,
      title: tasks.title,
      status: tasks.status,
      dependsOn: tasks.dependsOn,
    }).from(tasks).all();

    const nodes = all.map(t => ({ id: t.id, title: t.title, status: t.status }));

    const edges: Array<{ from: string; to: string }> = [];
    for (const t of all) {
      let deps: string[] = [];
      try { deps = JSON.parse(t.dependsOn) as string[]; } catch { deps = []; }
      for (const dep of deps) {
        edges.push({ from: dep, to: t.id });
      }
    }

    if (!root) return c.json({ nodes, edges });

    // BFS in both directions from `root` — collect connected ids.
    const reachable = new Set<string>([root]);
    const queue = [root];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const e of edges) {
        if (e.from === cur && !reachable.has(e.to)) {
          reachable.add(e.to); queue.push(e.to);
        }
        if (e.to === cur && !reachable.has(e.from)) {
          reachable.add(e.from); queue.push(e.from);
        }
      }
    }

    return c.json({
      nodes: nodes.filter(n => reachable.has(n.id)),
      edges: edges.filter(e => reachable.has(e.from) && reachable.has(e.to)),
    });
  });
}
