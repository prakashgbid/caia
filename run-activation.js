#!/usr/bin/env node

/**
 * Simple test runner for agent activation
 */

const fs = require('fs');
const path = require('path');

console.log('🚀 CAIA Agent Activation Test');
console.log('============================\n');

// Test basic path resolution
const agentsDir = path.join(__dirname, 'packages/agents');
console.log('Checking agents directory:', agentsDir);

try {
  const dirExists = fs.existsSync(agentsDir);
  console.log('Directory exists:', dirExists);
  
  if (dirExists) {
    const contents = fs.readdirSync(agentsDir);
    console.log('Found agents:', contents.length);
    contents.forEach(name => {
      console.log(`  - ${name}`);
    });
  }
} catch (error) {
  console.error('Error checking directory:', error.message);
}

// Test our AgentActivator class
console.log('\n🔧 Testing AgentActivator...');

try {
  // Load the activator
  const AgentActivatorModule = require('./scripts/activate-agents.js');
  console.log('✅ AgentActivator module loaded');
  
  // Create instance
  const activator = new AgentActivatorModule();
  console.log('✅ AgentActivator instance created');
  
  // Test template creation
  console.log('\n📝 Testing template creation...');
  activator.ensureTemplates().then(() => {
    console.log('✅ Templates created/verified');
    
    // Test agent scanning
    console.log('\n🔍 Testing agent scanning...');
    return activator.scanAgents();
  }).then((agents) => {
    console.log(`✅ Found ${agents.length} agents needing activation:`);
    agents.forEach(agent => {
      console.log(`  - ${agent.name} (${agent.category})`);
      console.log(`    Capabilities: ${agent.capabilities.length}`);
      console.log(`    Methods: ${agent.methods.length}`);
    });
    
    console.log('\n🎯 Ready for activation!');
    console.log('To activate all agents, run:');
    console.log('  node scripts/activate-all.js');
    
  }).catch(error => {
    console.error('❌ Error during testing:', error.message);
    console.error('Stack:', error.stack);
  });
  
} catch (error) {
  console.error('❌ Failed to load AgentActivator:', error.message);
  console.error('Stack:', error.stack);
}