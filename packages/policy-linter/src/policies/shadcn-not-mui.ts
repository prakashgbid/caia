/**
 * Policy: `shadcn-not-mui`
 *
 * Maps to spec `p012-no-shadcn-mui-mix.ts` (lines 604, 852-856) and ADR-061.
 *
 * Rule: in the shadcn-locked set of repos (default: all operator repos),
 * source code must not import from `@mui/material`, `@material-ui/core`, or
 * other known MUI namespaces. Brief must not propose adding MUI.
 *
 * Per spec line 852 (the worked-example pattern):
 *
 *   > grep the PR diff for `import.*@mui/material` or `from '@mui/material'`.
 *   > Flag if found. Misses: a developer adds `import { Box } from
 *   > '@material-ui/core'` (the v4 package); the grep doesn't match.
 *
 *   > Hybrid (the framework's recommendation): an algorithmic policy that
 *   > catches the high-confidence cases (grep for both `@mui/material` and
 *   > `@material-ui/core` and any other known MUI namespace).
 *
 * Mode: `hard-fail`. shadcn-over-MUI is settled per operator memory
 * "operator prefers shadcn over MUI" (spec line 359).
 *
 * Detection: scan `prDiff` first (highest-signal), then `briefMd`. Flag any
 * MUI namespace match. False-positive defence: do NOT flag mentions inside
 * negative phrasings like "do not use @mui/material" or "remove @mui/material".
 */

import type {
  DispatchContext,
  Policy,
  PolicyEvidence,
  PolicyVerdict
} from '../types.js';

const MUI_NAMESPACE_PATTERNS: ReadonlyArray<RegExp> = [
  /@mui\/material/gi,
  /@mui\/system/gi,
  /@mui\/styles/gi,
  /@mui\/x-data-grid/gi,
  /@mui\/icons-material/gi,
  /@material-ui\/core/gi,
  /@material-ui\/styles/gi,
  /@material-ui\/icons/gi,
  /@material-ui\/lab/gi
];

const NEGATIVE_CONTEXT_PATTERNS: ReadonlyArray<RegExp> = [
  /\b(?:do not|don't|don't|never|avoid|remove|drop|deprecate|migrate\s+(?:away\s+)?from|delete|forbid|ban|reject)\b/i,
  /\bnot\s+(?:to\s+)?use\b/i,
  /\bno\s+(?:more\s+)?(?:@?mui|material[\s\-]?ui)\b/i
];

function isNegativeContext(line: string): boolean {
  return NEGATIVE_CONTEXT_PATTERNS.some((rx) => rx.test(line));
}

export function findMuiImports(
  text: string,
  sourceLabel: string
): ReadonlyArray<PolicyEvidence> {
  const evidence: PolicyEvidence[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    // Skip deletion lines in a unified diff (start with `-` but not `---`).
    if (line.startsWith('-') && !line.startsWith('---')) continue;
    if (isNegativeContext(line)) continue;
    for (const rx of MUI_NAMESPACE_PATTERNS) {
      rx.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = rx.exec(line)) !== null) {
        evidence.push({
          source: sourceLabel,
          line: i + 1,
          snippet: line.length > 200 ? `${line.slice(0, 199)}…` : line
        });
        if (evidence.length >= 20) return evidence;
      }
    }
  }
  return evidence;
}

export const shadcnNotMuiPolicy: Policy = {
  id: 'shadcn-not-mui',
  description:
    'shadcn/ui is the operator-locked UI library. No @mui/material, @material-ui/core, or other MUI namespaces in source or PR diff. Source: ADR-061.',
  defaultMode: 'hard-fail',
  async check(ctx: DispatchContext): Promise<PolicyVerdict> {
    const diffEvidence = ctx.prDiff
      ? findMuiImports(ctx.prDiff, 'prDiff')
      : [];
    const briefEvidence = findMuiImports(ctx.briefMd, 'brief');
    const evidence = [...diffEvidence, ...briefEvidence];
    if (evidence.length === 0) {
      return { ok: true };
    }
    return {
      ok: false,
      mode: 'hard-fail',
      reason: `${evidence.length} MUI namespace reference${evidence.length === 1 ? '' : 's'} found in PR diff or brief. ADR-061 locks the UI library to shadcn/ui.`,
      suggestedFix:
        'Replace MUI imports with shadcn/ui primitives. Example: `import { Button } from "@/components/ui/button"`. Run `pnpm dlx shadcn@latest add <component>` to generate the component if missing.',
      evidence
    };
  }
};
