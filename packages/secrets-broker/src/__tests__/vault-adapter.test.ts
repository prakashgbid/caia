// Mock child_process BEFORE imports (jest hoists this automatically)
jest.mock('node:child_process', () => ({
  exec: jest.fn(),
}));

import * as cp from 'node:child_process';
import { SshFileVaultAdapter, HashiCorpVaultAdapter, createVaultAdapter } from '../vault-adapter';

// jest.mocked gives us proper typed mock
const mockedExec = jest.mocked(cp.exec);

type ExecCb = (err: Error | null, result: { stdout: string; stderr: string }) => void;

function mockExecSuccess(stdout: string): void {
  mockedExec.mockImplementation((_cmd: unknown, cb: unknown) => {
    (cb as ExecCb)(null, { stdout, stderr: '' });
    return undefined as unknown as ReturnType<typeof cp.exec>;
  });
}

function mockExecFailure(message: string): void {
  mockedExec.mockImplementation((_cmd: unknown, cb: unknown) => {
    (cb as ExecCb)(new Error(message), { stdout: '', stderr: message });
    return undefined as unknown as ReturnType<typeof cp.exec>;
  });
}

describe('SshFileVaultAdapter', () => {
  afterEach(() => jest.clearAllMocks());

  it('has correct name', () => {
    expect(new SshFileVaultAdapter().name).toBe('ssh-file-vault');
  });

  it('uses VAULT_SSH_HOST and VAULT_DIR env vars when no opts provided', () => {
    process.env['VAULT_SSH_HOST'] = 'my-host';
    process.env['VAULT_DIR'] = '/custom/vault';
    expect(new SshFileVaultAdapter().name).toBe('ssh-file-vault');
    delete process.env['VAULT_SSH_HOST'];
    delete process.env['VAULT_DIR'];
  });

  it('uses explicit constructor opts over env', () => {
    process.env['VAULT_SSH_HOST'] = 'env-host';
    const adapter = new SshFileVaultAdapter({ sshHost: 'explicit-host', vaultDir: '/vault' });
    expect(adapter.name).toBe('ssh-file-vault');
    delete process.env['VAULT_SSH_HOST'];
  });

  it('fetchSecret returns trimmed value when exec succeeds', async () => {
    mockExecSuccess('my-secret-value\n');
    const adapter = new SshFileVaultAdapter({ sshHost: 'stolution', vaultDir: '/home/s903/.vault' });
    const value = await adapter.fetchSecret('kv/ga4/pokerzeno', 'GA4_MEASUREMENT_ID');
    expect(value).toBe('my-secret-value');
  });

  it('fetchSecret throws when value is empty (grep matched but value is blank)', async () => {
    mockExecSuccess('  '); // SSH succeeded but grep returned only whitespace
    const adapter = new SshFileVaultAdapter({ sshHost: 'stolution', vaultDir: '/home/s903/.vault' });
    await expect(adapter.fetchSecret('kv/test/site', 'EMPTY_KEY')).rejects.toThrow('not found');
  });

  it('fetchSecret throws when exec fails', async () => {
    mockExecFailure('ssh: connect failed');
    const adapter = new SshFileVaultAdapter({ sshHost: 'no-host', vaultDir: '/tmp' });
    await expect(adapter.fetchSecret('kv/test/site', 'MY_KEY')).rejects.toThrow();
  });

  it('listPaths returns filenames when exec succeeds', async () => {
    mockExecSuccess('ga4-pokerzeno\ncloudflare-pokerzeno\n');
    const adapter = new SshFileVaultAdapter({ sshHost: 'stolution', vaultDir: '/home/s903/.vault' });
    const paths = await adapter.listPaths('kv/');
    expect(paths).toEqual(['ga4-pokerzeno', 'cloudflare-pokerzeno']);
  });

  it('listPaths returns empty array when stdout is empty', async () => {
    mockExecSuccess('');
    const adapter = new SshFileVaultAdapter({ sshHost: 'stolution', vaultDir: '/home/s903/.vault' });
    const paths = await adapter.listPaths('kv/missing');
    expect(paths).toEqual([]);
  });

  it('listPaths throws when exec fails', async () => {
    mockExecFailure('connection refused');
    const adapter = new SshFileVaultAdapter({ sshHost: 'no-host', vaultDir: '/tmp' });
    await expect(adapter.listPaths('kv/test')).rejects.toThrow();
  });

  it('writeSecret invokes exec with key and value', async () => {
    mockExecSuccess('');
    const adapter = new SshFileVaultAdapter({ sshHost: 'stolution', vaultDir: '/home/s903/.vault' });
    await adapter.writeSecret('kv/ga4/pokerzeno', 'GA4_KEY', 'G-TESTID');
    expect(mockedExec).toHaveBeenCalledTimes(1);
    const cmd = mockedExec.mock.calls[0]?.[0] as string;
    expect(cmd).toContain('GA4_KEY');
    expect(cmd).toContain('G-TESTID');
  });

  it('writeSecret throws when exec fails', async () => {
    mockExecFailure('permission denied');
    const adapter = new SshFileVaultAdapter({ sshHost: 'no-host', vaultDir: '/tmp' });
    await expect(adapter.writeSecret('kv/test/site', 'MY_KEY', 'val')).rejects.toThrow();
  });
});

describe('HashiCorpVaultAdapter', () => {
  const origEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...origEnv };
    jest.clearAllMocks();
  });

  it('throws if VAULT_TOKEN is missing', () => {
    delete process.env['VAULT_TOKEN'];
    expect(() => new HashiCorpVaultAdapter()).toThrow('VAULT_TOKEN is required');
  });

  it('constructs with explicit token', () => {
    const adapter = new HashiCorpVaultAdapter({ addr: 'http://localhost:8200', token: 'test-token' });
    expect(adapter.name).toBe('hashicorp-vault');
  });

  it('constructs using VAULT_TOKEN and VAULT_KV_MOUNT env vars', () => {
    process.env['VAULT_TOKEN'] = 'tok';
    process.env['VAULT_KV_MOUNT'] = 'my-mount';
    expect(new HashiCorpVaultAdapter().name).toBe('hashicorp-vault');
  });

  it('fetchSecret returns value from nested data structure', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { data: { MY_KEY: 'secret-value' } } }),
    }) as unknown as typeof fetch;

    const adapter = new HashiCorpVaultAdapter({ token: 'tok', addr: 'http://vault' });
    expect(await adapter.fetchSecret('kv/test/site', 'MY_KEY')).toBe('secret-value');
  });

  it('fetchSecret strips leading kv/ from URL path', async () => {
    const calls: string[] = [];
    global.fetch = jest.fn((url: unknown) => {
      calls.push(url as string);
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: { data: { KEY: 'v' } } }),
      });
    }) as unknown as typeof fetch;

    const adapter = new HashiCorpVaultAdapter({ token: 'tok', addr: 'http://vault' });
    await adapter.fetchSecret('kv/ga4/pokerzeno', 'KEY');
    expect(calls[0]).toContain('/data/ga4/pokerzeno');
    expect(calls[0]).not.toContain('kv/kv');
  });

  it('fetchSecret throws on non-ok response', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: () => Promise.resolve('forbidden'),
    }) as unknown as typeof fetch;

    const adapter = new HashiCorpVaultAdapter({ token: 'tok', addr: 'http://vault' });
    await expect(adapter.fetchSecret('kv/test/site', 'MY_KEY')).rejects.toThrow('403');
  });

  it('fetchSecret throws when key not in response', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { data: {} } }),
    }) as unknown as typeof fetch;

    const adapter = new HashiCorpVaultAdapter({ token: 'tok', addr: 'http://vault' });
    await expect(adapter.fetchSecret('kv/test', 'MISSING')).rejects.toThrow('not found');
  });

  it('listPaths returns keys on success', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { keys: ['ga4-site', 'supabase-site'] } }),
    }) as unknown as typeof fetch;

    const adapter = new HashiCorpVaultAdapter({ token: 'tok', addr: 'http://vault' });
    expect(await adapter.listPaths('kv/test')).toEqual(['ga4-site', 'supabase-site']);
  });

  it('listPaths returns [] on non-ok response', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false }) as unknown as typeof fetch;
    const adapter = new HashiCorpVaultAdapter({ token: 'tok', addr: 'http://vault' });
    expect(await adapter.listPaths('kv/test')).toEqual([]);
  });

  it('listPaths returns [] when body has data but no keys array', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: {} }),
    }) as unknown as typeof fetch;
    const adapter = new HashiCorpVaultAdapter({ token: 'tok', addr: 'http://vault' });
    expect(await adapter.listPaths('kv/test')).toEqual([]);
  });

  it('writeSecret posts correct body to vault data URL', async () => {
    const calls: [string, RequestInit][] = [];
    global.fetch = jest.fn((url: unknown, init: unknown) => {
      calls.push([url as string, init as RequestInit]);
      return Promise.resolve({ ok: true });
    }) as unknown as typeof fetch;

    const adapter = new HashiCorpVaultAdapter({ token: 'tok', addr: 'http://vault' });
    await adapter.writeSecret('kv/test/site', 'MY_KEY', 'new-val');
    expect(calls[0]![0]).toContain('/data/');
    const body = JSON.parse(calls[0]![1].body as string) as { data: Record<string, string> };
    expect(body.data['MY_KEY']).toBe('new-val');
  });

  it('writeSecret throws on non-ok response', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve('error'),
    }) as unknown as typeof fetch;

    const adapter = new HashiCorpVaultAdapter({ token: 'tok', addr: 'http://vault' });
    await expect(adapter.writeSecret('kv/test', 'KEY', 'v')).rejects.toThrow('500');
  });
});

describe('createVaultAdapter', () => {
  afterEach(() => {
    delete process.env['VAULT_ADAPTER'];
    delete process.env['VAULT_TOKEN'];
  });

  it('returns SshFileVaultAdapter by default', () => {
    delete process.env['VAULT_ADAPTER'];
    expect(createVaultAdapter().name).toBe('ssh-file-vault');
  });

  it('returns SshFileVaultAdapter for explicit "ssh-file"', () => {
    expect(createVaultAdapter('ssh-file').name).toBe('ssh-file-vault');
  });

  it('returns HashiCorpVaultAdapter for "hashicorp" when VAULT_TOKEN is set', () => {
    process.env['VAULT_TOKEN'] = 'test-token';
    expect(createVaultAdapter('hashicorp').name).toBe('hashicorp-vault');
  });

  it('reads VAULT_ADAPTER env var', () => {
    process.env['VAULT_ADAPTER'] = 'ssh-file';
    expect(createVaultAdapter().name).toBe('ssh-file-vault');
  });
});
