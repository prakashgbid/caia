import { existsSync } from 'fs';
import { execSync } from 'child_process';
import type { CheckResult, EntityRef } from '../types';

export function verifyTests(entity: EntityRef): CheckResult[] {
  const results: CheckResult[] = [];
  const plans = entity.verificationPlan ?? [];

  for (const plan of plans) {
    if (!plan.startsWith('test_pass:') && !plan.startsWith('behavior_test:')) continue;

    // Check if behavior test path exists
    if (entity.sourcePath && entity.sourcePath.includes('.behavior.ts')) {
      const exists = existsSync(entity.sourcePath);
      if (!exists) {
        results.push({
          checkKind: 'behavior_test',
          passed: false,
          expected: `Behavior test file exists: ${entity.sourcePath}`,
          actual: 'File not found',
          severity: 'critical',
          message: `❌ Behavior test file missing: ${entity.sourcePath}`,
        });
        continue;
      }

      // Try to run the test
      try {
        const cwd = entity.sourcePath.replace(/\/[^/]+$/, '');
        execSync(`npx jest --testPathPattern="${entity.sourcePath}" --passWithNoTests`, {
          cwd,
          timeout: 30000,
          stdio: 'pipe',
        });
        results.push({
          checkKind: 'behavior_test',
          passed: true,
          expected: 'All tests pass',
          actual: 'Tests passed',
          severity: 'info',
          message: `✅ Tests passed: ${entity.sourcePath}`,
        });
      } catch (err) {
        results.push({
          checkKind: 'behavior_test',
          passed: false,
          expected: 'All tests pass',
          actual: `Tests failed: ${(err as Error).message.slice(0, 200)}`,
          severity: 'critical',
          message: `❌ Tests failed: ${entity.sourcePath}`,
        });
      }
    }
  }

  return results;
}
