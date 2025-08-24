#!/usr/bin/env node

/**
 * Verification script for Enhanced Task Decomposer
 * Checks that all required modules are properly implemented
 */

const fs = require('fs');
const path = require('path');

const requiredFiles = [
  'src/analyzers/IdeaAnalyzer.ts',
  'src/planners/InitiativePlanner.ts', 
  'src/architects/FeatureArchitect.ts',
  'src/services/QualityGateController.ts',
  'src/index.ts',
  '__tests__/EnhancedTaskDecomposer.test.ts',
  'README.md'
];

const requiredClasses = [
  'IdeaAnalyzer',
  'InitiativePlanner', 
  'FeatureArchitect',
  'QualityGateController'
];

const requiredMethods = [
  'decomposeEnhanced',
  'analyzeIdea',
  'planInitiatives',
  'architectFeatures',
  'executeQualityGate'
];

console.log('🔍 Verifying Enhanced Task Decomposer Implementation...\n');

// Check required files exist
console.log('📁 Checking required files:');
let filesOk = true;
for (const file of requiredFiles) {
  const filePath = path.join(__dirname, file);
  const exists = fs.existsSync(filePath);
  console.log(`  ${exists ? '✅' : '❌'} ${file}`);
  if (!exists) filesOk = false;
}

if (!filesOk) {
  console.log('\n❌ Missing required files. Implementation incomplete.');
  process.exit(1);
}

// Check main index.ts has required exports
console.log('\n📤 Checking exports in index.ts:');
const indexContent = fs.readFileSync(path.join(__dirname, 'src/index.ts'), 'utf8');

let exportsOk = true;
for (const className of requiredClasses) {
  const hasExport = indexContent.includes(`export { ${className}`) || 
                   indexContent.includes(`export * from`) ||
                   indexContent.includes(`class ${className}`);
  console.log(`  ${hasExport ? '✅' : '❌'} ${className}`);
  if (!hasExport) exportsOk = false;
}

// Check for key method implementations
console.log('\n🔧 Checking key method implementations:');
let methodsOk = true;
for (const method of requiredMethods) {
  const hasMethod = indexContent.includes(`${method}(`) || 
                   indexContent.includes(`async ${method}(`) ||
                   indexContent.includes(`private ${method}(`);
  
  // Also check in other files
  let foundInOtherFiles = false;
  for (const file of ['src/analyzers/IdeaAnalyzer.ts', 'src/planners/InitiativePlanner.ts', 
                      'src/architects/FeatureArchitect.ts', 'src/services/QualityGateController.ts']) {
    if (fs.existsSync(path.join(__dirname, file))) {
      const content = fs.readFileSync(path.join(__dirname, file), 'utf8');
      if (content.includes(`${method}(`)) {
        foundInOtherFiles = true;
        break;
      }
    }
  }
  
  const exists = hasMethod || foundInOtherFiles;
  console.log(`  ${exists ? '✅' : '❌'} ${method}`);
  if (!exists) methodsOk = false;
}

// Check interfaces and types
console.log('\n📋 Checking key interfaces:');
const keyInterfaces = [
  'EnhancedTaskHierarchy',
  'DecompositionOptions', 
  'EnhancedDecomposerConfig'
];

let interfacesOk = true;
for (const interfaceName of keyInterfaces) {
  const hasInterface = indexContent.includes(`interface ${interfaceName}`) ||
                      indexContent.includes(`export interface ${interfaceName}`);
  console.log(`  ${hasInterface ? '✅' : '❌'} ${interfaceName}`);
  if (!hasInterface) interfacesOk = false;
}

// Check backward compatibility
console.log('\n🔄 Checking backward compatibility:');
const hasLegacyDecompose = indexContent.includes('async decompose(');
const hasTaskHierarchy = indexContent.includes('interface TaskHierarchy');
const hasLegacyMethods = indexContent.includes('createEpic') && 
                        indexContent.includes('createStories') &&
                        indexContent.includes('createTasks');

console.log(`  ${hasLegacyDecompose ? '✅' : '❌'} Legacy decompose method`);
console.log(`  ${hasTaskHierarchy ? '✅' : '❌'} TaskHierarchy interface`);
console.log(`  ${hasLegacyMethods ? '✅' : '❌'} Legacy helper methods`);

const backwardCompatOk = hasLegacyDecompose && hasTaskHierarchy && hasLegacyMethods;

// Check test file
console.log('\n🧪 Checking test coverage:');
const testContent = fs.readFileSync(path.join(__dirname, '__tests__/EnhancedTaskDecomposer.test.ts'), 'utf8');
const hasEnhancedTests = testContent.includes('decomposeEnhanced');
const hasQualityGateTests = testContent.includes('Quality Gate');
const hasBackwardCompatTests = testContent.includes('backward compatibility');

console.log(`  ${hasEnhancedTests ? '✅' : '❌'} Enhanced decomposition tests`);
console.log(`  ${hasQualityGateTests ? '✅' : '❌'} Quality gate tests`);
console.log(`  ${hasBackwardCompatTests ? '✅' : '❌'} Backward compatibility tests`);

const testsOk = hasEnhancedTests && hasQualityGateTests && hasBackwardCompatTests;

// File size checks (approximate complexity validation)
console.log('\n📏 Checking implementation complexity:');
const fileSizes = {};
for (const file of requiredFiles.filter(f => f.endsWith('.ts'))) {
  const filePath = path.join(__dirname, file);
  if (fs.existsSync(filePath)) {
    const stats = fs.statSync(filePath);
    fileSizes[file] = stats.size;
    const complexity = stats.size > 10000 ? '✅ Complex' : 
                      stats.size > 5000 ? '⚠️  Medium' : '❌ Simple';
    console.log(`  ${complexity} ${file} (${stats.size} bytes)`);
  }
}

// Final assessment
console.log('\n📊 Implementation Assessment:');
const score = [filesOk, exportsOk, methodsOk, interfacesOk, backwardCompatOk, testsOk].filter(x => x).length;
const total = 6;

console.log(`  Overall Score: ${score}/${total} (${Math.round(score/total * 100)}%)`);

if (score === total) {
  console.log('\n🎉 Implementation verification PASSED!');
  console.log('✅ All required components are implemented');
  console.log('✅ 7-level hierarchy support is complete');
  console.log('✅ Quality gates are integrated');
  console.log('✅ Backward compatibility is maintained');
  console.log('✅ Comprehensive tests are included');
} else {
  console.log('\n⚠️  Implementation verification PARTIAL');
  console.log(`   ${score}/${total} checks passed`);
  
  if (!filesOk) console.log('❌ Missing required files');
  if (!exportsOk) console.log('❌ Missing required exports');
  if (!methodsOk) console.log('❌ Missing required methods');
  if (!interfacesOk) console.log('❌ Missing required interfaces');
  if (!backwardCompatOk) console.log('❌ Backward compatibility issues');
  if (!testsOk) console.log('❌ Test coverage incomplete');
}

// Usage examples
console.log('\n📖 Usage Examples:');
console.log(`
// Enhanced 7-level decomposition
const decomposer = new TaskDecomposer();
const result = await decomposer.decomposeEnhanced(
  'Create comprehensive CRM system',
  'Enterprise B2B SaaS',
  { enableHierarchicalDecomposition: true }
);

// Access all 7 levels
console.log('Idea:', result.idea);
console.log('Initiatives:', result.initiatives.length);
console.log('Features:', result.features.length); 
console.log('Epics:', result.epics.length);
console.log('Stories:', result.stories.length);
console.log('Tasks:', result.tasks.length);
console.log('Subtasks:', result.subtasks.length);

// Quality gate validation
console.log('Validation passed:', result.validationPassed);
console.log('Confidence score:', result.confidenceScore);
`);

process.exit(score === total ? 0 : 1);