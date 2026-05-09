/**
 * Digest generator — renders curated Finding[] to markdown, grouped by source.
 *
 * Hard size cap: throws DigestSizeExceededError if rendered markdown would
 * exceed maxBytes. Caller (agent) should tighten minImportance and retry.
 */

import type { Digest, Finding, FindingSource } from './types.js';

export class DigestSizeExceededError extends Error {
  readonly sizeBytes: number;
  readonly maxBytes: number;
  readonly findingCount: number;
  constructor(sizeBytes: number, maxBytes: number, findingCount: number) {
    super(
      `Digest size ${sizeBytes}B exceeds cap ${maxBytes}B with ${findingCount} findings — ` +
      'importance filter not strict enough. Raise minImportance or lower maxFindings.'
    );
    this.name = 'DigestSizeExceededError';
    this.sizeBytes = sizeBytes;
    this.maxBytes = maxBytes;
    this.findingCount = findingCount;
  }
}

export interface GenerateDigestArgs {
  findings: readonly Finding[];
  dropped: readonly Finding[];
  generatedAtIso: string;
  sinceIso: string;
  untilIso: string;
  maxBytes: number;
  sourceSummary: Record<FindingSource, { collected: number; warnings: readonly string[] }>;
}

const SECTION_ORDER: readonly FindingSource[] = ['pr', 'memory', 'transcript', 'connector-error'];

const SECTION_LABEL: Readonly<Record<FindingSource, string>> = {
  pr: 'Pull Requests',
  memory: 'Agent Memory',
  transcript: 'Agent Transcripts',
  'connector-error': 'Connector Errors'
};

export function generateDigest(args: GenerateDigestArgs): Digest {
  const lines: string[] = [];
  lines.push(`# Surface Digest — ${args.untilIso}`);
  lines.push('');
  lines.push(`Window: \`${args.sinceIso}\` → \`${args.untilIso}\``);
  lines.push(`Generated: \`${args.generatedAtIso}\``);
  lines.push(`Findings: **${args.findings.length}** kept, ${args.dropped.length} dropped (below importance floor or over cap)`);
  lines.push('');

  // Summary table.
  lines.push('## Source summary');
  lines.push('');
  lines.push('| Source | Collected | Warnings |');
  lines.push('|---|---:|---|');
  for (const src of SECTION_ORDER) {
    const s = args.sourceSummary[src];
    if (s === undefined) continue;
    const w = s.warnings.length === 0
      ? '—'
      : '`' + s.warnings.map(x => x.slice(0, 60)).join('` `') + '`';
    lines.push(`| ${SECTION_LABEL[src]} | ${s.collected} | ${w} |`);
  }
  lines.push('');

  // Group findings by source.
  const groups = new Map<FindingSource, Finding[]>();
  for (const f of args.findings) {
    const list = groups.get(f.source);
    if (list === undefined) groups.set(f.source, [f]);
    else list.push(f);
  }

  for (const src of SECTION_ORDER) {
    const list = groups.get(src);
    if (list === undefined || list.length === 0) continue;
    lines.push(`## ${SECTION_LABEL[src]}`);
    lines.push('');
    for (const f of list) {
      lines.push(renderFinding(f));
    }
    lines.push('');
  }

  if (args.findings.length === 0) {
    lines.push('_No findings above importance floor._');
    lines.push('');
  }

  const markdown = lines.join('\n');
  const sizeBytes = Buffer.byteLength(markdown, 'utf-8');

  if (sizeBytes > args.maxBytes) {
    throw new DigestSizeExceededError(sizeBytes, args.maxBytes, args.findings.length);
  }

  return {
    markdown,
    findings: args.findings,
    dropped: args.dropped,
    sizeBytes,
    generatedAtIso: args.generatedAtIso,
    sinceIso: args.sinceIso,
    untilIso: args.untilIso,
    sourceSummary: args.sourceSummary
  };
}

function renderFinding(f: Finding): string {
  const importance = (f.importance * 100).toFixed(0).padStart(3, ' ');
  const ts = f.tsIso;
  const linkPart = f.url !== undefined ? ` [↗](${f.url})` : '';
  const tagPart = f.tags.length === 0
    ? ''
    : ' ' + f.tags.slice(0, 6).map(t => '`' + t + '`').join(' ');
  return `- **[${importance}%]** \`${ts}\` — ${escapeMd(f.title)}${linkPart}${tagPart}`;
}

function escapeMd(s: string): string {
  // Light: prevent accidental list/section breakage. Don't HTML-escape.
  return s.replace(/\|/g, '\\|').replace(/\n+/g, ' ');
}
