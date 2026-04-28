#!/usr/bin/env node
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// index.ts
var fs = __toESM(require("fs"), 1);
var path = __toESM(require("path"), 1);
var os = __toESM(require("os"), 1);
var API_BASE = process.env["CONDUCTOR_API"] ?? "http://localhost:7776";
var SESSIONS_DIR = process.env["CLAUDE_SESSIONS_DIR"] ?? path.join(os.homedir(), "Library", "Application Support", "Claude", "local-agent-mode-sessions");
var POLL_INTERVAL_MS = 3e4;
var STALL_THRESHOLD_MS = 15 * 60 * 1e3;
var IDLE_THRESHOLD_MS = 2 * 60 * 1e3;
var isBackfill = process.argv.includes("--backfill");
var isOnce = process.argv.includes("--once");
function readJsonlMessages(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split("\n").filter((l) => l.trim());
    const messages = [];
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (parsed && typeof parsed === "object" && "role" in parsed) {
          messages.push(parsed);
        }
      } catch {
      }
    }
    return messages;
  } catch {
    return [];
  }
}
function extractTitle(messages) {
  for (const msg of messages) {
    if (msg.role === "user") {
      const text = typeof msg.content === "string" ? msg.content : msg.content.find((c) => c.type === "text")?.text ?? "";
      const trimmed = text.trim().slice(0, 120);
      if (trimmed) return trimmed;
    }
  }
  return "Unnamed session";
}
function extractCwd(messages) {
  for (const msg of messages) {
    if (typeof msg.content === "string" && msg.content.includes("cwd")) {
      const match = msg.content.match(/cwd[:\s]+([^\s,\n"]+)/i);
      if (match?.[1]) return match[1];
    }
  }
  return void 0;
}
function hasResultLine(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "assistant") {
      const text = typeof msg.content === "string" ? msg.content : msg.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
      if (text.includes("[result]") || text.includes("Task complete") || text.toLowerCase().includes("completed successfully")) {
        return { found: true, text: text.slice(0, 500), ok: !text.toLowerCase().includes("failed") && !text.toLowerCase().includes("error") };
      }
    }
  }
  return { found: false, text: "", ok: false };
}
function extractLastAssistantExcerpt(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "assistant") {
      const text = typeof msg.content === "string" ? msg.content : msg.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
      if (text.trim()) return text.trim().slice(0, 500);
    }
  }
  return "";
}
function extractTodos(messages) {
  const todos = /* @__PURE__ */ new Map();
  let ordinal = 0;
  for (const msg of messages) {
    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === "tool_use" && part.name === "TodoWrite") {
          const input = part.input;
          if (input?.todos) {
            for (const todo of input.todos) {
              const key = todo.id ?? todo.content.slice(0, 80);
              if (!todos.has(key)) {
                todos.set(key, {
                  ordinal: ordinal++,
                  title: todo.content.slice(0, 200),
                  status: todo.status === "completed" ? "done" : todo.status === "in_progress" ? "pending" : "pending",
                  source: "todo"
                });
              } else {
                const existing = todos.get(key);
                existing.status = todo.status === "completed" ? "done" : todo.status === "in_progress" ? "pending" : existing.status;
              }
            }
          }
        }
      }
    }
  }
  return Array.from(todos.values());
}
function extractSubAgentCalls(messages) {
  const calls = [];
  let ordinal = 1e3;
  for (const msg of messages) {
    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === "tool_use" && part.name === "Task") {
          const input = part.input;
          const title = input?.description ?? (input?.prompt?.slice(0, 100) ?? "Sub-agent call");
          calls.push({
            ordinal: ordinal++,
            title,
            status: "done",
            // if we see it in transcript, it was invoked
            source: "sub_agent",
            evidenceKind: "none"
          });
        }
      }
    }
  }
  return calls;
}
function extractCommits(messages) {
  const commits = [];
  let ordinal = 2e3;
  for (const msg of messages) {
    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === "tool_use" && part.name === "Bash") {
          const input = part.input;
          const cmd = input?.command ?? "";
          const commitMatch = cmd.match(/git commit[^"]*"([^"]+)"/);
          if (commitMatch?.[1]) {
            commits.push({
              ordinal: ordinal++,
              title: `commit: ${commitMatch[1].slice(0, 100)}`,
              status: "done",
              source: "commit",
              evidenceKind: "commit_sha"
            });
          }
        }
      }
    }
  }
  return commits;
}
function analyzeSession(sessionDir, sessionId) {
  let files = [];
  try {
    files = fs.readdirSync(sessionDir).filter((f) => f.endsWith(".jsonl") || f === "transcript.jsonl").map((f) => path.join(sessionDir, f));
  } catch {
    return null;
  }
  const directFile = `${sessionDir}.jsonl`;
  if (fs.existsSync(directFile)) files.push(directFile);
  if (sessionDir.endsWith(".jsonl") && fs.existsSync(sessionDir)) {
    files = [sessionDir];
  }
  if (files.length === 0) {
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
  const messages = [];
  let lastMtime = 0;
  let firstMtime = Infinity;
  for (const f of files) {
    try {
      const stat = fs.statSync(f);
      lastMtime = Math.max(lastMtime, stat.mtimeMs);
      firstMtime = Math.min(firstMtime, stat.birthtimeMs || stat.ctimeMs);
      messages.push(...readJsonlMessages(f));
    } catch {
    }
  }
  if (messages.length === 0) return null;
  const now = Date.now();
  const timeSinceLastActivity = now - lastMtime;
  const resultInfo = hasResultLine(messages);
  const assistantTurns = messages.filter((m) => m.role === "assistant").length;
  const excerpt = extractLastAssistantExcerpt(messages);
  let status;
  let endedAt;
  if (resultInfo.found) {
    status = "completed";
    endedAt = new Date(lastMtime).toISOString();
  } else if (timeSinceLastActivity > STALL_THRESHOLD_MS) {
    status = "stalled";
  } else if (timeSinceLastActivity > IDLE_THRESHOLD_MS) {
    status = "idle";
  } else {
    status = "running";
  }
  const todos = extractTodos(messages);
  const subAgents = extractSubAgentCalls(messages);
  const commits = extractCommits(messages);
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
    resultOk: resultInfo.found ? resultInfo.ok : void 0,
    cwd: extractCwd(messages),
    subtasks: allSubtasks
  };
}
async function apiPost(path2, body) {
  const res = await fetch(`${API_BASE}${path2}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${path2} failed: ${res.status} ${text}`);
  }
  return res.json();
}
async function apiPatch(path2, body) {
  const res = await fetch(`${API_BASE}${path2}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API PATCH ${path2} failed: ${res.status} ${text}`);
  }
  return res.json();
}
async function processSession(sessionId, sessionPath) {
  const info = analyzeSession(sessionPath, sessionId);
  if (!info) return;
  try {
    await apiPost("/task-runs", {
      session_id: info.sessionId,
      title: info.title,
      kind: "task",
      cwd: info.cwd,
      started_at: info.startedAt
    });
    await apiPatch(`/task-runs/${info.sessionId}`, {
      status: info.status,
      turn_count: info.turnCount,
      last_activity_at: info.lastActivityAt,
      completion_summary: info.completionSummary,
      ended_at: info.endedAt ?? null,
      result_ok: info.resultOk ?? null
    });
    for (const subtask of info.subtasks) {
      await apiPost(`/task-runs/${info.sessionId}/subtasks`, {
        ordinal: subtask.ordinal,
        title: subtask.title,
        status: subtask.status,
        source: subtask.source,
        evidence_kind: subtask.evidenceKind,
        evidence_value: subtask.evidenceValue
      }).catch(() => {
      });
    }
    if (info.status === "stalled") {
      await apiPost(`/task-runs/${info.sessionId}/events`, {
        event_kind: "stall_detected",
        excerpt: info.completionSummary,
        payload: { turn_count: info.turnCount }
      }).catch(() => {
      });
    }
  } catch (err) {
    if (process.env["DEBUG"]) {
      console.error(`[poller] Failed to process ${sessionId}:`, err instanceof Error ? err.message : err);
    }
  }
}
async function scanAllSessions() {
  if (!fs.existsSync(SESSIONS_DIR)) {
    if (process.env["DEBUG"]) {
      console.log(`[poller] Sessions dir not found: ${SESSIONS_DIR}`);
    }
    return;
  }
  let entries = [];
  try {
    entries = fs.readdirSync(SESSIONS_DIR);
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = path.join(SESSIONS_DIR, entry);
    const sessionId = entry.replace(/\.jsonl$/, "");
    await processSession(sessionId, fullPath);
  }
}
async function main() {
  console.log(`[conductor-task-run-poller] Starting. API: ${API_BASE}, Sessions: ${SESSIONS_DIR}`);
  if (isBackfill) {
    console.log("[conductor-task-run-poller] Running backfill...");
    await scanAllSessions();
    console.log("[conductor-task-run-poller] Backfill complete.");
    if (!isOnce) process.exit(0);
  }
  if (isOnce) {
    await scanAllSessions();
    process.exit(0);
  }
  const poll = async () => {
    try {
      await scanAllSessions();
    } catch (err) {
      if (process.env["DEBUG"]) {
        console.error("[poller] Poll error:", err instanceof Error ? err.message : err);
      }
    }
  };
  await poll();
  setInterval(poll, POLL_INTERVAL_MS);
  process.on("SIGTERM", () => process.exit(0));
  process.on("SIGINT", () => process.exit(0));
}
main().catch((err) => {
  console.error("[conductor-task-run-poller] Fatal:", err);
  process.exit(1);
});
