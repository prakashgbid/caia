import { describe, expect, it } from 'vitest';
import { StateStore } from '../src/state-store.js';
import { StateCorruptError } from '../src/types.js';
import { createFakeClock, createInMemoryFs } from './helpers/fakes.js';

function setup() {
  const fs = createInMemoryFs();
  const { clock } = createFakeClock();
  const store = new StateStore({ runStatePath: '/data/state.json', fs, clock });
  return { fs, store };
}

describe('StateStore', () => {
  it('returns empty state when file is absent', () => {
    const { store } = setup();
    const s = store.read();
    expect(s.history).toEqual([]);
    expect(s.lastSuccessfulTrain).toBeNull();
  });

  it('round-trips state via atomic rename', () => {
    const { fs, store } = setup();
    const s = store.read();
    s.lastSuccessfulTrain = {
      at: '2026-05-01T00:00:00.000Z',
      adapterPath: '/adapters/x',
      adapterName: 'x',
      corpusManifestSha256: 'sha',
      outcome: 'trained-and-canary-promoted'
    };
    store.write(s);
    expect(fs.exists('/data/state.json')).toBe(true);
    const re = store.read();
    expect(re.lastSuccessfulTrain?.adapterPath).toBe('/adapters/x');
  });

  it('preserves a .bak file on second write', () => {
    const { fs, store } = setup();
    store.write(store.read());
    store.write(store.read());
    expect(fs.exists('/data/state.json.bak')).toBe(true);
  });

  it('throws StateCorruptError on malformed JSON', () => {
    const { fs, store } = setup();
    fs.put('/data/state.json', '{ broken');
    expect(() => store.read()).toThrow(StateCorruptError);
  });

  it('treats empty file as empty state', () => {
    const { fs, store } = setup();
    fs.put('/data/state.json', '');
    const s = store.read();
    expect(s.history).toEqual([]);
  });

  it('records outcomes append-only', () => {
    const { store } = setup();
    store.recordOutcome('skipped-no-delta');
    store.recordOutcome('trained-and-canary-promoted', { adapterName: 'a1' });
    const s = store.read();
    expect(s.history).toHaveLength(2);
    expect(s.history[0]!.outcome).toBe('skipped-no-delta');
    expect(s.history[1]!.adapterName).toBe('a1');
  });

  it('trims history beyond historyMax', () => {
    const fs = createInMemoryFs();
    const { clock } = createFakeClock();
    const store = new StateStore({ runStatePath: '/data/s.json', fs, clock, historyMax: 3 });
    for (let i = 0; i < 5; i++) {
      store.recordOutcome('skipped-no-delta');
    }
    const s = store.read();
    expect(s.history).toHaveLength(3);
  });

  it('records and clears errors', () => {
    const { store } = setup();
    store.recordError({ at: '2026-05-06T00:00:00.000Z', message: 'boom', kind: 'TestError' });
    expect(store.read().lastError?.kind).toBe('TestError');
    store.clearError();
    expect(store.read().lastError).toBeNull();
  });

  it('records canary + production promotion timestamps', () => {
    const { store } = setup();
    store.recordCanaryPromotion('2026-05-06T02:15:00.000Z');
    store.recordProductionPromotion('2026-05-09T14:30:00.000Z');
    const s = store.read();
    expect(s.lastCanaryPromotedAt).toBe('2026-05-06T02:15:00.000Z');
    expect(s.lastProductionPromotedAt).toBe('2026-05-09T14:30:00.000Z');
  });
});
