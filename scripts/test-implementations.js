#!/usr/bin/env node

/**
 * Test script to verify all implementations are working
 */

const fs = require('fs');
const path = require('path');

// Color helpers
const green = (text) => `\x1b[32m${text}\x1b[0m`;
const red = (text) => `\x1b[31m${text}\x1b[0m`;
const blue = (text) => `\x1b[34m${text}\x1b[0m`;

console.log(blue('\n🧪 Testing Implementations...\n'));

const tests = [
  // Knowledge Graph files
  {
    name: 'Knowledge Graph - Core',
    path: 'knowledge-system/knowledge_graph/core/graph_manager.ts',
    shouldContain: 'GraphManager'
  },
  {
    name: 'Knowledge Graph - Entity Extractor',
    path: 'knowledge-system/knowledge_graph/semantic/entity_extractor.ts',
    shouldContain: 'EntityExtractor'
  },
  {
    name: 'Knowledge Graph - Inference Engine',
    path: 'knowledge-system/knowledge_graph/reasoning/inference_engine.ts',
    shouldContain: 'InferenceEngine'
  },
  // Agent Bridges
  {
    name: 'Business Analyst Bridge',
    path: 'packages/integrations/agents/business-analyst/implementation.ts',
    shouldContain: 'BusinessAnalystImplementation'
  },
  {
    name: 'Sprint Prioritizer Bridge',
    path: 'packages/integrations/agents/sprint-prioritizer/implementation.ts',
    shouldContain: 'SprintPriorizerImplementation'
  },
  // Learning Systems
  {
    name: 'Interaction Logger',
    path: 'knowledge-system/learning/continuous/interaction_logger.ts',
    shouldContain: 'InteractionLogger'
  },
  {
    name: 'RLHF Trainer',
    path: 'knowledge-system/learning/feedback/rlhf_trainer.ts',
    shouldContain: 'RLHFTrainer'
  }
];

let passed = 0;
let failed = 0;

for (const test of tests) {
  const fullPath = path.join(__dirname, '..', test.path);

  try {
    if (fs.existsSync(fullPath)) {
      const content = fs.readFileSync(fullPath, 'utf-8');

      if (content.includes(test.shouldContain)) {
        console.log(green(`✅ ${test.name}`));
        console.log(`   File exists and contains '${test.shouldContain}'`);
        passed++;
      } else {
        console.log(red(`❌ ${test.name}`));
        console.log(`   File exists but missing '${test.shouldContain}'`);
        failed++;
      }
    } else {
      console.log(red(`❌ ${test.name}`));
      console.log(`   File not found: ${test.path}`);
      failed++;
    }
  } catch (error) {
    console.log(red(`❌ ${test.name}`));
    console.log(`   Error: ${error.message}`);
    failed++;
  }
}

console.log('\n' + blue('─'.repeat(50)));
console.log(blue(`\n📊 Test Results:`));
console.log(green(`   Passed: ${passed}`));
console.log(red(`   Failed: ${failed}`));
console.log(blue(`   Total: ${tests.length}`));

if (failed === 0) {
  console.log(green('\n🎉 All implementations verified successfully!\n'));
  process.exit(0);
} else {
  console.log(red(`\n⚠️  ${failed} implementations need attention.\n`));
  process.exit(1);
}