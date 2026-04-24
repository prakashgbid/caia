# @chiefaia/secrets

Secret management client for CAIA applications.

## Install

```bash
pnpm add @chiefaia/secrets
```

## Usage

```ts
import { createSecretsClient, MemorySecretsAdapter } from '@chiefaia/secrets';

// Development: in-memory adapter
const client = createSecretsClient(new MemorySecretsAdapter({
  DATABASE_PASSWORD: 'dev-password',
}));

const dbPass = await client.get('DATABASE_PASSWORD');

// Production: wire up SshFileVaultAdapter from @plugins/secrets-broker
// (adapter interface is identical — swap without changing call sites)
```

## Adapters

| Adapter | Use |
|---------|-----|
| `MemorySecretsAdapter` | Tests and local dev |
| SSH file vault (external) | Production via `@plugins/secrets-broker` |
