# @caia/secrets-postgres

## 0.1.0

### Minor Changes

- Initial release. `PostgresSecretsAdapter` with AES-256-GCM per-tenant
  HKDF derivation, crypto-shred GDPR-delete, audit-log writes to
  `caia_meta.audit_log`.
