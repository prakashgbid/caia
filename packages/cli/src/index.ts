import { Command } from 'commander';
import { registerNewCommand } from './commands/new.js';
import { registerDoctorCommand } from './commands/doctor.js';

export const program = new Command();

program
  .name('caia')
  .description('CAIA — Chief AI Agent CLI')
  .version('0.1.0');

registerNewCommand(program);
registerDoctorCommand(program);

program.parse();
