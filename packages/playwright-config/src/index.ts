/**
 * @chiefaia/playwright-config
 *
 * Shared Playwright config factory + Browserless pool.
 *
 * - {@link definePlaywrightConfig} — local + Browserless config (FIX-010)
 * - {@link createBrowserlessPool}  — connection pool with retry (FIX-011)
 *
 * Submodules are also reachable directly:
 *
 *   import { definePlaywrightConfig } from '@chiefaia/playwright-config';
 *   import { createBrowserlessPool }   from '@chiefaia/playwright-config/pool';
 */

export {
  definePlaywrightConfig,
  detectMode,
  clampWorkers,
  definePlaywrightTestConfig,
  devices,
} from './config.js';
export type {
  DefinePlaywrightConfigOptions,
  PlaywrightTestConfig,
} from './config.js';

export {
  createBrowserlessPool,
  isTransientBrowserError,
  buildPoolWsEndpoint,
} from './pool.js';
export type {
  BrowserlessPool,
  BrowserlessPoolOptions,
  PoolEvent,
} from './pool.js';
