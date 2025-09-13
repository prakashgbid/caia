#!/usr/bin/env node

/**
 * Production Validation Script
 * Validates that all production configurations are properly set up
 */

const fs = require('fs');
const path = require('path');

// Color helpers
const green = (text) => `\x1b[32m${text}\x1b[0m`;
const red = (text) => `\x1b[31m${text}\x1b[0m`;
const yellow = (text) => `\x1b[33m${text}\x1b[0m`;
const blue = (text) => `\x1b[34m${text}\x1b[0m`;

console.log(blue('\n🔍 Production Setup Validation\n'));

const checks = [];
let passed = 0;
let failed = 0;

// Check function
function check(name, condition, failMessage = '') {
  if (condition) {
    console.log(green(`✅ ${name}`));
    passed++;
    checks.push({ name, status: 'passed' });
  } else {
    console.log(red(`❌ ${name}`));
    if (failMessage) console.log(`   ${failMessage}`);
    failed++;
    checks.push({ name, status: 'failed', message: failMessage });
  }
}

// 1. Check Dependencies
console.log(blue('1. Checking Dependencies...\n'));

const requiredDeps = [
  '@xenova/transformers',
  'winston',
  'ioredis',
  'bull',
  'pg',
  'neo4j-driver',
  'natural',
  'sqlite3',
  '@tensorflow/tfjs-node'
];

const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
const installedDeps = Object.keys(packageJson.dependencies || {});

requiredDeps.forEach(dep => {
  check(
    `Dependency: ${dep}`,
    installedDeps.includes(dep),
    `Run: npm install ${dep}`
  );
});

// 2. Check Configuration Files
console.log(blue('\n2. Checking Configuration Files...\n'));

const configFiles = [
  { path: '.env', name: 'Environment Variables' },
  { path: 'tsconfig.production.json', name: 'TypeScript Config' },
  { path: 'ecosystem.config.js', name: 'PM2 Config' },
  { path: 'docker-compose.yml', name: 'Docker Compose' },
  { path: 'Dockerfile', name: 'Dockerfile' }
];

configFiles.forEach(file => {
  check(
    file.name,
    fs.existsSync(file.path),
    `Missing file: ${file.path}`
  );
});

// 3. Check Environment Variables
console.log(blue('\n3. Checking Environment Variables...\n'));

if (fs.existsSync('.env')) {
  const envContent = fs.readFileSync('.env', 'utf-8');
  const criticalVars = [
    'NODE_ENV',
    'DB_HOST',
    'DB_NAME',
    'NEO4J_URI',
    'REDIS_HOST',
    'JWT_SECRET',
    'API_PORT'
  ];

  criticalVars.forEach(varName => {
    const hasVar = envContent.includes(`${varName}=`);
    const hasValue = hasVar && !envContent.includes(`${varName}=\n`) && !envContent.includes(`${varName}= `);

    check(
      `Env Variable: ${varName}`,
      hasValue,
      hasVar ? 'Variable exists but has no value' : 'Variable not defined'
    );
  });
}

// 4. Check Directory Structure
console.log(blue('\n4. Checking Directory Structure...\n'));

const requiredDirs = [
  'knowledge-system/knowledge_graph/core',
  'knowledge-system/knowledge_graph/semantic',
  'knowledge-system/knowledge_graph/reasoning',
  'knowledge-system/learning/continuous',
  'knowledge-system/learning/feedback',
  'knowledge-system/core',
  'packages/integrations/agents/business-analyst',
  'packages/integrations/agents/sprint-prioritizer',
  'config',
  'scripts'
];

requiredDirs.forEach(dir => {
  check(
    `Directory: ${dir}`,
    fs.existsSync(dir),
    `Run: mkdir -p ${dir}`
  );
});

// 5. Check Implementation Files
console.log(blue('\n5. Checking Implementation Files...\n'));

const implementationFiles = [
  {
    path: 'knowledge-system/knowledge_graph/core/graph_manager.ts',
    name: 'Graph Manager'
  },
  {
    path: 'knowledge-system/knowledge_graph/semantic/entity_extractor.ts',
    name: 'Entity Extractor'
  },
  {
    path: 'knowledge-system/learning/continuous/interaction_logger.ts',
    name: 'Interaction Logger'
  },
  {
    path: 'packages/integrations/agents/business-analyst/implementation.ts',
    name: 'Business Analyst'
  }
];

implementationFiles.forEach(file => {
  if (fs.existsSync(file.path)) {
    const content = fs.readFileSync(file.path, 'utf-8');
    const hasContent = content.length > 100;

    check(
      file.name,
      hasContent,
      hasContent ? '' : 'File exists but appears empty'
    );
  } else {
    check(file.name, false, `File not found: ${file.path}`);
  }
});

// 6. Check Startup Scripts
console.log(blue('\n6. Checking Startup Scripts...\n'));

const scripts = [
  'scripts/start-production.sh',
  'scripts/parallel-implementation.js',
  'scripts/production-upgrade.js'
];

scripts.forEach(script => {
  if (fs.existsSync(script)) {
    const stats = fs.statSync(script);
    const isExecutable = (stats.mode & parseInt('111', 8)) !== 0;

    check(
      `Script: ${path.basename(script)}`,
      true,
      !isExecutable && script.endsWith('.sh') ? 'Not executable, run: chmod +x ' + script : ''
    );
  } else {
    check(`Script: ${path.basename(script)}`, false, 'Script not found');
  }
});

// 7. Check Production Upgrades
console.log(blue('\n7. Checking Production Upgrades...\n'));

const upgradeFiles = [
  {
    path: 'knowledge-system/knowledge_graph/semantic/entity_extractor_production.ts',
    name: 'Advanced NLP'
  },
  {
    path: 'knowledge-system/learning/training_data_manager.ts',
    name: 'Training Data Manager'
  },
  {
    path: 'knowledge-system/core/error_handler.ts',
    name: 'Error Handler'
  },
  {
    path: 'knowledge-system/core/production_scaler.ts',
    name: 'Production Scaler'
  },
  {
    path: 'config/production.config.ts',
    name: 'Production Config'
  }
];

upgradeFiles.forEach(file => {
  check(
    `Upgrade: ${file.name}`,
    fs.existsSync(file.path),
    `Run: node scripts/production-upgrade.js`
  );
});

// Final Report
console.log(blue('\n' + '='.repeat(60)));
console.log(blue('\n📊 VALIDATION SUMMARY\n'));

const totalChecks = passed + failed;
const percentage = ((passed / totalChecks) * 100).toFixed(1);

console.log(`Total Checks: ${totalChecks}`);
console.log(green(`Passed: ${passed}`));
console.log(red(`Failed: ${failed}`));
console.log(blue(`Success Rate: ${percentage}%`));

if (failed === 0) {
  console.log(green('\n✅ ALL CHECKS PASSED - Production setup is complete!'));
  console.log(green('\nYou can now run:'));
  console.log('  1. ./scripts/start-production.sh  (Local)');
  console.log('  2. docker-compose up              (Docker)');
  console.log('  3. pm2 start ecosystem.config.js  (PM2)');
} else {
  console.log(yellow(`\n⚠️  ${failed} checks failed - Some setup required`));

  console.log(yellow('\nQuick fixes:'));

  // Suggest fixes based on failures
  const missingDeps = checks.filter(c =>
    c.status === 'failed' && c.name.includes('Dependency')
  );

  if (missingDeps.length > 0) {
    const deps = missingDeps.map(d => d.name.replace('Dependency: ', '')).join(' ');
    console.log(`  npm install ${deps}`);
  }

  const missingDirs = checks.filter(c =>
    c.status === 'failed' && c.name.includes('Directory')
  );

  if (missingDirs.length > 0) {
    console.log(`  mkdir -p ${missingDirs.map(d => d.name.replace('Directory: ', '')).join(' ')}`);
  }

  if (!fs.existsSync('.env')) {
    console.log('  cp .env.example .env');
  }
}

console.log(blue('\n' + '='.repeat(60) + '\n'));

// Export results for CI/CD
if (process.env.CI) {
  fs.writeFileSync(
    'validation-results.json',
    JSON.stringify({ passed, failed, percentage, checks }, null, 2)
  );
}

// Exit with error code if validation failed
process.exit(failed > 0 ? 1 : 0);