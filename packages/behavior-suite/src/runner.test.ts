/**
 * Tests for the behavior-suite runner — specifically the scope resolver.
 * Run with: npx tsx --test runner.test.ts
 * Or via the site's test runner after wiring @plugins/behavior-suite.
 */

import * as assert from 'assert';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { resolveScope } from './runner';

// Create a temp "site" directory with behavior tests for testing
function makeTempSite(testFiles: string[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'behavior-suite-test-'));
  const behaviorDir = path.join(dir, 'tests', 'behavior');
  fs.mkdirSync(behaviorDir, { recursive: true });
  for (const f of testFiles) {
    fs.writeFileSync(path.join(behaviorDir, f), `// ${f}`);
  }
  return dir;
}

const TESTS = ['home.behavior.ts', 'play.behavior.ts', 'publications.behavior.ts', 'layout-contract.behavior.ts'];

// resolveScope: site: scope returns all tests for that site
{
  const siteDir = makeTempSite(TESTS);
  // Create a parent dir with the site as a child
  const parentDir = path.dirname(siteDir);
  const siteName = path.basename(siteDir);

  const result = resolveScope(`site:${siteName}` as `site:${string}`, parentDir);
  assert.ok(result.length === TESTS.length, `Expected ${TESTS.length} tests, got ${result.length}`);
  console.log('✓ site: scope resolves all tests');
}

// resolveScope: site + feature scope returns only that feature's test
{
  const siteDir = makeTempSite(TESTS);
  const parentDir = path.dirname(siteDir);
  const siteName = path.basename(siteDir);

  const result = resolveScope(`site:${siteName} feature:play` as `site:${string} feature:${string}`, parentDir);
  assert.ok(result.length === 1, `Expected 1 test, got ${result.length}`);
  assert.ok(result[0].endsWith('play.behavior.ts'), `Expected play.behavior.ts, got ${result[0]}`);
  console.log('✓ site: feature: scope resolves single feature test');
}

// resolveScope: unknown site returns empty array
{
  const result = resolveScope('site:does-not-exist-abc123' as `site:${string}`, '/tmp');
  assert.ok(result.length === 0, `Expected 0 tests for unknown site, got ${result.length}`);
  console.log('✓ unknown site returns empty array');
}

// resolveScope: feature that does not exist returns empty
{
  const siteDir = makeTempSite(TESTS);
  const parentDir = path.dirname(siteDir);
  const siteName = path.basename(siteDir);

  const result = resolveScope(`site:${siteName} feature:nonexistent` as `site:${string} feature:${string}`, parentDir);
  assert.ok(result.length === 0, `Expected 0 tests for nonexistent feature, got ${result.length}`);
  console.log('✓ nonexistent feature returns empty array');
}

console.log('\n✅ All runner tests passed');
