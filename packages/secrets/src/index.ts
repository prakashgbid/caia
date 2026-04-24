import { readFileSync, writeFileSync, existsSync } from 'fs';

export interface SecretValue {
  readonly key: string;
  readonly value: string;
  readonly fetchedAt: Date;
}

export interface SecretsAdapter {
  fetch(key: string): Promise<string>;
  list(): Promise<string[]>;
}

export interface SecretsClient {
  get(key: string): Promise<string>;
  getAll(keys: string[]): Promise<Record<string, string>>;
}

/** In-memory adapter — for tests and local development only */
export class MemorySecretsAdapter implements SecretsAdapter {
  private readonly store: Map<string, string>;

  constructor(values: Record<string, string> = {}) {
    this.store = new Map(Object.entries(values));
  }

  async fetch(key: string): Promise<string> {
    const value = this.store.get(key);
    if (value === undefined) throw new Error(`Secret '${key}' not found`);
    return value;
  }

  async list(): Promise<string[]> {
    return [...this.store.keys()];
  }

  set(key: string, value: string): void {
    this.store.set(key, value);
  }
}

/**
 * File-based vault adapter.
 *
 * Reads secrets from a JSON file at `VAULT_PATH` env var (default: `.secrets.json`).
 * File format: `{ "KEY": "value", ... }`
 *
 * Suitable for local development and CI environments. Do NOT use in production
 * without proper file permissions (600) and encryption at rest.
 */
export class FileVaultAdapter implements SecretsAdapter {
  private readonly vaultPath: string;

  constructor(vaultPath?: string) {
    this.vaultPath = vaultPath ?? process.env['VAULT_PATH'] ?? './.secrets.json';
  }

  private readVault(): Record<string, string> {
    if (!existsSync(this.vaultPath)) return {};
    const raw = readFileSync(this.vaultPath, 'utf-8');
    return JSON.parse(raw) as Record<string, string>;
  }

  private writeVault(data: Record<string, string>): void {
    writeFileSync(this.vaultPath, JSON.stringify(data, null, 2), { encoding: 'utf-8', mode: 0o600 });
  }

  async fetch(key: string): Promise<string> {
    const vault = this.readVault();
    const value = vault[key];
    if (value === undefined) throw new Error(`Secret '${key}' not found in vault at ${this.vaultPath}`);
    return value;
  }

  async list(): Promise<string[]> {
    return Object.keys(this.readVault());
  }

  async set(key: string, value: string): Promise<void> {
    const vault = this.readVault();
    vault[key] = value;
    this.writeVault(vault);
  }
}

export function createSecretsClient(adapter: SecretsAdapter): SecretsClient {
  return {
    async get(key) {
      return adapter.fetch(key);
    },

    async getAll(keys) {
      const entries = await Promise.all(keys.map(async (k) => [k, await adapter.fetch(k)] as const));
      return Object.fromEntries(entries);
    },
  };
}
