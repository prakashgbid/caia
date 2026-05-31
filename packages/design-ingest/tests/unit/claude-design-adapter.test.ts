/**
 * Unit tests for `ClaudeDesignAdapter` (Phase B B2).
 *
 * We inject `spawnImpl` + `parseEnvelopeImpl` so the suite never spawns
 * a real `claude` subprocess. 15 cases total. The brief requested >=10.
 */
import { describe, it, expect } from 'vitest';
import {
  ClaudeDesignAdapter,
  buildClaudeDesignPrompt,
  type ClaudeDesignAdapterDeps,
} from '../../src/claude-design-adapter.js';
import type { AdapterInput } from '../../src/types.js';
import type {
  SpawnClaudeInput,
  SpawnClaudeResult,
} from '@chiefaia/claude-spawner';
import { minimalDesign, asSnapshotter, StubSnapshotter } from '../helpers/fixtures.js';
import { FakePool } from '../helpers/fake-pg.js';
import type { SecretsAdapter, AccessContext } from '@caia/secrets-adapter';
import type { BYOCBlobAdapter } from '@caia/atlas-design-snapshotter';
import { RefreshNotSupported } from '../../src/errors.js';

const stubSecrets = {} as unknown as SecretsAdapter;
const stubStorage = {} as unknown as BYOCBlobAdapter;
const stubAccessContext = { callerId: 'test-caller', callerKind: 'test' } as unknown as AccessContext;

function deps(overrides: Partial<ClaudeDesignAdapterDeps> = {}): ClaudeDesignAdapterDeps {
  return {
    secrets: stubSecrets,
    storage: stubStorage,
    pg: new FakePool(),
    snapshotter: asSnapshotter(new StubSnapshotter()),
    accessContext: stubAccessContext,
    ...overrides,
  };
}

function okSpawnResult(stdout: string): SpawnClaudeResult {
  return {
    ok: true,
    rc: 0,
    stdout,
    stderr: '',
    timedOut: false,
    durationMs: 100,
    diagnostic: null,
    accountId: null,
  };
}

function failSpawnResult(diagnostic: string): SpawnClaudeResult {
  return {
    ok: false,
    rc: 1,
    stdout: '',
    stderr: '',
    timedOut: false,
    durationMs: 50,
    diagnostic,
    accountId: null,
  };
}

const REMOTE_INPUT: AdapterInput = {
  kind: 'remote',
  tenantId: 't-test',
  sourceConfig: {
    promptText: 'Design a clean dashboard',
    designVersionId: 'dv-test-1',
  },
};

describe('ClaudeDesignAdapter.validate', () => {
  it('returns ok:true for a well-shaped remote input', async () => {
    const adapter = new ClaudeDesignAdapter(deps());
    const r = await adapter.validate(REMOTE_INPUT);
    expect(r.ok).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it('returns ok:false on upload-kind input', async () => {
    const adapter = new ClaudeDesignAdapter(deps());
    const r = await adapter.validate({ kind: 'upload', uploadId: 'u1', tenantId: 't1' });
    expect(r.ok).toBe(false);
    expect(r.errors[0]?.code).toBe('claude_design_requires_remote_input');
  });

  it('returns ok:false when promptText is missing', async () => {
    const adapter = new ClaudeDesignAdapter(deps());
    const r = await adapter.validate({
      kind: 'remote',
      tenantId: 't1',
      sourceConfig: { designVersionId: 'dv-1' },
    });
    expect(r.ok).toBe(false);
    expect(r.errors[0]?.code).toBe('claude_design_prompt_required');
  });

  it('returns ok:false when promptText is whitespace-only', async () => {
    const adapter = new ClaudeDesignAdapter(deps());
    const r = await adapter.validate({
      kind: 'remote',
      tenantId: 't1',
      sourceConfig: { promptText: '   ', designVersionId: 'dv-1' },
    });
    expect(r.ok).toBe(false);
    expect(r.errors[0]?.code).toBe('claude_design_prompt_required');
  });

  it('returns ok:false when designVersionId is missing', async () => {
    const adapter = new ClaudeDesignAdapter(deps());
    const r = await adapter.validate({
      kind: 'remote',
      tenantId: 't1',
      sourceConfig: { promptText: 'something' },
    });
    expect(r.ok).toBe(false);
    expect(r.errors[0]?.code).toBe('claude_design_version_id_required');
  });
});

describe('ClaudeDesignAdapter.parse - success', () => {
  it('returns the validated RenderableDesign on a clean envelope', async () => {
    const design = minimalDesign({ designVersionId: 'dv-test-1' });
    const envelopeStdout = JSON.stringify({ result: JSON.stringify(design) });
    const adapter = new ClaudeDesignAdapter(
      deps({ spawnImpl: async () => okSpawnResult(envelopeStdout) }),
    );
    const out = await adapter.parse(REMOTE_INPUT);
    expect(out.designVersionId).toBe('dv-test-1');
    expect(out.routes[0]?.path).toBe('/');
  });

  it('threads model + timeoutMs from sourceConfig into spawnImpl options', async () => {
    const captured: SpawnClaudeInput[] = [];
    const design = minimalDesign({ designVersionId: 'dv-test-2' });
    const envelopeStdout = JSON.stringify({ result: JSON.stringify(design) });
    const adapter = new ClaudeDesignAdapter(
      deps({
        spawnImpl: async (i: SpawnClaudeInput) => {
          captured.push(i);
          return okSpawnResult(envelopeStdout);
        },
      }),
    );
    await adapter.parse({
      kind: 'remote',
      tenantId: 't-test',
      sourceConfig: {
        promptText: 'design',
        designVersionId: 'dv-test-2',
        model: 'claude-opus-4',
        timeoutMs: 30_000,
      },
    });
    expect(captured[0]?.options?.model).toBe('claude-opus-4');
    expect(captured[0]?.options?.timeoutMs).toBe(30_000);
    expect(captured[0]?.options?.outputFormat).toBe('json');
  });
});

describe('ClaudeDesignAdapter.parse - failure', () => {
  it('throws claude_spawn_failed when spawn returns ok=false', async () => {
    const adapter = new ClaudeDesignAdapter(
      deps({ spawnImpl: async () => failSpawnResult('binary not found') }),
    );
    await expect(adapter.parse(REMOTE_INPUT)).rejects.toMatchObject({
      code: 'claude_spawn_failed',
    });
  });

  it('throws claude_envelope_invalid when parseClaudeJsonEnvelope rejects', async () => {
    const adapter = new ClaudeDesignAdapter(
      deps({
        spawnImpl: async () => okSpawnResult('not-json'),
        parseEnvelopeImpl: () => ({ ok: false, diagnostic: 'envelope JSON parse failed' }),
      }),
    );
    await expect(adapter.parse(REMOTE_INPUT)).rejects.toMatchObject({
      code: 'claude_envelope_invalid',
    });
  });

  it('throws claude_design_json_parse_failed when envelope.result is not JSON', async () => {
    const adapter = new ClaudeDesignAdapter(
      deps({
        spawnImpl: async () => okSpawnResult('{"result":"hi"}'),
        parseEnvelopeImpl: () => ({
          ok: true,
          text: 'not-json',
          envelope: { result: 'not-json' },
        }),
      }),
    );
    await expect(adapter.parse(REMOTE_INPUT)).rejects.toMatchObject({
      code: 'claude_design_json_parse_failed',
    });
  });

  it('throws claude_design_schema_invalid when JSON misses required fields', async () => {
    const adapter = new ClaudeDesignAdapter(
      deps({
        spawnImpl: async () => okSpawnResult('{"result":"{}"}'),
        parseEnvelopeImpl: () => ({
          ok: true,
          text: '{}',
          envelope: { result: '{}' },
        }),
      }),
    );
    await expect(adapter.parse(REMOTE_INPUT)).rejects.toMatchObject({
      code: 'claude_design_schema_invalid',
    });
  });

  it('refresh always throws RefreshNotSupported', async () => {
    const adapter = new ClaudeDesignAdapter(deps());
    await expect(adapter.refresh('dv-1')).rejects.toBeInstanceOf(RefreshNotSupported);
  });
});

describe('ClaudeDesignAdapter - contract', () => {
  it('exposes sourceName claude-design and subscription-only capabilities', () => {
    const adapter = new ClaudeDesignAdapter(deps());
    expect(adapter.sourceName).toBe('claude-design');
    expect(adapter.capabilities.requiresCredential).toBe(false);
    expect(adapter.capabilities.supportsRefresh).toBe(false);
    expect(adapter.capabilities.supportsLiveWebhook).toBe(false);
  });
});

describe('buildClaudeDesignPrompt', () => {
  it('inlines the supplied designVersionId', () => {
    const out = buildClaudeDesignPrompt('design a thing', 'dv-abc');
    expect(out).toContain('designVersionId="dv-abc"');
  });

  it('inlines the supplied promptText', () => {
    const out = buildClaudeDesignPrompt('design a thing', 'dv-1');
    expect(out).toContain('design a thing');
    expect(out).toContain('JSON object ONLY');
  });
});
