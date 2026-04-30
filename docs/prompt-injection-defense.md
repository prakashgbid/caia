# Prompt-injection defense (operator runbook)

Implements third-party-paper §C.7 + v2 §5.2.4. Source:
`packages/tool-output-sanitizer/`.

## Why

Every MCP / HTTP / file-read response is potentially attacker-controlled
input. A malicious GitHub PR comment, a poisoned npm README, a
user-uploaded markdown file, a web page fetched by a browser tool,
OCR'd screen content from `computer-use` — any of these can flow into
the agent's context window unchecked. Production incidents documented
in 2025 (PromptArmor, Lakera Gandalf, OWASP LLM Top-10) confirm the
attack class is real and exploitable.

The `@chiefaia/tool-output-sanitizer` package is the deterministic
floor. Every tool result passes through `sanitizeToolResult` before
being added to context.

## Two strictness levels

| Strictness | Where | Behaviour |
|------------|-------|-----------|
| `paranoid` (default) | Web fetches, browser/computer-use OCR, third-party MCPs, user uploads | Strips control tokens, flags injection-shaped prose, rejects entire payload on high-risk hits |
| `lenient`            | First-party vendored MCPs (`mac-mcp`, `stolution-remote`)              | Strips control tokens; flags suspect prose without rejecting |

## What gets stripped, flagged, or rejected

`packages/tool-output-sanitizer/src/patterns.ts` is the source of truth.
Catalogue summary:

- **Stripped (action removes the match, payload continues):**
  - XML role tags: `<system>` / `</system>`, `<user>`, `<assistant>`.
  - Llama instruction blocks: `[INST]`, `[/INST]`.
  - ANSI escape sequences (`[31m`, etc.) — terminal-injection vector.
  - Zero-width Unicode (`U+200B`–`U+200D`, `U+2060`, `U+FEFF`,
    `U+E0000`–`U+E007F` tag block) — steganographic prompt smuggling.
- **Flagged (intact, but recorded):**
  - "Ignore / disregard / forget / override … previous / prior / above /
    earlier instructions" family.
  - "You are now …" role-shift.
  - "Pretend / Act as DAN / Do Anything Now" jailbreak templates.
  - "### System:" / "System:" line prefixes.
  - Inline `mcpServers` config blobs, `register_tool` / `new_tool` calls.
  - Long base64 blobs (>256 chars).
- **Rejected (entire payload replaced with sanitized stub):**
  - Reserved for the highest-risk patterns; see `patterns.ts` (no
    patterns currently default to `reject` in the OWASP LLM Top-10
    seed corpus, but the action is wired so operators can add custom
    rules without code changes).

Every flag carries an `id`, `description`, `action` (`stripped` /
`flagged` / `rejected` / `truncated`), and `matchCount`. The orchestrator
records flags into `audit_log` with `kind = 'tool_output_rejected'` so
the dashboard's "Tool output rejected" page can render the timeline.

## Adversarial regression corpus

`packages/tool-output-sanitizer/corpus/owasp-llm-top10.json` carries the
seed corpus drawn from OWASP LLM Top-10 (2026-04 edition), Lakera
Gandalf, and PromptArmor incident reports. Every sample is paired with
its `expectedFlag`. The sanitizer test suite asserts every sample trips
its expected pattern; this is the §3.9 regression gate.

The DoD will add (item 15): "agent-touching changes pass adversarial-
injection regression suite." See `feedback_definition_of_done.md` after
the safety-hardening release lands.

## API

```ts
import { sanitizeToolResult, sanitizeMcpToolResult } from '@chiefaia/tool-output-sanitizer';

// 1. Generic — accepts any unknown input.
const r = sanitizeToolResult(rawResult, { strictness: 'paranoid' });
//   r.payload   — text safe to feed back into the agent
//   r.flags     — array of { id, description, action, matchCount }
//   r.rejected  — true if payload was replaced with a stub
//   r.truncated — true if payload exceeded maxLength

// 2. MCP shape — walks each `content[].text` block.
const m = sanitizeMcpToolResult(mcpResponse, { strictness: 'lenient' });
```

## Wiring into CAIA

The Claude SDK harness wrapper (orchestrator-side) is where every tool
result enters the model's context. The sanitizer runs there:

```ts
// inside the harness — pseudo-code
const raw = await runTool(name, args);
const sanitized = strictness === 'paranoid'
  ? sanitizeToolResult(raw, { strictness: 'paranoid' })
  : sanitizeMcpToolResult(raw, { strictness: 'lenient' });
if (sanitized.flags.length) {
  auditLog.append({
    kind: 'tool_output_rejected', // or 'tool_output_flagged'
    payload: { tool: name, flags: sanitized.flags },
  });
  dashboardCounter.inc('tool_output_flags', sanitized.flags.length);
}
return sanitized.payload;
```

For computer-use OCR / browser fetches — always `paranoid`.
For first-party MCPs (mac-mcp, stolution-remote) — `lenient` is fine
because the worktree-local outputs we control don't carry attacker
content; the broker + sandbox already constrain what the MCP can do.

## Reference

- Source: `packages/tool-output-sanitizer/src/`.
- Tests: `packages/tool-output-sanitizer/tests/sanitizer.test.ts` (28).
- Corpus: `packages/tool-output-sanitizer/corpus/owasp-llm-top10.json`.
- Paper §C.7: `~/Documents/projects/reports/third-party-caia-paper-analysis-2026-04-29.md`.
- Related: `caia/docs/mcp-security.md`.
