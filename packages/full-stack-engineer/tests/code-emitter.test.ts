import { describe, expect, it, vi } from 'vitest';

import {
  EmitterError,
  createDeterministicEmitter,
  createSpawnedEmitter,
  extractFilePlan,
  validateFilePlan,
} from '../src/code-emitter.js';
import { readSpec } from '../src/spec-reader.js';
import { makeLoadedTicket, makeTestCase } from './fixtures/ticket-fixture.js';

describe('createDeterministicEmitter', () => {
  it('emits one component file per architect spec', async () => {
    const brief = readSpec(makeLoadedTicket());
    const emitted = await createDeterministicEmitter().emit(brief);
    expect(emitted.frontend.some((f) => f.path === 'src/components/Hello.tsx')).toBe(true);
    expect(emitted.frontend.some((f) => f.path === 'app/page.tsx')).toBe(true);
    expect(emitted.frontend.some((f) => f.path === 'src/state/user.ts')).toBe(true);
  });

  it('scaffolds components with shadcn/ui imports + Tailwind classes only', async () => {
    const brief = readSpec(makeLoadedTicket());
    const emitted = await createDeterministicEmitter().emit(brief);
    const comp = emitted.frontend.find((f) => f.path === 'src/components/Hello.tsx');
    expect(comp?.contents).toContain("from '@/components/ui/button'");
    expect(comp?.contents).toContain("from '@/components/ui/card'");
    expect(comp?.contents).toContain('className=');
    expect(comp?.contents).not.toContain('styled-components');
    expect(comp?.contents).not.toContain('@mui/');
  });

  it('emits endpoint scaffolds in the backend bucket', async () => {
    const brief = readSpec(makeLoadedTicket());
    const emitted = await createDeterministicEmitter().emit(brief);
    expect(emitted.backend.some((f) => f.path === 'src/api/hello.ts')).toBe(true);
    expect(emitted.backend.some((f) => f.path === 'src/services/greeter.ts')).toBe(true);
  });

  it('emits migration files under migrations/ prefix', async () => {
    const brief = readSpec(makeLoadedTicket());
    const emitted = await createDeterministicEmitter().emit(brief);
    expect(emitted.database[0]?.path).toBe('migrations/20260525_init.sql');
    expect(emitted.database[0]?.contents).toContain('CREATE TABLE greetings');
  });

  it('emits one test file per layer with Given/When/Then comments', async () => {
    const loaded = makeLoadedTicket({
      testCases: [
        makeTestCase({ id: 'TC-u1', title: 'a', layer: 'unit', category: 'happy' }),
        makeTestCase({ id: 'TC-u2', title: 'b', layer: 'unit', category: 'happy' }),
        makeTestCase({ id: 'TC-e1', title: 'c', layer: 'e2e', category: 'happy' }),
      ],
    });
    const brief = readSpec(loaded);
    const emitted = await createDeterministicEmitter().emit(brief);
    expect(emitted.tests).toHaveLength(2);
    const unit = emitted.tests.find((f) => f.path.includes('/unit/'));
    expect(unit?.contents).toContain('TC-u1');
    expect(unit?.contents).toContain('Given:');
    expect(unit?.contents).toContain('When:');
    expect(unit?.contents).toContain('Then:');
  });

  it('attaches frontend-architect attribution on component files', async () => {
    const brief = readSpec(makeLoadedTicket());
    const emitted = await createDeterministicEmitter().emit(brief);
    expect(emitted.frontend[0]?.attribution).toContain('frontend-architect');
  });

  it('attaches database-architect attribution on migration files', async () => {
    const brief = readSpec(makeLoadedTicket());
    const emitted = await createDeterministicEmitter().emit(brief);
    expect(emitted.database[0]?.attribution).toContain('database-architect');
  });

  it('attaches test-author attribution on test files', async () => {
    const brief = readSpec(makeLoadedTicket());
    const emitted = await createDeterministicEmitter().emit(brief);
    expect(emitted.tests[0]?.attribution).toContain('test-author');
  });
});

describe('extractFilePlan', () => {
  it('parses a bare JSON reply', () => {
    const r = extractFilePlan('{"frontend":[],"backend":[],"database":[],"tests":[]}');
    expect(r).toEqual({ frontend: [], backend: [], database: [], tests: [] });
  });

  it('parses a fenced ```json block', () => {
    const r = extractFilePlan('```json\n{"frontend":[]}\n```');
    expect(r).toEqual({ frontend: [] });
  });

  it('parses a fenced block without language hint', () => {
    const r = extractFilePlan('```\n{"frontend":[]}\n```');
    expect(r).toEqual({ frontend: [] });
  });

  it('parses prose surrounding a JSON object via brace search', () => {
    const r = extractFilePlan('some prose {"frontend":[]} more prose');
    expect(r).toEqual({ frontend: [] });
  });

  it('returns null on empty input', () => {
    expect(extractFilePlan('')).toBeNull();
    expect(extractFilePlan('   ')).toBeNull();
  });

  it('returns null when no JSON is present', () => {
    expect(extractFilePlan('hello world')).toBeNull();
  });
});

describe('validateFilePlan', () => {
  it('accepts a well-formed plan', () => {
    const r = validateFilePlan({
      frontend: [{ path: 'a.tsx', contents: 'x', attribution: ['frontend-architect'] }],
      backend: [],
      database: [],
      tests: [],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.files.frontend).toHaveLength(1);
  });

  it('rejects a non-object', () => {
    const r = validateFilePlan('nope');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.diagnostic).toContain('not an object');
  });

  it('rejects a missing bucket', () => {
    const r = validateFilePlan({ frontend: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.diagnostic).toContain('backend');
  });

  it('drops malformed entries silently', () => {
    const r = validateFilePlan({
      frontend: [
        { path: 'ok.tsx', contents: 'x' },
        { path: 'bad' }, // missing contents
        'not-an-object',
      ],
      backend: [],
      database: [],
      tests: [],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.files.frontend).toHaveLength(1);
      expect(r.files.frontend[0]?.path).toBe('ok.tsx');
    }
  });

  it('coerces attribution into a string array, dropping non-strings', () => {
    const r = validateFilePlan({
      frontend: [{ path: 'a.tsx', contents: 'x', attribution: ['frontend-architect', 42] }],
      backend: [],
      database: [],
      tests: [],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.files.frontend[0]?.attribution).toEqual(['frontend-architect']);
  });
});

describe('createSpawnedEmitter', () => {
  it('returns parsed files when the spawn succeeds and the envelope is well-formed', async () => {
    const brief = readSpec(makeLoadedTicket());
    const filePlan = JSON.stringify({
      frontend: [{ path: 'a.tsx', contents: `import { Button } from '@/components/ui/button';\nexport default function A() { return null; }`, attribution: ['frontend-architect'] }],
      backend: [],
      database: [],
      tests: [],
    });
    const envelope = JSON.stringify({ type: 'result', result: filePlan, is_error: false });
    const spawnFn = vi.fn().mockResolvedValue({
      ok: true,
      rc: 0,
      stdout: envelope,
      stderr: '',
      timedOut: false,
      durationMs: 1,
      diagnostic: null,
      accountId: null,
    });
    const emitter = createSpawnedEmitter({ spawnFn: spawnFn as never });
    const emitted = await emitter.emit(brief);
    expect(emitted.frontend).toHaveLength(1);
    expect(spawnFn).toHaveBeenCalledOnce();
  });

  it('throws spawn-failed when spawnClaude returns ok=false', async () => {
    const brief = readSpec(makeLoadedTicket());
    const spawnFn = vi.fn().mockResolvedValue({
      ok: false,
      rc: 1,
      stdout: '',
      stderr: 'boom',
      timedOut: false,
      durationMs: 1,
      diagnostic: 'spawn boom',
      accountId: null,
    });
    const emitter = createSpawnedEmitter({ spawnFn: spawnFn as never });
    await expect(emitter.emit(brief)).rejects.toMatchObject({
      name: 'EmitterError',
      code: 'spawn-failed',
    });
  });

  it('throws envelope-malformed when stdout is not JSON', async () => {
    const brief = readSpec(makeLoadedTicket());
    const spawnFn = vi.fn().mockResolvedValue({
      ok: true,
      rc: 0,
      stdout: 'not json',
      stderr: '',
      timedOut: false,
      durationMs: 1,
      diagnostic: null,
      accountId: null,
    });
    const emitter = createSpawnedEmitter({ spawnFn: spawnFn as never });
    await expect(emitter.emit(brief)).rejects.toMatchObject({
      code: 'envelope-malformed',
    });
  });

  it('throws file-plan-missing when the assistant text has no JSON', async () => {
    const brief = readSpec(makeLoadedTicket());
    const envelope = JSON.stringify({ type: 'result', result: 'no plan here', is_error: false });
    const spawnFn = vi.fn().mockResolvedValue({
      ok: true,
      rc: 0,
      stdout: envelope,
      stderr: '',
      timedOut: false,
      durationMs: 1,
      diagnostic: null,
      accountId: null,
    });
    const emitter = createSpawnedEmitter({ spawnFn: spawnFn as never });
    await expect(emitter.emit(brief)).rejects.toMatchObject({
      code: 'file-plan-missing',
    });
  });

  it('throws stack-lock-violation when a frontend file imports @mui', async () => {
    const brief = readSpec(makeLoadedTicket());
    const filePlan = JSON.stringify({
      frontend: [{ path: 'a.tsx', contents: `import { Button } from '@mui/material';`, attribution: [] }],
      backend: [],
      database: [],
      tests: [],
    });
    const envelope = JSON.stringify({ type: 'result', result: filePlan, is_error: false });
    const spawnFn = vi.fn().mockResolvedValue({
      ok: true,
      rc: 0,
      stdout: envelope,
      stderr: '',
      timedOut: false,
      durationMs: 1,
      diagnostic: null,
      accountId: null,
    });
    const emitter = createSpawnedEmitter({ spawnFn: spawnFn as never });
    await expect(emitter.emit(brief)).rejects.toMatchObject({
      code: 'stack-lock-violation',
    });
  });

  it('falls back to the deterministic emitter when fallbackToDeterministic=true and spawn fails', async () => {
    const brief = readSpec(makeLoadedTicket());
    const spawnFn = vi.fn().mockResolvedValue({
      ok: false,
      rc: 1,
      stdout: '',
      stderr: 'boom',
      timedOut: false,
      durationMs: 1,
      diagnostic: 'spawn boom',
      accountId: null,
    });
    const emitter = createSpawnedEmitter({
      spawnFn: spawnFn as never,
      fallbackToDeterministic: true,
    });
    const emitted = await emitter.emit(brief);
    expect(emitted.frontend.length).toBeGreaterThan(0);
  });
});

describe('EmitterError', () => {
  it('preserves the code + diagnostic on the instance', () => {
    const e = new EmitterError('spawn-failed', 'spawn timed out', 'some-detail');
    expect(e.code).toBe('spawn-failed');
    expect(e.diagnostic).toBe('some-detail');
    expect(e.name).toBe('EmitterError');
  });
});
