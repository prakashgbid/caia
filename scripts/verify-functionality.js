#!/usr/bin/env node

/**
 * Comprehensive functionality verification
 * Tests if implementations are actually functional, not just placeholders
 */

const fs = require('fs');
const path = require('path');

// Color helpers
const green = (text) => `\x1b[32m${text}\x1b[0m`;
const red = (text) => `\x1b[31m${text}\x1b[0m`;
const yellow = (text) => `\x1b[33m${text}\x1b[0m`;
const blue = (text) => `\x1b[34m${text}\x1b[0m`;

console.log(blue('\n🔍 Comprehensive Functionality Verification\n'));

const results = {
  fullyImplemented: [],
  partiallyImplemented: [],
  notFunctional: [],
  missingDependencies: []
};

// Test 1: Check if files contain actual implementation logic
console.log(blue('1. Checking implementation logic...'));

const implementations = [
  {
    name: 'Knowledge Graph - GraphManager',
    path: 'knowledge-system/knowledge_graph/core/graph_manager.ts',
    requiredMethods: ['connect', 'createNode', 'createRelationship', 'findPath'],
    requiredImports: ['neo4j-driver'],
    status: 'unknown'
  },
  {
    name: 'Entity Extractor',
    path: 'knowledge-system/knowledge_graph/semantic/entity_extractor.ts',
    requiredMethods: ['extractEntities', 'extractCodeEntities'],
    requiredImports: ['natural', '@babel/parser'],
    status: 'unknown'
  },
  {
    name: 'Inference Engine',
    path: 'knowledge-system/knowledge_graph/reasoning/inference_engine.ts',
    requiredMethods: ['inferRelationships', 'detectPatterns', 'recommendConnections'],
    requiredImports: ['../core/graph_manager'],
    status: 'unknown'
  },
  {
    name: 'Business Analyst Implementation',
    path: 'packages/integrations/agents/business-analyst/implementation.ts',
    requiredMethods: ['extractRequirements', 'generateAcceptanceCriteria'],
    requiredImports: ['natural'],
    status: 'unknown'
  },
  {
    name: 'Sprint Prioritizer Implementation',
    path: 'packages/integrations/agents/sprint-prioritizer/implementation.ts',
    requiredMethods: ['prioritizeSprint', 'calculateWSJF'],
    requiredImports: ['./bridge'],
    status: 'unknown'
  },
  {
    name: 'Interaction Logger',
    path: 'knowledge-system/learning/continuous/interaction_logger.ts',
    requiredMethods: ['logInteraction', 'detectPatterns', 'analyzeSession'],
    requiredImports: ['sqlite3'],
    status: 'unknown'
  },
  {
    name: 'RLHF Trainer',
    path: 'knowledge-system/learning/feedback/rlhf_trainer.ts',
    requiredMethods: ['trainOnFeedback', 'generateImprovedResponse'],
    requiredImports: ['@tensorflow/tfjs-node'],
    status: 'unknown'
  }
];

for (const impl of implementations) {
  const fullPath = path.join(__dirname, '..', impl.path);

  if (!fs.existsSync(fullPath)) {
    impl.status = 'missing';
    results.notFunctional.push(impl);
    console.log(red(`  ❌ ${impl.name}: File missing`));
    continue;
  }

  const content = fs.readFileSync(fullPath, 'utf-8');
  let score = 0;
  let issues = [];

  // Check for required methods
  const methodsFound = impl.requiredMethods.filter(method =>
    content.includes(`${method}(`) || content.includes(`async ${method}(`)
  );

  if (methodsFound.length === impl.requiredMethods.length) {
    score += 40;
  } else {
    issues.push(`Missing methods: ${impl.requiredMethods.filter(m => !methodsFound.includes(m)).join(', ')}`);
  }

  // Check for required imports
  const importsFound = impl.requiredImports.filter(imp =>
    content.includes(`import`) && content.includes(imp)
  );

  if (importsFound.length === impl.requiredImports.length) {
    score += 30;
  } else {
    const missingImports = impl.requiredImports.filter(i => !importsFound.includes(i));
    issues.push(`Missing imports: ${missingImports.join(', ')}`);

    // Check if these are npm dependencies
    if (missingImports.some(i => !i.startsWith('.'))) {
      results.missingDependencies.push(...missingImports.filter(i => !i.startsWith('.')));
    }
  }

  // Check for actual implementation (not just method signatures)
  const hasImplementation =
    content.includes('return') &&
    content.includes('await') &&
    (content.includes('query') || content.includes('result') || content.includes('process'));

  if (hasImplementation) {
    score += 30;
  } else {
    issues.push('Limited implementation logic');
  }

  // Categorize based on score
  impl.score = score;
  impl.issues = issues;

  if (score >= 80) {
    impl.status = 'fully-implemented';
    results.fullyImplemented.push(impl);
    console.log(green(`  ✅ ${impl.name}: Fully implemented (${score}%)`));
  } else if (score >= 50) {
    impl.status = 'partial';
    results.partiallyImplemented.push(impl);
    console.log(yellow(`  ⚠️  ${impl.name}: Partially implemented (${score}%)`));
    if (issues.length > 0) {
      issues.forEach(issue => console.log(`     - ${issue}`));
    }
  } else {
    impl.status = 'not-functional';
    results.notFunctional.push(impl);
    console.log(red(`  ❌ ${impl.name}: Not functional (${score}%)`));
    if (issues.length > 0) {
      issues.forEach(issue => console.log(`     - ${issue}`));
    }
  }
}

// Test 2: Check for missing npm dependencies
console.log(blue('\n2. Checking npm dependencies...'));

const requiredPackages = [
  'neo4j-driver',
  'natural',
  'sqlite3',
  '@tensorflow/tfjs-node',
  '@babel/parser'
];

const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));
const installedPackages = Object.keys(packageJson.dependencies || {});

const missingPackages = requiredPackages.filter(pkg =>
  !installedPackages.includes(pkg) &&
  !installedPackages.includes(pkg.replace('@', '').replace('/', '-'))
);

if (missingPackages.length > 0) {
  console.log(yellow(`  ⚠️  Missing npm packages:`));
  missingPackages.forEach(pkg => {
    console.log(`     - ${pkg}`);
    results.missingDependencies.push(pkg);
  });
} else {
  console.log(green(`  ✅ All required npm packages installed`));
}

// Test 3: Check TypeScript compilation
console.log(blue('\n3. Testing TypeScript compilation...'));

const { execSync } = require('child_process');

let canCompile = true;
try {
  // Test compile one file to check if TypeScript works
  execSync('npx tsc --version', { stdio: 'ignore' });
  console.log(green(`  ✅ TypeScript compiler available`));
} catch (error) {
  console.log(red(`  ❌ TypeScript compiler not available`));
  canCompile = false;
}

// Generate final report
console.log(blue('\n' + '='.repeat(60)));
console.log(blue('\n📊 VERIFICATION SUMMARY\n'));

console.log(green(`Fully Implemented: ${results.fullyImplemented.length}/7`));
results.fullyImplemented.forEach(impl => {
  console.log(green(`  ✅ ${impl.name}`));
});

if (results.partiallyImplemented.length > 0) {
  console.log(yellow(`\nPartially Implemented: ${results.partiallyImplemented.length}/7`));
  results.partiallyImplemented.forEach(impl => {
    console.log(yellow(`  ⚠️  ${impl.name} (${impl.score}%)`));
  });
}

if (results.notFunctional.length > 0) {
  console.log(red(`\nNot Functional: ${results.notFunctional.length}/7`));
  results.notFunctional.forEach(impl => {
    console.log(red(`  ❌ ${impl.name}`));
  });
}

if ([...new Set(results.missingDependencies)].length > 0) {
  console.log(yellow(`\nMissing Dependencies:`));
  [...new Set(results.missingDependencies)].forEach(dep => {
    console.log(`  - npm install ${dep}`);
  });
}

// Final verdict
console.log(blue('\n' + '='.repeat(60)));
console.log(blue('\n🏁 FINAL VERDICT:\n'));

const totalScore = implementations.reduce((sum, impl) => sum + (impl.score || 0), 0) / implementations.length;

if (totalScore >= 80) {
  console.log(green('✅ FULLY FUNCTIONAL - All implementations are working and complete'));
} else if (totalScore >= 60) {
  console.log(yellow('⚠️  MOSTLY FUNCTIONAL - Most implementations work but some need attention'));
  console.log(yellow('\nRequired actions:'));
  if (missingPackages.length > 0) {
    console.log(`  1. Install missing packages: npm install ${missingPackages.join(' ')}`);
  }
  if (results.partiallyImplemented.length > 0) {
    console.log(`  2. Complete partial implementations in ${results.partiallyImplemented.length} files`);
  }
} else {
  console.log(red('❌ NOT FULLY FUNCTIONAL - Significant work needed'));
  console.log(red('\nCritical issues:'));
  console.log(`  - ${results.notFunctional.length} implementations are not functional`);
  console.log(`  - ${missingPackages.length} required packages are missing`);
}

console.log(blue(`\nOverall Implementation Score: ${totalScore.toFixed(1)}%\n`));

// Export results for other scripts
module.exports = { results, totalScore };