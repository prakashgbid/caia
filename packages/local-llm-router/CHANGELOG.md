# @chiefaia/local-llm-router

## 0.2.0

### Minor Changes

- 3746380: Initial release of `@chiefaia/local-llm-router`, lifted from `prakashgbid/conductor` (`archive/conductor-claude-exec-token-phase2-2026-04-28` branch). Routes simple CAIA tasks (classification, dedup, story enrichment, status summaries) to a local Ollama daemon (`qwen2.5-coder:7b`, `llama3.1:8b`); routes complex tasks (hierarchy decomposition, architecture decisions, security review) to the Claude API. Cuts projected monthly token spend by ~65–70% at 1k agent invocations/day. Wired into the orchestrator via three new endpoints (`GET /llm/rules`, `GET /llm/rules/:taskType`, `POST /llm/route`).
