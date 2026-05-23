import type { IncomingMessage, ServerResponse } from 'node:http';

import type { ProjectEvent, StateMachine, TicketEvent } from './state-machine.js';

/**
 * Minimal SSE writer. Frame format per the EventSource spec:
 *   - `event: <name>` (optional)
 *   - `id: <id>` (optional)
 *   - `data: <line>` (repeat per line)
 *   - blank line terminator.
 */
export class SseConnection {
  private closed = false;
  private readonly keepaliveTimer: NodeJS.Timeout;

  constructor(
    private readonly res: ServerResponse,
    keepaliveMs = 15_000,
  ) {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    this.keepaliveTimer = setInterval(
      () => this.sendComment('keepalive'),
      keepaliveMs,
    );
    res.on('close', () => this.close());
  }

  send(event: string, data: string, id?: string): void {
    if (this.closed) return;
    let frame = '';
    if (id) frame += `id: ${id}\n`;
    if (event) frame += `event: ${event}\n`;
    for (const line of data.split('\n')) {
      frame += `data: ${line}\n`;
    }
    frame += '\n';
    try {
      this.res.write(frame);
    } catch {
      this.close();
    }
  }

  sendJson(event: string, value: unknown, id?: string): void {
    this.send(event, JSON.stringify(value), id);
  }

  sendComment(text: string): void {
    if (this.closed) return;
    try {
      this.res.write(`: ${text}\n\n`);
    } catch {
      this.close();
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.keepaliveTimer);
    try {
      this.res.end();
    } catch {
      /* ignore */
    }
  }

  get isClosed(): boolean {
    return this.closed;
  }
}

export interface SseHandlerOptions {
  keepaliveMs?: number;
  onError?: (err: Error) => void;
}

/**
 * Wire an SSE endpoint to a `StateMachine`. Use from any Node http
 * framework - pass the raw `IncomingMessage`/`ServerResponse` pair.
 */
export async function handleProjectSse(
  sm: StateMachine,
  req: IncomingMessage,
  res: ServerResponse,
  projectId: string,
  opts: SseHandlerOptions = {},
): Promise<void> {
  const conn = new SseConnection(res, opts.keepaliveMs);
  const proj = await sm.getProject(projectId);
  if (!proj) {
    conn.sendJson('error', { error: 'project-not-found', project_id: projectId });
    conn.close();
    return;
  }
  conn.sendJson('snapshot', {
    project_id: projectId,
    status: proj.status,
    paused: proj.paused,
    version: proj.version,
    last_transitioned_at: proj.lastTransitionedAt.toISOString(),
  });

  const unsubProject = await sm.subscribeToProject(projectId, (evt: ProjectEvent) => {
    conn.sendJson('project', evt, String(evt.history_id));
  });
  const unsubTickets = await sm.subscribeToTickets(projectId, (evt: TicketEvent) => {
    conn.sendJson('ticket', evt);
  });

  const onClose = async (): Promise<void> => {
    try {
      await unsubProject();
    } catch {
      /* ignore */
    }
    try {
      await unsubTickets();
    } catch {
      /* ignore */
    }
  };
  req.on('close', () => {
    void onClose();
  });
}
