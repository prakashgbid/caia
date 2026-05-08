/**
 * cost-overrun detector.
 *
 * Flags references to per-token-billed APIs that violate the
 * subscription-only rule (feedback_no_api_key_billing.md). Specifically:
 *   - ANTHROPIC_API_KEY env-var reads in src code
 *   - api.anthropic.com / openai.com/v1 / api.openai.com URL literals
 *   - api.together.ai / replicate.com per-token endpoints
 *
 * Allowed: explicit `// cost-overrun: allow` annotation, or the file is
 * a test fixture / example. The default test for the apprentice corpus
 * distillation explicitly nukes ANTHROPIC_API_KEY — references to *deleting*
 * the env var are NOT flagged (only reads).
 */

import type { Detector } from '../types.js';
import { addedTextOnly, excerpt, isAllowlistedFixturePath, makeFinding } from './shared.js';

const PER_TOKEN_HOSTS = /\b(api\.anthropic\.com|api\.openai\.com|openai\.com\/v1|api\.together\.ai|api\.replicate\.com|api\.anyscale\.com)\b/;
const API_KEY_READ = /\bprocess\.env\[\s*['"]ANTHROPIC_API_KEY['"]\s*\]|\bprocess\.env\.ANTHROPIC_API_KEY\b|os\.getenv\(\s*['"]ANTHROPIC_API_KEY['"]\s*\)/;
const ALLOW_HINT = /\/\/\s*cost-overrun:\s*allow|#\s*cost-overrun:\s*allow/;
const SOURCE_PATH = /\.(ts|tsx|js|jsx|mjs|cjs|py)$/i;
const TEST_PATH = /(?:^|\/)(tests|__tests__|test|spec|specs)\/|\.(test|spec)\.[jt]sx?$/i;

export const costOverrunDetector: Detector = {
  id: 'det-cost-overrun',
  category: 'cost-overrun',
  scan(hunk, _ctx) {
    if (!SOURCE_PATH.test(hunk.file)) return [];
    if (isAllowlistedFixturePath(hunk.file)) return [];
    if (TEST_PATH.test(hunk.file)) return [];
    const findings = [];
    for (const line of addedTextOnly(hunk)) {
      if (ALLOW_HINT.test(line.text)) continue;
      const hostMatch = PER_TOKEN_HOSTS.exec(line.text);
      const keyMatch = API_KEY_READ.exec(line.text);
      if (hostMatch !== null) {
        findings.push(makeFinding({
          category: 'cost-overrun',
          file: hunk.file,
          line: line.newLine,
          attackVector: `per-token-host-${hostMatch[1] ?? 'unknown'}`,
          description: `Reference to per-token-billed API host \`${hostMatch[1] ?? ''}\`. Per feedback_no_api_key_billing.md the project uses subscription-only — \`claude\` binary or Ollama, never per-token endpoints.`,
          reproductionSteps: [
            `Read ${hunk.file} line ${line.newLine}`,
            'Confirm whether this is intentional production code (not test fixture).'
          ],
          suggestedMitigation: 'Replace the per-token API call with a `claude` binary subprocess (see packages/apprentice-corpus/src/distiller.ts for the canonical pattern) OR an Ollama call via @chiefaia/local-llm-router.',
          detectorId: 'det-cost-overrun',
          excerpt: excerpt(line.text)
        }));
      }
      if (keyMatch !== null) {
        findings.push(makeFinding({
          category: 'cost-overrun',
          file: hunk.file,
          line: line.newLine,
          attackVector: 'reads-anthropic-api-key',
          description: 'Source code reads ANTHROPIC_API_KEY from env. Per feedback_no_api_key_billing.md this env var must be DELETED before spawning subprocess, never read for billing.',
          reproductionSteps: [
            `Read ${hunk.file} line ${line.newLine}`,
            'Confirm whether the surrounding code is using the key for per-token billing OR explicitly clearing it before subprocess spawn.'
          ],
          suggestedMitigation: 'If clearing: rephrase as `delete env[\'ANTHROPIC_API_KEY\']` (no read needed). If billing: replace with `claude` binary subprocess pattern.',
          detectorId: 'det-cost-overrun',
          excerpt: excerpt(line.text)
        }));
      }
    }
    return findings;
  }
};
