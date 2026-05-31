/**
 * Phase C7 — chiefaia-wizard multi-replica + sticky-session contract.
 *
 * Raw-text / regex assertions on the bumped Deployment +
 * DestinationRule (same pattern as hpa-manifest.test.ts and
 * registry-yaml.test.ts; no yaml dep in this app).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(process.cwd(), '..', '..');
const DEPLOYMENT = readFileSync(
  join(REPO_ROOT, 'infra', 'wizard', '10-deployment.yaml'),
  'utf-8',
);
const DR = readFileSync(
  join(REPO_ROOT, 'infra', 'istio', 'chiefaia', '26-destinationrule-wizard.yaml'),
  'utf-8',
);

describe('Phase C7 — chiefaia-wizard 2-replica baseline (infra/wizard/10-deployment.yaml)', () => {
  it('Deployment.spec.replicas is 2 (operator-ratified baseline; HPA in C1 scales 1..5)', () => {
    // Match against `replicas: N` under `spec:` — there's only one
    // `spec:` block at the top of the file (the Deployment itself);
    // the ServiceAccount + NetworkPolicy that follow do not carry a
    // `replicas:` field, so a non-greedy regex is safe.
    const specHunk = DEPLOYMENT.split(/^kind:\s*Deployment\s*$/m)[1] ?? '';
    expect(specHunk).toMatch(/replicas:\s*2\b/);
    // And make sure it's no longer 1.
    expect(specHunk).not.toMatch(/^\s*replicas:\s*1\b/m);
  });

  it('RollingUpdate strategy keeps maxUnavailable:0 + maxSurge:1 (ring never empty)', () => {
    expect(DEPLOYMENT).toMatch(/strategy:\s*\n\s*type:\s*RollingUpdate/);
    expect(DEPLOYMENT).toMatch(/maxUnavailable:\s*0\b/);
    expect(DEPLOYMENT).toMatch(/maxSurge:\s*1\b/);
  });

  it('comments reference the C7 sticky-session DestinationRule + the C1 HPA', () => {
    // Cross-references in comments stop future devs from "fixing" the
    // 2-replica baseline without realising it's coupled to the
    // consistentHash ring + the HPA's minReplicas.
    expect(DEPLOYMENT).toMatch(/Phase C7/);
    expect(DEPLOYMENT).toMatch(/26-destinationrule-wizard\.yaml/);
    expect(DEPLOYMENT).toMatch(/chiefaia-wizard-session/);
    expect(DEPLOYMENT).toMatch(/Phase C1/);
  });
});

describe('Phase C7 — chiefaia-wizard DestinationRule (infra/istio/chiefaia/26-destinationrule-wizard.yaml)', () => {
  it('uses networking.istio.io/v1beta1 + kind DestinationRule', () => {
    expect(DR).toMatch(/^apiVersion:\s*networking\.istio\.io\/v1beta1\s*$/m);
    expect(DR).toMatch(/^kind:\s*DestinationRule\s*$/m);
  });

  it('targets the chiefaia-wizard service FQDN', () => {
    expect(DR).toMatch(
      /host:\s*chiefaia-wizard\.chiefaia\.svc\.cluster\.local/,
    );
  });

  it('uses consistentHash with the chiefaia-wizard-session HTTP cookie', () => {
    expect(DR).toMatch(/loadBalancer:/);
    expect(DR).toMatch(/consistentHash:/);
    expect(DR).toMatch(/httpCookie:/);
    expect(DR).toMatch(/name:\s*chiefaia-wizard-session/);
  });

  it('carries the canonical chiefaia labels (component:destinationrule)', () => {
    expect(DR).toMatch(/app\.kubernetes\.io\/name:\s*chiefaia-wizard/);
    expect(DR).toMatch(/app\.kubernetes\.io\/component:\s*destinationrule/);
    expect(DR).toMatch(/app\.kubernetes\.io\/part-of:\s*chiefaia/);
    expect(DR).toMatch(/namespace:\s*chiefaia/);
  });

  it('declares session-cookie TTL (0s) — rolling is handled at app layer', () => {
    expect(DR).toMatch(/ttl:\s*0s/);
  });
});
