---
"@chiefaia/test-isolation": minor
---

feat(test-isolation): per-test localhost port allocator (FIX-009)

Adds `@chiefaia/test-isolation/ports` to the existing test-isolation
package landed in FIX-008. Exports:

- `allocateTestPort({ testId })` — async, returns a free port on
  127.0.0.1. Deterministic starting offset
  `30000 + sha1(testId) mod 5000` so the same test always lands on the
  same port (reproducible failures).
- `allocateTestPortRange({ testId, count })` — N consecutive free
  ports. Useful for tests that need orchestrator + dashboard + stub on
  adjacent ports.
- `releaseTestPort(port | ports)` — return ports to the in-process
  registry so subsequent tests in the same worker can reuse the slot.
- `listClaimedTestPorts()` — observability hook for the FIX-013
  dashboard panel.
- `deriveStartPort(testId, count, floor, ceiling)` — pure helper,
  exported for testing.
- `DEFAULT_PORT_FLOOR = 30000`, `DEFAULT_PORT_CEILING = 34999`.

The allocator hashes the testId to a starting offset, then probes
forward with `EADDRINUSE` fallback. This is the same shape
`pytest-xdist` and Playwright's worker fixtures use; it gives
deterministic offsets (nice for reproducing failures) plus collision
recovery (nice for parallel safety).

Phase B (FIX-009). Stacks on FIX-008.
