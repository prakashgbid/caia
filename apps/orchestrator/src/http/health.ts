import * as http from 'http';
import type { Conductor } from '../index';
import type { AddParams } from '../core/types';
import type { RequirementsManager } from '../requirements/manager';
import type { ListRequirementsFilter, RequirementState } from '../requirements/types';
import type { BlockersManager } from '../blockers/manager';
import type { BlockerState, CreateBlockerParams } from '../blockers/types';
import type { QuestionsManager } from '../questions/manager';
import type { CreateQuestionParams, QuestionAnswer, QuestionState } from '../questions/types';

const startTime = Date.now();

function jsonResponse(res: http.ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(body);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk: Buffer) => { data += chunk.toString(); });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function parseQs(url: string): Record<string, string> {
  const idx = url.indexOf('?');
  if (idx === -1) return {};
  const qs = url.slice(idx + 1);
  const params: Record<string, string> = {};
  for (const pair of qs.split('&')) {
    const [k, v] = pair.split('=');
    if (k) params[decodeURIComponent(k)] = decodeURIComponent(v ?? '');
  }
  return params;
}

export function createHealthServer(
  conductor: Conductor,
  port: number = 7776,
  reqManager?: RequirementsManager,
  blockersManager?: BlockersManager,
  questionsManager?: QuestionsManager,
): http.Server {
  const server = http.createServer(async (req, res) => {
    const url = req.url ?? '/';
    const pathname = url.split('?')[0] ?? '/';
    const method = req.method ?? 'GET';

    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      res.end();
      return;
    }

    try {
      // ─── Task endpoints ────────────────────────────────────────────────────
      if (method === 'GET' && pathname === '/health') {
        const state = conductor.status();
        const pendingTasks = Object.values(state.tasks).filter(
          (t) => t.status === 'queued' || t.status === 'running' || t.status === 'blocked',
        ).length;
        const events = state.events;
        const lastEvent = events.length > 0 ? events[events.length - 1] : null;

        jsonResponse(res, 200, {
          ok: true,
          uptime: Math.floor((Date.now() - startTime) / 1000),
          lastEvent,
          pendingTasks,
        });
        return;
      }

      if (method === 'GET' && pathname === '/status') {
        const state = conductor.status();
        // VAL-RESTART-1777591616: cap events to prevent large JSON serialization from
        // blocking the event loop and timing out the dashboard under high event volume.
        jsonResponse(res, 200, { ...state, events: state.events.slice(-100) });
        return;
      }

      if (method === 'GET' && pathname === '/tasks') {
        jsonResponse(res, 200, conductor.list());
        return;
      }

      if (method === 'POST' && pathname === '/tasks') {
        const body = await readBody(req);
        const params = JSON.parse(body) as AddParams;
        const result = await conductor.add(params);
        jsonResponse(res, 201, result);
        return;
      }

      if (method === 'GET' && pathname === '/events') {
        const qs = parseQs(url);
        const since = qs['since'];
        const events = conductor.getHistory(since);
        jsonResponse(res, 200, events);
        return;
      }

      if (method === 'GET' && pathname === '/dag') {
        const qs = parseQs(url);
        const root = qs['root'];
        const dag = conductor.dag(root);
        jsonResponse(res, 200, dag);
        return;
      }

      if (method === 'POST' && pathname === '/check') {
        const body = await readBody(req);
        const { files } = JSON.parse(body) as { files: string[] };
        const result = conductor.check(files);
        jsonResponse(res, 200, result);
        return;
      }

      if (method === 'POST' && pathname === '/bypass') {
        jsonResponse(res, 200, { ok: true });
        return;
      }

      // ─── Requirements endpoints ────────────────────────────────────────────
      if (reqManager) {
        if (method === 'GET' && pathname === '/requirements') {
          const qs = parseQs(url);
          const filter: ListRequirementsFilter = {};
          if (qs['state']) filter.state = qs['state'] as RequirementState;
          if (qs['priority']) filter.priority = parseInt(qs['priority'], 10) as 1 | 2 | 3 | 4 | 5;
          if (qs['labels']) filter.labels = qs['labels'].split(',');
          jsonResponse(res, 200, reqManager.list(filter));
          return;
        }

        if (method === 'POST' && pathname === '/requirements') {
          const body = await readBody(req);
          const params = JSON.parse(body) as Parameters<RequirementsManager['capture']>[0];
          const req2 = await reqManager.capture(params);
          jsonResponse(res, 201, req2);
          return;
        }

        // /requirements/:id
        const reqMatch = pathname.match(/^\/requirements\/([^/]+)$/);
        if (reqMatch) {
          const id = reqMatch[1]!;

          if (method === 'GET') {
            const found = reqManager.get(id);
            if (!found) { jsonResponse(res, 404, { error: 'Not found' }); return; }
            jsonResponse(res, 200, found);
            return;
          }

          if (method === 'PUT') {
            const body = await readBody(req);
            const patch = JSON.parse(body) as Parameters<RequirementsManager['refine']>[1];
            const updated = await reqManager.refine(id, patch);
            jsonResponse(res, 200, updated);
            return;
          }
        }

        // /requirements/:id/state
        const stateMatch = pathname.match(/^\/requirements\/([^/]+)\/state$/);
        if (stateMatch && method === 'POST') {
          const id = stateMatch[1]!;
          const body = await readBody(req);
          const { state } = JSON.parse(body) as { state: RequirementState };
          const updated = await reqManager.setState(id, state);
          jsonResponse(res, 200, updated);
          return;
        }

        // /requirements/:id/notes
        const notesMatch = pathname.match(/^\/requirements\/([^/]+)\/notes$/);
        if (notesMatch && method === 'POST') {
          const id = notesMatch[1]!;
          const body = await readBody(req);
          const { text } = JSON.parse(body) as { text: string };
          const updated = await reqManager.addNote(id, text);
          jsonResponse(res, 200, updated);
          return;
        }
      }

      // ─── Blockers endpoints ────────────────────────────────────────────────
      if (blockersManager) {
        if (method === 'GET' && pathname === '/blockers') {
          const qs = parseQs(url);
          const state = qs['state'] as BlockerState | undefined;
          jsonResponse(res, 200, blockersManager.list(state));
          return;
        }

        if (method === 'POST' && pathname === '/blockers') {
          const body = await readBody(req);
          const params = JSON.parse(body) as CreateBlockerParams;
          const created = await blockersManager.create(params);
          jsonResponse(res, 201, created);
          return;
        }

        const blockerMatch = pathname.match(/^\/blockers\/([^/]+)$/);
        if (blockerMatch) {
          const id = blockerMatch[1]!;
          if (method === 'GET') {
            const found = blockersManager.get(id);
            if (!found) { jsonResponse(res, 404, { error: 'Not found' }); return; }
            jsonResponse(res, 200, found);
            return;
          }
        }

        const blockerResolveMatch = pathname.match(/^\/blockers\/([^/]+)\/resolve$/);
        if (blockerResolveMatch && method === 'POST') {
          const id = blockerResolveMatch[1]!;
          const body = await readBody(req);
          const { note } = (body ? JSON.parse(body) : {}) as { note?: string };
          const updated = await blockersManager.resolve(id, note);
          jsonResponse(res, 200, updated);
          return;
        }

        const blockerCancelMatch = pathname.match(/^\/blockers\/([^/]+)\/cancel$/);
        if (blockerCancelMatch && method === 'POST') {
          const id = blockerCancelMatch[1]!;
          const updated = await blockersManager.cancel(id);
          jsonResponse(res, 200, updated);
          return;
        }
      }

      // ─── Questions endpoints ───────────────────────────────────────────────
      if (questionsManager) {
        if (method === 'GET' && pathname === '/questions') {
          const qs = parseQs(url);
          const state = qs['state'] as QuestionState | undefined;
          jsonResponse(res, 200, questionsManager.list(state));
          return;
        }

        if (method === 'POST' && pathname === '/questions') {
          const body = await readBody(req);
          const params = JSON.parse(body) as CreateQuestionParams;
          const created = await questionsManager.create(params);
          jsonResponse(res, 201, created);
          return;
        }

        const questionMatch = pathname.match(/^\/questions\/([^/]+)$/);
        if (questionMatch) {
          const id = questionMatch[1]!;
          if (method === 'GET') {
            const found = questionsManager.get(id);
            if (!found) { jsonResponse(res, 404, { error: 'Not found' }); return; }
            jsonResponse(res, 200, found);
            return;
          }
        }

        const questionAnswerMatch = pathname.match(/^\/questions\/([^/]+)\/answer$/);
        if (questionAnswerMatch && method === 'POST') {
          const id = questionAnswerMatch[1]!;
          const body = await readBody(req);
          const answer = JSON.parse(body) as QuestionAnswer;
          const updated = await questionsManager.answer(id, answer);
          jsonResponse(res, 200, updated);
          return;
        }

        const questionCancelMatch = pathname.match(/^\/questions\/([^/]+)\/cancel$/);
        if (questionCancelMatch && method === 'POST') {
          const id = questionCancelMatch[1]!;
          const updated = await questionsManager.cancel(id);
          jsonResponse(res, 200, updated);
          return;
        }
      }

      // ─── Counts endpoint (for dashboard badges) ────────────────────────────
      if (method === 'GET' && pathname === '/counts') {
        jsonResponse(res, 200, {
          openBlockers: blockersManager?.openCount() ?? 0,
          openQuestions: questionsManager?.openCount() ?? 0,
        });
        return;
      }

      jsonResponse(res, 404, { error: 'Not found' });
    } catch (err) {
      jsonResponse(res, 500, { error: String(err) });
    }
  });

  return server;
}
