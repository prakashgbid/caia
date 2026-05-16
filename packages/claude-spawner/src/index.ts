/**
 * @chiefaia/claude-spawner — public surface.
 *
 * See `spawn.ts` file-level comment for design + constraint rationale.
 */

export {
  spawnClaude,
  buildSpawnArgs,
  buildSpawnEnv,
  parseClaudeJsonEnvelope,
  SpawnClaudeConstraintError,
  SCRUBBED_AUTH_ENV_VARS,
} from './spawn.js';

export type {
  SpawnClaudeInput,
  SpawnClaudeOptions,
  SpawnClaudeConstraints,
  SpawnClaudeResult,
  ClaudeJsonEnvelope,
  ParsedClaudeEnvelope,
} from './spawn.js';

export {
  runClaudeWrap,
  parseArgs as parseClaudeWrapArgs,
  decideRoute,
  synthesiseClaudeJsonEnvelope,
  buildLogLine,
  hashPrompt,
  DEFAULT_LOG_DIR,
  DEFAULT_ROUTER_URL,
  DEFAULT_REAL_CLAUDE,
} from './claude-wrap.js';

export type { ClaudeWrapDeps, ClaudeWrapResult, ParsedArgs, RouteDecision } from './claude-wrap.js';
