#!/usr/bin/env node
/**
 * caia-reuse-search-mcp — minimal MCP server exposing @caia/reuse-searcher
 * as the tool `search_reuse_candidates(brief, topN?)`.
 *
 * Speaks JSON-RPC 2.0 over stdio. Implements the MCP `initialize`, `tools/list`
 * and `tools/call` methods. Kept dependency-free (no @modelcontextprotocol/sdk
 * needed at install-time) so this package stays buildable in the workspace
 * without external installs.
 *
 * Layer L3 of the reuse-first guardrail (ADR-065).
 */

import { searchReuseCandidates, type RankedCandidate } from "@caia/reuse-searcher";

const PROTOCOL_VERSION = "2024-11-05";
const SERVER_INFO = { name: "caia-reuse-search-mcp", version: "0.1.0" };

interface JsonRpcReq {
  jsonrpc: "2.0";
  id?: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcRes {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

const TOOLS = [
  {
    name: "search_reuse_candidates",
    description:
      "Search @caia/* / @chiefaia/* / @stolution/* / @pokerzeno/* workspace packages for prior art that could be reused for a task brief. Returns a ranked list of candidate packages with match scores and reasons. ALWAYS call this before spawning a code task — the candidates should be injected into the spawned agent's prompt. Layer L3 of the reuse-first guardrail (ADR-065).",
    inputSchema: {
      type: "object",
      required: ["brief"],
      properties: {
        brief: {
          type: "string",
          description: "Free-form description of what the code task will do. Tokenized + matched against the package index.",
        },
        topN: {
          type: "integer",
          description: "Maximum candidates to return. Default 10.",
          minimum: 1,
          maximum: 100,
        },
        packagesRoot: {
          type: "string",
          description: "Override the packages directory. Default resolves to <cwd>/packages.",
        },
      },
    },
  },
] as const;

function formatResult(candidates: readonly RankedCandidate[]): string {
  if (candidates.length === 0) {
    return "No reuse candidates found. Confirm with the operator before writing new code from scratch.";
  }
  const lines: string[] = ["# Reuse candidates (search before you write)", ""];
  for (const c of candidates) {
    lines.push(
      `- **${c.packageName}** (score ${c.matchScore})`,
      `  - ${c.description || "(no description)"}`,
      `  - Reasons: ${c.matchReasons.join("; ") || "(none recorded)"}`,
      ""
    );
  }
  lines.push(
    "Decide for each: (a) consume as-is, (b) extend it (a PR to that package), (c) reject with a written reason recorded in the plan's `reuseSearchResults` field. New from-scratch code is the last resort."
  );
  return lines.join("\n");
}

async function handle(req: JsonRpcReq): Promise<JsonRpcRes | null> {
  const id = req.id ?? null;
  if (req.method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      },
    };
  }
  if (req.method === "tools/list") {
    return { jsonrpc: "2.0", id, result: { tools: TOOLS } };
  }
  if (req.method === "tools/call") {
    const params = (req.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
    if (params.name !== "search_reuse_candidates") {
      return { jsonrpc: "2.0", id, error: { code: -32601, message: `unknown tool: ${String(params.name)}` } };
    }
    const args = params.arguments ?? {};
    const brief = typeof args.brief === "string" ? args.brief : "";
    const topN = typeof args.topN === "number" ? args.topN : 10;
    const packagesRoot = typeof args.packagesRoot === "string" ? args.packagesRoot : undefined;
    try {
      const opts: Parameters<typeof searchReuseCandidates>[1] = { topN };
      if (packagesRoot) opts.packagesRoot = packagesRoot;
      const candidates = await searchReuseCandidates(brief, opts);
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: formatResult(candidates) }],
          isError: false,
        },
      };
    } catch (e) {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: `reuse-searcher error: ${(e as Error).message}` }],
          isError: true,
        },
      };
    }
  }
  if (req.id === undefined) return null; // notification — no reply
  return { jsonrpc: "2.0", id, error: { code: -32601, message: `method not found: ${req.method}` } };
}

async function main(): Promise<void> {
  let buffer = "";
  process.stdin.setEncoding("utf-8");
  process.stdin.on("data", (chunk: string) => {
    buffer += chunk;
    let nl: number;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      void (async () => {
        try {
          const req = JSON.parse(line) as JsonRpcReq;
          const res = await handle(req);
          if (res) process.stdout.write(JSON.stringify(res) + "\n");
        } catch (e) {
          process.stderr.write(`parse error: ${(e as Error).message}\n`);
        }
      })();
    }
  });
  process.stdin.on("end", () => process.exit(0));
}

void main();
