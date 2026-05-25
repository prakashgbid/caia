/**
 * hook.test.ts — unit tests for the HOF wrapper.
 *
 * Mocks @chiefaia/architecture-registry's archSearch so we exercise the
 * full hook → injectContext → renderer → event-bus chain without booting
 * a real AKG.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { canonicalHits, result, stubEmbedder } from './fixtures.js';

vi.mock('@chiefaia/architecture-registry', async () => {
  const actual =
    await vi.importActual<typeof import('@chiefaia/architecture-registry')>(
      '@chiefaia/architecture-registry',
    );
  return {
    ...actual,
    archSearch: vi.fn(),
  };
});

import { createEventBus } from '@chiefaia/events';
import { archSearch } from '@chiefaia/architecture-registry';
import {
  createKgDispatchHook,
  withKgContext,
} from '../src/hook.js';
import {
  CONTEXT_INJECTED,
  type ContextInjectedEvent,
  type DispatchBrief,
} from '../src/types.js';

const mockedArchSearch = archSearch as unknown as ReturnType<typeof vi.fn>;

function brief(): DispatchBrief {
  return {
    callerAgentId: 'agent-z',
    briefMd: 'Build event-sourcing leaderboard.',
    intent: 'build',
  };
}

const fakeDb = {} as unknown as import('better-sqlite3').Database;

beforeEach(() => {
  mockedArchSearch.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createKgDispatchHook + withKgContext', () => {
  it('wraps an inner dispatch and propagates its return value', async () => {
    mockedArchSearch.mockResolvedValue(result(canonicalHits()));
    const wrapped = withKgContext(
      { db: fakeDb, embedder: stubEmbedder() },
      async () => 'inner-result',
    );
    expect(await wrapped(brief())).toBe('inner-result');
  });

  it('passes the enriched brief as the inner dispatch first arg', async () => {
    mockedArchSearch.mockResolvedValue(result(canonicalHits()));
    let seenBriefMd = '';
    const wrapped = withKgContext(
      { db: fakeDb, embedder: stubEmbedder() },
      async (b) => {
        seenBriefMd = b.briefMd;
        return 'ok';
      },
    );
    await wrapped(brief());
    expect(seenBriefMd).toContain('## Architecture Context (auto-injected by AKG)');
    expect(seenBriefMd).toContain('Build event-sourcing leaderboard');
  });

  it('stashes the original briefMd in metadata.kgDispatchHook.originalBriefMd', async () => {
    mockedArchSearch.mockResolvedValue(result(canonicalHits()));
    const sniffed: { meta?: Record<string, unknown> } = {};
    const wrapped = withKgContext(
      { db: fakeDb, embedder: stubEmbedder() },
      async (b) => {
        sniffed.meta = (b.metadata?.['kgDispatchHook'] ?? {}) as Record<string, unknown>;
      },
    );
    await wrapped(brief());
    expect(sniffed.meta?.['originalBriefMd']).toBe(brief().briefMd);
  });

  it('emits context.injected on the bus when one is supplied', async () => {
    mockedArchSearch.mockResolvedValue(result(canonicalHits()));
    const bus = createEventBus();
    const received: ContextInjectedEvent[] = [];
    bus.on<ContextInjectedEvent>(CONTEXT_INJECTED, (ev) => {
      received.push(ev);
    });
    const wrapped = createKgDispatchHook({ db: fakeDb, embedder: stubEmbedder(), eventBus: bus })(
      async () => 'ok',
    );
    await wrapped(brief());
    expect(received).toHaveLength(1);
    expect(received[0]?.callerAgentId).toBe('agent-z');
    expect(received[0]?.retrievedIds.length).toBeGreaterThan(0);
  });

  it('still runs the inner dispatch when injection throws (soft fail)', async () => {
    mockedArchSearch.mockRejectedValue(new Error('boom'));
    let innerRan = false;
    const wrapped = withKgContext(
      { db: fakeDb, embedder: stubEmbedder() },
      async () => {
        innerRan = true;
        return 'still-ok';
      },
    );
    const out = await wrapped(brief());
    expect(out).toBe('still-ok');
    expect(innerRan).toBe(true);
  });

  it('calls onInjected callback with the event payload', async () => {
    mockedArchSearch.mockResolvedValue(result(canonicalHits()));
    const calls: ContextInjectedEvent[] = [];
    const wrapped = withKgContext(
      { db: fakeDb, embedder: stubEmbedder() },
      async () => 'ok',
      {
        onInjected: (e) => {
          calls.push(e);
        },
      },
    );
    await wrapped(brief());
    expect(calls).toHaveLength(1);
    expect(calls[0]?.intent).toBe('build');
  });
});
