#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createLogger } from '@chiefaia/logger';

// Structured logger (PR #478 logger first-wave migration). Wraps pino with
// a `component=poller` binding so log aggregation can attribute these lines.
const log = createLogger({
  name: 'task-run-poller',
  level: (process.env['POLLER_LOG_LEVEL'] as 'debug' | 'info' | 'warn' | 'error' | undefined) ?? 'info',
}).child({ component: 'poller' });

const API_BASE = process.env['CONDUCTOR_API'] ?? 'http://localhost:7776';
const SESSIONS_DIR = process.env['CLAUDE_SESSIONS_DIR'] ??
  path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'local-agent-mode-sessions');
const POLL_INTERVAL_MS = 30_000;
const STALL_THRESHOLD_MS = 15 * 60 * 1000; // 15 min
const IDLE_THRESHOLD_MS = 2 * 60 * 1000;   // 2 min

const isBackfill = process.argv.includes('--backfill');
const isOnce = process.argv.includes('--once');

interface MessageEntry {
  role: 'user' | 'assistant' | 'system';
  content: string | Array<{ type: string; text?: string; name?: string; input?: unknown }>;
  ts?: string;
  timestamp?: string;
}

interface SessionInfo {
  sessionId: string;
  title: string;
  status: 'running' | 'idle' | 'completed' | 'stalled';
  turnCount: number;
  completionSummary: string;
  lastActivityAt: string;
  startedAt: string;
  endedAt?: string;
  resultOk?: boolean;
  cwd?: string;
  subtasks: SubtaskInfo[];
}

interface SubtaskInfo {
  ordinal: number;
  title: string;
  status: 'pending' | 'done' | 'failed';
  source: 'todo' | 'sub_agent' | 'commit' | 'manual';
  evidenceKind?: string;
  evidenceValue?: string;
}

function readJsonlMessages(filePath: string): MessageEntry[] {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n').filter(l => l.trim());
    const messages: MessageEntry[] = [];
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as unknown;
        if (parsed && typeof parsed === 'object' && 'role' in parsed) {
          messages.push(parsed as MessageEntry);
        }
      } catch { /* skip malformed lines */ }
    }
    return messages;
  } catch {
    return [];
  }
}

function extractTitle(messages: MessageEntry[]): string {
  for (const msg of messages) {
    if (msg.role === 'user') {
      const text = typeof msg.content === 'string'
        ? msg.content
        : msg.content.find((c): c is { type: string; text: string } => c.type === 'text')?.text ?? '';
      const trimmed = text.trim().slice(0, 120);
      if (trimmed) return trimmed;
    }
  }
  return 'Unnamed session';
}

function extractCwd(messages: MessageEntry[]): string | undefined {
  for (const msg of messages) {
    if (typeof msg.content === 'string' && msg.content.includes('cwd')) {
      const match = msg.content.match(/cwd[:\s]+([^\s,\n"]+)/i);
      if (match?.[1]) return match[1];
    }
  }
  return undefined;
}

function hasResultLine(messages: MessageEntry[]): { found: boolean; text: string; ok: boolean } {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === 'assistant') {
      const text = typeof msg.content === 'string'
        ? msg.content
        : msg.content.filter((c): c is { type: string; text: string } => c.type === 'text').map(c => c.text).join('\n');
      if (text.includes('[result]') || text.includes('Task complete') || text.toLowerCase().includes('completed successfully')) {
        return { found: true, text: text.slice(0, 500), ok: !text.toLowerCase().includes('failed') && !text.toLowerCase().includes('error') };
      }
    }
  }
  return { found: false, text: '', ok: false };
}

function extractLastAssistantExcerpt(messages: MessageEntry[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === 'assistant') {
      const text = typeof msg.content === 'string'
        ? msg.content
        : msg.content.filter((c): c is { type: string; text: string } => c.type === 'text').map(c => c.text).join('\n');
      if (text.trim()) return text.trim().slice(0, 500);
    }
  }
  return '';
}

function extractTodos(messages: MessageEntry[]): SubtaskInfo[] {
  const todos: Map<string, SubtaskInfo> = new Map();
  let ordinal = 0;

  for (const msg of messages) {
    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === 'tool_use' && part.name === 'TodoWrite') {
          const input = part.input as { todos?: Array<{ content: string; status: string; id?: string }> } | undefined;
          if (input?.todos) {
            for (const todo of input.todos) {
              const key = todo.id ?? todo.content.slice(0, 80);
              if (!todos.has(key)) {
                todos.set(key, {
                  ordinal: ordinal++,
                  title: todo.content.slice(0, 200),
                  status: todo.status === 'completed' ? 'done' : todo.status === 'in_progress' ? 'pending' : 'pending',
                  source: 'todo',
                });
              } else {
                const existing = todos.get(key)!;
                existing.status = todo.status === 'completed' ? 'done' : todo.status === 'in_progress' ? 'pending' : existing.status;
              }
            }
          }
        }
      }
    }
  }

  return Array.from(todos.values());
}

function extractSubAgentCalls(messages: MessageEntry[]): SubtaskInfo[] {
  const calls: SubtaskInfo[] = [];
  let ordinal = 1000;

  for (const msg of messages) {
    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === 'tool_use' && part.name === 'Task') {
          const input = part.input as { description?: string; prompt?: string } | undefined;
          const title = input?.description ?? (input?.prompt?.slice(0, 100) ?? 'Sub-agent call');
          calls.push({
            ordinal: ordinal++,
            title,
            status: 'done', // if we see it in transcript, it was invoked
            source: 'sub_agent',
            evidenceKind: 'none',
          });
        }
      }
    }
  }

  return calls;
}

function extractCommits(messages: MessageEntry[]): SubtaskInfo[] {
  const commits: SubtaskInfo[] = [];
  let ordinal = 2000;

  for (const msg of messages) {
    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === 'tool_use' && part.name === 'Bash') {
          const input = part.input as { command?: string } | undefined;
          const cmd = input?.command ?? '';
          // Look for git commit commands
          const commitMatch = cmd.match(/git commit[^"]*"([^"]+)"/);
          if (commitMatch?.[1]) {
            commits.push({
              ordinal: ordinal++,
              title: `commit: ${commitMatch[1].slice(0, 100)}`,
              status: 'done',
              source: 'commit',
              evidenceKind: 'commit_sha',
            });
          }
        }
      }
    }
  }

  return commits;
}

function analyzeSession(sessionDir: string, sessionId: string): SessionInfo | null {
  // Find JSONL files in the session dir
  let files: string[] = [];
  try {
    files = fs.readdirSync(sessionDir)
      .filter(f => f.endsWith('.jsonl') || f === 'transcript.jsonl')
      .map(f => path.join(sessionDir, f));
  } catch {
    return null;
  }

  // Also check for direct .jsonl file named after session
  const directFile = `${sessionDir}.jsonl`;
  if (fs.existsSync(directFile)) files.push(directFile);

  // If sessionDir itself is a .jsonl file
  if (sessionDir.endsWith('.jsonl') && fs.existsSync(sessionDir)) {
    files = [sessionDir];
  }

  if (files.length === 0) {
    // Session dir might have subdirs or be structured differently
    try {
      const stat = fs.statSync(sessionDir);
      if (stat.isFile()) {
        files = [sessionDir];
      }
    } catch {
      return null;
    }
  }

  if (files.length === 0) return null;

  const messages: MessageEntry[] = [];
  let lastMtime = 0;
  let firstMtime = Infinity;

  for (const f of files) {
    try {
      const stat = fs.statSync(f);
      lastMtime = Math.max(lastMtime, stat.mtimeMs);
      firstMtime = Math.min(firstMtime, stat.birthtimeMs || stat.ctimeMs);
      messages.push(...readJsonlMessages(f));
    } catch { /* skip */ }
  }

  if (messages.length === 0) return null;

  const now = Date.now();
  const timeSinceLastActivity = now - lastMtime;
  const resultInfo = hasResultLine(messages);
  const assistantTurns = messages.filter(m => m.role === 'assistant').length;
  const excerpt = extractLastAssistantExcerpt(messages);

  let status: SessionInfo['status'];
  let endedAt: string | undefined;

  if (resultInfo.found) {
    status = 'completed';
    endedAt = new Date(lastMtime).toISOString();
  } else if (timeSinceLastActivity > STALL_THRESHOLD_MS) {
    status = 'stalled';
  } else if (timeSinceLastActivity > IDLE_THRESHOLD_MS) {
    status = 'idle';
  } else {
    status = 'running';
  }

  const todos = extractTodos(messages);
  const subAgents = extractSubAgentCalls(messages);
  const commits = extractCommits(messages);

  // Merge subtasks, deduplicate by source+title
  const allSubtasks = [...todos, ...subAgents, ...commits];

  return {
    sessionId,
    title: extractTitle(messages),
    status,
    turnCount: assistantTurns,
    completionSummary: excerpt,
    lastActivityAt: new Date(lastMtime).toISOString(),
    startedAt: new Date(firstMtime === Infinity ? lastMtime : firstMtime).toISOString(),
    endedAt,
    resultOk: resultInfo.found ? resultInfo.ok : undefined,
    cwd: extractCwd(messages),
    subtasks: allSubtasks,
  };
}

async function apiPost(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API ${path} failed: ${res.status} ${text}`);
  }
  return res.json();
}

async function apiPatch(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API PATCH ${path} failed: ${res.status} ${text}`);
  }
  return res.json();
}

async function processSession(sessionId: string, sessionPath: string): Promise<void> {
  const info = analyzeSession(sessionPath, sessionId);
  if (!info) return;

  try {
    // Upsert the task_run
    await apiPost('/task-runs', {
      session_id: info.sessionId,
      title: info.title,
      kind: 'task',
      cwd: info.cwd,
      started_at: info.startedAt,
    });

    // Update status/progress
    await apiPatch(`/task-runs/${info.sessionId}`, {
      status: info.status,
      turn_count: info.turnCount,
      last_activity_at: info.lastActivityAt,
      completion_summary: info.completionSummary,
      ended_at: info.endedAt ?? null,
      result_ok: info.resultOk ?? null,
    });

    // Upsert subtasks
    for (const subtask of info.subtasks) {
      await apiPost(`/task-runs/${info.sessionId}/subtasks`, {
        ordinal: subtask.ordinal,
        title: subtask.title,
        status: subtask.status,
        source: subtask.source,
        evidence_kind: subtask.evidenceKind,
        evidence_value: subtask.evidenceValue,
      }).catch(() => { /* ignore subtask upsert failures */ });
    }

    // Emit stall event if newly stalled
    if (info.status === 'stalled') {
      await apiPost(`/task-runs/${info.sessionId}/events`, {
        event_kind: 'stall_detected',
        excerpt: info.completionSummary,
        payload: { turn_count: info.turnCount },
      }).catch(() => { /* ignore */ });
    }
  } catch (err) {
    // API might not be running — silently continue
    log.debug('failed to process session', { sessionId, err: err instanceof Error ? err.message : String(err) });
  }
}

async function scanAllSessions(): Promise<void> {
  if (!fs.existsSync(SESSIONS_DIR)) {
    log.debug('sessions dir not found', { sessions_dir: SESSIONS_DIR });
    return;
  }

  let entries: string[] = [];
  try {
    entries = fs.readdirSync(SESSIONS_DIR);
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(SESSIONS_DIR, entry);
    // Session dirs are named like 'local_abc123' or have UUID-style names
    const sessionId = entry.replace(/\.jsonl$/, '');
    await processSession(sessionId, fullPath);
  }
}

async function main(): Promise<void> {
  log.info('starting', { api_base: API_BASE, sessions_dir: SESSIONS_DIR });

  if (isBackfill) {
    log.info('running backfill');
    await scanAllSessions();
    log.info('backfill complete');
    if (!isOnce) process.exit(0);
  }

  if (isOnce) {
    await scanAllSessions();
    process.exit(0);
  }

  // Continuous polling
  const poll = async () => {
    try {
      await scanAllSessions();
    } catch (err) {
      log.debug('poll error', { err: err instanceof Error ? err.message : String(err) });
    }
  };

  await poll();
  setInterval(poll, POLL_INTERVAL_MS);

  // Keep process alive
  process.on('SIGTERM', () => process.exit(0));
  process.on('SIGINT', () => process.exit(0));
}

main().catch(err => {
  log.fatal('fatal error', { err: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
