#!/usr/bin/env ts-node
/**
 * Retroactive backfill: synthesize prompts rows from Claude Code session JSONL files.
 * Scans ~/.claude/projects/-* /session-*.jsonl for user messages, creates prompts rows,
 * and links existing stories/requirements within 60 seconds of each prompt.
 * @no-events — one-shot backfill utility; not a runtime domain operation
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createHash } from 'crypto';
import { randomUUID } from 'crypto';
import { eq, and, gte, lte } from 'drizzle-orm';
import Database from 'better-sqlite3';
import { getDb } from '../src/db/connection';
import { prompts, stories, requirements } from '../src/db/schema';

type ContentBlock = string | Array<{ type: string; text?: string }>;

interface JsonlMessage {
  type?: string;
  role?: string;
  content?: ContentBlock;
  timestamp?: string;
  uuid?: string;
  // Claude Code session format: nested under message
  message?: { role?: string; content?: ContentBlock };
  sessionId?: string;
}

function makePromptId(): string {
  const ts = Date.now().toString(36).padStart(8, '0');
  const rand = randomUUID().replace(/-/g, '').slice(0, 16);
  return `prm_${ts}_${rand}`;
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function extractText(content: string | Array<{ type: string; text?: string }>): string {
  if (typeof content === 'string') return content;
  return content
    .filter(c => c.type === 'text' && c.text)
    .map(c => c.text ?? '')
    .join('\n');
}

function parseJsonlFile(filePath: string): Array<{ body: string; receivedAt: string; sessionId: string }> {
  const sessionId = path.basename(filePath, '.jsonl');
  const results: Array<{ body: string; receivedAt: string; sessionId: string }> = [];

  const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB guard
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_FILE_BYTES) return results;
  const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line) as JsonlMessage;
      // Support both flat format (role/content) and CC session format (type/message.content)
      const isUserMessage = msg.role === 'user' || msg.type === 'user'
        || (msg.message?.role === 'user');
      const content = msg.content ?? msg.message?.content;
      if (!isUserMessage || !content) continue;

      const body = extractText(content).trim();
      if (!body || body.length < 5) continue;

      const receivedAt = msg.timestamp ?? new Date().toISOString();
      results.push({ body, receivedAt, sessionId });
    } catch {
      // skip malformed lines
    }
  }
  return results;
}

const UUID_JSONL_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/i;

function findSessionFiles(projectsDir: string): string[] {
  const files: string[] = [];
  const projectDirs = fs.readdirSync(projectsDir);
  for (const projectDir of projectDirs) {
    const fullDir = path.join(projectsDir, projectDir);
    try {
      const stat = fs.statSync(fullDir);
      if (!stat.isDirectory()) continue;
      const entries = fs.readdirSync(fullDir);
      for (const entry of entries) {
        if (entry.endsWith('.jsonl') && (entry.startsWith('session-') || UUID_JSONL_RE.test(entry))) {
          files.push(path.join(fullDir, entry));
        }
      }
    } catch {
      // skip unreadable dirs
    }
  }
  return files;
}

function applyMigration0010(dbUrl: string): void {
  // Apply migration 0010 directly to avoid re-running already-applied 0006/0007
  // which may not be tracked in __drizzle_migrations but whose tables already exist.
  const sqlite = new Database(dbUrl);
  const stmts = [
    `CREATE TABLE IF NOT EXISTS \`prompts\` (
      \`id\` text PRIMARY KEY NOT NULL,
      \`body\` text NOT NULL,
      \`received_at\` text NOT NULL,
      \`received_via\` text NOT NULL DEFAULT 'chat',
      \`user_id\` text,
      \`session_id\` text,
      \`correlation_id\` text NOT NULL,
      \`hash\` text NOT NULL,
      \`tokens_in\` integer,
      \`metadata_json\` text NOT NULL DEFAULT '{}',
      \`status\` text NOT NULL DEFAULT 'received',
      \`completed_at\` text,
      \`elapsed_ms\` integer
    )`,
    `CREATE INDEX IF NOT EXISTS \`prm_received_idx\` ON \`prompts\` (\`received_at\` DESC)`,
    `CREATE INDEX IF NOT EXISTS \`prm_user_idx\` ON \`prompts\` (\`user_id\`, \`received_at\` DESC)`,
    `CREATE INDEX IF NOT EXISTS \`prm_status_idx\` ON \`prompts\` (\`status\`)`,
    `CREATE INDEX IF NOT EXISTS \`prm_hash_idx\` ON \`prompts\` (\`hash\`)`,
    `CREATE TABLE IF NOT EXISTS \`prompt_responses\` (
      \`id\` text PRIMARY KEY NOT NULL,
      \`prompt_id\` text NOT NULL REFERENCES \`prompts\`(\`id\`),
      \`response_body\` text NOT NULL DEFAULT '',
      \`responded_at\` text NOT NULL,
      \`response_kind\` text NOT NULL DEFAULT 'chat',
      \`tokens_out\` integer,
      \`decomposition_tree_json\` text
    )`,
    `CREATE INDEX IF NOT EXISTS \`pr_prompt_idx\` ON \`prompt_responses\` (\`prompt_id\`)`,
    `CREATE TABLE IF NOT EXISTS \`task_status_transitions\` (
      \`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      \`task_id\` text NOT NULL,
      \`from_status\` text,
      \`to_status\` text NOT NULL,
      \`transitioned_at\` text NOT NULL,
      \`actor\` text NOT NULL DEFAULT 'system',
      \`trigger_event_id\` text,
      \`notes\` text,
      \`root_prompt_id\` text
    )`,
    `CREATE INDEX IF NOT EXISTS \`tst_task_idx\` ON \`task_status_transitions\` (\`task_id\`)`,
    `CREATE INDEX IF NOT EXISTS \`tst_prompt_idx\` ON \`task_status_transitions\` (\`root_prompt_id\`)`,
    `CREATE INDEX IF NOT EXISTS \`tst_at_idx\` ON \`task_status_transitions\` (\`transitioned_at\`)`,
  ];
  const alterStmts = [
    `ALTER TABLE \`stories\` ADD COLUMN \`root_prompt_id\` text`,
    `ALTER TABLE \`stories\` ADD COLUMN \`parent_entity_type\` text`,
    `ALTER TABLE \`stories\` ADD COLUMN \`parent_entity_id\` text`,
    `ALTER TABLE \`requirements\` ADD COLUMN \`root_prompt_id\` text`,
    `ALTER TABLE \`requirements\` ADD COLUMN \`parent_entity_type\` text`,
    `ALTER TABLE \`requirements\` ADD COLUMN \`parent_entity_id\` text`,
    `ALTER TABLE \`tasks\` ADD COLUMN \`root_prompt_id\` text`,
    `ALTER TABLE \`tasks\` ADD COLUMN \`parent_entity_type\` text`,
    `ALTER TABLE \`tasks\` ADD COLUMN \`parent_entity_id\` text`,
    `ALTER TABLE \`task_runs\` ADD COLUMN \`root_prompt_id\` text`,
    `ALTER TABLE \`task_runs\` ADD COLUMN \`parent_entity_type\` text`,
    `ALTER TABLE \`task_runs\` ADD COLUMN \`parent_entity_id\` text`,
    `ALTER TABLE \`blockers\` ADD COLUMN \`root_prompt_id\` text`,
    `ALTER TABLE \`blockers\` ADD COLUMN \`parent_entity_type\` text`,
    `ALTER TABLE \`blockers\` ADD COLUMN \`parent_entity_id\` text`,
    `ALTER TABLE \`questions\` ADD COLUMN \`root_prompt_id\` text`,
    `ALTER TABLE \`questions\` ADD COLUMN \`parent_entity_type\` text`,
    `ALTER TABLE \`questions\` ADD COLUMN \`parent_entity_id\` text`,
  ];
  const indexStmts = [
    `CREATE INDEX IF NOT EXISTS \`story_root_prompt_idx\` ON \`stories\` (\`root_prompt_id\`)`,
    `CREATE INDEX IF NOT EXISTS \`story_parent_entity_idx\` ON \`stories\` (\`parent_entity_id\`)`,
    `CREATE INDEX IF NOT EXISTS \`req_root_prompt_idx\` ON \`requirements\` (\`root_prompt_id\`)`,
    `CREATE INDEX IF NOT EXISTS \`req_parent_entity_idx\` ON \`requirements\` (\`parent_entity_id\`)`,
    `CREATE INDEX IF NOT EXISTS \`task_root_prompt_idx\` ON \`tasks\` (\`root_prompt_id\`)`,
    `CREATE INDEX IF NOT EXISTS \`task_parent_entity_idx\` ON \`tasks\` (\`parent_entity_id\`)`,
    `CREATE INDEX IF NOT EXISTS \`tr_root_prompt_idx\` ON \`task_runs\` (\`root_prompt_id\`)`,
    `CREATE INDEX IF NOT EXISTS \`tr_parent_entity_idx\` ON \`task_runs\` (\`parent_entity_id\`)`,
    `CREATE INDEX IF NOT EXISTS \`blocker_root_prompt_idx\` ON \`blockers\` (\`root_prompt_id\`)`,
    `CREATE INDEX IF NOT EXISTS \`blocker_parent_entity_idx\` ON \`blockers\` (\`parent_entity_id\`)`,
    `CREATE INDEX IF NOT EXISTS \`question_root_prompt_idx\` ON \`questions\` (\`root_prompt_id\`)`,
    `CREATE INDEX IF NOT EXISTS \`question_parent_entity_idx\` ON \`questions\` (\`parent_entity_id\`)`,
  ];
  for (const s of stmts) { sqlite.prepare(s).run(); }
  for (const s of alterStmts) { try { sqlite.prepare(s).run(); } catch { /* column already exists */ } }
  for (const s of indexStmts) { sqlite.prepare(s).run(); }
  sqlite.close();
}

async function main() {
  const dbUrl = process.env['CONDUCTOR_DB_URL'] ?? path.join(os.homedir(), '.conductor', 'db.sqlite');
  applyMigration0010(dbUrl);
  const db = getDb(dbUrl);

  const projectsDir = path.join(os.homedir(), '.claude', 'projects');
  if (!fs.existsSync(projectsDir)) {
    console.log('No ~/.claude/projects directory found. Nothing to backfill.');
    return;
  }

  const files = findSessionFiles(projectsDir);

  console.log(`Found ${files.length} session files to scan.`);

  let promptsSynthesized = 0;
  let entitiesLinked = 0;
  let entitiesUnlinked = 0;

  for (const file of files) {
    let messages: Array<{ body: string; receivedAt: string; sessionId: string }> = [];
    try {
      messages = parseJsonlFile(file);
    } catch (err) {
      console.warn(`  Skipping ${path.basename(file)}: ${String(err)}`);
      continue;
    }

    for (const msg of messages) {
      const hash = sha256(msg.body);

      const existing = db.select({ id: prompts.id })
        .from(prompts)
        .where(eq(prompts.hash, hash))
        .get();

      if (existing) continue;

      const id = makePromptId();
      try {
        db.insert(prompts).values({
          id,
          body: msg.body,
          receivedAt: msg.receivedAt,
          receivedVia: 'chat',
          sessionId: msg.sessionId,
          correlationId: id,
          hash,
          status: 'answered',
          metadataJson: JSON.stringify({ source: 'backfill', file: path.basename(file) }),
        }).run();
        promptsSynthesized++;
      } catch {
        continue;
      }

      // Link stories created within 60 seconds of this prompt
      const windowStart = new Date(new Date(msg.receivedAt).getTime() - 5_000).toISOString();
      const windowEnd = new Date(new Date(msg.receivedAt).getTime() + 60_000).toISOString();

      const matchingStories = db.select({ id: stories.id })
        .from(stories)
        .where(and(
          gte(stories.createdAt, windowStart),
          lte(stories.createdAt, windowEnd),
        ))
        .all();

      for (const s of matchingStories) {
        db.update(stories).set({ rootPromptId: id }).where(eq(stories.id, s.id)).run();
        entitiesLinked++;
      }

      // Link requirements created within 60 seconds
      const matchingReqs = db.select({ id: requirements.id })
        .from(requirements)
        .where(and(
          gte(requirements.createdAt, windowStart),
          lte(requirements.createdAt, windowEnd),
        ))
        .all();

      for (const r of matchingReqs) {
        db.update(requirements).set({ rootPromptId: id }).where(eq(requirements.id, r.id)).run();
        entitiesLinked++;
      }
    }
  }

  // Count unlinked entities
  const unlinkStories = db.select({ id: stories.id })
    .from(stories)
    .all()
    .filter((s: { id: string }) => {
      const row = db.select({ rootPromptId: stories.rootPromptId }).from(stories).where(eq(stories.id, s.id)).get();
      return !row?.rootPromptId;
    }).length;

  const unlinkReqs = db.select({ id: requirements.id })
    .from(requirements)
    .all()
    .filter((r: { id: string }) => {
      const row = db.select({ rootPromptId: requirements.rootPromptId }).from(requirements).where(eq(requirements.id, r.id)).get();
      return !row?.rootPromptId;
    }).length;

  entitiesUnlinked = unlinkStories + unlinkReqs;

  console.log('');
  console.log('Backfill complete:');
  console.log(`  Prompts synthesized : ${promptsSynthesized}`);
  console.log(`  Entities linked     : ${entitiesLinked}`);
  console.log(`  Entities unlinked   : ${entitiesUnlinked}`);
}

main().catch(err => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
