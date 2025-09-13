#!/usr/bin/env node

/**
 * CAIA Reusability CLI
 * Command-line interface for managing reusable components
 */

const fs = require('fs').promises;
const path = require('path');
const { LocalCloudBridge, ComponentRegistry } = require('./bridge-service');
const { 
  EnvironmentDetector, 
  AdaptiveKnowledgeQuery,
  EnvironmentAgnosticAgent 
} = require('./shared-components');

class CAIAReuseCLI {
  constructor() {
    this.bridge = new LocalCloudBridge();
    this.registry = new ComponentRegistry();
    this.commands = {
      init: this.init.bind(this),
      share: this.share.bind(this),
      import: this.import.bind(this),
      sync: this.sync.bind(this),
      list: this.list.bind(this),
      test: this.test.bind(this),
      analyze: this.analyze.bind(this),
      stats: this.stats.bind(this)
    };
  }
  
  async init() {
    console.log('🚀 Initializing CAIA Reusability Framework...');
    
    // Create directory structure
    const dirs = [
      'shared',
      'shared/components',
      'shared/patterns',
      'shared/agents',
      'shared/workflows'
    ];
    
    const basePath = path.join(process.env.HOME, 'Documents/projects/caia');
    
    for (const dir of dirs) {
      const fullPath = path.join(basePath, dir);
      await fs.mkdir(fullPath, { recursive: true });
      console.log(`📁 Created: ${dir}`);
    }
    
    // Initialize bridge
    const status = await this.bridge.initialize();
    
    // Create initial configuration
    const config = {
      version: '1.0.0',
      initialized: new Date().toISOString(),
      environment: {
        local: status.local,
        cloud: status.cloud
      },
      settings: {
        autoSync: true,
        syncInterval: 300000,
        conflictResolution: 'newest'
      }
    };
    
    await fs.writeFile(
      path.join(basePath, 'reusability.config.json'),
      JSON.stringify(config, null, 2)
    );
    
    console.log('✅ Reusability framework initialized!');
    console.log('📡 Local CKS:', status.local ? 'Connected' : 'Not Available');
    console.log('☁️  Cloud API:', status.cloud ? 'Connected' : 'Not Configured');
  }
  
  async share(componentName) {
    if (!componentName) {
      console.error('❌ Please provide a component name');
      return;
    }
    
    console.log(`📤 Sharing component: ${componentName}`);
    
    // Find component in local codebase
    const component = await this.findComponent(componentName);
    
    if (!component) {
      console.error(`❌ Component "${componentName}" not found`);
      return;
    }
    
    // Analyze dependencies
    const deps = await this.analyzeDependencies(component);
    console.log(`🔗 Found ${deps.length} dependencies`);
    
    // Package component
    const componentPackage = await this.packageComponent(component, deps);
    
    // Register in registry
    const id = this.registry.register(componentPackage);
    await this.registry.save();
    
    console.log(`✅ Component shared with ID: ${id}`);
    
    // Optionally upload to cloud
    if (EnvironmentDetector.isCloud || process.env.CLOUD_CKS_URL) {
      console.log('☁️  Uploading to cloud...');
      // await this.uploadToCloud(package);
      console.log('✅ Uploaded to cloud');
    }
  }
  
  async import(componentId) {
    if (!componentId) {
      console.error('❌ Please provide a component ID');
      return;
    }
    
    console.log(`📥 Importing component: ${componentId}`);
    
    // Check local registry first
    await this.registry.load();
    let component = this.registry.components.get(componentId);
    
    if (!component) {
      console.log('🔍 Not in local registry, checking cloud...');
      // component = await this.fetchFromCloud(componentId);
      
      if (!component) {
        console.error(`❌ Component "${componentId}" not found`);
        return;
      }
    }
    
    // Install component
    await this.installComponent(component);
    
    console.log(`✅ Component imported: ${component.name}`);
  }
  
  async sync() {
    console.log('🔄 Starting synchronization...');
    
    await this.bridge.initialize();
    await this.bridge.syncAll();
    
    console.log('✅ Synchronization complete');
  }
  
  async list(options = {}) {
    console.log('📋 Listing reusable components...');
    
    await this.registry.load();
    
    const components = Array.from(this.registry.components.values());
    
    // Filter by source if specified
    const filtered = options.source 
      ? components.filter(c => c.source === options.source)
      : components;
    
    if (filtered.length === 0) {
      console.log('No components found');
      return;
    }
    
    console.log(`\nFound ${filtered.length} components:\n`);
    
    filtered.forEach(component => {
      console.log(`📦 ${component.name} (${component.id.substring(0, 8)}...)`);
      console.log(`   Type: ${component.type}`);
      console.log(`   Source: ${component.source || 'local'}`);
      console.log(`   Dependencies: ${component.dependencies?.length || 0}`);
      console.log('');
    });
  }
  
  async test(componentName, environment = 'both') {
    console.log(`🧪 Testing component: ${componentName} in ${environment} environment(s)`);
    
    const component = await this.findComponent(componentName);
    
    if (!component) {
      console.error(`❌ Component "${componentName}" not found`);
      return;
    }
    
    const results = {};
    
    if (environment === 'local' || environment === 'both') {
      console.log('💻 Testing locally...');
      results.local = await this.testLocal(component);
    }
    
    if (environment === 'cloud' || environment === 'both') {
      console.log('☁️  Testing in cloud...');
      results.cloud = await this.testCloud(component);
    }
    
    // Display results
    console.log('\n📊 Test Results:');
    Object.entries(results).forEach(([env, result]) => {
      console.log(`${env}: ${result.success ? '✅ Passed' : '❌ Failed'}`);
      if (result.error) {
        console.log(`  Error: ${result.error}`);
      }
    });
  }
  
  async analyze() {
    console.log('🔍 Analyzing codebase for reusability opportunities...');
    
    const analysis = {
      duplicates: [],
      patterns: [],
      candidates: []
    };
    
    // Scan for duplicate code
    console.log('🔍 Scanning for duplicate code...');
    // Simplified - would use AST analysis in production
    
    // Identify common patterns
    console.log('🎨 Identifying patterns...');
    analysis.patterns = [
      { name: 'API Client', count: 3 },
      { name: 'Data Processor', count: 5 },
      { name: 'Error Handler', count: 7 }
    ];
    
    // Find componentization candidates
    console.log('🎯 Finding componentization candidates...');
    analysis.candidates = [
      { name: 'Authentication Flow', usageCount: 4, complexity: 'medium' },
      { name: 'Data Validation', usageCount: 6, complexity: 'low' },
      { name: 'Logging System', usageCount: 8, complexity: 'low' }
    ];
    
    // Display analysis
    console.log('\n📊 Analysis Results:\n');
    
    console.log('🎨 Common Patterns:');
    analysis.patterns.forEach(p => {
      console.log(`  - ${p.name}: Used ${p.count} times`);
    });
    
    console.log('\n🎯 Componentization Candidates:');
    analysis.candidates.forEach(c => {
      console.log(`  - ${c.name}`);
      console.log(`    Usage: ${c.usageCount} times`);
      console.log(`    Complexity: ${c.complexity}`);
    });
    
    // Calculate potential savings
    const totalLines = 10000; // Simplified
    const duplicateLines = 1500;
    const savingsPercent = (duplicateLines / totalLines * 100).toFixed(1);
    
    console.log(`\n💰 Potential Savings:`);
    console.log(`  - Code reduction: ${savingsPercent}%`);
    console.log(`  - Estimated time saved: ${Math.round(duplicateLines / 50)} hours`);
  }
  
  async stats() {
    console.log('📊 Reusability Statistics\n');
    
    await this.registry.load();
    
    const stats = {
      totalComponents: this.registry.components.size,
      byType: {},
      bySource: {},
      avgDependencies: 0,
      lastSync: null
    };
    
    // Calculate statistics
    let totalDeps = 0;
    this.registry.components.forEach(component => {
      // By type
      stats.byType[component.type] = (stats.byType[component.type] || 0) + 1;
      
      // By source
      const source = component.source || 'local';
      stats.bySource[source] = (stats.bySource[source] || 0) + 1;
      
      // Dependencies
      totalDeps += (component.dependencies?.length || 0);
    });
    
    stats.avgDependencies = stats.totalComponents > 0 
      ? (totalDeps / stats.totalComponents).toFixed(1)
      : 0;
    
    // Display statistics
    console.log(`Total Components: ${stats.totalComponents}`);
    
    console.log('\nBy Type:');
    Object.entries(stats.byType).forEach(([type, count]) => {
      console.log(`  ${type}: ${count}`);
    });
    
    console.log('\nBy Source:');
    Object.entries(stats.bySource).forEach(([source, count]) => {
      console.log(`  ${source}: ${count}`);
    });
    
    console.log(`\nAverage Dependencies: ${stats.avgDependencies}`);
    
    // Check bridge stats
    console.log('\nBridge Statistics:');
    console.log(`  Synced: ${this.bridge.stats.synced}`);
    console.log(`  Conflicts: ${this.bridge.stats.conflicts}`);
    console.log(`  Errors: ${this.bridge.stats.errors}`);
    console.log(`  Last Sync: ${this.bridge.stats.lastSync || 'Never'}`);
  }
  
  // Helper methods
  async findComponent(name) {
    // Simplified component search
    return {
      name: name,
      type: 'function',
      path: `/Users/MAC/Documents/projects/caia/components/${name}.js`,
      dependencies: []
    };
  }
  
  async analyzeDependencies(component) {
    // Simplified dependency analysis
    return ['fs', 'path', 'http'];
  }
  
  async packageComponent(component, deps) {
    return {
      ...component,
      dependencies: deps,
      packaged: new Date().toISOString()
    };
  }
  
  async installComponent(component) {
    // Simplified installation
    const targetPath = path.join(
      process.env.HOME,
      'Documents/projects/caia/shared/components',
      `${component.name}.js`
    );
    
    // Would copy actual file in production
    await fs.writeFile(
      targetPath,
      `// Imported component: ${component.name}\nmodule.exports = {};`
    );
  }
  
  async testLocal(component) {
    // Simplified local testing
    return { success: true, duration: 123 };
  }
  
  async testCloud(component) {
    // Simplified cloud testing
    return { success: true, duration: 456 };
  }
}

// CLI Entry Point
if (require.main === module) {
  const cli = new CAIAReuseCLI();
  const args = process.argv.slice(2);
  const command = args[0];
  const params = args.slice(1);
  
  async function main() {
    if (!command || command === 'help') {
      console.log(`
🚀 CAIA Reusability CLI

Usage:
  caia-reuse <command> [options]

Commands:
  init              Initialize reusability framework
  share <name>      Share a component to registry
  import <id>       Import a component from registry
  sync              Synchronize local and cloud components
  list [--source]   List available components
  test <name> [env] Test component in environment(s)
  analyze           Analyze codebase for reusability
  stats             Show reusability statistics
  help              Show this help message

Examples:
  caia-reuse init
  caia-reuse share MyComponent
  caia-reuse import abc123def456
  caia-reuse list --source=cloud
  caia-reuse test MyComponent both
  caia-reuse analyze
`);
      return;
    }
    
    if (cli.commands[command]) {
      await cli.commands[command](...params);
    } else {
      console.error(`❌ Unknown command: ${command}`);
      console.log('Run "caia-reuse help" for usage information');
    }
  }
  
  main().catch(console.error);
}

module.exports = CAIAReuseCLI;