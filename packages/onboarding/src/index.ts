/**
 * `@caia/onboarding` — public surface.
 *
 * The engine is the primary entry point; the wizard server and CLI
 * both instantiate `new OnboardingEngine({ store, secrets })` and
 * call `submitStep` / `stateFor` / `defer`.
 *
 * Re-exports the static category catalog, validator dispatch, and
 * store implementations for direct use from tests + tooling.
 */

export * from './types.js';
export * from './categories/index.js';
export * from './validators/index.js';
export * from './store/index.js';
export * from './engine/index.js';
