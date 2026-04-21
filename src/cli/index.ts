#!/usr/bin/env node
import { Command } from 'commander';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';
import { Conductor } from '../index';
import { createHealthServer } from '../http/health';

const program = new Command();

const DEFAULT_DIR = path.join(os.homedir(), '.conductor');
const HTTP_PORT = parseInt(process.env['CONDUCTOR_HTTP_PORT'] ?? '7776', 10);

async function getConductor(dir?: string): Promise<Conductor> {
  const conductor = new Conductor(dir ?? DEFAULT_DIR);
  await conductor.init();
  return conductor;
}

program
  .name('conductor')
  .description('Task orchestration system for parallel AI code execution')
  .version('0.1.0');

program
  .command('add')
  .description('Register a new task')
  .requiredOption('--title <title>', 'Task title')
  .requiredOption('--cwd <cwd>', 'Working directory')
  .requiredOption('--files <globs>', 'Comma-separated file globs')
  .option('--depends <ids>', 'Comma-separated task ids')
  .option('--spawned-by <who>', 'Who spawned the task (user|claude|hook)', 'user')
  .option('--notes <notes>', 'Optional notes')
  .action(async (opts: {
    title: string;
    cwd: string;
    files: string;
    depends?: string;
    spawnedBy: string;
    notes?: string;
  }) => {
    const conductor = await getConductor();
    const result = await conductor.add({
      title: opts.title,
      cwd: opts.cwd,
      files: opts.files.split(',').map(f => f.trim()),
      dependsOn: opts.depends?.split(',').map(d => d.trim()),
      spawnedBy: (opts.spawnedBy as 'user' | 'claude' | 'hook') ?? 'user',
      notes: opts.notes,
    });
    console.log(JSON.stringify(result, null, 2));
  });

program
  .command('check')
  .description('Check if files are locked')
  .requiredOption('--files <files>', 'Comma-separated file paths')
  .action(async (opts: { files: string }) => {
    const conductor = await getConductor();
    const result = conductor.check(opts.files.split(',').map(f => f.trim()));
    console.log(JSON.stringify(result, null, 2));
  });

program
  .command('start <id>')
  .description('Start a queued task')
  .action(async (id: string) => {
    const conductor = await getConductor();
    const task = await conductor.start(id);
    console.log(JSON.stringify(task, null, 2));
  });

program
  .command('complete <id>')
  .description('Mark task as completed')
  .option('--actual <files>', 'Comma-separated actual files touched')
  .action(async (id: string, opts: { actual?: string }) => {
    const conductor = await getConductor();
    const actualFiles = opts.actual?.split(',').map(f => f.trim());
    const task = await conductor.complete(id, actualFiles);
    console.log(JSON.stringify(task, null, 2));
  });

program
  .command('fail <id>')
  .description('Mark task as failed')
  .option('--reason <reason>', 'Failure reason')
  .action(async (id: string, opts: { reason?: string }) => {
    const conductor = await getConductor();
    const task = await conductor.fail(id, opts.reason);
    console.log(JSON.stringify(task, null, 2));
  });

program
  .command('cancel <id>')
  .description('Cancel a task')
  .action(async (id: string) => {
    const conductor = await getConductor();
    const task = await conductor.cancel(id);
    console.log(JSON.stringify(task, null, 2));
  });

program
  .command('status')
  .description('Show conductor state')
  .action(async () => {
    const conductor = await getConductor();
    const state = conductor.status();
    console.log(JSON.stringify(state, null, 2));
  });

program
  .command('list')
  .description('List tasks')
  .option('--status <status>', 'Filter by status')
  .action(async (opts: { status?: string }) => {
    const conductor = await getConductor();
    const tasks = conductor.list(
      opts.status ? { status: opts.status as import('../core/types').TaskStatus } : undefined,
    );
    console.log(JSON.stringify(tasks, null, 2));
  });

program
  .command('dag')
  .description('Show dependency graph')
  .option('--root <id>', 'Root task id')
  .action(async (opts: { root?: string }) => {
    const conductor = await getConductor();
    const dag = conductor.dag(opts.root);
    console.log(JSON.stringify(dag, null, 2));
  });

program
  .command('release <id>')
  .description('Release task file locks')
  .action(async (id: string) => {
    const conductor = await getConductor();
    await conductor.release(id);
    console.log(`Released locks for ${id}`);
  });

program
  .command('audit <id>')
  .description('Audit declared vs actual files')
  .action(async (id: string) => {
    const conductor = await getConductor();
    const result = await conductor.audit(id);
    console.log(JSON.stringify(result, null, 2));
  });

program
  .command('reconcile')
  .description('Reconcile running tasks against live sessions')
  .action(async () => {
    const conductor = await getConductor();
    const result = await conductor.reconcile([]);
    console.log(JSON.stringify(result, null, 2));
  });

program
  .command('history')
  .description('Show event history')
  .option('--since <eventId>', 'Show events after this id')
  .action(async (opts: { since?: string }) => {
    const conductor = await getConductor();
    const events = conductor.getHistory(opts.since);
    console.log(JSON.stringify(events, null, 2));
  });

program
  .command('mcp')
  .description('Start MCP server')
  .action(async () => {
    const { startMcpServer } = await import('../mcp/server');
    await startMcpServer();
  });

program
  .command('dashboard')
  .description('Start dashboard server')
  .action(async () => {
    const conductor = await getConductor();
    const server: http.Server = createHealthServer(conductor, HTTP_PORT);
    server.listen(HTTP_PORT, () => {
      console.log(`Conductor HTTP server running on http://localhost:${HTTP_PORT}`);
      console.log('Start dashboard with: cd dashboard && npm run dev');
    });
  });

program
  .command('install')
  .description('Install hook and MCP config')
  .action(async () => {
    const { install } = await import('../install');
    await install();
  });

program
  .command('install-claudemd [dir]')
  .description('Install CONDUCTOR.md rules template')
  .action(async (dir?: string) => {
    const { installClaudeMd } = await import('../install');
    await installClaudeMd(dir ?? process.cwd());
  });

program.parse(process.argv);
