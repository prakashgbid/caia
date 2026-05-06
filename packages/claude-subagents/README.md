# `@chiefaia/claude-subagents`

CAIA-flavoured Claude Code subagent definitions + installer. Wave 1.1 of the **Enterprise Wave 1** campaign per `agent/memory/enterprise_ai_landscape_directive.md`.

## What it ships

10 canonical CAIA subagent system prompts under `agents/`:

| Name | Tier | Model | Role |
|------|------|-------|------|
| `caia-po` | 2 | sonnet | Product Owner — classify + decompose |
| `caia-ba` | 2 | sonnet | Business Analyst — enrich draft stories |
| `caia-ea` | 3 | opus | Enterprise Architect — architecture decisions |
| `caia-validator` | 3 | sonnet | Story Validator — DoD enforcement |
| `caia-test-design` | 3 | sonnet | Test Designer — pre-implementation test plan |
| `caia-coding` | 4 | sonnet | Coding Worker — end-to-end implementation |
| `caia-fix-it` | 4 | sonnet | Fix-It Agent — repair red CI |
| `caia-steward` | 4 | sonnet | Steward Gatekeeper — 15-failure-mode analysis |
| `caia-mentor` | 5 | sonnet | Mentor — post-incident lesson capture |
| `caia-curator` | 5 | sonnet | Curator — daily proactive quality scan |

Each definition is a Claude Code-compatible `.md` file with frontmatter (`name`, `description`, `tools`, `model`) plus a system prompt body.

## Installation

```bash
# All shipped subagents → ~/.claude/agents/
caia-claude-subagents install

# Subset only
caia-claude-subagents install --only caia-coding,caia-validator

# Custom target dir (for project-local overrides)
caia-claude-subagents install --target ./.claude/agents/

# Force overwrite of existing files (idempotent without --force)
caia-claude-subagents install --force
```

## Verification

```bash
caia-claude-subagents verify
# → exits 0 when every shipped file is present + matches
# → exits 2 when any file is missing or has drifted
```

## How it composes with the existing CAIA agent system

The TS-implemented `BAAgent` / `EAAgent` / `Validator` etc. inside `apps/orchestrator/src/agents/*.ts` are the in-process orchestration layer. These subagent definitions are the LLM-side delegate prompts — when a spawned `claude -p` worker (or interactive Claude Code session) needs to delegate a sub-task (e.g., enriching a story, designing a test plan), it invokes the corresponding subagent via the Task tool with `subagent_type: "caia-<role>"`.

This composition pattern follows Anthropic's published multi-agent research result (+90.2% over single-Opus, ~80% of variance attributable to token usage / decomposition). See `agent/memory/enterprise_ai_landscape_directive.md` §W1-1.

## Programmatic API

```ts
import { installSubagents, verifyInstalled, MANIFEST } from '@chiefaia/claude-subagents';

const result = installSubagents({ force: true });
console.log(`Installed ${result.writtenCount + result.overwrittenCount} subagents`);

const check = verifyInstalled();
if (!check.ok) {
  console.warn(`Drift detected: ${check.driftedCount} drifted, ${check.missingCount} missing`);
}

console.log(MANIFEST.entries.map((e) => e.name));
```

## Constraints honoured

- Subscription-only LLM (no API keys); the subagent definitions tell Claude Code which model to prefer (`sonnet` / `opus`), but execution is via the user's `claude` CLI under their subscription.
- Mac M-series 16GB primary surface — no install-time native deps.
- Idempotent installer — content-aware skip on re-run.
- Library-first per ADR-001 + ADR-002.
- No browser storage / runtime persistence — everything is filesystem-backed.

## Adding a new subagent

1. Drop the `.md` file under `agents/` with valid frontmatter.
2. Add the manifest entry in `src/manifest.ts`.
3. `pnpm build`; `pnpm test`.
4. `caia-claude-subagents install --force` to refresh.
