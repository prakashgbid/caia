/**
 * PR connector — reads `gh pr list --json ...` for merged + open PRs in a
 * given repo since a relative time, returns Finding[].
 *
 * Fields requested: number, title, state, author, mergedAt, createdAt,
 * updatedAt, url, labels, isDraft, baseRefName, headRefName.
 */

import { createHash } from 'node:crypto';

import type {
  CollectArgs,
  Connector,
  ConnectorResult,
  Finding,
  FindingKind,
  GhRunner
} from '../types.js';

interface GhPr {
  number: number;
  title: string;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  author?: { login?: string };
  mergedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  url?: string;
  labels?: ReadonlyArray<{ name: string }>;
  isDraft?: boolean;
  baseRefName?: string;
  headRefName?: string;
}

const PR_FIELDS = [
  'number',
  'title',
  'state',
  'author',
  'mergedAt',
  'createdAt',
  'updatedAt',
  'url',
  'labels',
  'isDraft',
  'baseRefName',
  'headRefName'
];

const STALE_THRESHOLD_DAYS = 7;

export interface PrConnectorOptions {
  ghRepo: string;
  gh: GhRunner;
  /** Max PRs returned by `gh pr list --limit`. Defaults to 200. */
  limit?: number;
}

export function createPrConnector(opts: PrConnectorOptions): Connector {
  const limit = opts.limit ?? 200;

  return {
    source: 'pr',
    async collect(args: CollectArgs): Promise<ConnectorResult> {
      const collectedAtIso = args.untilIso;
      const warnings: string[] = [];
      const findings: Finding[] = [];
      const sinceMs = Date.parse(args.sinceIso);
      const untilMs = Date.parse(args.untilIso);

      // Pull both merged + open in two passes — `gh pr list` filters by state
      // separately and merging the two streams gives the operator a single
      // ranked view.
      let mergedJson = '';
      let openJson = '';
      try {
        mergedJson = await opts.gh.run([
          'pr', 'list',
          '--repo', opts.ghRepo,
          '--state', 'merged',
          '--limit', String(limit),
          '--json', PR_FIELDS.join(',')
        ]);
      } catch (e) {
        warnings.push(`pr-merged: ${(e as Error).message.slice(0, 200)}`);
      }
      try {
        openJson = await opts.gh.run([
          'pr', 'list',
          '--repo', opts.ghRepo,
          '--state', 'open',
          '--limit', String(limit),
          '--json', PR_FIELDS.join(',')
        ]);
      } catch (e) {
        warnings.push(`pr-open: ${(e as Error).message.slice(0, 200)}`);
      }

      const merged = parseJsonArray(mergedJson, warnings, 'merged');
      const open = parseJsonArray(openJson, warnings, 'open');

      for (const pr of merged) {
        const ts = pr.mergedAt ?? pr.updatedAt ?? pr.createdAt;
        if (ts === undefined || ts === null) continue;
        const tsMs = Date.parse(ts);
        if (Number.isNaN(tsMs) || tsMs < sinceMs || tsMs > untilMs) continue;
        findings.push(buildFinding(pr, ts, 'pr-merged'));
      }
      for (const pr of open) {
        const created = pr.createdAt ?? pr.updatedAt ?? args.sinceIso;
        const updated = pr.updatedAt ?? pr.createdAt ?? args.sinceIso;
        const createdMs = Date.parse(created);
        const updatedMs = Date.parse(updated);
        // Bucket the open PR as either "newly opened in window" or "stale".
        const opensInWindow = !Number.isNaN(createdMs) && createdMs >= sinceMs && createdMs <= untilMs;
        const ageDays = (untilMs - updatedMs) / (1000 * 60 * 60 * 24);
        if (opensInWindow) {
          findings.push(buildFinding(pr, created, 'pr-opened'));
        } else if (ageDays >= STALE_THRESHOLD_DAYS) {
          findings.push(buildFinding(pr, updated, 'pr-stale'));
        }
      }

      return {
        source: 'pr',
        findings,
        collectedAtIso,
        warnings
      };
    }
  };
}

function parseJsonArray(json: string, warnings: string[], label: string): GhPr[] {
  if (json.trim() === '') return [];
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) {
      warnings.push(`${label}: gh json was not an array`);
      return [];
    }
    return parsed as GhPr[];
  } catch (e) {
    warnings.push(`${label}: json parse failed: ${(e as Error).message.slice(0, 100)}`);
    return [];
  }
}

function buildFinding(pr: GhPr, tsIso: string, kind: FindingKind): Finding {
  const labels = (pr.labels ?? []).map(l => l.name);
  const tags: string[] = [
    `state:${pr.state.toLowerCase()}`,
    ...(pr.isDraft === true ? ['draft'] : []),
    ...labels.map(l => `label:${l}`),
    ...(pr.baseRefName !== undefined ? [`base:${pr.baseRefName}`] : [])
  ];
  const titleClean = pr.title.length > 200 ? pr.title.slice(0, 197) + '...' : pr.title;
  const idHash = createHash('sha256')
    .update(`pr|${kind}|${pr.number}|${tsIso}`)
    .digest('hex')
    .slice(0, 16);
  const meta: Record<string, string | number | boolean> = {
    number: pr.number,
    state: pr.state,
    isDraft: pr.isDraft ?? false
  };
  if (pr.author?.login !== undefined) meta['author'] = pr.author.login;
  if (pr.headRefName !== undefined) meta['headRefName'] = pr.headRefName;
  const finding: Finding = {
    id: idHash,
    source: 'pr',
    kind,
    key: `pr#${pr.number}`,
    title: `PR #${pr.number} ${kindVerb(kind)}: ${titleClean}`,
    tsIso,
    importance: 0,
    tags,
    meta
  };
  if (pr.url !== undefined) finding.url = pr.url;
  return finding;
}

function kindVerb(kind: FindingKind): string {
  switch (kind) {
    case 'pr-merged':
      return 'merged';
    case 'pr-opened':
      return 'opened';
    case 'pr-stale':
      return 'stale';
    default:
      return kind;
  }
}
