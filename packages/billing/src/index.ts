/**
 * @caia/billing — public entrypoint.
 *
 * Re-exports the full surface so consumers `import { ... } from '@caia/billing'`.
 * Route-handler factories live under `./api` to keep Next-specific
 * code paths discoverable.
 */

export * from './types.js';
export * from './stripe-client.js';
export * from './subscription.js';
export * from './subscription-store.js';
export * from './webhooks.js';
export * from './byok.js';
export * from './runtime-key-audit-store.js';
export * from './events.js';
export * from './api.js';
export type {
  AccessContext,
  CallerType,
  SecretsAdapter,
  PutOptions,
  PutResult,
  DeleteOptions,
  SecretMetadata,
} from './secrets-adapter.js';
export { isSecretNotFound, SecretNotFoundLike } from './secrets-adapter.js';
