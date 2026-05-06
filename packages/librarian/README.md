# @chiefaia/librarian — pre-spawn precedent retrieval (Phase 1)

Librarian is the Tier-A operator-replacement agent that organizes ALL prior decisions (good and bad) and surfaces them as the orchestrator spawns each new task. Distinct from Mentor (mistake-driven; surfaces *lessons*) and Apprentice (model-trained; not yet built), Librarian provides *precedent* retrieval — "here's what we already decided" rather than "here's what bit us".

Together with Mentor's pre-spawn lesson injection, the orchestrator pipeline brackets every new task with both layers of context:

```
echo "$ORIGINAL_PROMPT" | caia-mentor-prepend | caia-librarian-prepend
   ↓
Precedent from prior decisions — for context:
  1. master_backlog_sequencing_2026-05-05 (kind=master, similarity=0.681)
     <8-line snippet>
  2. enterprise-wave-1-leg-1-handoff (kind=report, similarity=0.662)
     <8-line snippet>
  ...
Lessons from past similar work — do not repeat:
  1. feedback_pat_topic (kind=feedback, similarity=0.78)
     <8-line snippet>
  ...
$ORIGINAL_PROMPT
```

## How it works

1. **Aggregation.** Walks `<memoryDir>/*.md` (directives, feedback, proposals, registries, architecture refs, master plans, landscape research, gate completion, …) plus `~/Documents/projects/reports/*.md` (handoffs, completion reports, analyses). Each file is classified by filename pattern into one of 19 kinds (see `src/types.ts`). Excludes `MEMORY.md`, hidden files, `.bak` backups, the index DB itself.
2. **Embedding.** Every classified file is fed (truncated to ~4 KB on a UTF-8 codepoint boundary) to Ollama's `nomic-embed-text` model running locally. Returns a 768-dim Float32 vector.
3. **Persistence.** Vectors land in `<memoryDir>/_librarian-index.sqlite` alongside the source path, kind, slug, mtime, sha256, and a 4-KB content snippet. Schema is documented in `src/index-store.ts`. WAL mode lets multiple readers run while the builder is writing.
4. **Retrieval.** Given a query, embed it the same way, scan all rows in JS (faster than sqlite-vec at this scale), compute cosine similarity, filter below threshold (default 0.4), sort by similarity desc, return top-N.
5. **Pre-spawn injection.** `caia-librarian-prepend` reads a prompt from stdin, retrieves top-N matching precedent, and emits an augmented prompt to stdout with a `Precedent from prior decisions — for context:` preamble. Composes left-to-right with `caia-mentor-prepend` in either order.

## CLIs

### `caia-librarian-index`

```sh
# Build/refresh the index (idempotent — only re-embeds files whose mtime+sha changed)
caia-librarian-index build [--memory <dir>] [--reports <dir>|--no-reports]

# Inspect what's indexed
caia-librarian-index status [--memory <dir>]

# Help
caia-librarian-index help
```

### `caia-librarian-retrieve`

```sh
# Quick TSV output: similarity, kind, slug, path
echo "master backlog sequencing" | caia-librarian-retrieve --memory <dir>

# Full JSON
echo "..." | caia-librarian-retrieve --memory <dir> --json

# Pretty multi-line block per row
echo "..." | caia-librarian-retrieve --memory <dir> --pretty

# Same preamble caia-librarian-prepend would inject
echo "..." | caia-librarian-retrieve --memory <dir> --preamble

# Filter by kind
echo "..." | caia-librarian-retrieve --memory <dir> --kind directive,master
```

### `caia-librarian-prepend`

```sh
# The orchestrator hook
AUGMENTED=$(echo "$PROMPT" | caia-librarian-prepend --memory <dir> --quiet)

# Compose with Mentor (either order works)
AUGMENTED=$(echo "$PROMPT" | caia-mentor-prepend --quiet | caia-librarian-prepend --quiet)

# Append a JSON metadata footer (for audit trails)
echo "$PROMPT" | caia-librarian-prepend --metadata
```

## Install

```sh
# 1. Build the dist
pnpm -C packages/librarian build

# 2. Install CLIs into ~/.local/bin (which is on PATH)
bash packages/librarian/scripts/install.sh

# 3. Build the index against your memory + reports dirs
caia-librarian-index build \
  --memory "$HOME/Library/Application Support/Claude/local-agent-mode-sessions/<sid>/<sid>/agent/memory" \
  --reports "$HOME/Documents/projects/reports"

# 4. Verify
caia-librarian-index status --memory <same-memory-dir>
```

## Library

```ts
import {
  buildIndex,
  retrievePrecedent,
  prependPrecedent,
  createOllamaEmbedder
} from '@chiefaia/librarian';

const embed = createOllamaEmbedder();
await buildIndex({ memoryDir, reportsDir, embed });

const prep = await prependPrecedent('What is the master backlog sequencing?', {
  memoryDir,
  topN: 5
});
console.log(prep.augmentedPrompt);
console.log(prep.precedent.map(p => `${p.slug}@${p.similarity.toFixed(3)}`));
```

## Architecture (data flow)

```
┌──────────────────┐        ┌──────────────────┐
│  memoryDir/*.md  │        │   reportsDir/    │
│  proposals/*.md  │        │      *.md         │
└────────┬─────────┘        └────────┬─────────┘
         │                            │
         └─────────────┬──────────────┘
                       │
                       ▼
         ┌─────────────────────────────┐
         │     defaultFsReader         │   classifies by filename
         │     (source-readers.ts)     │   → PrecedentKind
         └─────────────┬───────────────┘
                       │
                       ▼
         ┌─────────────────────────────┐
         │     buildIndex              │   sha+mtime change detection
         │     (index-builder.ts)      │   truncate to 4 KB UTF-8
         │                             │   embed via Ollama
         └─────────────┬───────────────┘
                       │
                       ▼
         ┌─────────────────────────────┐
         │  _librarian-index.sqlite    │   table precedent
         │  (better-sqlite3 + WAL)     │   table meta
         └─────────────┬───────────────┘
                       │
                       ▼
                 (read-only)
                       │
   ┌───────────────────┴───────────────────┐
   ▼                                       ▼
retrievePrecedent                   prependPrecedent
(retrieve.ts)                       (prepend.ts)
   │                                       │
   ▼                                       ▼
top-N RetrievedPrecedent[]    augmented prompt with preamble
   │                                       │
   ▼                                       ▼
   CLI: caia-librarian-retrieve            CLI: caia-librarian-prepend
                                              │
                                              ▼
                         orchestrator pipe-composes with caia-mentor-prepend
```

## Design decisions

**Why a separate index DB from Mentor.** Mentor's `_mentor-index.sqlite` opens read-only in retrieval and assumes only `feedback`/`proposal` kinds. Adding the broader Librarian kind set there would break Mentor's invariants and tangle the rebuild cadences (Mentor rebuilds rarely; Librarian rebuilds every leg as new reports land). The two indexes share zero data and cost ~2 MB of duplicated embeddings for the overlapping `feedback_*.md` set — a fair price for orthogonality.

**Why JS-side cosine, not sqlite-vec.** At ≈241 rows today (and plausibly ≤ a few thousand in a year), the full-table cosine scan runs in <5 ms. sqlite-vec brings a per-OS native binary install hassle that buys nothing at this scale. Same conclusion as Mentor's `index-store.ts`.

**Why truncate input to 4 KB.** Ollama's `nomic-embed-text` default `num_ctx` is 2048 tokens (~6 KB at typical English-with-code-identifiers tokenization). 4 KB leaves margin for token-dense files (paths, JSON, hashes, matrix tables) that would otherwise blow the budget — production corpus exposed 13 such files when we tested at 6144, and 0 when we dropped to 4096. The full file is still SHA-hashed for change detection; only the embedding input is truncated.

**Why "precedent" not "lessons".** Librarian's framing is "here's what we already decided" — the agent should READ this and align, not avoid. Mentor's framing is "don't repeat". Distinct labels prevent the spawned agent from conflating the two signal classes.

## What's NOT in Phase 1

- **PR titles + transcripts ingestion.** Designed (would add an MCP / GitHub API path) but not built. Reports cover most of the same ground; PRs are a follow-up leg.
- **Mem0 + NetworkX graph layer.** Phase 2 build per `enterprise_ai_landscape_directive.md` W2-1.
- **Daily LaunchAgent for index rebuild.** Easy follow-up; manual rebuild is fine for v0.
- **Pre-merge Steward analyzer that flags PRs lacking precedent retrieval.** Phase 2.
- **fsnotify-based incremental rebuild on memory file write.** Easy follow-up.

## Testing

```sh
pnpm -C packages/librarian test       # 126 tests, ≈600 ms
pnpm -C packages/librarian lint       # zero errors
pnpm -C packages/librarian typecheck  # clean
```

End-to-end smoke (no Ollama required) lives in `tests/end-to-end.test.ts` and uses a deterministic toy embedder so the build → retrieve → prepend pipeline can be verified in CI.

## See also

- `agent/memory/agent_ecosystem_expansion_directive.md` §A5 — Librarian directive
- `agent/memory/mentor_agent_directive.md` — sibling pre-spawn pattern
- `agent/memory/master_backlog_sequencing_2026-05-05.md` Item 5 — campaign authority
- `~/Documents/projects/reports/librarian-agent-analysis.md` — Stage 1-3 design doc
- `packages/mentor-retrieval/` — the structural mirror this package extends
