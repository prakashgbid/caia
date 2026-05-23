/**
 * `@caia/secrets-infisical` — public surface.
 *
 * Reference: research/multi_tenant_secrets_architecture_2026.md §1, §3
 * (Pattern B), §5.
 */

export {
  InfisicalSecretsAdapter,
  BACKEND_NAME,
  type InfisicalSecretsAdapterOptions,
} from './adapter.js';

export {
  InfisicalAuth,
  type AuthConfig,
  type UniversalAuthConfig,
  type StaticTokenAuthConfig,
  type CloudflareAccessConfig,
  type InfisicalAuthOptions,
} from './auth.js';

export {
  InfisicalClient,
  type InfisicalClientOptions,
  type InfisicalRawSecret,
  type GetSecretParams,
  type PutSecretParams,
  type UpdateSecretParams,
  type DeleteSecretParams,
  type ListSecretsParams,
} from './client.js';

export {
  ConfigMapProjectResolver,
  FunctionProjectResolver,
  type ProjectResolver,
} from './project-resolver.js';

export {
  NoopAuditLogger,
  InMemoryAuditLogger,
  type AuditLogger,
  type AuditWriteParams,
} from './audit.js';
