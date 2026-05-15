// inject.ts — format top-K file contents into a system context block.
//
// Token budget: we approximate "tokens" as `chars / 4`, which is roughly
// the GPT-tokenizer ratio for English+code. The 2K-token cap (per the T2.5
// Phase 2 spec) translates to ~8 000 characters of context. The budget is
// split evenly across the K files, with each file allowed to use less than
// its share if the file is small.

import { existsSync, readFileSync, statSync } from 'node:fs';

import type { IndexEntry } from './index.js';

export const DEFAULT_TOKEN_BUDGET = Number(process.env['ROUTER_RAG_TOKEN_BUDGET'] ?? 2_000);
export const CHARS_PER_TOKEN = 4;                       // ~ heuristic
const HEADER = '## CAIA RAG context — auto-injected from local file index';

export interface InjectInput {
  entries: IndexEntry[];
  similarities?: number[];                  // optional, parallel to entries
  tokenBudget?: number;
}

export interface InjectResult {
  systemMessage: string;                    // ready-to-prepend system content
  filesIncluded: number;
  charsIncluded: number;
  truncated: boolean;
}

export function injectFiles(input: InjectInput): InjectResult {
  const tokenBudget = input.tokenBudget ?? DEFAULT_TOKEN_BUDGET;
  const charBudget = tokenBudget * CHARS_PER_TOKEN;

  if (input.entries.length === 0) {
    return { systemMessage: '', filesIncluded: 0, charsIncluded: 0, truncated: false };
  }

  const perFileBudget = Math.floor(charBudget / input.entries.length);
  const sections: string[] = [HEADER];
  let totalChars = HEADER.length;
  let truncated = false;
  let filesIncluded = 0;

  for (let i = 0; i < input.entries.length; i++) {
    const entry = input.entries[i];
    if (entry === undefined) continue;
    const sim = input.similarities?.[i];

    let body: string;
    try {
      if (existsSync(entry.path)) {
        // Cap the read at perFileBudget to keep memory bounded for huge files
        // (some markdowns/notebooks are megabytes). We still slice the result
        // below so the final string fits.
        const raw = readFileSync(entry.path, 'utf8');
        body = raw.slice(0, perFileBudget * 2); // overshoot then slice cleanly
      } else {
        body = entry.preview; // file moved/deleted since index build — use preview
      }
    } catch {
      body = entry.preview;
    }

    if (body.length > perFileBudget) {
      body = body.slice(0, perFileBudget) + '\n…[truncated]';
      truncated = true;
    }

    const simStr = typeof sim === 'number' ? ` (sim=${sim.toFixed(3)})` : '';
    const section = `\n\n### ${entry.rel}${simStr}\n\n\`\`\`\n${body}\n\`\`\``;

    // Respect the global character budget too — stop adding files if the
    // running total would exceed it.
    if (totalChars + section.length > charBudget && filesIncluded > 0) {
      truncated = true;
      break;
    }

    sections.push(section);
    totalChars += section.length;
    filesIncluded += 1;
  }

  return {
    systemMessage: sections.join(''),
    filesIncluded,
    charsIncluded: totalChars,
    truncated,
  };
}

// Lightweight stat helper used by the index-build script.
export function fileSizeOrZero(path: string): number {
  try { return statSync(path).size; } catch { return 0; }
}
