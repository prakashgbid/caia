---
name: sitemap-and-content-plan
created: 2026-05-16T09:08:06Z
updated: 2026-05-16T09:08:06Z
status: complete
type: design-plan
chain: caia-website-sitemap-content / phase 1 of 1
spawn_id: phase1-20260516T090352-66544
scope: docs/website-design-system
---

# CAIA Website — Sitemap & Content Plan (Phase 1)

> Comprehensive plan for the **CAIA public-facing website**. The site has three jobs: (1) showcase the AI-first architecture so a technically-literate visitor can understand what CAIA is and why it is unusual; (2) act as the organised, navigable knowledge surface for every package, concept and system; (3) be the operator's gateway to the live dashboard.
>
> This document is the master content & IA spec — a content writer plus a designer should be able to take it and build the site without going back to the codebase for re-discovery.

---

## 0. Source-of-truth references used to build this plan

- `caia/README.md`, `caia/AGENTS.md`, `caia/ARCHITECTURE-MIGRATION.md` — the platform's own self-description.
- `caia/docs/business-architecture.md`, `caia/docs/capability-map.md`, `caia/docs/intelligence-architecture.md`, `caia/docs/communication-architecture.md`, `caia/docs/value-stream.md`, `caia/docs/data-ownership.md`, `caia/docs/information-classification.md` — the EA reference set.
- `caia/docs/adr/ADR-006..015` — the ten standing architectural decisions (Option E shape, subscription-only LLM, Mac-first inference, custom Hono runtime, four-layer safety stack, Evidence Gate, Steward Gatekeeper, single-threaded write-per-worktree, HashiCorp Vault, Git Flow enforcement).
- `caia/packages/*` — 74 workspace packages whose READMEs were sampled to capture accurate one-liners.
- `caia/apps/dashboard` — Next.js 15 app on port 7777 ("Conductor"), source of visual-identity hints.
- `caia/reports/audits/2026-05-16-caia-dashboard-codebase-audit.md` — the dashboard audit that maps every operator page and its data wiring.

---

## 1. Audiences

The site serves three distinct visitor archetypes. Every page must be readable to all three, but each archetype has a primary read-path.

### 1.1 Technical visitor (primary)

The engineer who landed here from a link, a search, a conference talk, or a referral. Has built distributed systems before. Wants to know within 60 seconds: *"Is this a real platform or vapourware?"*

- **Triggers**: linked from a blog post, GitHub repo, hacker forum, AI-engineering newsletter, conference talk.
- **What they want**: concrete architecture, real code, real numbers, real ADRs. They distrust marketing prose and reward depth.
- **Primary entry**: Home hero → Architecture overview → one Concept deep-dive (often Autonomous Chains or Apprentice LoRA) → Packages catalog browse.
- **Exit win**: they bookmark the site, follow the GitHub org, share a Concept page on social.

### 1.2 Potential collaborator / future hire (secondary)

Engineer, AI researcher, or designer who is *evaluating CAIA as an organisation to join, partner with, or learn from*. Reads more slowly, looks for cultural fit, principles, governance.

- **Triggers**: a hiring conversation, a referral, an EA-style design discussion, a Mentor / Apprentice talk.
- **What they want**: the principles (Option E, subscription-only LLM, operator-does-not-code, evidence-gated PRs), the standing rules, the engineering culture surface (commit hooks, gates, eval-driven development).
- **Primary entry**: Home → About → Concepts/Safety-stack → Concepts/Autonomous-chains → Documentation/ADRs.
- **Exit win**: they reach out to the operator with a concrete proposal.

### 1.3 Operator (Prakash) — fast-path

The owner of CAIA, who uses this site as the launch-pad into the live dashboard. Visits frequently, almost always to either (a) jump into the dashboard or (b) hand a link to a third party.

- **Triggers**: bookmark, dock icon, mobile shortcut.
- **What they want**: a one-click "Dashboard" CTA that is always visible, a "What's new" surface, and a small operator-shortcuts strip (e.g. links to the local Grafana, the Langfuse trace UI, the platform-status page).
- **Primary entry**: top-right `Login → Dashboard` button.
- **Exit win**: under one second to the dashboard.

These three audiences share one site; the IA must let each one self-serve without the other two crowding the experience. The home page is the only place where all three converge — every other page biases toward the visitor archetype it serves.

---

## 2. Top-level navigation (7 sections)

The header carries seven top-level entries plus a persistent right-aligned `Dashboard →` CTA. Seven is the upper end of the 5–8 guidance and is chosen deliberately because the platform's surface genuinely splits seven ways. Collapsing further would conflate Architecture vs Concepts (different content), or Packages vs Documentation (different reader intent).

| # | Top nav | One-line purpose | Primary audience |
|---|---|---|---|
| 1 | **Home** | The pitch in one scroll. | All |
| 2 | **Architecture** | The seven EA views (Business, Application, Information, Communication, Intelligence, Operations, Value-stream). | Technical, Collaborator |
| 3 | **Packages** | Filterable catalog of all 74 `@chiefaia/*` and `@pokerzeno/*` packages with per-package detail pages. | Technical |
| 4 | **Concepts** | Reader-friendly long-form essays on the platform's distinctive ideas (event-driven, observability, smart prompting, autonomous chains, apprentice LoRA, safety stack, knowledge graph). | All |
| 5 | **Documentation** | Operator runbooks, ADR register, getting-started guides, API references. | Technical, Operator |
| 6 | **About** | Mission, operator, principles, how the platform is run. | Collaborator |
| 7 | **Login** | Auth gateway → operator dashboard. | Operator (and any future collaborator) |

The header bar is sticky. On mobile it collapses to a hamburger with `Home / Dashboard →` left visible. There is no second-level nav in the header — second-level navigation lives inside each section landing page (the Architecture landing has a sub-nav for its seven views, the Packages landing has filter chips, etc.).

---

## 3. Page-by-page outline

For each page below: **purpose**, **section breakdown**, **content draft per section** (2–3 paragraphs each), and **visual notes** (diagrams to commission, code samples, screenshots from the existing dashboard, illustrations).

### 3.1 Home — `/`

**Purpose.** Compress the 30-second answer to *"what is CAIA?"* into one scroll. Establish technical credibility, anchor the three audiences, and route them onward. Avoid the AI-startup marketing voice — CAIA is a working platform run by one operator with measurable outputs; the home page should sound like that.

**Section 1 — Hero.**

- *Headline*: **"The platform that builds and operates AI-driven websites — with zero human-in-the-loop coding."**
- *Sub-headline*: "CAIA is a private multi-agent system. One operator validates visuals. Everything else — architecture, code, CI/CD, DevOps, observability, learning — is executed by Claude agents bonded to a 74-package monorepo."
- *Two CTAs side-by-side*: `Explore the architecture` (anchor to §2) and `Open the dashboard →` (login).
- *Status strip*: small inline row of live numbers — "11 sites operating · 74 packages · 100+ orchestrator routes · Evidence Gate green: 92% (30d)". These are read from a static JSON snapshot at build time, refreshed weekly.

**Section 1 content draft.**

> CAIA — *Chief AI Agent* — is the private platform behind a fleet of AI-driven websites and the Stolution startup. It is not a hosted product. It is the operator's personal multi-agent substrate, built around a single inviolate rule: the human validates only what is rendered on a screen, and every line of code, every commit, every deployment, every observability dashboard, every learning loop is owned by Claude-powered agents.

> The platform is approximately 74 workspace packages, ten apps, six required CI gates, four enforced safety layers, three knowledge surfaces (Mentor, Librarian, Apprentice), and one human in the loop. That one human's job is to look at things and say "ship it" or "no."

> This site exists for three reasons: to make the architecture legible enough that a stranger can audit it; to act as an index into every package and concept; and to launch the operator straight into the live dashboard.

**Visual note**: full-bleed dark hero (background `#0f1117` to match dashboard), a single animated diagram on the right — concentric rings labelled Operator → Orchestrator → Agents → Substrate → Sites, with a subtle pulse on the outer ring representing a heartbeat. Static SVG fallback for no-JS.

**Section 2 — "Three answers in one scroll."**

Three side-by-side cards, each answering one question:

- **What does CAIA do?** "CAIA takes operator intent — a prompt typed into a chat — and produces tested, deployed code. Decomposition, BA enrichment, EA architectural instructions, story validation, test design, multi-bucket scheduling, code-gen, fix-it loops, evidence-gated PR merge, weekly release. Every stage is an agent; every stage is observable."
- **Why is it different?** "Three distinguishing constraints: (1) subscription-only LLM access — no API-key billing exists; (2) Option E shape — every agent is a private workspace package with parameterised public API and fixture-corpus tests; (3) one operator, zero coding — the operator validates visuals, agents own everything else."
- **Where does it run?** "Mac-first inference for local Ollama (qwen2.5-coder 7B), Claude subscription for synthesis-heavy work. Mac orchestrates; the Stolution VPS hosts the production observability stack (Langfuse, Tempo, Loki, Prometheus, Grafana). Cron'd self-improvement loop runs daily on the operator's machine."

**Visual note**: three cards rendered as flat panels with dashboard-style stat-strips above each (e.g. "60-70% local-routed", "74 packages, 0 published to npm", "11 sites live"). Click-through arrows on each card link to Architecture, Concepts/Smart-prompting, and Architecture/Operations respectively.

**Section 3 — Featured concepts (4 tiles).**

A grid of four large tiles, each linking to a Concept long-read:

1. **Autonomous Chains** — multi-phase YAML-defined work units that survive across operator sessions. "A chain dispatches a phase, holds an exclusive lock with heartbeat, persists state, retries failed phases, recovers stale locks, and writes an audit log."
2. **Apprentice LoRA** — the self-improving substrate. "A QLoRA-trained 7B adapter learns from CAIA's own Mentor events, agent memory, PR history, and Langfuse traces. Adapters move through `registered → shadow → canary → production` with percent-based traffic splitting."
3. **Four-layer Safety Stack** — the irreversible-action defence. "Every dangerous action — git push, deploy, delete, billing — flows through `@chiefaia/capability-broker`. Every MCP call goes through the allowlist proxy. Every tool output that re-enters a prompt goes through the sanitizer. Every LLM call goes through the spend guard."
4. **Mentor + Librarian + Apprentice** — the three knowledge surfaces. "Mentor surfaces mistakes; Librarian surfaces precedent; Apprentice learns aggregate patterns. Together they bracket every spawned agent's prompt."

**Visual note**: each tile uses a hand-drawn-style line illustration (commissioned) — a heartbeat curve for Chains, layered cards for LoRA adapters, a brick wall for Safety, three overlapping orbits for the knowledge surfaces.

**Section 4 — Operator quote / principles strip.**

Single-row strip of five principles, each one a chip:

- "The operator never edits code."
- "No API-key billing. Subscription only."
- "Every agent is a private workspace package."
- "Tests, not prose, gate the merge."
- "Every irreversible action is brokered."

**Visual note**: typography-only section with a faint diagonal grid background (echoing dashboard's `#1a1f2e` sidebar tone). Each chip click-throughs to the relevant ADR.

**Section 5 — Footer.**

Three columns: *Explore* (links to each top-nav), *Operator* (Dashboard, Status, Langfuse, Grafana), *Repo* (GitHub, MIGRATION-STATUS, ARCHITECTURE-MIGRATION, AGENTS.md). Build-info chip — commit SHA + build date — bottom-right.

**Cross-links**: every section above links into Architecture, Concepts, Packages, or Documentation as labelled.

---

### 3.2 Architecture — `/architecture`

**Purpose.** The single page where a senior engineer can audit the platform's bones. Mirrors the EA reference set in `docs/`. Sub-navigation on the page (NOT in header) lets the visitor jump between seven views.

**Sub-nav tabs (sticky in-page)**: `Business · Application · Information · Communication · Intelligence · Operations · Value-stream`.

#### 3.2.1 Business view — `#business`

**Section 1 — Mission and end-states.**

> CAIA's mission is to be the platform that builds and operates 100+ AI-driven niche websites plus the Stolution startup with zero human-in-the-loop coding. Three measurable end-states define success: (a) 100 niche-traffic sites each producing $10–$50K of monthly revenue, (b) the Stolution platform shipped to first paying users with its ~115 GB Postgres and 80 GB Meilisearch behind it, (c) a self-improving substrate that compounds quality without any operator coding intervention.

> The operator validates only visual output. They look at rendered pages, dashboards, and UI behaviour and say "this is fine" or "fix this." Every other surface — code, CI, infrastructure, observability, learning — is owned and operated by Claude agents. This shape is inviolate; it is the load-bearing constraint behind every other architectural decision on this site.

**Section 2 — Stakeholders.**

Table reproduced from `docs/business-architecture.md` (Operator / Cowork Claude / Subagent fleet / Tenant / End-users / Anthropic / Apple). Visual: stakeholder map as a centred hub-and-spoke SVG, with the Operator at the centre and the agent fleet around them.

**Section 3 — Business capabilities (the capability map).**

Static rendering of the C1–C6 capability matrix from `docs/capability-map.md`. Each row is filterable by status (`live` / `in flight` / `backlog` / `deferred`). Each cell links to the implementing surface (package or app), wiring this page into `/packages`. Diagram to commission: a horizontal swim-lane showing C1 (prompt → deployed) as the spine, with C2/C3/C4/C5 as feeders.

#### 3.2.2 Application view — `#application`

**Section 1 — The monorepo shape.**

> CAIA is a single pnpm workspace. The `apps/` directory holds runtime services. The `packages/` directory holds 74 reusable agent packages scoped `@chiefaia/*` and `@pokerzeno/*`. The `templates/` directory holds two site scaffolds plus a utility starter. The `configs/` directory holds shared eslint, tsconfig, and turbo configs. There is no separate build infrastructure for any individual package — turbo plus a single pnpm install resolves the entire 1,119-dependency graph.

> The application is strictly TypeScript, ESM, Node ≥20, pnpm workspaces. `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, and `noImplicitOverride` are non-negotiable. There is no `any`, no `@ts-ignore`, no public-npm publishing of agent packages. Every agent follows the Option E shape (ADR-006): private package, parameterised public API, fixture-corpus tests, pre-spawn injection consumed, no second-customer abstraction.

**Section 2 — Apps.**

A horizontal table of every app, with one-liners pulled from each app's `package.json` and README:

- `orchestrator` — Hono REST + WebSocket on :7776; the real data plane backed by SQLite via Drizzle.
- `dashboard` — Next.js 15 on :7777; operator UI, "Conductor" title, six accordion nav groups.
- `executor` — task executor daemon.
- `completeness-sentinel` — every-2h completeness sweep.
- `db-backup` — hourly Postgres backup.
- `task-run-poller` — task-run completion poller.
- `story-backfiller` — back-fills stories from blockers.
- `pipeline-pulse` — pipeline health canary.
- `orchestrator-middleware` — HTTP/MCP middleware.
- `worker-coding` and `worker-fix-it` — per-bucket coding-agent workers.
- `smart-cicd-agent`, `stolution-mcp`, `local-preview-orchestrator`, `roulette-backend` — utility surfaces.

**Visual note**: a `services` diagram (commission) showing arrows from operator → dashboard → orchestrator → workers → vendors (Claude, Ollama, Vault).

**Section 3 — Communication kinds.**

Reproduced from `docs/communication-architecture.md` — the seven kinds (sync REST, RPC, async events, real-time push, external LLM, cross-host, cron). Each kind gets a short paragraph; the page renders the decision matrix as a flowchart SVG.

#### 3.2.3 Information view — `#information`

**Section 1 — What CAIA owns vs reads.**

> CAIA owns three classes of data: agent memory (markdown files in `agent/memory/`), the Architecture Knowledge Graph (Postgres tables + sqlite-vec), and the Feature Registry. It reads three classes: Stolution's Postgres (~115 GB), Langfuse traces, and GitHub PR/issue history.

> Information classification follows `docs/information-classification.md`: `PUBLIC` (this website, blog posts, OSS-style docs), `INTERNAL` (orchestrator API responses, dashboard pages, ADRs in the repo), `CONFIDENTIAL` (Vault-stored secrets, subscription tokens, Stolution PII), `SECRET` (the operator's own credentials, never automated).

**Section 2 — Data-ownership diagram.**

A radial diagram (commission) showing each datastore (`agent/memory`, `arch_*` Postgres tables, `feature_registry*`, Stolution Postgres, Langfuse, GitHub) with arrows in/out labelled by which agent reads and writes it.

#### 3.2.4 Communication view — `#communication`

Short page — link out to `/concepts/event-driven` for depth. Render the decision matrix flowchart from `docs/communication-architecture.md`.

#### 3.2.5 Intelligence view — `#intelligence`

**Section 1 — Model selection.**

> Every task that reaches an agent passes through a decision tree: is it bulk classification or simple synthesis? Route to local Ollama (qwen2.5-coder 7B or nomic-embed-text). Is it simple enough for Claude Haiku? Spawn the `claude` binary with `--model haiku`. Is it genuinely complex synthesis or architecture? Spawn `claude` with `--model sonnet` or `--model opus`.

> Account-pool selection happens inside the binary spawn: try subscription account #1; if it is over 80% of weekly cap, try account #2; if both are over 80%, bias the router back to Ollama; if both hit 100%, raise `BudgetExceededError` and pause the orchestrator. The platform never falls back to API-key billing. That is a standing rule (ADR-007) anchored in `feedback_no_api_key_billing.md`.

**Section 2 — Self-improvement loop.**

> Mentor surfaces mistakes after the fact. Librarian surfaces precedent during pre-spawn injection. Apprentice trains a 7B LoRA adapter on the platform's own history and serves it through staged rollouts. Three different mechanisms, one shared substrate.

**Section 3 — Eval harness.**

> Prompts ship with eval suites in `@chiefaia/prompt-evals`. The Wave 1 canonical 100-prompt suite is the gate for any prompt change. The Apprentice eval suite (`@chiefaia/apprentice-eval`) scores each LoRA candidate against base; regression-flagged candidates are disqualified from canary.

**Visual note**: render the model-selection decision tree as a stepped flowchart with concrete examples per branch (e.g. "intent classification → Ollama", "ADR drafting → Sonnet").

#### 3.2.6 Operations view — `#operations`

**Section 1 — Six required gates per PR.** (Evidence Gate per ADR-011)
**Section 2 — Steward Gatekeeper.** (Daily/weekly, 15 failure modes — ADR-012)
**Section 3 — Cron + scheduled work.** (Worktree Reaper, Completeness Sentinel, DB Backup, Steward sweep)
**Section 4 — Observability stack.** (Langfuse, Tempo, Loki, Prometheus, Grafana — all self-hosted on stolution)

**Visual note**: take a cropped screenshot of `/platform-status` from the live dashboard (with synthetic data) for the operations view, plus a Grafana panel screenshot for the observability strip.

#### 3.2.7 Value-stream view — `#value-stream`

Reproduce the text diagram from `docs/value-stream.md`: prompt → ingested → decomposed → enriched → architected → validated → test-designed → … → deployed → operated → improved. Each stage is a clickable chip that opens a side-panel summarising the agent or package that owns the stage. Visual: a long horizontal flowchart, mobile-tappable.

---

### 3.3 Packages — `/packages`

**Purpose.** The full catalog of 74 workspace packages. Every package gets a detail page. The landing page is a filterable index.

**Landing page section 1 — Intro paragraph.**

> CAIA's monorepo holds 74 workspace packages. Most are scoped `@chiefaia/*` (private agent code, never published). Some are scoped `@pokerzeno/*` and were historically published for site consumption; under the 2026-05-06 standing rule, new agent packages stay private. This catalog is filterable by scope, status, and tier. Each card links to a detail page with the package's README, public API, dependencies, consumers, and ADR refs.

**Landing page section 2 — Filter chips.**

Chips: `All · Agents · Pipeline · Knowledge · Safety · Observability · Utilities · Site-building · Apprentice · Architects`.

Each chip filters the grid below. Chip taxonomy is hand-curated in a `packages-taxonomy.json` file at the site's repo root.

**Landing page section 3 — Grid of package cards.**

Each card: scope chip + name + one-line description (from README) + status badge (`live` / `wave-X` / `dormant` / `archived`) + ADR refs + a small "depends on / depended on by" count. Cards are virtualised — at 74 cards the page is fine; at 200+ a tag-driven pagination kicks in.

**Landing page section 4 — Tier explainer.**

Brief note on the Tier 1–5 stack from `ARCHITECTURE-MIGRATION.md`: Tier 1 (foundational utilities — logger/metrics/tracing/config/secrets/errors/events/test-kit), Tier 2 (domain utilities), Tier 3 (agent primitives), Tier 4 (CAIA core orchestration), Tier 5 (sites that consume from the platform).

**Visual note for landing**: subtle alternating-row background (`#1a1f2e` / `#0f1117`) to echo the dashboard's accordion sidebar. Hover state on each card reveals a one-sentence "what makes this package unusual" — pulled from a curated `highlights.md` per package.

### 3.3.x Package detail page — `/packages/[name]`

A repeatable template. The same shape for every one of the 74 packages.

- **Header**: scope chip · name · status badge · "private" lock icon if `"private": true` · GitHub source link.
- **Section 1 — One-paragraph summary** (from README's lede).
- **Section 2 — Why it exists** (the "Why this exists" section that most well-described packages already have — `claude-spawner`, `capability-broker`, `local-llm-router`, `aiml-architect`, `vastu`, etc. all have one).
- **Section 3 — Public API surface** (auto-generated from the package's `index.ts` exports — names, signatures, JSDoc).
- **Section 4 — Consumers** (which other packages import it; derived from a build-time graph).
- **Section 5 — ADR refs** (linked).
- **Section 6 — Tests + evidence** (vitest output, coverage, eval-suite scores where applicable).

**Curated picks worth highlighting on the landing page** (10 of the 74):

1. **`@chiefaia/chain-runner`** — autonomous multi-phase work units.
2. **`@chiefaia/claude-spawner`** — subscription-only `claude` binary spawn.
3. **`@chiefaia/local-llm-router`** — Ollama-vs-Claude routing.
4. **`@chiefaia/librarian`** — pre-spawn precedent retrieval.
5. **`@chiefaia/apprentice-corpus` / `-eval` / `-training` / `-serving`** — the four-phase apprentice loop.
6. **`@chiefaia/capability-broker`** — irreversible-action gating.
7. **`@chiefaia/spend-guard`** — LLM spend ceiling.
8. **`@chiefaia/mcp-allowlist-proxy`** — supply-chain hardening for MCP servers.
9. **`@chiefaia/tool-output-sanitizer`** — prompt-injection defence.
10. **`@chiefaia/aiml-architect`** — first of the twelve domain-specialist architect agents.

**Visual note**: each detail page uses a fixed split-pane layout — 70% content, 30% right-rail with quick-jump (Summary / API / Consumers / ADRs / Tests). The right-rail also surfaces a compact dependency-graph SVG (rendered server-side from the package's `package.json`).

---

### 3.4 Concepts — `/concepts`

**Purpose.** The reader-friendly long-form home for the platform's distinctive ideas. Each Concept is a single page, 1,500–3,000 words, treated as a permalink-worthy essay. The Concepts section is what gets shared on social.

**Concept index page sections**:

1. Intro paragraph framing why CAIA's substrate looks different.
2. Seven concept tiles (below). Each is a card with a strong illustration.

The seven concepts (each a separate page):

#### 3.4.1 `/concepts/event-driven` — Event-driven everything

> Every state change in the platform is an event on Mentor's event bus (which itself is the `ConductorEventBus` substrate). Pipeline transitions, agent spawn-completes, gate verdicts, LoRA rollouts — all observable as a stream. The dashboard's `/timeline` and `/events` pages are thin WebSocket subscribers.

**Section breakdown**: Why events / The bus / Topic taxonomy (`incident.*` Mentor topics, `application.*` future-Choreographer topics) / How the dashboard subscribes (`useEventStream` hook) / What happens on a failure (replay vs at-most-once).

**Visual notes**: animated timeline-strip illustration, code sample from `hooks/useEventStream.ts`, screenshot of `/events`.

#### 3.4.2 `/concepts/observability` — Observability stack

> CAIA's observability stack is fully self-hosted on the Stolution VPS: Langfuse for LLM traces, Tempo for distributed tracing, Loki for logs, Prometheus + Grafana for metrics + dashboards. Local-llm-router emits OpenTelemetry spans for every Ollama and Claude dispatch. The CAIA dashboard surfaces a subset of metrics inline at `/metrics`, `/metrics/llm`, and `/platform-status`.

**Section breakdown**: Why self-hosted / The five surfaces (Langfuse, Tempo, Loki, Prom, Grafana) / What gets traced / What gets dashboarded / Pulse health canaries / How an alert turns into an Operator nudge.

**Visual notes**: commissioned diagram of the five-surface stack; screenshots of `/health/pulse`, `/observability/health`, `/metrics`; one example Grafana panel (synthetic data).

#### 3.4.3 `/concepts/smart-prompting` — Smart prompting

> Every prompt that reaches an LLM is composed: a `system-prompt-block` CAIA primer, Mentor-injected lessons, Librarian-retrieved precedent, the task body itself, and (sometimes) Apprentice-LoRA bias on the model side. The `prompt-optimizer` package wraps every model call routed through `local-llm-router` and applies a three-stage optimisation. Prompt change is gated by `@chiefaia/prompt-evals` Promptfoo suites.

**Section breakdown**: The five layers of a prompt / The system-prompt-block (≤1K tokens) / Mentor pre-spawn injection / Librarian pre-spawn injection / Prompt-optimizer's three stages / Eval suites + how a regression blocks a change.

**Visual notes**: a stacked-layers illustration showing the prompt composition; a screenshot of a Promptfoo report; an annotated example prompt with each layer colour-coded.

#### 3.4.4 `/concepts/autonomous-chains` — Autonomous chains

> A chain is a YAML-defined sequence of phases. Each phase has dependencies, a max-runtime cap, and a prompt template. A LaunchAgent wakes every N minutes, asks the runner "what's next?", and (if eligible) spawns a phase in the background. The runner persists per-chain state, holds an exclusive lock with heartbeat, recovers stale locks, retries failed phases up to a cap, and writes an audit log. Every multi-phase work item in CAIA uses this runner.

**Section breakdown**: The shape of a chain YAML / The lock-with-heartbeat protocol / How stale locks recover / Phase-level retries vs chain-level escalation / The dispatch-then-monitor pattern / Worker-level heartbeat (H-12) / Standing rule: all multi-phase work goes through `chain-runner`.

**Visual notes**: timeline strip showing a chain progressing across hours; a state-diagram (commissioned) of `pending → in-flight → recovered → completed | failed`; an actual screenshot of the chain-watchdog INBOX.

#### 3.4.5 `/concepts/apprentice-lora` — Apprentice LoRA

> The self-improving substrate. CAIA's Apprentice is a four-phase pipeline that turns the platform's accumulated history into a fine-tuned 7B LoRA adapter served via Ollama. Phase 0 — Corpus — normalises Mentor events, agent memory, PR history, and Langfuse traces into a JSONL training set. Phase 1 — Eval — scores candidate adapters against a canonical suite. Phase 2 — Training — runs QLoRA via `mlx_lm.lora` on Mac M-series. Phase 3 — Serving — promotes adapters through `registered → shadow → canary → production` with percent-based traffic splitting.

**Section breakdown**: Why a LoRA adapter and not a fine-tune / The four phases / How a regression disqualifies a candidate / The canary routing config / What gets retrained how often / How this closes the self-improvement loop.

**Visual notes**: lifecycle diagram of an adapter (registered → shadow → canary → production → archived/rejected), commissioned; a screenshot of `apprentice-eval`'s score-card output.

#### 3.4.6 `/concepts/safety-stack` — Four-layer safety stack

> Four layers gate every dangerous thing the platform can do. Layer 1: **capability broker** (`@chiefaia/capability-broker`) mints short-lived capability tokens for irreversible actions (push, deploy, delete, billing). Layer 2: **MCP allowlist proxy** (`@chiefaia/mcp-allowlist-proxy`) is the only entry point for MCP tool calls. Layer 3: **tool-output sanitizer** (`@chiefaia/tool-output-sanitizer`) scrubs tool output before it re-enters an LLM prompt. Layer 4: **spend guard** (`@chiefaia/spend-guard`) caps subscription-bucket consumption and refuses calls when ceilings are hit. ADR-010 codifies the stack; semgrep rules enforce that bypass routes don't sprout.

**Section breakdown**: The Lemkin/Replit prior incident / Why text-based "don't do X" is insufficient / Each of the four layers / The semgrep rules / How a developer adds a new capability / Audit log shape.

**Visual notes**: a brick-wall illustration showing the four stacked layers; a code sample of `capabilityBroker.use(...)`; a screenshot of an audit-log entry from the orchestrator.

#### 3.4.7 `/concepts/knowledge-graph` — Knowledge surfaces (Mentor + Librarian + Apprentice)

> Three knowledge surfaces bracket every spawned agent. **Mentor** classifies failures into 18 categories and surfaces relevant lessons before the next spawn. **Librarian** maintains a searchable index over every prior decision (good and bad) and surfaces precedent before each spawn. **Apprentice** (when promoted to production) biases the model itself with patterns learned across the entire history. The three surfaces are independent but composable: pre-spawn injection pipelines stack `caia-mentor-prepend | caia-librarian-prepend` ahead of the task.

**Section breakdown**: The three surfaces compared / What each captures and when / The pre-spawn injection pipeline / The Architecture Knowledge Graph (AKG) and Feature Registry as Librarian's substrate / How Mentor's incident topics feed Apprentice's corpus / Why this loop compounds.

**Visual notes**: three overlapping orbits with each surface labelled and arrows showing the data-flows between them; a side-by-side comparison table; an actual sample of an injected pre-spawn block.

---

### 3.5 Documentation — `/docs`

**Purpose.** The operator runbook + ADR register + getting-started guide. This is the "go here when something is on fire" surface.

**Landing page sections**:

- **Section 1 — Runbooks.** Filterable list of every file in `caia/docs/runbooks/` and the cross-cutting ones at `caia/docs/*.md` (capability-broker, evidence-gate, git-flow, mcp-security, prompt-injection-defense, regression-testing, run-modes, spend-guard, story-validation, task-manager, test-isolation-runbook).
- **Section 2 — ADR register.** ADR-006 through ADR-015 reproduced as full pages (Markdown render) with status + supersession links + sub-discussions. Each ADR has its own canonical URL `/docs/adrs/adr-006-option-e-agent-shape`.
- **Section 3 — Getting started.** Three short guides: (a) "Read the dashboard cold" — operator-oriented; (b) "Add a new agent package" — engineer-oriented, Option E shape walkthrough; (c) "Add a new prompt to the eval suite" — Promptfoo + `prompt-evals` walkthrough.
- **Section 4 — API references.** Auto-generated TypeDoc output for every `@chiefaia/*` package — linked but not embedded; the per-package detail page already has the inline API.

**Cross-link contract**: Concepts pages link out to specific ADRs ("see ADR-006 for Option E" → `/docs/adrs/adr-006-option-e-agent-shape`). Architecture pages link out to specific runbooks ("operations view → evidence-gate runbook"). The footer always carries a `Docs ↗` link for fast jumps.

**Visual note**: documentation uses a slightly lighter background (`#161a26`) to differentiate from the content-heavy Architecture / Concepts pages. Code samples render in a monospace block with copy-on-click.

---

### 3.6 About — `/about`

**Purpose.** The principles, the operator, and the story. This page is the "how is this actually run?" answer. It is short and confident.

**Section 1 — One operator, many agents.**

> CAIA is run by one person — the operator — and a fleet of agents. The operator does not write code, does not edit code, does not commit code. The operator validates visual output, sets direction via chat-typed intent, and reviews summary digests. Every line of code in this monorepo was authored by a Claude-powered agent under the four-layer safety stack and the six-gate Evidence Gate.

> This is not a stylistic preference. It is a load-bearing architectural constraint: it means every workflow has to be agent-native end-to-end. If the operator ever has to drop into a terminal to fix something, the platform has a gap; the gap becomes a Mentor entry; the Mentor entry feeds the next iteration. The shape is inviolate.

**Section 2 — Principles.**

A vertical list of the standing rules, each with one paragraph of rationale and a link to the canonical `agent/memory/` file:

- **Operator never edits code.** (`feedback_operator_does_not_code.md`)
- **Subscription-only LLM access. No API-key billing, ever.** (ADR-007, `feedback_no_api_key_billing.md`)
- **Every agent is a private workspace package, Option E shape.** (ADR-006, `agent_architecture_shape_2026-05-06.md`)
- **Every irreversible action is brokered.** (ADR-010, `capability-broker.md`)
- **Evidence-gated PR merge — six required CI contexts.** (ADR-011, `evidence-gate.md`)
- **Git Flow is enforced.** (ADR-015, `feedback_git_flow_enforced.md`)
- **Open-sourcing is not a priority.** (Operator standing decision, 2026-05-06)

**Section 3 — How the work flows.**

> Operator types intent into the Cowork chat. Scaffolder ingests. PO Agent decomposes. BA Agent enriches. EA Agent attaches architectural instructions. Story Validator gates the story. Test-Design Agent generates the test_cases. Task-Manager schedules across buckets. Coding Agent generates code. Fix-It Test Agent iterates until tests pass. Evidence Gate enforces six required CI contexts. The PR merges; the release branch picks it up; the weekly release/* PR lands on `main`. Every stage is observable on the dashboard.

**Section 4 — Contact.**

A small, restrained contact strip: email, GitHub, and a "this site is the public surface of a private platform" disclaimer.

**Visual note**: About is the only page with a real photograph (the operator's portrait, optional) and a hand-drawn signature block. Otherwise it stays consistent with the rest of the site.

---

### 3.7 Login → Dashboard — `/login`

**Purpose.** The operator's daily entry. The visitor-archetype consideration here is *only the operator* — collaborators and technical visitors will never sign in.

**Page shape**:

- Centred login form (Google OAuth + magic-link). The header bar is hidden on `/login`.
- Below the form: a small "What's on the dashboard right now" preview — last 5 timeline events from a server-side render of `/api/recent-events` (with appropriate auth — this preview shows synthetic data when no session exists).
- After login, hard redirect to the dashboard's default landing (`/timeline` per the dashboard's current behaviour).

**Operator-extras strip (appears post-login on the dashboard, not on this page)**:

- Quick-jumps to `/platform-status`, `/health/pulse`, `/metrics/llm`, `/buckets`, `/timeline`.
- A "switch project" dropdown (sourced from `NavProjectSelector`).
- A persistent "open Grafana ↗" and "open Langfuse ↗" pair pinned to the top-right strip — these are the operator's two off-dashboard surfaces.

**Visual note**: `/login` page is full-bleed dark with a single centred form. No marketing, no nav. The form uses the dashboard's exact colour palette so the transition feels seamless.

---

## 4. User journeys

Three journeys map to the three audiences. Each is a step-by-step trace through the site with the expected affordances and cross-links at each step.

### 4.1 Operator login journey

1. Land on `caia-domain.com` (Home).
2. Click `Dashboard →` top-right.
3. Land on `/login`. Sign in (OAuth or magic-link).
4. Redirect to `/timeline` (in the actual dashboard, served from a separate origin or a subpath).
5. From the dashboard, use the persistent operator-extras strip for Grafana / Langfuse / Platform-status.

**Affordances**: the `Dashboard →` button is the only CTA the operator ever clicks here. Total click count: 2 (or 1 with a kept session).

### 4.2 Technical visitor learning journey

1. Land on Home (often via a shared Concept link, in which case skip step 1).
2. Read the hero. Click `Explore the architecture`.
3. Land on `/architecture#business`. Scan business view; click into `/architecture#application`.
4. From the apps table, click `dashboard` → land on `/packages/dashboard` (the package detail).
5. From the package detail's "Consumers" panel, click into `/concepts/event-driven` (the dashboard subscribes to the event bus).
6. Read the Concept long-form. At its foot, follow the cross-link into `/concepts/observability` for the stack.
7. End: bookmark, follow GitHub.

**Affordances**: every Architecture cell links into a Package; every Package detail links into a Concept; every Concept foot links into another related Concept or an ADR. The visitor never has to type a URL.

### 4.3 Deep-dive collaborator journey

1. Land on Home (perhaps shared by a hiring conversation).
2. Click `About`.
3. Read principles top-to-bottom.
4. From the "Every irreversible action is brokered" principle, click into ADR-010 (`/docs/adrs/adr-010-four-layer-safety-stack`).
5. From ADR-010, click into `/concepts/safety-stack` for the long-form.
6. From the Concept's brick-wall diagram, click into `/packages/capability-broker`.
7. From the package detail, follow the Consumers panel to see every place the broker is used.
8. End: contact the operator with a concrete proposal.

**Affordances**: About → ADR → Concept → Package → Consumers is the canonical collaborator path. The site never asks for an email address or gates content; it relies on the depth of the material to qualify the reader.

---

## 5. Cross-link patterns

A small set of cross-link contracts keep the site coherent. Each contract is a *required* link relationship — content writers can add more cross-links, but cannot remove these.

### 5.1 Architecture ↔ Packages

Every cell in the Architecture/Application/apps table links to the corresponding `/packages/[name]` detail page. Every package detail page's "Architecture context" rail names the Architecture view that owns it (so an engineer landing on `claude-spawner` can see "this lives under the Intelligence view of the Architecture").

### 5.2 Concepts ↔ Packages

Every Concept page foot carries a "Packages this concept touches" strip with 3–6 package chips. Conversely, every package detail page's right-rail carries a "Concepts" strip with 1–3 concept chips.

### 5.3 Concepts ↔ ADRs

Every Concept long-read carries a "Codified in" strip naming the ADR(s) that govern it. Every ADR detail page has a "Discussed in" link to the relevant Concept(s).

### 5.4 ADRs ↔ Standing rules

Every ADR detail page links back to the canonical `agent/memory/feedback_*.md` standing rule that anchors it, when one exists.

### 5.5 Home ↔ everything

The home page is the only top-of-funnel surface. Every Concept tile on Home points to its Concept page. Every principle chip in the principles strip points to its ADR. The status strip's numbers each link to a relevant Architecture or Operations view.

### 5.6 Dashboard ↔ Public site

The dashboard's left-nav carries one "Help" entry at the bottom that opens the public site's Documentation index in a new tab. The public site, in reverse, never embeds the dashboard — `Dashboard →` is the only doorway.

### 5.7 Footer-wide

Every page footer has the same three columns (Explore / Operator / Repo) plus a build-info chip. The Operator column carries the off-platform shortcut links (Grafana, Langfuse) for the operator's convenience.

---

## 6. Cross-cutting design + content notes

### 6.1 Visual identity

The site borrows the dashboard's palette to maintain visual continuity: background `#0f1117`, sidebar/panel `#1a1f2e`, border `#2d3748`, primary text `#e2e8f0`, secondary text `#f0f4f8`, link blue `#63b3ed`, accent red `#fc8181`. System font stack: `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`. Monospace for code: `'SF Mono', 'JetBrains Mono', Menlo, monospace`.

Spacing scale: 4 / 8 / 16 / 24 / 48 / 96 px. Border radius: 6 px on cards, 12 px on hero. No drop shadows. No gradients except the hero's subtle vignette.

### 6.2 Content voice

Operator-confident, evidence-anchored, mildly skeptical of its own marketing impulses. Every claim should be checkable against the repo. No "revolutionary," no "next-generation," no "world-class." If a sentence sounds like a press release, rewrite it.

Tense: present indicative for things that work today; future indicative ("will," "is planned to") for backlog items, always with a status badge.

Numbers: prefer concrete (e.g. "74 packages, 100+ orchestrator routes, 11 sites operating") over vague ("many," "a lot"). When a number is approximate, mark it with `~`.

### 6.3 Diagrams to commission

A consolidated list of diagrams the designer should produce (matching the visual notes above):

1. **Concentric-rings hero animation** — Operator → Orchestrator → Agents → Substrate → Sites.
2. **Stakeholder hub-and-spoke** (Architecture/Business).
3. **Capability swim-lane** (Architecture/Business).
4. **Services diagram** (Architecture/Application) — apps + workers + vendors.
5. **Decision-matrix flowchart** (Architecture/Communication).
6. **Model-selection decision tree** (Architecture/Intelligence).
7. **Data-ownership radial diagram** (Architecture/Information).
8. **Value-stream horizontal flowchart** (Architecture/Value-stream).
9. **Chain state diagram** (Concepts/Autonomous-chains).
10. **Apprentice adapter lifecycle** (Concepts/Apprentice-LoRA).
11. **Four-layer brick wall** (Concepts/Safety-stack).
12. **Three-orbit knowledge-surfaces diagram** (Concepts/Knowledge-graph).
13. **Five-surface observability stack** (Concepts/Observability).
14. **Prompt-layers stack** (Concepts/Smart-prompting).
15. **Hand-drawn line illustrations for the four Featured-Concepts tiles on Home** (matching tile copy).

### 6.4 Screenshots to take from the live dashboard

For consistency, every screenshot uses the same window size (1440 × 900), light-cropped to remove the sidebar where the page can stand alone, and rendered against a `#0f1117` mat.

1. `/timeline` (with synthetic data) — Home featured tile, Concepts/Event-driven.
2. `/platform-status` — Architecture/Operations.
3. `/health/pulse` — Concepts/Observability.
4. `/metrics/llm` — Architecture/Intelligence.
5. `/events` — Concepts/Event-driven.
6. `/buckets` — Architecture/Application.
7. `/dag` — Architecture/Value-stream.
8. `/enforcement` — Concepts/Safety-stack (with a note that this page is mock-data per the dashboard audit).

### 6.5 Code samples to embed

- `useEventStream` hook excerpt — Concepts/Event-driven.
- `capabilityBroker.use(...)` example — Concepts/Safety-stack.
- A canonical chain YAML — Concepts/Autonomous-chains.
- A Promptfoo eval YAML excerpt — Concepts/Smart-prompting.
- A sample `apprentice-eval` score-card JSON — Concepts/Apprentice-LoRA.

All code samples are loaded from `examples/*.{ts,yaml,json}` at the site repo root, so they remain editable + diffable + reviewable. No code is inlined in markdown; it is `include`d.

### 6.6 Accessibility + performance budget

- Lighthouse target: ≥ 95 across the four scores on Home, Architecture, Concepts/Autonomous-chains, Packages.
- Axe-core target: zero serious or critical violations on every page.
- Largest contentful paint: ≤ 2.0s on a throttled 3G connection for Home.
- All diagrams: SVG with `<title>` and `<desc>` for screen-reader output.

### 6.7 SEO and discoverability

The site is public-facing; it should rank for "Claude Code orchestration," "Option E agent shape," "autonomous chains LLM," "QLoRA agent fine-tuning," and a small number of long-tail technical phrases that map to the Concept pages. Each Concept page carries an `og:image` rendered from its hero illustration and an `og:description` ≤ 160 characters.

### 6.8 Out of scope for Phase 1

The following are flagged explicitly so the designer + content writer do not over-build:

- No blog. (Future phase.)
- No newsletter signup. (Operator standing rule: open-sourcing is not a priority; visitors come through other channels.)
- No comment system on Concepts.
- No public-facing search. (Site search is a Phase-2 add — for now, the filtered Packages catalog + the Documentation index suffice.)
- No multi-language support.

---

## 7. Implementation hand-off summary

A content writer can author the seven Concept long-reads, the seven Architecture views, the 74 package details (using a template + README extraction), the Documentation runbook index, the About page, and the Home from this single document. A designer can commission the 15 diagrams from §6.3, take the 8 screenshots from §6.4, produce the four line illustrations for Home's Featured Concepts, and apply the §6.1 palette + spacing scale.

Recommended build order:

1. **Foundation** — set up the site repo (Next.js 15 to match the dashboard's framework, App Router), apply the visual identity, build the layout + header + footer components.
2. **Home + About** — ship these first; they are the highest-leverage surfaces and require no per-package automation.
3. **Architecture** — ship the seven views as one page with in-page tabs.
4. **Concepts** — ship the seven long-reads. These are the social-shareable surface.
5. **Packages** — ship the landing + the per-package detail template. Use a build-time generator that ingests every `packages/*/README.md` and outputs MDX.
6. **Documentation** — ship the runbook + ADR index. Use a build-time generator that ingests every `docs/runbooks/*.md` and `docs/adr/*.md`.
7. **Login + Dashboard handoff** — ship `/login` last; wire to the existing dashboard origin.

Once those seven steps are complete, the site is launchable as a Phase-1 public surface. Phase 2 (blog, search, multi-locale, deeper interactive diagrams) opens once Phase 1 is in production and the operator confirms it carries the visitor archetypes intended.

---

*End of plan. ~5,700 words. Spawn `phase1-20260516T090352-66544`, chain `caia-website-sitemap-content`, scope `1` of `1`.*
