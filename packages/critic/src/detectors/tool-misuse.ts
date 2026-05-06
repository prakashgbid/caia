/**
 * tool-misuse detector.
 *
 * Flags use of bare `curl`/`wget` in code paths where MCP / web_fetch is
 * the right tier (per `feedback_tool_choice_*` family of memory rules).
 *
 * Only flags inside source code, scripts, or CI configs — README docs
 * frequently quote curl examples for human consumption and those are fine.
 */

import type { Detector } from '../types.js';
import { addedTextOnly, excerpt, makeFinding } from './shared.js';

const HTTP_CALL = /\b(curl|wget|http\.get|fetch\(|axios\.get|requests\.get)\s*\(?["'\s]?https?:\/\//i;

const SOURCE_PATH = /\.(ts|tsx|js|jsx|mjs|cjs|py|sh|zsh|bash|yml|yaml)$/i;

const ALLOWLIST_HINT = /\/\/\s*tool-misuse:\s*allow|#\s*tool-misuse:\s*allow/;

export const toolMisuseDetector: Detector = {
  id: 'det-tool-misuse',
  category: 'tool-misuse',
  scan(hunk, _ctx) {
    if (!SOURCE_PATH.test(hunk.file)) return [];
    const findings = [];
    for (const line of addedTextOnly(hunk)) {
      if (ALLOWLIST_HINT.test(line.text)) continue;
      if (HTTP_CALL.test(line.text)) {
        findings.push(makeFinding({
          category: 'tool-misuse',
          file: hunk.file,
          line: line.newLine,
          attackVector: 'raw-http-call-instead-of-mcp',
          description: 'Added line makes a raw HTTP call. The orchestrator path for HTTP fetches is the web_fetch tool / MCP — raw curl/fetch in production code typically misses retry, telemetry, and capability-broker checks.',
          reproductionSteps: [
            `Read ${hunk.file} line ${line.newLine}`,
            'Confirm whether MCP / web_fetch is the appropriate tier for this caller.'
          ],
          suggestedMitigation: 'Use @chiefaia/mcp-allowlist-proxy or web_fetch instead. If raw HTTP is intentional, add `// tool-misuse: allow` on the same line.',
          detectorId: 'det-tool-misuse',
          excerpt: excerpt(line.text)
        }));
      }
    }
    return findings;
  }
};
