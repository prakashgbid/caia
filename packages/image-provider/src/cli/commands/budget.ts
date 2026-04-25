import { Command } from 'commander';
import pc from 'picocolors';
import { getTotalSpend, getRemainingBudget, getLedger } from '../../generators/index.js';
import { getCapUsd } from '../../../config/index.js';

export const budgetCommand = new Command('budget')
  .description('Show AI generation budget usage and ledger')
  .action(() => {
    const spent = getTotalSpend();
    const cap = getCapUsd();
    const remaining = getRemainingBudget();
    const pct = cap > 0 ? (spent / cap * 100).toFixed(1) : '0.0';
    const ledger = getLedger();

    const remainingColor = remaining < 0.1 ? pc.red : remaining < 0.30 ? pc.yellow : pc.green;

    console.log(`\n${pc.bold('AI Generation Budget')}`);
    console.log(`  Cap:       $${cap.toFixed(2)}`);
    console.log(`  Spent:     $${spent.toFixed(4)}  (${pct}%)`);
    console.log(`  Remaining: ${remainingColor(`$${remaining.toFixed(4)}`)}`);

    if (ledger.length === 0) {
      console.log(`\n  No spend recorded yet.`);
      return;
    }

    console.log(`\n  ${pc.bold('Recent ledger')} (last 10 of ${ledger.length}):`);
    for (const entry of ledger.slice(-10)) {
      const model = entry.model.split('/').pop() ?? entry.model;
      console.log(`    ${entry.ts.slice(0, 10)}  ${model.padEnd(10)}  $${entry.cost.toFixed(4)}  ${entry.query.slice(0, 40)}`);
    }
    if (ledger.length > 10) {
      console.log(`    … and ${ledger.length - 10} earlier entries`);
    }
  });
