import { describe, it, expect } from 'vitest';
import { MemorySecretsAdapter, createSecretsClient } from '../src/index.js';

describe('MemorySecretsAdapter', () => {
  it('fetches a stored secret', async () => {
    const adapter = new MemorySecretsAdapter({ MY_KEY: 'secret-value' });
    expect(await adapter.fetch('MY_KEY')).toBe('secret-value');
  });

  it('throws for missing secret', async () => {
    const adapter = new MemorySecretsAdapter();
    await expect(adapter.fetch('MISSING')).rejects.toThrow("Secret 'MISSING' not found");
  });

  it('lists keys', async () => {
    const adapter = new MemorySecretsAdapter({ A: '1', B: '2' });
    expect(await adapter.list()).toEqual(expect.arrayContaining(['A', 'B']));
  });
});

describe('createSecretsClient', () => {
  it('getAll returns all requested secrets', async () => {
    const adapter = new MemorySecretsAdapter({ X: 'x-val', Y: 'y-val' });
    const client = createSecretsClient(adapter);
    const result = await client.getAll(['X', 'Y']);
    expect(result).toEqual({ X: 'x-val', Y: 'y-val' });
  });
});
