# Mac-side Stolution ops

Operator scripts that run on a developer's Mac to pull / mirror data from the stolution server.

## `pull-stolution-vault-snapshots.sh`

Daily rsync of Vault Raft snapshots from `stolution:~/backups/vault/` to local Mac storage. Off-server backup of every secret-store snapshot, so a server-disk failure can't wipe the only copies.

| | |
|---|---|
| Schedule | Daily 03:30 local (after server-side 02:00 snapshot + 02:05 audit rotation) |
| Source | `s903@stolution:/home/s903/backups/vault/vault-snapshot-*.snap` |
| Local | `~/Library/Application Support/Stolution/vault-snapshots/` |
| Retention | 30 days |
| Log | `~/Library/Logs/stolution-vault-snapshot-pull.log` |
| Verify | newest snapshot < 26h old; non-empty count — exits non-zero on either failure |

The companion launchd plist is `com.stolution.vault-snapshot-pull.plist`. Both are installed to their canonical locations by `install.sh`.

### Install / re-install

```sh
cd apps/stolution-mcp/ops/mac
./install.sh
```

The installer is idempotent. It copies the script to `~/bin/`, writes the plist to `~/Library/LaunchAgents/` with `$HOME` substituted, and reloads the LaunchAgent.

### Manual trigger

```sh
launchctl start com.stolution.vault-snapshot-pull
tail -f ~/Library/Logs/stolution-vault-snapshot-pull.log
```

### Uninstall

```sh
launchctl unload ~/Library/LaunchAgents/com.stolution.vault-snapshot-pull.plist
rm ~/Library/LaunchAgents/com.stolution.vault-snapshot-pull.plist
rm ~/bin/pull-stolution-vault-snapshots.sh
```

Local snapshots under `~/Library/Application Support/Stolution/vault-snapshots/` are not touched by uninstall.

### Optional external-disk mirror

Set `EXTERNAL_MIRROR_DIR` (and optionally `EXTERNAL_MIRROR_WEEKDAY`, default `0` for Sunday) to enable a weekly mirror to an external drive. Silently skipped if the path is unset or not mounted, so a missing external drive never blocks the primary pull.

```sh
# In ~/.zshrc or as a launchd EnvironmentVariables entry:
export EXTERNAL_MIRROR_DIR="/Volumes/Backup/stolution-vault-snapshots"
```

### Prerequisites

- SSH alias `stolution` configured in `~/.ssh/config` with key auth (no password prompt). Verify with `ssh -o BatchMode=yes stolution echo ok`.
- `rsync` available on `PATH` (default macOS install is fine; Homebrew rsync also works).
