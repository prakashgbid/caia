/**
 * Phase C1 — chiefaia-wizard + chiefaia-dashboard HPA manifest contract.
 *
 * Raw-text / regex assertions (no yaml dep in this app; same pattern
 * as registry-yaml.test.ts). Verifies the shape that operators rely on
 * + that the two HPAs stay structurally consistent with each other.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(process.cwd(), '..', '..');
const WIZARD_HPA = readFileSync(
  join(REPO_ROOT, 'infra', 'wizard', '50-hpa.yaml'),
  'utf-8',
);
const DASHBOARD_HPA = readFileSync(
  join(REPO_ROOT, 'infra', 'dashboard', '50-hpa.yaml'),
  'utf-8',
);

const HPA_TARGETS: Array<{ name: string; yaml: string }> = [
  { name: 'chiefaia-wizard', yaml: WIZARD_HPA },
  { name: 'chiefaia-dashboard', yaml: DASHBOARD_HPA },
];

describe('Phase C1 — HPA manifest shape (chiefaia-wizard + chiefaia-dashboard)', () => {
  it.each(HPA_TARGETS)(
    '$name HPA uses autoscaling/v2 (k8s ≥1.23 stable surface)',
    ({ yaml }) => {
      expect(yaml).toMatch(/^apiVersion:\s*autoscaling\/v2\s*$/m);
      expect(yaml).toMatch(/^kind:\s*HorizontalPodAutoscaler\s*$/m);
    },
  );

  it.each(HPA_TARGETS)(
    '$name HPA targets a Deployment of the same name in chiefaia ns',
    ({ name, yaml }) => {
      expect(yaml).toMatch(/scaleTargetRef:/);
      expect(yaml).toMatch(/apiVersion:\s*apps\/v1/);
      expect(yaml).toMatch(/kind:\s*Deployment/);
      const targetBlock = yaml.split('scaleTargetRef:')[1] ?? '';
      expect(targetBlock).toMatch(new RegExp(`name:\\s*${name}\\b`));
      expect(yaml).toMatch(/namespace:\s*chiefaia/);
    },
  );

  it.each(HPA_TARGETS)(
    '$name HPA scales 1..5 replicas per the operator V1 cap',
    ({ yaml }) => {
      expect(yaml).toMatch(/minReplicas:\s*1\b/);
      expect(yaml).toMatch(/maxReplicas:\s*5\b/);
    },
  );

  it.each(HPA_TARGETS)(
    '$name HPA fires on BOTH CPU 70% AND memory 80% utilisation',
    ({ yaml }) => {
      // CPU metric
      const cpuBlock =
        yaml.match(/name:\s*cpu[\s\S]*?averageUtilization:\s*(\d+)/)?.[1] ?? '';
      expect(cpuBlock).toBe('70');
      // Memory metric
      const memBlock =
        yaml.match(/name:\s*memory[\s\S]*?averageUtilization:\s*(\d+)/)?.[1] ??
        '';
      expect(memBlock).toBe('80');
    },
  );

  it.each(HPA_TARGETS)(
    '$name HPA carries the canonical chiefaia labels (selector parity with Deployment)',
    ({ name, yaml }) => {
      expect(yaml).toMatch(
        new RegExp(`app\\.kubernetes\\.io/name:\\s*${name}`),
      );
      expect(yaml).toMatch(/app\.kubernetes\.io\/component:\s*autoscaler/);
      expect(yaml).toMatch(/app\.kubernetes\.io\/part-of:\s*chiefaia/);
    },
  );

  it.each(HPA_TARGETS)(
    '$name HPA carries an anti-flap behavior block (300s scale-down window)',
    ({ yaml }) => {
      expect(yaml).toMatch(/behavior:/);
      // scaleUp: max 100%/min OR +2 pods/min
      const upBlock = yaml.match(/scaleUp:[\s\S]*?scaleDown:/)?.[0] ?? '';
      expect(upBlock).toMatch(/stabilizationWindowSeconds:\s*60\b/);
      expect(upBlock).toMatch(/selectPolicy:\s*Max/);
      expect(upBlock).toMatch(/value:\s*100[\s\S]*?type:\s*Percent|type:\s*Percent[\s\S]*?value:\s*100/);
      // scaleDown: 5-minute stabilisation window protects in-flight sessions
      const downBlock = yaml.match(/scaleDown:[\s\S]*$/)?.[0] ?? '';
      expect(downBlock).toMatch(/stabilizationWindowSeconds:\s*300\b/);
      expect(downBlock).toMatch(/selectPolicy:\s*Min/);
    },
  );

  it('the two HPAs are structurally symmetric (same thresholds + behavior)', () => {
    // Strip names/comments and compare the spec hunks so the wizard and
    // dashboard HPAs cannot drift apart without an explicit operator
    // decision. (We assert on shape, not byte-equality.)
    const normalise = (s: string) =>
      s
        .replace(/^#.*$/gm, '')
        .replace(/\s+/g, ' ')
        .replace(/chiefaia-wizard|chiefaia-dashboard/g, 'WORKLOAD')
        .trim();
    expect(normalise(WIZARD_HPA)).toBe(normalise(DASHBOARD_HPA));
  });
});
