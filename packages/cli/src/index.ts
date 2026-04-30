import { Command } from 'commander';
import { registerNewCommand } from './commands/new.js';
import { registerDoctorCommand } from './commands/doctor.js';
import { registerPlanCommand } from './commands/plan.js';
import { registerTestCommand } from './commands/test.js';

export const program = new Command();

program
  .name('caia')
  .description('CAIA — Chief AI Agent CLI')
  .version('0.1.0');

registerNewCommand(program);
registerDoctorCommand(program);
registerPlanCommand(program);
registerTestCommand(program);

// Only parse when run directly as a script, not when imported in tests
const isMain = process.argv[1] !== undefined &&
  (process.argv[1].endsWith('caia.js') || process.argv[1].endsWith('caia'));

if (isMain) {
  program.parse();
}
