/**
 * security-regression detector.
 *
 * Flags literal credential-shape strings in added diff lines outside
 * allowlisted fixture paths. Mirrors gitleaks-style heuristics — the goal
 * is NOT to replace gitleaks (which runs in CI), but to surface findings
 * BEFORE merge-time so the producing agent can squash the offending commit
 * (per feedback_secret_scanner_history_squash.md).
 */

import type { Detector } from '../types.js';

import {
  addedTextOnly,
  excerpt,
  isAllowlistedFixturePath,
  makeFinding
} from './shared.js';

const PATTERNS: { name: string; re: RegExp; mitigation: string }[] = [
  {
    name: 'github-pat',
    re: /\bghp_[A-Za-z0-9]{30,}/,
    mitigation: 'Rotate the PAT immediately and squash the introducing commit; PATs in git history must be treated as compromised.'
  },
  {
    name: 'openai-api-key',
    re: /\bsk-[A-Za-z0-9]{30,}/,
    mitigation: 'Rotate the OpenAI key. Per feedback_no_api_key_billing.md the project does not use OpenAI tokens — investigate why this was added.'
  },
  {
    name: 'anthropic-api-key',
    re: /\bsk-ant-[A-Za-z0-9_-]{30,}/,
    mitigation: 'Rotate the Anthropic key. Per feedback_no_api_key_billing.md the project must NOT bill via API key — use the claude binary subscription path instead.'
  },
  {
    name: 'aws-access-key',
    re: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
    mitigation: 'Rotate the AWS key in IAM. Squash the introducing commit per feedback_secret_scanner_history_squash.md.'
  },
  {
    name: 'private-key-pem',
    re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/,
    mitigation: 'Rotate the private key. Move the file to a secrets vault, never commit unencrypted.'
  },
  {
    name: 'jwt-token',
    re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
    mitigation: 'Treat the JWT as compromised; rotate its signing key.'
  }
];

export const securityRegressionDetector: Detector = {
  id: 'det-security-regression',
  category: 'security-regression',
  scan(hunk, _ctx) {
    if (isAllowlistedFixturePath(hunk.file)) return [];
    const findings = [];
    for (const line of addedTextOnly(hunk)) {
      for (const pat of PATTERNS) {
        if (pat.re.test(line.text)) {
          findings.push(makeFinding({
            category: 'security-regression',
            file: hunk.file,
            line: line.newLine,
            attackVector: `literal-${pat.name}`,
            description: `An added line contains a literal credential shape matching ${pat.name}. Even if this is a placeholder, gitleaks/semgrep will block the merge — and the literal stays in git history.`,
            reproductionSteps: [
              `git show HEAD -- ${hunk.file}`,
              `Inspect line ${line.newLine}; the credential pattern is on that line.`
            ],
            suggestedMitigation: pat.mitigation,
            detectorId: 'det-security-regression',
            excerpt: excerpt(line.text)
          }));
        }
      }
    }
    return findings;
  }
};
