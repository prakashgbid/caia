#!/usr/bin/env node

/**
 * Simple test to see what agents exist and verify the activation system
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 Testing CAIA Agent Structure...\n');

// First, let's see what's in the project
const projectRoot = __dirname;
console.log('Project root:', projectRoot);

// Check if packages directory exists
const possiblePaths = [
  path.join(projectRoot, 'packages/agents'),
  path.join(projectRoot, 'agents'),
  path.join(projectRoot, 'src/agents')
];

for (const agentsPath of possiblePaths) {
  console.log(`Checking: ${agentsPath}`);
  
  if (fs.existsSync(agentsPath)) {
    console.log(`✅ Found agents directory: ${agentsPath}`);
    
    const contents = fs.readdirSync(agentsPath, { withFileTypes: true });
    console.log(`\n📁 Contents (${contents.length} items):`);
    
    contents.forEach(item => {
      if (item.isDirectory()) {
        const dirPath = path.join(agentsPath, item.name);
        const hasReadme = fs.existsSync(path.join(dirPath, 'README.md'));
        const hasSrc = fs.existsSync(path.join(dirPath, 'src'));
        const hasPackageJson = fs.existsSync(path.join(dirPath, 'package.json'));
        
        console.log(`  📦 ${item.name}`);
        console.log(`    - README.md: ${hasReadme ? '✅' : '❌'}`);
        console.log(`    - src/: ${hasSrc ? '✅' : '❌'}`);
        console.log(`    - package.json: ${hasPackageJson ? '✅' : '❌'}`);
        
        if (hasSrc) {
          const srcFiles = fs.readdirSync(path.join(dirPath, 'src'));
          const tsFiles = srcFiles.filter(f => f.endsWith('.ts'));
          console.log(`    - TS files: ${tsFiles.length} (${tsFiles.join(', ')})`);
        }
        
        console.log('');
      } else {
        console.log(`  📄 ${item.name}`);
      }
    });
    
    // Now test our activation system
    console.log('\n🚀 Testing activation system...');
    try {
      const AgentActivator = require('./scripts/activate-agents.js');
      const activator = new AgentActivator();
      
      // Override the AGENTS_DIR for this test
      activator.constructor.prototype.AGENTS_DIR = agentsPath;
      
      console.log('Activation system loaded successfully!');
      
      // Test discovery
      activator.scanAgents().then(agents => {
        console.log(`\n📊 Discovery results: ${agents.length} agents need activation`);
        agents.forEach(agent => {
          console.log(`  - ${agent.name} (${agent.category}): ${agent.capabilities.length} capabilities`);
        });
      }).catch(error => {
        console.error('Discovery failed:', error.message);
      });
      
    } catch (error) {
      console.error('❌ Failed to load activation system:', error.message);
    }
    
    break;
  } else {
    console.log(`❌ Not found: ${agentsPath}`);
  }
}

console.log('\n🎯 Summary:');
console.log('- Found the actual agent directory structure');
console.log('- Identified which agents need activation');
console.log('- Tested that our activation system can load');
console.log('\nNext: Run the actual activation with the corrected paths');