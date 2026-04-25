import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { VaultAdapter } from './types.js';

const execAsync = promisify(exec);

/**
 * Reads secrets from stolution:/home/s903/.vault/*.env via SSH.
 *
 * Path convention: "kv/ga4/pokerzeno" → ~/.vault/ga4-pokerzeno.env
 * Each file contains KEY=value lines (chmod 600 on the server).
 */
export class SshFileVaultAdapter implements VaultAdapter {
  readonly name = 'ssh-file-vault';

  private readonly sshHost: string;
  private readonly vaultDir: string;

  constructor(opts?: { sshHost?: string; vaultDir?: string }) {
    this.sshHost = opts?.sshHost ?? (process.env['VAULT_SSH_HOST'] ?? 'stolution');
    this.vaultDir = opts?.vaultDir ?? (process.env['VAULT_DIR'] ?? '/home/s903/.vault');
  }

  /** "kv/ga4/pokerzeno" → "ga4-pokerzeno" */
  private pathToFilename(path: string): string {
    return path.replace(/^kv\//, '').replace(/\//g, '-');
  }

  async fetchSecret(path: string, key: string): Promise<string> {
    const filename = `${this.pathToFilename(path)}.env`;
    const fullPath = `${this.vaultDir}/${filename}`;
    const escapedKey = key.replace(/[^a-zA-Z0-9_]/g, '');
    // grep -m1 handles values containing '=' (e.g. base64); cut -d= -f2- gets everything after first '='
    const { stdout } = await execAsync(
      `ssh ${this.sshHost} "grep -m1 '^${escapedKey}=' ${fullPath} | cut -d= -f2-"`,
    );
    const value = stdout.trim();
    if (!value) throw new Error(`Secret '${key}' not found at '${path}' (${filename})`);
    return value;
  }

  async listPaths(pathPrefix: string): Promise<string[]> {
    const prefix = this.pathToFilename(pathPrefix);
    const { stdout } = await execAsync(
      `ssh ${this.sshHost} "ls ${this.vaultDir}/${prefix}*.env 2>/dev/null | xargs -I{} basename {} .env"`,
    );
    return stdout.trim().split('\n').filter(Boolean);
  }

  async writeSecret(path: string, key: string, value: string): Promise<void> {
    const filename = `${this.pathToFilename(path)}.env`;
    const fullPath = `${this.vaultDir}/${filename}`;
    const escapedKey = key.replace(/[^a-zA-Z0-9_]/g, '');
    // Escape single quotes in value for SSH
    const escapedValue = value.replace(/'/g, "'\\''");
    await execAsync(
      `ssh ${this.sshHost} "if grep -q '^${escapedKey}=' ${fullPath} 2>/dev/null; then sed -i 's|^${escapedKey}=.*|${escapedKey}=${escapedValue}|' ${fullPath}; else echo '${escapedKey}=${escapedValue}' >> ${fullPath}; fi && chmod 600 ${fullPath}"`,
    );
  }
}

/**
 * Reads secrets from HashiCorp Vault via HTTP API.
 * Uses KV v2 by default (path prefix: secret/data/).
 *
 * Blocker BL-VAULT-ENABLE: if using this adapter, run on stolution:
 *   vault secrets enable -path=kv kv-v2
 */
export class HashiCorpVaultAdapter implements VaultAdapter {
  readonly name = 'hashicorp-vault';

  private readonly vaultAddr: string;
  private readonly vaultToken: string;
  private readonly kvMount: string;

  constructor(opts?: { addr?: string; token?: string; kvMount?: string }) {
    this.vaultAddr = opts?.addr ?? (process.env['VAULT_ADDR'] ?? 'http://localhost:8200');
    this.vaultToken = opts?.token ?? (process.env['VAULT_TOKEN'] ?? '');
    this.kvMount = opts?.kvMount ?? (process.env['VAULT_KV_MOUNT'] ?? 'kv');
    if (!this.vaultToken) throw new Error('HashiCorpVaultAdapter: VAULT_TOKEN is required');
  }

  private dataUrl(path: string): string {
    // Strip leading "kv/" if callers pass it through
    const stripped = path.replace(/^kv\//, '');
    return `${this.vaultAddr}/v1/${this.kvMount}/data/${stripped}`;
  }

  async fetchSecret(path: string, key: string): Promise<string> {
    const res = await fetch(this.dataUrl(path), {
      headers: { 'X-Vault-Token': this.vaultToken },
    });
    if (!res.ok) throw new Error(`Vault fetch failed: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as { data?: { data?: Record<string, string> } };
    const value = body.data?.data?.[key];
    if (value === undefined) throw new Error(`Secret '${key}' not found at '${path}'`);
    return value;
  }

  async listPaths(pathPrefix: string): Promise<string[]> {
    const stripped = pathPrefix.replace(/^kv\//, '');
    const res = await fetch(`${this.vaultAddr}/v1/${this.kvMount}/metadata/${stripped}?list=true`, {
      method: 'GET',
      headers: { 'X-Vault-Token': this.vaultToken, 'X-Vault-Request': 'true' },
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { data?: { keys?: string[] } };
    return body.data?.keys ?? [];
  }

  async writeSecret(path: string, key: string, value: string): Promise<void> {
    const res = await fetch(this.dataUrl(path), {
      method: 'POST',
      headers: { 'X-Vault-Token': this.vaultToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { [key]: value } }),
    });
    if (!res.ok) throw new Error(`Vault write failed: ${res.status} ${await res.text()}`);
  }
}

export function createVaultAdapter(type?: string): VaultAdapter {
  const kind = type ?? (process.env['VAULT_ADAPTER'] ?? 'ssh-file');
  if (kind === 'hashicorp') return new HashiCorpVaultAdapter();
  return new SshFileVaultAdapter();
}
