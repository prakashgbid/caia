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
