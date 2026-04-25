import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';
import { getCapUsd } from '../../config/index.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const LEDGER_PATH = resolve(__dirname, '../../budget/ledger.json');

const LedgerEntrySchema = z.object({
  ts: z.string(),
  model: z.string(),
  cost: z.number(),
  query: z.string(),
  imageId: z.string(),
});

export type LedgerEntry = z.infer<typeof LedgerEntrySchema>;

function readLedger(): LedgerEntry[] {
  if (!existsSync(LEDGER_PATH)) return [];
  try {
    const raw = readFileSync(LEDGER_PATH, 'utf-8');
    return z.array(LedgerEntrySchema).parse(JSON.parse(raw));
  } catch {
    return [];
  }
}

function writeLedger(entries: LedgerEntry[]): void {
  writeFileSync(LEDGER_PATH, JSON.stringify(entries, null, 2) + '\n', 'utf-8');
}

export function getTotalSpend(): number {
  return readLedger().reduce((sum, e) => sum + e.cost, 0);
}

export function getRemainingBudget(): number {
  return Math.max(0, getCapUsd() - getTotalSpend());
}

export function checkBudget(estimatedCost: number): void {
  const spent = getTotalSpend();
  const cap = getCapUsd();
  const remaining = cap - spent;
  if (estimatedCost > remaining) {
    throw new Error(
      `Budget cap reached. Spent $${spent.toFixed(4)} of $${cap.toFixed(2)}. ` +
      `Need $${estimatedCost.toFixed(4)} but only $${remaining.toFixed(4)} remaining. ` +
      `Increase BUDGET_CAP_USD in .env if intentional.`,
    );
  }
}

export function recordSpend(entry: Omit<LedgerEntry, 'ts'>): void {
  const entries = readLedger();
  entries.push({ ...entry, ts: new Date().toISOString() });
  writeLedger(entries);
}

export function getLedger(): LedgerEntry[] {
  return readLedger();
}
