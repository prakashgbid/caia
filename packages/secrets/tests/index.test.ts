import { describe, it, expect } from 'vitest';
import { MemorySecretsAdapter, FileVaultAdapter, createSecretsClient } from '../src/index.js';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

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

  it('set adds a new key', async () => {
    const adapter = new MemorySecretsAdapter();
    adapter.set('NEW', 'value');
    expect(await adapter.fetch('NEW')).toBe('value');
  });

  it('set updates an existing key', async () => {
    const adapter = new MemorySecretsAdapter({ X: 'old' });
    adapter.set('X', 'new');
    expect(await adapter.fetch('X')).toBe('new');
  });

  it('list returns empty array when empty', async () => {
    const adapter = new MemorySecretsAdapter();
    expect(await adapter.list()).toEqual([]);
  });
});

describe('FileVaultAdapter', () => {
  function tmpVaultPath(): string {
    const dir = mkdtempSync(join(tmpdir(), 'vault-test-'));
    return join(dir, 'secrets.json');
  }

  it('fetches a secret from a JSON file', async () => {
    const path = tmpVaultPath();
    writeFileSync(path, JSON.stringify({ TOKEN: 'abc123' }));
    const adapter = new FileVaultAdapter(path);
    expect(await adapter.fetch('TOKEN')).toBe('abc123');
  });

  it('throws for missing key', async () => {
    const path = tmpVaultPath();
    writeFileSync(path, JSON.stringify({}));
    const adapter = new FileVaultAdapter(path);
    await expect(adapter.fetch('MISSING')).rejects.toThrow("Secret 'MISSING' not found");
  });

  it('returns empty array when file does not exist', async () => {
    const adapter = new FileVaultAdapter('/tmp/nonexistent-vault-xyz.json');
    expect(await adapter.list()).toEqual([]);
  });

  it('lists keys from file', async () => {
    const path = tmpVaultPath();
    writeFileSync(path, JSON.stringify({ A: '1', B: '2' }));
    const adapter = new FileVaultAdapter(path);
    expect(await adapter.list()).toEqual(expect.arrayContaining(['A', 'B']));
  });

  it('set writes a new key to the file', async () => {
    const path = tmpVaultPath();
    const adapter = new FileVaultAdapter(path);
    await adapter.set('KEY', 'value');
    expect(await adapter.fetch('KEY')).toBe('value');
  });

  it('set updates an existing key', async () => {
    const path = tmpVaultPath();
    writeFileSync(path, JSON.stringify({ X: 'old' }));
    const adapter = new FileVaultAdapter(path);
    await adapter.set('X', 'new');
    expect(await adapter.fetch('X')).toBe('new');
  });
});

describe('createSecretsClient', () => {
  it('getAll returns all requested secrets', async () => {
    const adapter = new MemorySecretsAdapter({ X: 'x-val', Y: 'y-val' });
    const client = createSecretsClient(adapter);
    const result = await client.getAll(['X', 'Y']);
    expect(result).toEqual({ X: 'x-val', Y: 'y-val' });
  });

  it('get delegates to adapter', async () => {
    const adapter = new MemorySecretsAdapter({ K: 'v' });
    const client = createSecretsClient(adapter);
    expect(await client.get('K')).toBe('v');
  });

  it('get throws for missing key', async () => {
    const adapter = new MemorySecretsAdapter();
    const client = createSecretsClient(adapter);
    await expect(client.get('MISSING')).rejects.toThrow();
  });

  it('getAll with empty array returns empty object', async () => {
    const adapter = new MemorySecretsAdapter();
    const client = createSecretsClient(adapter);
    expect(await client.getAll([])).toEqual({});
  });
});
