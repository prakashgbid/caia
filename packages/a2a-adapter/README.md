# @chiefaia/a2a-adapter

Thin TypeScript wrapper over the Linux Foundation A2A protocol. Provides
client + server primitives so CAIA's mesh supervisor and specialist-agent
shells don't bind directly to the upstream SDK (which is still pre-1.0 in TS).

## Where this is used

- `apps/mesh-supervisor/src/server.ts` — uses `A2AClient` to dispatch
  `tasks/send` to specialist agents from LangGraph nodes.
- `packages/sql-helper/src/index.ts` — wraps `composeSql()` around an
  `A2AClient` pointed at the XiYanSQL endpoint (gated by `MESH_SQL=on`).
- Future specialist agents (Qwen2.5-Coder, Qwen2.5-VL, Granite Guardian,
  Codestral, etc. per the P5 plan §3 M1-M4) use `bindHonoA2A` to expose
  their inference loop as an A2A-compliant endpoint.

## Plan reference

Per `~/Documents/projects/agent-memory/decisions/p4_agent_mesh_implementation_plan_2026_05_16.md`
§4.2 "Net-new dependencies → A2A SDK". The plan called for `@a2a/sdk@1.2`
but that npm name doesn't exist. The actual upstream package is
`@a2a-js/sdk@^0.3` (last published 2026-03-16). Documented in
`p5_m0_m1_execution_2026_05_17.md`.

## Verification

```bash
cd packages/a2a-adapter
pnpm install
pnpm tsc --noEmit
```
