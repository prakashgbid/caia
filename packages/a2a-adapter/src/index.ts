/**
 * @chiefaia/a2a-adapter — TypeScript façade over @a2a-js/sdk.
 *
 * Per p4_agent_mesh_implementation_plan_2026_05_16.md §4.2:
 *   "A2A SDK — Linux Foundation A2A v1.2. Install paths: Python
 *    (`pip install a2a-sdk==1.2.*`), TS/JS (`npm install @a2a/sdk@1.2`).
 *    Wrapped behind `@chiefaia/a2a-adapter`."
 *
 * Plan version pins out of date as of 2026-05-17. Actual pins (verified
 * against npm/PyPI):
 *   - TS: @a2a-js/sdk@^0.3 (the @a2a/sdk@1.2 name doesn't exist)
 *   - Python: a2a-sdk@^1.0 (plan asked for 1.2.*; 1.0 is current stable)
 *
 * Documented in p5_m0_m1_execution_2026_05_17.md.
 */
export * from './client.js';
export * from './server.js';
export * from './agent-card.js';
export * from './types.js';
