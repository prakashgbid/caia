#!/usr/bin/env node
/**
 * preservation-smoke.test.js
 *
 * DoD smoke test for @caia-app/roulette-backend.
 *
 * This package is dormant — it preserves a backend lifted from the archived
 * repo prakashgbid/roulette-advisor-ai (REM-001, 2026-04-28). It is not meant
 * to run. The only thing CI verifies is that the preservation copy is intact:
 *
 *   - README.md exists and documents this is a dormant preservation copy
 *   - package.json.original is preserved (the source-of-truth manifest)
 *   - The expected source files are still present
 *
 * Pure Node — no test framework, no external deps. Just the built-in
 * assert/fs/path modules. Exits 0 on success, 1 on any failure.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(`        ${err.message}`);
    failed++;
  }
}

function fileExists(rel) {
  const p = path.join(root, rel);
  if (!fs.existsSync(p)) {
    throw new Error(`expected file to exist: ${rel}`);
  }
  if (!fs.statSync(p).isFile()) {
    throw new Error(`expected ${rel} to be a file`);
  }
}

console.log('@caia-app/roulette-backend — preservation smoke test');
console.log('---------------------------------------------------');

check('README.md exists', () => fileExists('README.md'));

check('README.md documents dormant/preservation status', () => {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  assert.match(readme, /DORMANT/, 'README must mention DORMANT status');
  assert.match(readme, /REM-001/, 'README must reference REM-001');
  assert.match(readme, /2026-04-28/, 'README must reference port date');
  assert.match(readme, /roulette-advisor-ai/, 'README must cite source repo');
  assert.match(
    readme,
    /no-capability-loss/i,
    'README must reference no-capability-loss policy'
  );
});

check('package.json declares the package private + dormant', () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(root, 'package.json'), 'utf8')
  );
  assert.equal(pkg.name, '@caia-app/roulette-backend');
  assert.equal(pkg.private, true);
  assert.match(pkg.description || '', /DORMANT/);
});

check('original npm manifest preserved verbatim', () =>
  fileExists('package.json.original')
);

check('original npm lockfile preserved verbatim', () =>
  fileExists('package-lock.json.original')
);

check('original .env.template preserved', () => fileExists('.env.template'));

// Express app entry + service routers — the meat of what we are preserving.
const expectedSourceFiles = [
  'src/server.js',
  'src/middleware/authMiddleware.js',
  'src/models/Bet.js',
  'src/models/Game.js',
  'src/models/User.js',
  'src/services/auth/controllers.js',
  'src/services/auth/routes.js',
  'src/services/bet/controllers.js',
  'src/services/bet/routes.js',
  'src/services/game/controllers.js',
  'src/services/game/routes.js',
  'src/types/index.ts',
  'src/utils/jwtUtils.js',
];
for (const rel of expectedSourceFiles) {
  check(`source preserved: ${rel}`, () => fileExists(rel));
}

// Legacy top-level server.js variant from the original repo.
check('legacy-top-level/server.js preserved', () =>
  fileExists('legacy-top-level/server.js')
);

// Infrastructure artifacts.
const expectedInfraFiles = [
  'infrastructure/docker/backend.Dockerfile',
  'infrastructure/docker/frontend.Dockerfile',
  'infrastructure/docker/docker-compose.yml',
  'infrastructure/gcp/kubernetes/backend-deployment.yaml',
  'infrastructure/gcp/kubernetes/frontend-deployment.yaml',
  'infrastructure/gcp/kubernetes/mongodb-statefulset.yaml',
];
for (const rel of expectedInfraFiles) {
  check(`infra preserved: ${rel}`, () => fileExists(rel));
}

console.log('---------------------------------------------------');
console.log(`Result: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
