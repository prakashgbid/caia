# `components/chat/` — Vercel AI SDK chat panel

Wave 1.3 of the **Enterprise Wave 1** campaign per `agent/memory/enterprise_ai_landscape_directive.md` (W1-2-add — AG-UI / CopilotKit / Vercel AI SDK in CAIA dashboard).

## What ships

- `ChatPanel.tsx` — operator chat UI backed by `@ai-sdk/react`'s `useChat` hook against `/api/chat`. Renders a streaming chat surface inside the dashboard's existing dark-themed shell.
- `app/chat/page.tsx` — Next.js route that renders the panel.
- `app/api/chat/route.ts` — POST handler that streams Vercel-AI-SDK Data Stream Protocol chunks back to the client.
- `lib/chat/routing.ts` — routing taxonomy + orchestrator-forward + AI-SDK encoders. Mirrors the deterministic provider in `@chiefaia/prompt-evals`.

## Routing

Each user message is classified into one of the 10 canonical CAIA subagent roles using deterministic keyword routing. Try:

| Prompt | Routed to | Classification |
|--------|-----------|----------------|
| "Decompose into stories: build a new dashboard" | caia-po | decomposition |
| "Enrich this story with acceptance criteria" | caia-ba | enrichment |
| "Make a build-vs-buy architecture call here" | caia-ea | architecture |
| "Run the DoD checklist on PR 342" | caia-validator | dod-check |
| "Premature completion: typecheck was skipped" | caia-validator | red-flag |
| "Write the unit test plan" | caia-test-design | plan-design |
| "Implement the new authentication endpoint" | caia-coding | implementation |
| "Open the PR with auto-merge" | caia-coding | pr-flow |
| "CI failed — diagnose" | caia-fix-it | failure-diagnosis |
| "Run the steward gatekeeper analysis" | caia-steward | gatekeeper-verdict |
| "Capture this incident as a lesson" | caia-mentor | lesson-capture |
| "Scan findings + emit alarms" | caia-curator | action-routing |

## Orchestrator forwarding (optional)

When `CAIA_ORCHESTRATOR_URL` is set in the dashboard process environment, every chat message is also POSTed to `/prompts` on the orchestrator (fire-and-forget — failures don't block the chat stream). The returned prompt ID is surfaced in the assistant's reply so operators can jump to the prompt-journey UI.

## Subscription-only constraint

The `/api/chat` endpoint NEVER calls Anthropic's API or any paid LLM service. The synthesised response is fully local + deterministic. Operators who want true LLM-backed chat can swap the streamer for `streamText` with an `ollama:llama3.2:3b` provider locally — the AI SDK protocol is provider-agnostic.

## Tests

- `tests/chat-routing.test.ts` — 16 unit tests covering every routing rule + the unrouted fallback.
- `tests/chat-route.test.ts` — 7 integration tests for the POST handler (happy path, 400s, header propagation, orchestrator fail-soft).

Run `pnpm --filter @caia-app/dashboard test`.
