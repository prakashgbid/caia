import { existsSync } from 'fs';
import { resolve } from 'path';
import type { CheckResult, EntityRef } from '../types';

const PROJECT_ROOT = process.env['CONDUCTOR_PROJECT_ROOT'] ?? process.cwd();

function resolvePath(p: string): string {
  if (p.startsWith('/')) return p;
  return resolve(PROJECT_ROOT, p);
}

export function verifyFiles(entity: EntityRef): CheckResult[] {
  const results: CheckResult[] = [];
  const plans = entity.verificationPlan ?? [];

  for (const plan of plans) {
    if (!plan.startsWith('file_exists:')) continue;
    const pathPart = plan.replace('file_exists:', '').trim();
    const paths = pathPart.match(/\S+\.\w+/g) ?? [];

    for (const p of paths) {
      const absPath = resolvePath(p);
      const exists = existsSync(absPath);
      results.push({
        checkKind: 'file_exists',
        passed: exists,
        expected: `File exists: ${p}`,
        actual: exists ? `File found at ${absPath}` : `File NOT found at ${absPath}`,
        severity: exists ? 'info' : 'critical',
        message: exists ? `✅ ${p} exists` : `❌ ${p} not found on disk`,
      });
    }
  }

  if (entity.sourcePath) {
    const absPath = resolvePath(entity.sourcePath);
    const exists = existsSync(absPath);
    results.push({
      checkKind: 'file_exists',
      passed: exists,
      expected: `Source file: ${entity.sourcePath}`,
      actual: exists ? 'found' : 'missing',
      severity: 'critical',
      message: exists ? `✅ Source file exists` : `❌ Source file missing: ${entity.sourcePath}`,
    });
  }

  return results;
}
