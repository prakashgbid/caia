# `@caia/secrets-infisical`

> Phase-1 hot-path `SecretsAdapter` for CAIA.

Self-hosted Infisical. Project-per-tenant isolation. Machine-identity
universal-auth. Optional Cloudflare-Access service-token headers for
deployments behind Cloudflare Tunnel.

## What you get

- `InfisicalSecretsAdapter` — implements `SecretsAdapter` from
  `@caia/secrets-adapter`.
- `InfisicalAuth` — universal-auth machine identity login + access-token
  cache + auto-refresh.
- `InfisicalClient` — thin V3 HTTP client (get / put / patch / delete /
  list raw secrets).
- `ConfigMapProjectResolver`, `FunctionProjectResolver` — tenant→project
  mapping.
- `NoopAuditLogger`, `InMemoryAuditLogger` — audit-log pluggability;
  inject `PostgresAuditLogger` from `@caia/secrets-postgres` for the
  canonical persistent log.

## Quickstart

```ts
import {
  InfisicalSecretsAdapter,
  ConfigMapProjectResolver,
} from '@caia/secrets-infisical';

const adapter = new InfisicalSecretsAdapter({
  baseUrl: 'https://infisical.chiefaia.com',
  auth: {
    type: 'universal-auth',
    clientId: process.env.INFISICAL_CLIENT_ID!,
    clientSecret: process.env.INFISICAL_CLIENT_SECRET!,
  },
  cloudflareAccess: {
    clientId: process.env.CF_ACCESS_CLIENT_ID!,
    clientSecret: process.env.CF_ACCESS_CLIENT_SECRET!,
  },
  projectResolver: new ConfigMapProjectResolver({
    'tenant-prakash': 'wsk_uuid_for_prakash',
    'tenant-acme': 'wsk_uuid_for_acme',
  }),
  environment: 'prod',
});

await adapter.put('tenant-prakash', 'cloud.aws', 'access_key', 'AKIA...');
const value = await adapter.get('tenant-prakash', 'cloud.aws', 'access_key', {
  callerType: 'agent',
  callerId: 'deploy-worker-7',
  reason: 'push docker image',
});
```

## Env

| name | required | description |
|---|---|---|
| `INFISICAL_URL` | for integration tests | `https://infisical.chiefaia.com` |
| `INFISICAL_CLIENT_ID` | for integration tests | machine identity universal-auth client id |
| `INFISICAL_CLIENT_SECRET` | for integration tests | machine identity universal-auth client secret |
| `INFISICAL_TEST_WORKSPACE_ID` | for integration tests | a project the machine identity can write to |
| `CF_ACCESS_CLIENT_ID` | when behind CF Access | Cloudflare Access service-token client id |
| `CF_ACCESS_CLIENT_SECRET` | when behind CF Access | Cloudflare Access service-token client secret |

## Reference

`research/multi_tenant_secrets_architecture_2026.md` §1, §3 (Pattern B),
§5, §9.
