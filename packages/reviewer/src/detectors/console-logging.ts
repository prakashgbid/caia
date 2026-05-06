/**
 * console-logging detector.
 *
 * Flags `console.log` / `console.debug` added in `src/` files. Considered
 * debug rot — production code uses the project logger; console.warn /
 * console.error are allowed (legitimate non-fatal signal channels).
 *
 * CLI source files (`src/cli.ts`, `bin/*.ts`) are exempt because the CLI
 * literally writes to stdout for the user.
 */

import type { Detector } from '../types.js';
import { addedTextOnly, excerpt, isFixturePath, isJsTsSrcPath, isTestPath, makeFinding } from './shared.js';

const CONSOLE_DEBUG = /\bconsole\s*\.\s*(log|debug)\b/;
const CLI_PATH = /(?:^|\/)(?:cli|bin)\.[jt]sx?$|(?:^|\/)bin\//;

export const consoleLoggingDetector: Detector = {
  id: 'det-console-logging',
  dimension: 'console-logging',
  scan(hunk, _ctx) {
    if (!isJsTsSrcPath(hunk.file)) return [];
    if (isFixturePath(hunk.file)) return [];
    if (isTestPath(hunk.file)) return [];
    if (CLI_PATH.test(hunk.file)) return [];
    const findings = [];
    for (const line of addedTextOnly(hunk)) {
      const m = CONSOLE_DEBUG.exec(line.text);
      if (m === null) continue;
      const method = m[1] ?? 'log';
      findings.push(makeFinding({
        dimension: 'console-logging',
        file: hunk.file,
        line: line.newLine,
        suggestionTitle: `console-${method}`,
        description: `\`console.${method}\` added in production source. Use the project logger for routed/leveled output; console.${method} silently bloats prod logs and skips structured fields.`,
        suggestedChange: `Switch to the package's logger (e.g. \`logger.info(...)\`); console.warn / console.error are still allowed for unrecoverable channels.`,
        detectorId: 'det-console-logging',
        excerpt: excerpt(line.text)
      }));
    }
    return findings;
  }
};
