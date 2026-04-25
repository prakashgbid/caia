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
    const { runMigrations, getDb } = await import('../db/connection');
    runMigrations();
    const db = getDb();
    const { createApp } = await import('../api/app');
    const { serve } = await import('@hono/node-server');
    const app = createApp(db);
    serve({ fetch: app.fetch, port: HTTP_PORT }, () => {
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

// ─── db:export — VACUUM INTO a file ────────────────────────────────────────
program
  .command('db:export <outPath>')
  .description('Export conductor DB to a new SQLite file (VACUUM INTO)')
  .action(async (outPath: string) => {
    const { getSqliteRaw, getDb } = await import('../db/connection');
    const { runMigrations } = await import('../db/connection');
    runMigrations();
    const sqlite = getSqliteRaw();
    const resolved = path.resolve(outPath);
    const { mkdirSync } = await import('fs');
    mkdirSync(path.dirname(resolved), { recursive: true });
    sqlite.exec(`VACUUM INTO '${resolved.replace(/'/g, "''")}'`);
    const { statSync } = await import('fs');
    const size = statSync(resolved).size;
    console.log(`✅ Exported to ${resolved} (${(size / 1024).toFixed(1)}KB)`);
  });

// ─── db:import — restore from an exported file ─────────────────────────────
program
  .command('db:import <srcPath>')
  .description('Restore conductor DB from a backup SQLite file (copies file, replaces current DB)')
  .action(async (srcPath: string) => {
    const resolved = path.resolve(srcPath);
    const { existsSync, copyFileSync } = await import('fs');
    if (!existsSync(resolved)) {
      console.error(`❌ File not found: ${resolved}`);
      process.exit(1);
    }
    const dbPath = path.join(os.homedir(), '.conductor', 'db.sqlite');
    const backupPath = dbPath + '.pre-import-' + Date.now();
    if (existsSync(dbPath)) copyFileSync(dbPath, backupPath);
    copyFileSync(resolved, dbPath);
    console.log(`✅ Restored from ${resolved}`);
    if (existsSync(backupPath)) console.log(`   (Previous DB saved to ${backupPath})`);
  });

// ─── memory:sync — sync .md files to lock_contracts + memory_anchors ───────
program
  .command('memory:sync [memoryDir]')
  .description('Sync memory .md files to DB lock_contracts + memory_anchors')
  .action(async (memoryDir?: string) => {
    const { existsSync, readdirSync, readFileSync } = await import('fs');
    const { createHash } = await import('crypto');
    const { getDb, runMigrations } = await import('../db/connection');
    const { getSqliteRaw } = await import('../db/connection');
    const { nanoid } = await import('nanoid');

    runMigrations();
    const db = getDb();
    const { lockContracts: lcTable, memoryAnchors: maTable } = await import('../db/schema');
    const { eq } = await import('drizzle-orm');

    const dir = memoryDir ?? path.join(os.homedir(), '.claude', 'projects', '-Users-MAC-Documents-projects', 'memory');
    if (!existsSync(dir)) {
      console.error(`❌ Memory dir not found: ${dir}`);
      process.exit(1);
    }

    const files = readdirSync(dir).filter(f => f.endsWith('.md') && f !== 'MEMORY.md');
    let synced = 0, drifted = 0, created = 0;

    for (const file of files) {
      const filePath = path.join(dir, file);
      const content = readFileSync(filePath, 'utf8');
      const checksum = createHash('sha256').update(content).digest('hex');
      const slug = file.replace(/\.md$/, '').toLowerCase().replace(/[^a-z0-9-]/g, '-');

      // Determine kind from frontmatter or filename
      const kindMatch = content.match(/^type:\s*(\w+)/m);
      const kind = kindMatch?.[1] ?? 'standard';
      const titleMatch = content.match(/^name:\s*(.+)/m);
      const title = titleMatch?.[1]?.trim() ?? slug;

      // Upsert lock_contract
      const existing = db.select().from(lcTable).where(eq(lcTable.slug, slug)).all()[0];
      let contractId: string;
      const now = new Date().toISOString();
      const sqlite = getSqliteRaw();

      if (existing) {
        const bodyChanged = existing.checksum !== checksum;
        if (bodyChanged) {
          const nextVersion = existing.version + 1;
          sqlite.transaction(() => {
            db.update(lcTable).set({ bodyMd: content, version: nextVersion, updatedAt: now, checksum }).where(eq(lcTable.slug, slug)).run();
            sqlite.prepare('INSERT INTO lock_contract_revisions (contract_id, version, body_md, changed_at, changed_by) VALUES (?, ?, ?, ?, ?)').run(existing.id, nextVersion, content, now, 'memory:sync');
          })();
          drifted++;
        }
        contractId = existing.id;
      } else {
        contractId = 'lc_' + nanoid(10);
        sqlite.transaction(() => {
          db.insert(lcTable).values({ id: contractId, slug, kind, title, bodyMd: content, version: 1, active: true, createdAt: now, updatedAt: now, checksum }).run();
          sqlite.prepare('INSERT INTO lock_contract_revisions (contract_id, version, body_md, changed_at, changed_by) VALUES (?, 1, ?, ?, ?)').run(contractId, content, now, 'memory:sync');
        })();
        created++;
      }

      // Upsert memory_anchor
      db.insert(maTable).values({ path: filePath, kind: 'lock_contract', refId: contractId, refTable: 'lock_contracts', lastSyncedAt: now, checksumAtSync: checksum })
        .onConflictDoUpdate({ target: maTable.path, set: { checksumAtSync: checksum, lastSyncedAt: now } }).run();
      synced++;
    }

    console.log(`✅ memory:sync complete: ${files.length} files — ${created} created, ${drifted} updated, ${synced - created - drifted} unchanged`);
  });

// ─── exec — autonomous executor commands ───────────────────────────────────
const execCmd = program.command('exec').description('Autonomous executor engine commands');

execCmd
  .command('start')
  .description('Enable the executor daemon (sets executor_config.enabled=true). You must start the daemon separately with `conductor exec daemon`.')
  .action(async () => {
    const { runMigrations, getDb } = await import('../db/connection');
    runMigrations();
    const db = getDb();
    const { executorConfig } = await import('../db/schema');
    const { eq } = await import('drizzle-orm');
    const cfg = db.select().from(executorConfig).all()[0];
    if (!cfg) { console.error('❌ executor_config not seeded — run `conductor dashboard` once first'); process.exit(1); }
    db.update(executorConfig).set({ enabled: true, updatedAt: new Date().toISOString() }).where(eq(executorConfig.id, cfg.id)).run();
    console.log('✅ Executor enabled. Start the daemon with: conductor exec daemon');
    console.log('   Or install launchd: conductor exec install-launchd');
  });

execCmd
  .command('stop')
  .description('Disable the executor (running workers finish naturally)')
  .action(async () => {
    const { runMigrations, getDb } = await import('../db/connection');
    runMigrations();
    const db = getDb();
    const { executorConfig } = await import('../db/schema');
    const { eq } = await import('drizzle-orm');
    const cfg = db.select().from(executorConfig).all()[0];
    if (!cfg) { console.error('❌ executor_config not seeded'); process.exit(1); }
    db.update(executorConfig).set({ enabled: false, updatedAt: new Date().toISOString() }).where(eq(executorConfig.id, cfg.id)).run();
    console.log('✅ Executor disabled. Queued tasks will remain queued until re-enabled.');
  });

execCmd
  .command('status')
  .description('Show executor status')
  .action(async () => {
    const API_BASE = process.env['CONDUCTOR_API'] ?? `http://localhost:${HTTP_PORT}`;
    try {
      const res = await fetch(`${API_BASE}/executor/status`);
      if (!res.ok) { console.error('❌ API not reachable — is `conductor dashboard` running?'); process.exit(1); }
      const data = await res.json() as Record<string, unknown>;
      console.log(JSON.stringify(data, null, 2));
    } catch {
      console.error('❌ Could not reach API at', API_BASE);
      process.exit(1);
    }
  });

execCmd
  .command('pause')
  .description('Pause executor (stop picking up new tasks)')
  .action(async () => {
    const API_BASE = process.env['CONDUCTOR_API'] ?? `http://localhost:${HTTP_PORT}`;
    const res = await fetch(`${API_BASE}/executor/pause`, { method: 'POST' });
    console.log(res.ok ? '✅ Executor paused' : '❌ Failed');
  });

execCmd
  .command('resume')
  .description('Resume executor')
  .action(async () => {
    const API_BASE = process.env['CONDUCTOR_API'] ?? `http://localhost:${HTTP_PORT}`;
    const res = await fetch(`${API_BASE}/executor/resume`, { method: 'POST' });
    console.log(res.ok ? '✅ Executor resumed' : '❌ Failed');
  });

execCmd
  .command('drain')
  .description('Disable executor and kill all in-flight workers')
  .action(async () => {
    const API_BASE = process.env['CONDUCTOR_API'] ?? `http://localhost:${HTTP_PORT}`;
    const res = await fetch(`${API_BASE}/executor/drain`, { method: 'POST' });
    console.log(res.ok ? '✅ Drain initiated' : '❌ Failed');
  });

execCmd
  .command('attempt')
  .description('Manage task execution attempts')
  .option('--task <id>', 'Task ID')
  .option('--reset-breaker', 'Reset circuit breaker and unpause task')
  .option('--list', 'List attempts for the task')
  .action(async (opts: { task?: string; resetBreaker?: boolean; list?: boolean }) => {
    if (!opts.task) { console.error('❌ --task <id> required'); process.exit(1); }
    const API_BASE = process.env['CONDUCTOR_API'] ?? `http://localhost:${HTTP_PORT}`;

    if (opts.list) {
      const res = await fetch(`${API_BASE}/tasks/${opts.task}/attempts`);
      console.log(JSON.stringify(await res.json(), null, 2));
      return;
    }

    if (opts.resetBreaker) {
      const res = await fetch(`${API_BASE}/executor/tasks/${opts.task}/unpause`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reset_attempts: true }),
      });
      console.log(res.ok ? `✅ Circuit breaker reset for task ${opts.task}` : '❌ Failed');
      return;
    }

    const res = await fetch(`${API_BASE}/executor/tasks/${opts.task}/run-now`, { method: 'POST' });
    console.log(res.ok ? `✅ Task ${opts.task} nudged to run on next tick` : '❌ Failed');
  });

execCmd
  .command('daemon')
  .description('Start the executor daemon in the foreground (for manual use; use launchd for 24/7)')
  .action(async () => {
    const { runMigrations } = await import('../db/connection');
    runMigrations();
    console.log('[conductor] Starting executor daemon...');
    const { spawn } = await import('child_process');
    const { existsSync } = await import('fs');
    // Probe 3 levels up (dist/src/cli → project root) then 2 levels (dist/cli → project root, legacy layout).
    const dir3 = path.resolve(path.dirname(process.argv[1]), '..', '..', '..');
    const dir2 = path.resolve(path.dirname(process.argv[1]), '..', '..');
    const pkgRoot = existsSync(path.join(dir3, 'apps', 'executor')) ? dir3 : dir2;
    const appDist = path.join(pkgRoot, 'apps', 'executor', 'dist', 'executor-daemon.js');
    const globalDist = path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'conductor', 'dist', 'apps', 'executor', 'executor-daemon.js');
    const fallback = path.join(os.homedir(), '.conductor', 'executor-daemon.js');

    const targetPath = existsSync(appDist) ? appDist : existsSync(globalDist) ? globalDist : fallback;

    if (!existsSync(targetPath)) {
      console.error(`❌ Executor daemon not found at ${targetPath}`);
      console.error('   Build first: npm run build');
      process.exit(1);
    }

    const proc = spawn('node', [targetPath], { stdio: 'inherit', env: { ...process.env } });
    proc.on('exit', (code) => process.exit(code ?? 0));
  });

execCmd
  .command('install-launchd')
  .description('Install macOS launchd plist for 24/7 executor daemon')
  .action(async () => {
    const { installExecutorLaunchd } = await import('../install');
    await installExecutorLaunchd();
  });

// ─── Pulse ───────────────────────────────────────────────────────────────────

program
  .command('pulse')
  .description('Run the 3-layer pipeline health check (canary + invariants + 15 micro-probes)')
  .option('--json', 'Output structured JSON result')
  .option('--no-heal', 'Skip auto-heal phase')
  .option('--no-canary', 'Skip synthetic canary test (faster, less coverage)')
  .action(async (opts: { json?: boolean; heal?: boolean; canary?: boolean }) => {
    const argv: string[] = [];
    if (opts.json) argv.push('--json');
    if (opts.heal === false) argv.push('--no-heal');
    if (opts.canary === false) argv.push('--no-canary');
    const { runPulseCli } = await import('../../apps/pipeline-pulse/src/cli');
    await runPulseCli(argv);
  });

program.parse(process.argv);
