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
import { getDb, runMigrations } from '../src/db/connection';
import { prompts, stories, requirements } from '../src/db/schema';

interface JsonlMessage {
  type?: string;
  role?: string;
  content?: string | Array<{ type: string; text?: string }>;
  timestamp?: string;
  uuid?: string;
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
  const sessionId = path.basename(path.dirname(filePath));
  const results: Array<{ body: string; receivedAt: string; sessionId: string }> = [];

  const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line) as JsonlMessage;
      const isUserMessage = msg.role === 'user' || msg.type === 'user';
      if (!isUserMessage || !msg.content) continue;

      const body = extractText(msg.content).trim();
      if (!body || body.length < 5) continue;

      const receivedAt = msg.timestamp ?? new Date().toISOString();
      results.push({ body, receivedAt, sessionId });
    } catch {
      // skip malformed lines
    }
  }
  return results;
}

function findSessionFiles(projectsDir: string): string[] {
  const files: string[] = [];
  const projectDirs = fs.readdirSync(projectsDir).filter(d => d.startsWith('-'));
  for (const projectDir of projectDirs) {
    const fullDir = path.join(projectsDir, projectDir);
    try {
      const entries = fs.readdirSync(fullDir);
      for (const entry of entries) {
        if (entry.startsWith('session-') && entry.endsWith('.jsonl')) {
          files.push(path.join(fullDir, entry));
        }
      }
    } catch {
      // skip unreadable dirs
    }
  }
  return files;
}

async function main() {
  const dbUrl = process.env['CONDUCTOR_DB_URL'] ?? path.join(os.homedir(), '.conductor', 'db.sqlite');
  runMigrations(dbUrl);
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
