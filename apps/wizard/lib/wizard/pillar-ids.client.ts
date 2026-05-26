/**
 * Client-safe mirror of `@caia/interviewer`'s `PILLAR_IDS` constant.
 *
 * Why duplicate?
 *   `@caia/interviewer`'s `dist/index.js` barrel transitively imports
 *   `@chiefaia/claude-spawner` and (through it) `@chiefaia/tracing`'s
 *   `init.js`, which in turn pulls in `@opentelemetry/sdk-node` →
 *   `@grpc/grpc-js` → Node's `net` module. Next.js's webpack build
 *   then fails any client bundle that touches `@caia/interviewer`
 *   because it can't resolve `net` for the browser/edge runtime.
 *
 *   The safe path: import the engine package only from server-side
 *   code (API routes with `runtime = 'nodejs'`, server components,
 *   and Node-based tests). Client components import this local
 *   constant instead.
 *
 * Why is this not a drift risk?
 *   The `pillar-id-mirror.test.ts` vitest case (Node env — safe to
 *   import the engine) asserts this constant equals
 *   `@caia/interviewer`'s `PILLAR_IDS`. If the engine ever changes
 *   the list, CI fails and we update both.
 */

export const PILLAR_IDS_CLIENT = [
  'B1',
  'B2',
  'B3',
  'B4',
  'B5',
  'B6',
  'B7',
  'B8',
  'B9',
  'B10',
  'B11',
  'B12',
  'B13',
  'B14',
  'B15',
  'B16',
] as const;

export type PillarIdClient = (typeof PILLAR_IDS_CLIENT)[number];
