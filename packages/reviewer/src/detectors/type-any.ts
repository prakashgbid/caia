/**
 * type-any detector.
 *
 * Flags explicit `: any` annotations, `as any` casts, and `<any>` generics
 * added to TypeScript source. AGENTS.md "Code style" — "No `any`. Use
 * `unknown` + narrow, or fix the type."
 *
 * Test files are exempt — fixture types occasionally need `any` for
 * shape-mismatch fakes.
 */

import type { Detector } from '../types.js';
import { addedTextOnly, excerpt, isFixturePath, isJsTsSrcPath, isTestPath, makeFinding } from './shared.js';

const ANY_ANNOTATION = /:\s*any\b|\bas\s+any\b|<any>/;
const TYPESCRIPT_FILE = /\.tsx?$/;

export const typeAnyDetector: Detector = {
  id: 'det-type-any',
  dimension: 'type-any',
  scan(hunk, _ctx) {
    if (!isJsTsSrcPath(hunk.file)) return [];
    if (!TYPESCRIPT_FILE.test(hunk.file)) return [];
    if (isTestPath(hunk.file)) return [];
    if (isFixturePath(hunk.file)) return [];
    const findings = [];
    for (const line of addedTextOnly(hunk)) {
      if (!ANY_ANNOTATION.test(line.text)) continue;
      // Skip lines that are eslint-disable comments referencing any.
      if (/eslint-disable.*no-explicit-any/.test(line.text)) continue;
      findings.push(makeFinding({
        dimension: 'type-any',
        file: hunk.file,
        line: line.newLine,
        suggestionTitle: 'explicit-any',
        description: 'Explicit `any` annotation / cast added. CAIA convention (AGENTS.md "Code style") is `unknown` + narrow, or a precise type. `any` silently disables type-checking and propagates unsoundness.',
        suggestedChange: 'Replace `any` with `unknown` (and narrow at use-site) or with the precise type.',
        detectorId: 'det-type-any',
        excerpt: excerpt(line.text)
      }));
    }
    return findings;
  }
};
