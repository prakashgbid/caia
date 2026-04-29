import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { Db } from './connection';
import { requirements, tasks, blockers, questions, projects } from './schema';
import { logger as rootLogger } from '../observability/logger';

const log = rootLogger.child({ component: 'migrate-from-jsonl' });
import { eq } from 'drizzle-orm';

function inferProjectId(db: Db, opts: {
  targetProject?: string;
  files?: string[];
  title?: string;
  description?: string;
}): string | null {
  const allProjects = db.select().from(projects).all();

  if (opts.targetProject) {
    const tp = opts.targetProject.toLowerCase();
    for (const p of allProjects) {
      if (tp.includes(p.slug) || tp.includes(p.name.toLowerCase())) return p.id;
    }
  }

  const fileStr = (opts.files ?? []).join(' ').toLowerCase();
  if (fileStr) {
    const pathMappings: Record<string, string> = {
      'poker-zeno': 'pokerzeno',
      'pokerzeno': 'pokerzeno',
      'roulette-community': 'roulettecommunity',
      'roulettecommunity': 'roulettecommunity',
      'conductor': 'conductor',
      'image-provider': 'imageprovider',
      'cast-bridge': 'castbridge',
      'dev-inspector': 'devinspector',
      'analytics': 'analytics',
      'backend-core': 'backendcore',
      'content-engine': 'contentengine',
      'seo-program': 'seoprogram',
      'integrity-check': 'integritycheck',
    };
    for (const [pattern, slug] of Object.entries(pathMappings)) {
      if (fileStr.includes(pattern)) {
        const proj = allProjects.find(p => p.slug === slug);
        if (proj) return proj.id;
      }
    }
  }

  const text = ((opts.title ?? '') + ' ' + (opts.description ?? '')).toLowerCase();
  const keywordMappings: Array<[string, string]> = [
    ['pokerzeno', 'pokerzeno'],
    ['poker zeno', 'pokerzeno'],
    ['poker-zeno', 'pokerzeno'],
    ['roulette community', 'roulettecommunity'],
    ['roulettecommunity', 'roulettecommunity'],
    ['conductor', 'conductor'],
    ['image provider', 'imageprovider'],
    ['cast bridge', 'castbridge'],
    ['devinspector', 'devinspector'],
    ['dev inspector', 'devinspector'],
    ['analytics', 'analytics'],
    ['backend core', 'backendcore'],
    ['content engine', 'contentengine'],
    ['seo program', 'seoprogram'],
    ['integrity check', 'integritycheck'],
  ];
  for (const [kw, slug] of keywordMappings) {
    if (text.includes(kw)) {
      const proj = allProjects.find(p => p.slug === slug);
      if (proj) return proj.id;
    }
  }

  return null;
}

export async function migrateFromJsonl(
  db: Db,
  conductorDir?: string,
): Promise<{ migrated: number; skipped: number }> {
  const dir = conductorDir ?? path.join(os.homedir(), '.conductor');
  let migrated = 0;
  let skipped = 0;
  const now = new Date().toISOString();

  // Migrate requirements
  const reqSnapshotPath = path.join(dir, 'requirements.snapshot.json');
  if (fs.existsSync(reqSnapshotPath)) {
    try {
      const raw = fs.readFileSync(reqSnapshotPath, 'utf8');
      const state = JSON.parse(raw) as { requirements: Record<string, unknown> };
      for (const [id, req] of Object.entries(state.requirements ?? {})) {
        const r = req as Record<string, unknown>;
        const existing = db.select({ id: requirements.id }).from(requirements).where(eq(requirements.id, id)).all();
        if (existing.length > 0) { skipped++; continue; }
        const projectId = inferProjectId(db, {
          targetProject: r['targetProject'] as string | undefined,
          files: r['estimatedFiles'] as string[] | undefined,
          title: r['title'] as string | undefined,
          description: r['description'] as string | undefined,
        });
        db.insert(requirements).values({
          id,
          title: (r['title'] as string) ?? 'Untitled',
          description: (r['description'] as string) ?? '',
          state: (r['state'] as string) ?? 'captured',
          priority: (r['priority'] as number) ?? 3,
          labels: JSON.stringify(r['labels'] ?? []),
          targetProject: r['targetProject'] as string | undefined,
          estimatedFiles: JSON.stringify(r['estimatedFiles'] ?? []),
          dependsOn: JSON.stringify(r['dependsOn'] ?? []),
          linkedTaskIds: JSON.stringify(r['linkedTaskIds'] ?? []),
          spec: r['spec'] ? JSON.stringify(r['spec']) : null,
          projectId,
          scope: projectId ? 'site' : 'global',
          createdAt: (r['capturedAt'] as string) ?? now,
          updatedAt: (r['updatedAt'] as string) ?? now,
        }).run();
        migrated++;
      }
    } catch (e) {
      log.error('failed to migrate requirements', { err: e instanceof Error ? e.message : String(e) });
    }
  }

  // Migrate blockers
  const blkSnapshotPath = path.join(dir, 'blockers.snapshot.json');
  if (fs.existsSync(blkSnapshotPath)) {
    try {
      const raw = fs.readFileSync(blkSnapshotPath, 'utf8');
      const state = JSON.parse(raw) as { blockers: Record<string, unknown> };
      for (const [id, blk] of Object.entries(state.blockers ?? {})) {
        const b = blk as Record<string, unknown>;
        const existing = db.select({ id: blockers.id }).from(blockers).where(eq(blockers.id, id)).all();
        if (existing.length > 0) { skipped++; continue; }
        const projectId = inferProjectId(db, {
          title: b['title'] as string | undefined,
          description: b['description'] as string | undefined,
        });
        db.insert(blockers).values({
          id,
          title: (b['title'] as string) ?? 'Untitled',
          severity: (b['severity'] as string) ?? 'normal',
          kind: (b['kind'] as string) ?? 'info',
          description: (b['description'] as string) ?? '',
          resolutionSteps: JSON.stringify(b['resolutionSteps'] ?? []),
          approvalButton: b['approvalButton'] ? JSON.stringify(b['approvalButton']) : null,
          links: JSON.stringify(b['links'] ?? []),
          state: (b['state'] as string) ?? 'open',
          requirementId: b['requirementId'] as string | undefined,
          taskId: b['taskId'] as string | undefined,
          resolvedAt: b['resolvedAt'] as string | undefined,
          resolvedBy: b['resolvedBy'] as string | undefined,
          resolutionNote: b['resolutionNote'] as string | undefined,
          projectId,
          scope: projectId ? 'site' : 'global',
          createdAt: (b['createdAt'] as string) ?? now,
        }).run();
        migrated++;
      }
    } catch (e) {
      log.error('failed to migrate blockers', { err: e instanceof Error ? e.message : String(e) });
    }
  }

  // Migrate questions
  const qSnapshotPath = path.join(dir, 'questions.snapshot.json');
  if (fs.existsSync(qSnapshotPath)) {
    try {
      const raw = fs.readFileSync(qSnapshotPath, 'utf8');
      const state = JSON.parse(raw) as { questions: Record<string, unknown> };
      for (const [id, q] of Object.entries(state.questions ?? {})) {
        const qu = q as Record<string, unknown>;
        const existing = db.select({ id: questions.id }).from(questions).where(eq(questions.id, id)).all();
        if (existing.length > 0) { skipped++; continue; }
        const projectId = inferProjectId(db, {
          title: qu['title'] as string | undefined,
          description: qu['context'] as string | undefined,
        });
        db.insert(questions).values({
          id,
          title: (qu['title'] as string) ?? 'Untitled',
          priority: (qu['priority'] as string) ?? 'normal',
          context: (qu['context'] as string) ?? '',
          recommendations: JSON.stringify(qu['recommendations'] ?? []),
          customAnswerPlaceholder: qu['customAnswerPlaceholder'] as string | undefined,
          state: (qu['state'] as string) ?? 'open',
          requirementId: qu['requirementId'] as string | undefined,
          taskId: qu['taskId'] as string | undefined,
          answer: qu['answer'] ? JSON.stringify(qu['answer']) : null,
          answeredAt: qu['answer'] ? now : null,
          projectId,
          scope: projectId ? 'site' : 'global',
          createdAt: (qu['createdAt'] as string) ?? now,
        }).run();
        migrated++;
      }
    } catch (e) {
      log.error('failed to migrate questions', { err: e instanceof Error ? e.message : String(e) });
    }
  }

  // Migrate tasks
  const stateSnapshotPath = path.join(dir, 'state.snapshot.json');
  if (fs.existsSync(stateSnapshotPath)) {
    try {
      const raw = fs.readFileSync(stateSnapshotPath, 'utf8');
      const state = JSON.parse(raw) as { tasks: Record<string, unknown> };
      for (const [id, t] of Object.entries(state.tasks ?? {})) {
        const tk = t as Record<string, unknown>;
        const existing = db.select({ id: tasks.id }).from(tasks).where(eq(tasks.id, id)).all();
        if (existing.length > 0) { skipped++; continue; }
        const projectId = inferProjectId(db, {
          files: tk['declaredFiles'] as string[] | undefined,
          title: tk['title'] as string | undefined,
        });
        db.insert(tasks).values({
          id,
          title: (tk['title'] as string) ?? 'Untitled',
          sessionId: tk['sessionId'] as string | undefined,
          status: (tk['status'] as string) ?? 'queued',
          cwd: (tk['cwd'] as string) ?? '/',
          declaredFiles: JSON.stringify(tk['declaredFiles'] ?? []),
          actualFiles: tk['actualFiles'] ? JSON.stringify(tk['actualFiles']) : null,
          dependsOn: JSON.stringify(tk['dependsOn'] ?? []),
          spawnedBy: (tk['spawnedBy'] as string) ?? 'user',
          bypassUsed: (tk['bypassUsed'] as boolean) ?? false,
          notes: tk['notes'] as string | undefined,
          projectId,
          scope: projectId ? 'site' : 'global',
          createdAt: (tk['createdAt'] as string) ?? now,
          startedAt: tk['startedAt'] as string | undefined,
          completedAt: tk['completedAt'] as string | undefined,
        }).run();
        migrated++;
      }
    } catch (e) {
      log.error('failed to migrate tasks', { err: e instanceof Error ? e.message : String(e) });
    }
  }

  return { migrated, skipped };
}
