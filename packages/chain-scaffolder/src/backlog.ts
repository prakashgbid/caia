// Backlog discovery + dependency resolution for the templated path.
//
// A "structured backlog" is just a directory of one-yaml-per-item files.
// `--backlog` can point at:
//   - a directory                       → walk for *.yaml + *.yml
//   - a .yaml file (single or array)    → load directly
//   - a .md file (e.g. MASTER_BACKLOG)  → look in a sibling `structured/` dir
//
// "Pending" = the structured item exists but no chain-state has been
// scaffolded yet (~/.caia/chain/<id>/state.json is missing).
//
// "Next available" = first pending item whose `deps[]` chain ids are all
// reported `all_done: true` in their respective state.json. This keeps the
// orchestrator's choice deterministic + diff-friendly.

import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import yaml from 'js-yaml';
import type { BacklogItem } from './templated.js';
import { validateBacklogItem, chainPaths } from './templated.js';

export interface BacklogIndexEntry {
  source: string;
  item: BacklogItem;
  scaffolded: boolean;
  depsResolved: boolean;
  /** Reason the entry is currently *not* dispatchable, when applicable. */
  blockedReason?: string;
}

export interface BacklogIndex {
  entries: BacklogIndexEntry[];
  errors: Array<{ source: string; reason: string }>;
}

interface ParseOpts {
  home?: string;
}

function expandHome(p: string, home: string): string {
  if (p.startsWith('~/')) return join(home, p.slice(2));
  if (p === '~') return home;
  return p;
}

function loadYamlSources(backlogPath: string): Array<{ source: string; raw: unknown }> {
  const ext = extname(backlogPath).toLowerCase();
  const stat = statSync(backlogPath);

  let dir: string;
  if (stat.isDirectory()) {
    dir = backlogPath;
  } else if (ext === '.md' || ext === '.markdown') {
    const sibling = join(dirname(backlogPath), 'structured');
    if (!existsSync(sibling) || !statSync(sibling).isDirectory()) return [];
    dir = sibling;
  } else if (ext === '.yaml' || ext === '.yml') {
    const raw = yaml.load(readFileSync(backlogPath, 'utf8'));
    if (Array.isArray(raw)) {
      return raw.map((it, i) => ({ source: `${backlogPath}#${i}`, raw: it }));
    }
    return [{ source: backlogPath, raw }];
  } else {
    throw new Error(`unsupported backlog path ${backlogPath} (need .yaml, .yml, .md, or directory)`);
  }

  const out: Array<{ source: string; raw: unknown }> = [];
  for (const entry of readdirSync(dir).sort()) {
    if (!entry.endsWith('.yaml') && !entry.endsWith('.yml')) continue;
    const p = join(dir, entry);
    const raw = yaml.load(readFileSync(p, 'utf8'));
    if (Array.isArray(raw)) {
      raw.forEach((it, i) => out.push({ source: `${p}#${i}`, raw: it }));
    } else {
      out.push({ source: p, raw });
    }
  }
  return out;
}

/**
 * Parse the backlog into a normalized index. Validation errors on individual
 * items do not abort the whole walk — they land in `index.errors` and the
 * remaining items still index. This matches the orchestrator's expectations:
 * one bad item shouldn't stall the queue.
 */
export function parseBacklog(backlogPath: string, opts: ParseOpts = {}): BacklogIndex {
  const home = opts.home ?? homedir();
  const expanded = expandHome(backlogPath, home);
  const abs = resolve(expanded);
  const sources = loadYamlSources(abs);

  const errors: BacklogIndex['errors'] = [];
  const entries: BacklogIndexEntry[] = [];

  for (const { source, raw } of sources) {
    try {
      validateBacklogItem(raw);
    } catch (e) {
      errors.push({ source, reason: (e as Error).message });
      continue;
    }
    const item = raw;
    const paths = chainPaths(item.id, home);
    const scaffolded = existsSync(paths.stateFile);
    const blockers: string[] = [];
    for (const dep of item.deps) {
      const depPaths = chainPaths(dep, home);
      if (!existsSync(depPaths.stateFile)) {
        blockers.push(`dep "${dep}" has no chain-state yet`);
        continue;
      }
      try {
        const st = JSON.parse(readFileSync(depPaths.stateFile, 'utf8')) as { all_done?: boolean };
        if (!st.all_done) blockers.push(`dep "${dep}" not all_done`);
      } catch (e) {
        blockers.push(`dep "${dep}" state unreadable: ${(e as Error).message}`);
      }
    }
    const depsResolved = blockers.length === 0;
    const entry: BacklogIndexEntry = {
      source,
      item,
      scaffolded,
      depsResolved,
    };
    if (!depsResolved) entry.blockedReason = blockers.join('; ');
    entries.push(entry);
  }

  return { entries, errors };
}

/** Items that exist in the backlog but have NO chain-state yet. */
export function listPending(backlogPath: string, opts: ParseOpts = {}): BacklogIndexEntry[] {
  return parseBacklog(backlogPath, opts).entries.filter((e) => !e.scaffolded);
}

/**
 * The next backlog item that should be scaffolded: not-yet-scaffolded AND
 * deps are all_done. Returns null when no item qualifies (orchestrator
 * treats this as "nothing to spawn this tick").
 */
export function nextAvailable(
  backlogPath: string,
  opts: ParseOpts = {},
): BacklogIndexEntry | null {
  const pending = listPending(backlogPath, opts);
  return pending.find((e) => e.depsResolved) ?? null;
}
