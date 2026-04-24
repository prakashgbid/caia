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
