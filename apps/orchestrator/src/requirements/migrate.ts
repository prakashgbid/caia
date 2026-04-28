/**
 * Seed requirements from .auto-memory/backlog/*.md files.
 * BL-* files with status: ready or status: specced become Requirements in the matching state.
 * Original files are preserved; they become the spec reference.
 */
import * as fs from 'fs';
import * as path from 'path';
import { RequirementsManager } from './manager';
import type { RequirementState } from './types';

interface BacklogEntry {
  title: string;
  description: string;
  status: RequirementState;
  priority: 1 | 2 | 3 | 4 | 5;
  labels: string[];
  targetProject?: string;
  estimatedFiles: string[];
  goals: string[];
  nonGoals: string[];
  acceptanceCriteria: string[];
  notes: string;
}

function parseFrontmatter(content: string): Record<string, string> {
  const fm: Record<string, string> = {};
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match?.[1]) return fm;
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (key) fm[key] = value;
  }
  return fm;
}

function mapStatus(raw: string): RequirementState | null {
  const s = raw.toLowerCase();
  if (s === 'ready') return 'ready';
  if (s === 'specced') return 'specced';
  if (s === 'captured') return 'captured';
  if (s === 'refining') return 'refining';
  if (s === 'executing') return 'executing';
  if (s === 'verifying') return 'verifying';
  if (s === 'done') return 'done';
  if (s === 'blocked') return 'blocked';
  if (s === 'cancelled') return 'cancelled';
  // Legacy statuses from BL files
  if (s === 'backlog' || s === 'todo') return 'captured';
  if (s === 'in-progress' || s === 'in_progress') return 'executing';
  if (s === 'complete' || s === 'completed') return 'done';
  return null;
}

function extractSection(content: string, heading: string): string[] {
  const re = new RegExp(`#+\\s*${heading}\\s*\\n([\\s\\S]*?)(?=\\n#|$)`, 'i');
  const match = content.match(re);
  if (!match?.[1]) return [];
  return match[1]
    .split('\n')
    .map(l => l.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean);
}

function parseBacklogFile(filepath: string): BacklogEntry | null {
  const raw = fs.readFileSync(filepath, 'utf8');
  const fm = parseFrontmatter(raw);

  const statusRaw = fm['status'] ?? 'captured';
  const status = mapStatus(statusRaw);
  if (!status) return null;

  // Strip frontmatter for body parsing
  const body = raw.replace(/^---\n[\s\S]*?\n---\n?/, '');

  const title = fm['title'] ?? path.basename(filepath, '.md');
  const description = body.split('\n').find(l => l.trim() && !l.startsWith('#')) ?? title;

  const priority = parseInt(fm['priority'] ?? '3', 10) as 1 | 2 | 3 | 4 | 5;
  const labels = fm['labels']
    ? fm['labels'].split(',').map(l => l.trim()).filter(Boolean)
    : [];
  const targetProject = fm['targetProject'] ?? fm['project'] ?? undefined;

  return {
    title,
    description,
    status,
    priority: (priority >= 1 && priority <= 5) ? priority : 3,
    labels,
    targetProject,
    estimatedFiles: extractSection(body, 'Files'),
    goals: extractSection(body, 'Goals'),
    nonGoals: extractSection(body, 'Non.?goals'),
    acceptanceCriteria: extractSection(body, 'Acceptance Criteria'),
    notes: fm['notes'] ?? '',
  };
}

export async function migrateFromBacklog(
  backlogDir: string,
  reqManager: RequirementsManager,
  options: { dryRun?: boolean } = {},
): Promise<{ migrated: string[]; skipped: string[]; errors: string[] }> {
  const migrated: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];

  if (!fs.existsSync(backlogDir)) {
    skipped.push(`Backlog dir not found: ${backlogDir}`);
    return { migrated, skipped, errors };
  }

  const files = fs.readdirSync(backlogDir)
    .filter(f => f.match(/^BL-.*\.md$/i) || f.match(/\.md$/))
    .map(f => path.join(backlogDir, f));

  for (const filepath of files) {
    try {
      const entry = parseBacklogFile(filepath);
      if (!entry) {
        skipped.push(filepath);
        continue;
      }

      if (options.dryRun) {
        migrated.push(`[DRY RUN] Would create: ${entry.title} (${entry.status})`);
        continue;
      }

      const req = await reqManager.seedFromRecord({
        title: entry.title,
        description: entry.description,
        state: entry.status,
        priority: entry.priority,
        labels: entry.labels,
        targetProject: entry.targetProject,
        estimatedFiles: entry.estimatedFiles,
        dependsOn: [],
        spec: (entry.goals.length > 0 || entry.acceptanceCriteria.length > 0) ? {
          goals: entry.goals,
          nonGoals: entry.nonGoals,
          acceptanceCriteria: entry.acceptanceCriteria,
          notes: entry.notes,
        } : undefined,
      });

      migrated.push(`${req.id} — ${entry.title} (${entry.status})`);
    } catch (err) {
      errors.push(`${filepath}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { migrated, skipped, errors };
}
