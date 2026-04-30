/**
 * @chiefaia/mcp-allowlist-proxy — public surface.
 */

export {
  ToolAllowanceSchema,
  McpPolicySchema,
  ToolCallRequestSchema,
  type ToolAllowance,
  type McpPolicy,
  type ToolCallRequest,
  type PolicyDecision,
} from './policy.js';
export { McpAllowlistProxy, type ProxyOptions } from './proxy.js';
export {
  buildSandboxedSpawn,
  DEFAULT_STDIO_ALLOWED_COMMANDS,
  type SandboxedSpawnArgs,
} from './sandbox.js';
export {
  assertSpawnCommandAllowed,
  assertNoPublicBind,
  readAllowlistFromEnv,
  basename,
  SpawnAllowlistError,
  PublicBindError,
} from './spawn-allowlist.js';
export {
  isForbiddenSettingsPath,
  assertSettingsPathNotForbidden,
  ADDITIVE_MERGE_ALLOWED_PATH,
  FORBIDDEN_SETTINGS_GLOBS,
  ForbiddenSettingsPathError,
} from './settings-deny-list.js';
