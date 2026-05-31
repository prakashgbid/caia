# @chiefaia/tracing

## 0.3.1

### Patch Changes

- Phase B B3: add `withClaudeSpawnerSpan` + `withClaudeSpawnerChildSpan`
  for wrapping wizard-side `@chiefaia/claude-spawner` invocations with
  wizard step semantic attributes (`caia.wizard.step`,
  `caia.wizard.project_id`, `caia.claude.prompt_template`,
  `caia.claude.model`, etc). The OTel context manager threads the new
  span as the parent of the spawner's existing `claude.spawn` span so
  W3C TraceContext carries `trace_id` to Tempo end-to-end. Wired into
  the wizard's interview/answer, interview/complete, and
  proposal/generate API routes.

## 0.2.0

### Minor Changes

- 96a6170: Implement OpenTelemetry SDK backend via trace.getTracer with withSpan context manager

## 0.1.0

### Minor Changes

- Initial stub release
