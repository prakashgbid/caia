/**
 * Rich parser for `claude --print --output-format json` output.
 *
 * The basic parser in dispatcher.ts extracts session_id / resultOk / costUsd / turnCount
 * from the final "result" line.  This parser extracts the deeper telemetry:
 *   - Every tool_use block → ClaudeToolCall list
 *   - Cumulative token usage from usage fields
 *   - Files that were written/edited
 *
 * Claude --output-format json emits JSONL: one JSON object per line.
 * Line types we care about:
 *   { type: "assistant", message: { role: "assistant", content: [...], usage: {...} } }
 *   { role: "assistant", content: [...], usage: {...} }  (alternate flat format)
 *   { type: "result", usage: { input_tokens, output_tokens, ... } }
 */

export interface ClaudeToolCall {
  name: string;
  inputSummary: string;
  sequenceIndex: number;
}

export interface ParsedClaudeOutputRich {
  toolCalls: ClaudeToolCall[];
  inputTokens: number;
  outputTokens: number;
  filesChanged: string[];
  toolCallCount: number;
}

/** Tools whose invocation writes or modifies a file on disk. */
const FILE_MODIFYING_TOOLS = new Set([
  'Write', 'Edit', 'MultiEdit', 'Create', 'NotebookEdit',
]);

export function parseClaudeOutputRich(lines: string[]): ParsedClaudeOutputRich {
  const toolCalls: ClaudeToolCall[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  const filesChangedSet = new Set<string>();

  for (const line of lines) {
    if (!line.trim()) continue;

    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue; // skip non-JSON (plain text progress lines, etc.)
    }

    // --- Streaming JSONL format: { type: "assistant", message: { content: [...], usage: {} } } ---
    if (obj['type'] === 'assistant' && obj['message'] != null && typeof obj['message'] === 'object') {
      const msg = obj['message'] as Record<string, unknown>;
      extractToolCalls(msg, toolCalls, filesChangedSet);
      accumulateUsage(msg['usage'], { inputTokens, outputTokens }, (u) => {
        inputTokens = u.inputTokens;
        outputTokens = u.outputTokens;
      });
    }

    // --- Flat format: { role: "assistant", content: [...], usage: {} } ---
    if (obj['role'] === 'assistant' && obj['content'] != null) {
      extractToolCalls(obj, toolCalls, filesChangedSet);
      accumulateUsage(obj['usage'], { inputTokens, outputTokens }, (u) => {
        inputTokens = u.inputTokens;
        outputTokens = u.outputTokens;
      });
    }

    // --- Result / final summary line: { type: "result", usage: { ... } } ---
    if ((obj['type'] === 'result' || obj['subtype'] === 'success') && obj['usage'] != null) {
      // The result line's usage is the authoritative total
      accumulateUsage(obj['usage'], { inputTokens, outputTokens }, (u) => {
        inputTokens = u.inputTokens;
        outputTokens = u.outputTokens;
      });
    }
  }

  return {
    toolCalls,
    inputTokens,
    outputTokens,
    filesChanged: [...filesChangedSet],
    toolCallCount: toolCalls.length,
  };
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function extractToolCalls(
  msg: Record<string, unknown>,
  toolCalls: ClaudeToolCall[],
  filesChangedSet: Set<string>,
): void {
  const content = msg['content'];
  if (!Array.isArray(content)) return;

  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const b = block as Record<string, unknown>;
    if (b['type'] !== 'tool_use') continue;

    const name = String(b['name'] ?? 'unknown');
    const input = (b['input'] ?? {}) as Record<string, unknown>;

    toolCalls.push({
      name,
      inputSummary: JSON.stringify(input).slice(0, 500),
      sequenceIndex: toolCalls.length,
    });

    // Track writes / edits
    if (FILE_MODIFYING_TOOLS.has(name)) {
      const filePath = (input['file_path'] ?? input['path']) as string | undefined;
      if (filePath) filesChangedSet.add(filePath);
    }
  }
}

function accumulateUsage(
  usage: unknown,
  current: { inputTokens: number; outputTokens: number },
  set: (u: { inputTokens: number; outputTokens: number }) => void,
): void {
  if (!usage || typeof usage !== 'object') return;
  const u = usage as Record<string, unknown>;
  const inp = u['input_tokens'];
  const out = u['output_tokens'];
  set({
    // Take the max for input (cumulative caching can cause earlier lines to show larger numbers)
    inputTokens: inp != null ? Math.max(current.inputTokens, Number(inp)) : current.inputTokens,
    // Sum output tokens across turns
    outputTokens: out != null ? current.outputTokens + Number(out) : current.outputTokens,
  });
}
