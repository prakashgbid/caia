# @chiefaia/orchestrator-elevate

Root-owned sudo wrapper + scoped Vault AppRole for permanent Cowork orchestrator privilege escalation on stolution. Single NOPASSWD entry point with exhaustive allowlisting and JSONL audit logging.

## Problem

The Cowork orchestrator on M1 (Mac) needs to perform privileged operations on the stolution server (e.g., install systemd units, update sudoers, manage services) without requiring operator (human) involvement for each escalation. Prior approach: operator types sudo password each time. Goal: zero recurring operator-sudo involvement after one-time bootstrap.

## Solution

Three-layer architecture:

1. **`/usr/local/bin/orchestrator-exec`** — Root-owned bash wrapper script
   - Only NOPASSWD entry point for privilege escalation
   - Exhaustive allowlist of operations (6 ops, closed set)
   - Validates every input (unit names, paths, package names)
   - All invocations logged to JSONL + syslog
   - Fails closed on ambiguity

2. **`/etc/sudoers.d/orchestrator`** — Single sudoers line
   - `s903 ALL=(root) NOPASSWD: /usr/local/bin/orchestrator-exec`
   - No other escalation paths for s903
   - Easy revocation: `rm /etc/sudoers.d/orchestrator`

3. **Vault AppRole `orchestrator`** — Scoped credential access
   - Read-only access to `secret/orchestrator/*` namespace
   - Denied access to `sys/`, `auth/`, `secret/master/*`
   - 24h token TTL, 720h max TTL (30 days)
   - 365-day secret ID TTL
   - Credentials stored at `/home/s903/.orchestrator-vault-creds` (mode 0600)

## Installation (One-Time)

### Prerequisites

- stolution server with sudo access
- Vault running and accessible
- Vault root token or admin token (temporary, used once)

### Bootstrap Steps

1. Clone/stage this package on stolution.
2. Copy artifacts to /tmp:
   ```bash
   cp packages/orchestrator-elevate/bin/orchestrator-exec /tmp/
   cp packages/orchestrator-elevate/etc/orchestrator.sudoers /tmp/
   cp packages/orchestrator-elevate/etc/orchestrator-policy.hcl /tmp/
   chmod +x /tmp/orchestrator-exec
   ```

3. Run the bootstrap installer:
   ```bash
   export VAULT_ADDR=http://localhost:8200
   bash /tmp/bootstrap-orchestrator-elevate.sh
   ```

4. The script will prompt for:
   - Confirmation to proceed
   - Vault root token (one-time, not stored)

5. Outputs:
   - `/usr/local/bin/orchestrator-exec` — wrapper script
   - `/etc/sudoers.d/orchestrator` — sudoers entry
   - `/home/s903/.orchestrator-vault-creds` — Vault AppRole creds (role_id + secret_id, one per line)

6. Cleanup:
   ```bash
   rm /tmp/orchestrator-exec /tmp/orchestrator.sudoers /tmp/orchestrator-policy.hcl /tmp/bootstrap-orchestrator-elevate.sh
   unset VAULT_TOKEN
   ```

## Allowlist

### 1. `install-systemd-unit <unit-name> <unit-file-path>`

Install a systemd unit file.

- **unit-name**: Must match `^(actions\.runner\.[a-z-]+|caia-[a-z-]+|stolution-[a-z-]+|cowork-[a-z-]+)\.service$`
  - Examples: `actions.runner.caia-1.service`, `stolution-worker.service`
  - Rejects: `app.service`, `evil.service`, anything outside the namespace
  
- **unit-file-path**: Must be under `/tmp/` or `/home/s903/` (no `..` traversal)

- **Action**: Installs to `/etc/systemd/system/<unit-name>` with mode 0644

- **Protection**: Refuses to overwrite existing units unless owned by root with mode 0644

Example:
```bash
sudo /usr/local/bin/orchestrator-exec install-systemd-unit actions.runner.caia-2.service /tmp/my-unit.service
```

### 2. `systemctl-action <action> <unit-pattern>`

Wrapper around systemctl commands.

- **action**: One of: `enable`, `disable`, `start`, `stop`, `restart`, `reload`, `status`, `is-active`, `is-enabled`, `daemon-reload`
  - `daemon-reload` does not require a unit
  
- **unit-pattern**: Must match the same regex as install-systemd-unit (unless action is `daemon-reload`)

Example:
```bash
sudo /usr/local/bin/orchestrator-exec systemctl-action daemon-reload
sudo /usr/local/bin/orchestrator-exec systemctl-action start actions.runner.caia-1.service
```

### 3. `install-sudoers-entry <name> <source-path>`

Install a sudoers configuration file.

- **name**: Must match `^[a-z][a-z0-9-]*-orchestrator$`
  - Examples: `runner-pool-orchestrator`, `cron-orchestrator`
  - Rejects: `orchestrator`, `Orchestrator`, `runner`, uppercase, underscores

- **source-path**: Must be under `/tmp/` or `/home/s903/`

- **Action**:
  - Validates syntax via `visudo -c -f <source>`
  - Adds marker comment: `# Installed by orchestrator-exec at <UTC-timestamp>`
  - Installs to `/etc/sudoers.d/<name>` with mode 0440

- **Protection**: Refuses to overwrite existing entries unless marked as orchestrator-installed

Example:
```bash
# Write sudoers file to /tmp/runner-pool-orchestrator
echo "runner ALL=(root) NOPASSWD: /usr/bin/systemctl restart docker" > /tmp/runner-sudoers
sudo /usr/local/bin/orchestrator-exec install-sudoers-entry runner-pool-orchestrator /tmp/runner-sudoers
```

### 4. `apt-install-package <package>`

Install a package (vetted list only).

- **package**: Must be in the hardcoded vetted list:
  - `curl`, `jq`, `git`, `tmux`, `htop`, `iotop`, `tree`, `unzip`, `zip`
  - `nodejs`, `npm`
  - `nginx`, `certbot`, `python3-certbot-nginx`
  - `postgresql-client`, `redis-tools`
  - `prometheus-node-exporter`

- **Rejects**: Any package not on this list (e.g., `sudo`, `netcat`, `openssh-server`)

- **Action**: Runs `apt-get install -y <package>`

Example:
```bash
sudo /usr/local/bin/orchestrator-exec apt-install-package curl
sudo /usr/local/bin/orchestrator-exec apt-install-package nodejs
```

### 5. `service-reload <service>`

Reload or restart a system service.

- **service**: Must be one of: `nginx`, `cloudflared`, `prometheus-node-exporter`, `syncthing`

- **Action**: Attempts `systemctl reload <service>`, falls back to `systemctl restart` if reload not supported

Example:
```bash
sudo /usr/local/bin/orchestrator-exec service-reload nginx
```

### 6. `cron-install <name> <source-path>`

Install a cron job.

- **name**: Must match `^[a-z][a-z0-9-]*-orchestrator$`

- **source-path**: Must be under `/tmp/` or `/home/s903/`

- **Action**:
  - Validates via `crontab -T -f <source>` (or basic shell syntax check)
  - Adds marker comment
  - Installs to `/etc/cron.d/<name>` with mode 0644

Example:
```bash
echo '0 */4 * * * root /usr/local/bin/some-task' > /tmp/maintenance-cron
sudo /usr/local/bin/orchestrator-exec cron-install maintenance-orchestrator /tmp/maintenance-cron
```

## Explicit Rejections

The wrapper rejects any of the following:

- **Paths containing `..`** (path traversal)
- **Direct `/etc/sudoers` edits** (only `/etc/sudoers.d/<name>` allowed)
- **Critical system files**: `/etc/passwd`, `/etc/shadow`, `/etc/group`, `/root/`, `/etc/ssh/sshd_config`
- **Self-modification**: `/etc/sudoers.d/orchestrator`, `/usr/local/bin/orchestrator-exec`
- **Packages not on vetted list**
- **Services not on allowed list**
- **Unit names outside the namespace**
- **Unknown operations**

## Logging

### Log File

Every invocation is logged to `/var/log/orchestrator-exec.log` as JSONL (one record per line):

```json
{
  "timestamp": "2026-05-08T17:30:00Z",
  "operation": "install-systemd-unit",
  "result": "success",
  "reject_reason": null,
  "exit_code": 0,
  "duration_ms": 42,
  "caller_uid": 1000,
  "caller_gid": 1000
}
```

### Syslog

Also logged to syslog with tag `orchestrator-exec` and facility `auth.info`:

```bash
May  8 17:30:00 stolution orchestrator-exec[12345]: {"timestamp":"2026-05-08T17:30:00Z",...}
```

### Promtail + Loki

If Loki is deployed, add the promtail config snippet at `etc/promtail-orchestrator-exec.yaml` to your promtail config to ship logs with labels:

```yaml
app=orchestrator-elevate
component=wrapper
operation=<operation>
result=<success|reject|error>
caller_uid=<uid>
```

## Extending the Allowlist

To add a new operation or package:

1. **Add to wrapper**: Edit `bin/orchestrator-exec` to add the new operation/package/service
2. **Update TypeScript constants**: Edit `src/index.ts` to update `VETTED_PACKAGES`, `ALLOWED_SERVICES`, etc.
3. **Add tests**: Update `tests/wrapper.test.sh` and `src/index.test.ts`
4. **Submit PR**: Full review required (security-sensitive)
5. **Deploy**: Re-run bootstrap on stolution to pick up updated wrapper

Example: Adding `htop` package (already included, but the pattern):

```bash
# Edit bin/orchestrator-exec
readonly VETTED_PACKAGES="curl jq git ... htop ..."

# Edit src/index.ts
export const VETTED_PACKAGES = [
  'curl', 'jq', 'git', ..., 'htop', ...
];

# Add test in tests/wrapper.test.sh
assert_failure "Can install htop" "..." || true

# Submit PR, merge, re-run bootstrap
```

## Revocation

To revoke the orchestrator-elevate system:

```bash
# On stolution (with sudo):
sudo rm /usr/local/bin/orchestrator-exec /etc/sudoers.d/orchestrator

# In Vault:
vault policy delete orchestrator
vault delete auth/approle/role/orchestrator

# On s903 home:
rm /home/s903/.orchestrator-vault-creds
```

## Security Model

### Threat: Privilege Escalation

**Mitigation**: NOPASSWD entry is scoped to a single wrapper script. All privilege escalation flows through that one path, which validates every input.

### Threat: Confusion Attack (tricking wrapper with malformed args)

**Mitigation**: Every input is validated against a regex (unit names, paths, package names). Paths are checked for traversal (`..`). Operations are checked against an allowlist.

### Threat: Unauthorized Operations

**Mitigation**: Allowlist is closed (not a blocklist). Unknown operations are rejected. Each operation has explicit rules.

### Threat: Wrapper Self-Modification

**Mitigation**: Explicit check: operations that would modify `/usr/local/bin/orchestrator-exec` are rejected.

### Threat: Vault Token Leakage

**Mitigation**: AppRole credentials are stored at rest in `/home/s903/.orchestrator-vault-creds` with mode 0600. The policy is narrow (read-only to `secret/orchestrator/*`). Credentials rotate via secret ID renewal (365d TTL).

### Threat: Credential Abuse (orchestrator account compromise)

**Mitigation**: AppRole policy explicitly denies `sys/`, `auth/`, and `secret/master/*`. Even if credentials are leaked, attacker can only read `secret/orchestrator/*`.

### Threat: Audit Evasion

**Mitigation**: Logging is append-only (JSONL to file) and also shipped to syslog. Attacker with wrapper access cannot modify logs without also gaining root-level log access.

## Testing

### Unit Tests (bash)

```bash
npm run test:wrapper
# or
bash tests/wrapper.test.sh
```

Tests validation of:
- Unit names (valid/invalid)
- Sudoers names (valid/invalid)
- Path traversal rejection
- Forbidden paths
- Package allowlist
- Service allowlist
- Logging format
- Operation rejection

### TypeScript Tests

```bash
npm run test
```

Tests constants and regex validation.

### Manual Verification

After bootstrap, verify installation:

```bash
# Check wrapper exists and is executable
ls -la /usr/local/bin/orchestrator-exec
# Should output: -rwxr-xr-x 1 root root ...

# Check sudoers entry
sudo cat /etc/sudoers.d/orchestrator
# Should show NOPASSWD entry

# Check Vault AppRole exists
vault read auth/approle/role/orchestrator
# Should show token_ttl=24h, token_policies=["orchestrator"]

# Check credentials are readable by s903
sudo -u s903 cat /home/s903/.orchestrator-vault-creds
# Should show role_id and secret_id, one per line

# Test an operation (daemon-reload is safe)
sudo /usr/local/bin/orchestrator-exec systemctl-action daemon-reload
# Should output: Ran systemctl daemon-reload

# Check logs
tail -f /var/log/orchestrator-exec.log
# Should show JSONL records
```

## Phase B: Cowork Integration

Once this PR merges, Phase B (operator-typed bootstrap) + Phase C (Cowork-side MCP integration) will auto-spawn.

Phase B: 
```bash
# On stolution, one-time:
export VAULT_ADDR=http://localhost:8200
bash bootstrap-orchestrator-elevate.sh
```

Phase C:
- Update `@chiefaia/stolution-remote` MCP to read `/home/s903/.orchestrator-vault-creds`
- Authenticate to Vault via AppRole
- Add tool `stolution_orchestrator_exec` to invoke wrapper without operator involvement
- Smoke-test by installing pending GitHub Actions runners through the new system

## Architecture References

- Design proposal: `~/Documents/projects/reports/orchestrator-elevate-design-proposal-2026-05-08.md`
- Memory doc: `~/Documents/projects/agent-memory/orchestrator_elevate_design_2026-05-08.md`
- CAIA security packages: `@chiefaia/capability-broker`, `@chiefaia/mcp-allowlist-proxy`, `@chiefaia/spend-guard`, `@chiefaia/tool-output-sanitizer`
- Stolution security: `~/Documents/projects/agent-memory/feedback_stolution_extreme_caution.md`

## License

MIT. See LICENSE in the monorepo root.
