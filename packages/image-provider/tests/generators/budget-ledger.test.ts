import { describe, it, expect, beforeEach } from 'vitest';
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const LEDGER_PATH = resolve(__dirname, '../../budget/ledger.json');

function resetLedger() {
  writeFileSync(LEDGER_PATH, '[]', 'utf-8');
}

describe('Budget Ledger', () => {
  beforeEach(() => {
    resetLedger();
    // Reset module cache so each test gets a fresh ledger read
    process.env.BUDGET_CAP_USD = '1.00';
  });

  it('starts with zero spend', async () => {
    const { getTotalSpend } = await import('../../src/generators/budget-ledger.js');
    expect(getTotalSpend()).toBe(0);
  });

  it('getRemainingBudget equals cap when no spend', async () => {
    const { getRemainingBudget } = await import('../../src/generators/budget-ledger.js');
    expect(getRemainingBudget()).toBeCloseTo(1.00);
  });

  it('recordSpend accumulates correctly', async () => {
    const { recordSpend, getTotalSpend } = await import('../../src/generators/budget-ledger.js');
    recordSpend({ model: 'fal-ai/flux/schnell', cost: 0.003, query: 'test', imageId: 'a1' });
    recordSpend({ model: 'fal-ai/flux/schnell', cost: 0.003, query: 'test2', imageId: 'a2' });
    expect(getTotalSpend()).toBeCloseTo(0.006);
  });

  it('checkBudget does not throw when within budget', async () => {
    const { checkBudget } = await import('../../src/generators/budget-ledger.js');
    expect(() => checkBudget(0.50)).not.toThrow();
  });

  it('checkBudget throws when spend would exceed cap', async () => {
    const { recordSpend, checkBudget } = await import('../../src/generators/budget-ledger.js');
    // Fill to $0.95
    for (let i = 0; i < 19; i++) {
      recordSpend({ model: 'fal-ai/flux-pro', cost: 0.05, query: `q${i}`, imageId: `id-${i}` });
    }
    // Remaining = $0.05; requesting $0.06 should fail
    expect(() => checkBudget(0.06)).toThrow(/Budget cap reached/);
  });

  it('checkBudget allows spend exactly equal to remaining', async () => {
    const { recordSpend, checkBudget } = await import('../../src/generators/budget-ledger.js');
    recordSpend({ model: 'fal-ai/flux-pro', cost: 0.50, query: 'q', imageId: 'x' });
    // Remaining = $0.50; requesting exactly $0.50 should pass
    expect(() => checkBudget(0.50)).not.toThrow();
  });

  it('getLedger returns all recorded entries', async () => {
    const { recordSpend, getLedger } = await import('../../src/generators/budget-ledger.js');
    recordSpend({ model: 'fal-ai/flux/schnell', cost: 0.003, query: 'q1', imageId: 'i1' });
    recordSpend({ model: 'fal-ai/flux/schnell', cost: 0.003, query: 'q2', imageId: 'i2' });
    const ledger = getLedger();
    expect(ledger).toHaveLength(2);
    expect(ledger[0]?.model).toBe('fal-ai/flux/schnell');
    expect(ledger[0]?.ts).toBeTruthy();
  });
});
