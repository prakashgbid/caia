import { Command } from 'commander';
import { acquireCommand } from './commands/acquire.js';
import { listCommand } from './commands/list.js';
import { reuseCommand } from './commands/reuse.js';
import { creditsCommand } from './commands/credits.js';
import { budgetCommand } from './commands/budget.js';
import { searchCommand } from './commands/search.js';
import { validateCommand } from './commands/validate.js';

const program = new Command();

program
  .name('image-provider')
  .description('Supply real photo-quality imagery to your websites')
  .version('0.1.0');

program.addCommand(acquireCommand);
program.addCommand(listCommand);
program.addCommand(reuseCommand);
program.addCommand(creditsCommand);
program.addCommand(budgetCommand);
program.addCommand(searchCommand);
program.addCommand(validateCommand);

program.parseAsync().catch(err => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
