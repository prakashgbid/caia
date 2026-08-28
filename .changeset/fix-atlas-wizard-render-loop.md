---
"caia": patch
---

fix(wizard): stop AtlasWizardClient re-rendering forever

`AtlasWizardClient` built its `fetchImpl` fallback inline:

    const fetchFn = props.fetchImpl ?? ((...args) => fetch(...args));

That allocated a new closure on every render whenever `fetchImpl` was not
supplied. `httpClient` memoises on `[fetchFn]` and `client` memoises on
`[mockClient, httpClient]`, so both invalidated every render. `useAtlasSse`
keys its effect on `opts.client` and unconditionally calls `setConnected(true)`,
so each render re-subscribed and set state, which re-rendered, which
re-allocated `fetchFn` — an unbounded synchronous loop.

Memoising `fetchFn` on `[props.fetchImpl]` breaks the cycle.

Impact beyond tests: in a browser this pegged the CPU and reopened the SSE
connection to `/api/atlas/project/:id/events` on every frame.

This also unblocks CI for the whole monorepo. `apps/wizard`'s suite hung
indefinitely on `tests/wizard-shell/wizard-steps/atlas.test.tsx` — the loop
is synchronous, so vitest's 5s test timeout never fired and the runner sat
with no output until the job was killed (observed: 58 minutes). Because the
loop blocks at render, no result line was ever printed, which is why it read
as a stalled job rather than a failing test. The suite now completes in
~7 seconds: 34 files, 378 tests, all passing.
