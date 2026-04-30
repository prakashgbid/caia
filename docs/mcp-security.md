# MCP security (operator runbook)

Hardens CAIA's MCP attack surface against the 2025–2026 CVE family.
Implements third-party-paper §C.3 + v2 §5.2 (April 2026 update).

Source:
- `packages/mcp-allowlist-proxy/`
- `packages/tool-output-sanitizer/`
- `caia/scripts/mcp-sandbox.sb`
- `vendored-mcp/`

## CVE history this hardens against

| CVE                | Title                                                                   | Mitigation in this PR |
|--------------------|-------------------------------------------------------------------------|------------------------|
| CVE-2025-6514      | mcp-remote RCE via crafted authorization endpoint URL                   | sandbox-exec, allowlist proxy |
| CVE-2025-54135     | CurXecute — prompt-injection-driven mcp.json modification               | settings-file write deny-list |
| CVE-2025-53967     | Figma MCP code execution path                                           | spawn-command allowlist + per-tool args constraints |
| CVE-2025-68143     | mcp-server-git RCE via malicious .git/config (CVSS 10/10)               | filesystem deny-list + sandbox profile |
| CVE-2025-68144     | mcp-server-git companion vector                                         | "                                              " |
| CVE-2025-68145     | mcp-server-git companion vector                                         | "                                              " |
| CVE-2026-23744     | MCPJam Inspector binds 0.0.0.0 by default                               | `assertNoPublicBind` rejects 0.0.0.0 / [::] tokens at spawn |
| OX-2026-04-15      | Anthropic MCP-SDK systemic command injection (Cursor / VS Code / Windsurf / Claude Code / Gemini-CLI / Copilot) | litellm-style `MCP_STDIO_ALLOWED_COMMANDS` allowlist re-validated at every spawn |

The OX disclosure landed April 15 2026; Anthropic declined to patch
upstream (calls the behaviour "expected"), so the responsibility falls
on every host. CAIA's host-side mitigation is the four-layer defense
below.

## Four layers of defense

```
agent  ──JSON-RPC──▶  allowlist-proxy  ──validated args──▶  spawn guard  ──sandbox-exec──▶  MCP server
                            │                                    │              │
                            │                                    ▼              ▼
                            │                       MCP_STDIO_ALLOWED_   mcp-sandbox.sb
                            │                       COMMANDS (litellm)  (deny-default)
                            ▼
                            tool-output-sanitizer ◀── response from MCP
                            (strips role markers, [INST], zero-width,
                             ANSI escapes, tool-redefinition payloads)
                            ▼
                  agent context window
```

1. **Allowlist proxy** (`@chiefaia/mcp-allowlist-proxy`).
   - Rejects unknown tool names.
   - Validates per-tool argument constraints (regex / enum / maxLength /
     forbid).
   - Enforces per-task `maxPerTask` budgets.
   - Returns `-32001` JSON-RPC error frames verbatim to the agent.
2. **Spawn-command allowlist** (`assertSpawnCommandAllowed`).
   - litellm canonical list — `npx`, `uvx`, `python`, `python3`, `node`,
     `docker`, `deno`. Configurable via `MCP_STDIO_ALLOWED_COMMANDS`.
   - Re-validated at every spawn (not just config-load), so a malicious
     `mcp.json` injection that points at `bash` is still rejected.
3. **Public-bind guard** (`assertNoPublicBind`).
   - Rejects any spawn whose args contain `0.0.0.0`, `[::]`, `--host=…`,
     etc. mapped to a wildcard. Force 127.0.0.1 / ::1 only.
4. **macOS sandbox-exec profile** (`caia/scripts/mcp-sandbox.sb`).
   - Deny-default. Reads allowed only inside the worktree + cache dir
     + system OS paths + npm/pnpm caches. Writes only inside
     worktree/cache. Exec only of node/python/sh/env. Network only
     localhost + DNS + outbound TCP (further pinned by the proxy).
   - On non-Darwin hosts, the wrapper is a no-op (the proxy + spawn
     guards still apply).

Plus the application-layer **tool-output-sanitizer**
(`@chiefaia/tool-output-sanitizer`) — every MCP/HTTP/file-read response
runs through it before reaching the agent's context. See
`caia/docs/prompt-injection-defense.md`.

## Vendoring

`vendored-mcp/<name>/` is the canonical location for any MCP we don't
trust the maintainer to ship safely. Each subdirectory carries a
`PINNED_COMMIT` file with the upstream SHA we audited. CI workflow
`.github/workflows/mcp-vendored-verify.yml` checks pinning + reproducible
build on every PR that touches `vendored-mcp/**`.

## In-use MCP inventory

| MCP                  | Trust tier                | Pinned ref / hash | Notes |
|----------------------|---------------------------|-------------------|-------|
| `mac-mcp`            | first-party-caia          | `44d92f1b…0010ab7e` (server.py SHA-256, truncated to 40) | Local Python, full host privileges absent the sandbox |
| `stolution-remote`   | first-party-caia          | placeholder — pin remote SHA at next sync | SSH to s903; add reverse-proxy host pinning |
| `figma`              | third-party-vendored      | placeholder — pin upstream `@anthropic/mcp-figma` SHA at vendor time | Move under `vendored-mcp/figma/` next |

Policies live at `packages/mcp-allowlist-proxy/policies/<name>.json`. The
operator updates these (and a corresponding ADR) any time a server is
upgraded or its trust tier changes.

## CurXecute mitigation — settings-file write deny-list

`@chiefaia/mcp-allowlist-proxy` exports `assertSettingsPathNotForbidden(path)`.
The orchestrator wires this into every tool that accepts a `path`
argument (`mac_write_file`, `stolution_write_file`, fs/edit, etc.).
Forbidden globs:

- `**/mcp.json`, `**/.mcp.json`
- `**/.cursor/mcp.json`
- `**/.continue/config.json`
- `**/.vscode/settings.json`
- Claude Desktop config under `Library/Application Support/Claude/` and
  `.config/claude/`

`.claude/settings.json` is reserved for an additive-merge capability
the broker brokers explicitly (Item 1 §C.1 follow-up). Direct writes to
it from arbitrary tools remain denied.

## Allowlist proxy — concrete behaviour

Given a `tools/call` JSON-RPC frame:

```json
{
  "jsonrpc": "2.0",
  "id": 17,
  "method": "tools/call",
  "params": {
    "name": "mac_read_file",
    "arguments": { "path": "../etc/secret" }
  }
}
```

…and a policy where `mac_read_file.argsConstraints.path` is
`{"kind":"regex","pattern":"^/Users/.+"}`, the proxy emits:

```json
{
  "jsonrpc": "2.0",
  "id": 17,
  "error": {
    "code": -32001,
    "message": "mcp-allowlist-proxy: arg 'path'='../etc/secret' does not match required pattern /^/Users/.+/"
  }
}
```

— and never forwards.

## Reference

- Source: `packages/mcp-allowlist-proxy/src/`,
  `packages/tool-output-sanitizer/src/`.
- Tests: `packages/mcp-allowlist-proxy/tests/` (37),
  `packages/tool-output-sanitizer/tests/` (28).
- Sandbox profile: `caia/scripts/mcp-sandbox.sb`.
- Policies: `packages/mcp-allowlist-proxy/policies/`.
- Vendored sources: `vendored-mcp/`.
- Paper analysis: `~/Documents/projects/reports/third-party-caia-paper-analysis-2026-04-29.md` §C.3.
- v2 update: see user prompt 2026-04-29 (sequencing change + litellm allowlist + 0.0.0.0 rejection).
- litellm canonical fix: https://docs.litellm.ai/blog/mcp-stdio-command-injection-april-2026
- OX disclosure: https://www.ox.security/blog/the-mother-of-all-ai-supply-chains-critical-systemic-vulnerability-at-the-core-of-the-mcp/
- The Register coverage: https://www.theregister.com/2026/04/16/anthropic_mcp_design_flaw/
