#!/usr/bin/env node

/**
 * Batch Agent Activation Script
 * 
 * Processes multiple agents in parallel using the CC Orchestrator for maximum performance.
 * Groups agents by category and activates them concurrently.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

class BatchActivator {
  constructor() {
    this.scriptsDir = __dirname;
    this.activatorScript = path.join(this.scriptsDir, 'activate-agents.js');
    this.reportPath = path.join(this.scriptsDir, 'batch-activation-report.json');
    
    this.batchReport = {
      startTime: new Date(),
      endTime: null,
      totalDuration: 0,
      totalAgents: 0,
      processed: 0,
      successful: 0,
      failed: 0,
      categories: {},
      batches: [],
      errors: []
    };
  }

  /**
   * Main batch activation process
   */
  async activate(options = {}) {
    const {
      parallel = true,
      batchSize = 10,
      timeout = 300000, // 5 minutes
      dryRun = false
    } = options;

    console.log('🚀 CAIA Batch Agent Activation Starting...\n');
    console.log(`Configuration:`);
    console.log(`  Parallel: ${parallel}`);
    console.log(`  Batch Size: ${batchSize}`);
    console.log(`  Timeout: ${timeout}ms`);
    console.log(`  Dry Run: ${dryRun}\n`);

    try {
      // Discover agents
      const agents = await this.discoverAgents();
      this.batchReport.totalAgents = agents.length;

      if (agents.length === 0) {
        console.log('ℹ️  No agents found needing activation');
        return this.batchReport;
      }

      // Group agents by category for optimal processing
      const agentGroups = this.groupAgentsByCategory(agents);
      
      if (dryRun) {
        console.log('🔍 DRY RUN - Would activate:');
        this.printDryRunSummary(agentGroups);
        return this.batchReport;
      }

      // Process agents
      if (parallel) {
        await this.processAgentsInParallel(agentGroups, batchSize, timeout);
      } else {
        await this.processAgentsSequentially(agents, timeout);
      }

      this.batchReport.endTime = new Date();
      this.batchReport.totalDuration = this.batchReport.endTime - this.batchReport.startTime;

      // Generate final report
      this.generateFinalReport();

      console.log('\n✅ Batch activation completed!');
      return this.batchReport;

    } catch (error) {
      console.error('\n❌ Batch activation failed:', error.message);
      this.batchReport.errors.push({
        message: error.message,
        stack: error.stack,
        timestamp: new Date()
      });
      throw error;
    }
  }

  /**
   * Discover agents needing activation
   */
  async discoverAgents() {
    const agentsDir = path.join(this.scriptsDir, '../packages/agents');
    const agentDirs = fs.readdirSync(agentsDir, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);

    const needsActivation = [];

    for (const agentName of agentDirs) {
      const agentPath = path.join(agentsDir, agentName);
      const readmePath = path.join(agentPath, 'README.md');
      const srcPath = path.join(agentPath, 'src');

      if (fs.existsSync(readmePath)) {
        const hasImplementation = fs.existsSync(srcPath) && 
          fs.readdirSync(srcPath).some(file => file.endsWith('.ts') && file !== 'types.ts');

        if (!hasImplementation) {
          const category = this.inferCategory(agentName);
          needsActivation.push({
            name: agentName,
            path: agentPath,
            category,
            priority: this.getPriority(category, agentName)
          });
        }
      }
    }

    // Sort by priority (higher priority first)
    needsActivation.sort((a, b) => b.priority - a.priority);

    console.log(`📊 Discovered ${needsActivation.length} agents needing activation:`);
    needsActivation.forEach(agent => {
      console.log(`  - ${agent.name} (${agent.category}, priority: ${agent.priority})`);
    });
    console.log();

    return needsActivation;
  }

  /**
   * Group agents by category for optimal parallel processing
   */
  groupAgentsByCategory(agents) {
    const groups = agents.reduce((acc, agent) => {
      if (!acc[agent.category]) {
        acc[agent.category] = [];
      }
      acc[agent.category].push(agent);
      return acc;
    }, {});

    console.log('📋 Agent groups by category:');
    Object.entries(groups).forEach(([category, categoryAgents]) => {
      console.log(`  ${category}: ${categoryAgents.length} agents`);
    });
    console.log();

    return groups;
  }

  /**
   * Process agents in parallel using category-based batching
   */
  async processAgentsInParallel(agentGroups, batchSize, timeout) {
    console.log('🔄 Processing agents in parallel...\n');

    // Process each category in parallel
    const categoryPromises = Object.entries(agentGroups).map(
      ([category, agents]) => this.processCategoryBatch(category, agents, batchSize, timeout)
    );

    const results = await Promise.allSettled(categoryPromises);

    // Aggregate results
    results.forEach((result, index) => {
      const category = Object.keys(agentGroups)[index];
      if (result.status === 'fulfilled') {
        this.batchReport.categories[category] = result.value;
      } else {
        this.batchReport.categories[category] = {
          error: result.reason.message,
          processed: 0,
          successful: 0,
          failed: agentGroups[category].length
        };
        this.batchReport.errors.push({
          category,
          message: result.reason.message,
          timestamp: new Date()
        });
      }
    });
  }

  /**
   * Process a category of agents in batches
   */
  async processCategoryBatch(category, agents, batchSize, timeout) {
    console.log(`🔨 Processing ${category} category (${agents.length} agents)...`);

    const batches = this.chunkArray(agents, batchSize);
    const categoryResult = {
      processed: 0,
      successful: 0,
      failed: 0,
      duration: 0,
      batches: []
    };

    const startTime = Date.now();

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      console.log(`  Batch ${i + 1}/${batches.length}: ${batch.map(a => a.name).join(', ')}`);

      const batchResult = await this.processBatch(batch, timeout);
      categoryResult.batches.push(batchResult);
      categoryResult.processed += batchResult.processed;
      categoryResult.successful += batchResult.successful;
      categoryResult.failed += batchResult.failed;
    }

    categoryResult.duration = Date.now() - startTime;
    console.log(`  ✅ ${category}: ${categoryResult.successful}/${categoryResult.processed} successful (${categoryResult.duration}ms)\n`);

    return categoryResult;
  }

  /**
   * Process a single batch of agents
   */
  async processBatch(agents, timeout) {
    const batchResult = {
      agents: agents.map(a => a.name),
      processed: 0,
      successful: 0,
      failed: 0,
      duration: 0,
      details: []
    };

    const startTime = Date.now();

    // Process agents in this batch concurrently
    const agentPromises = agents.map(agent => this.activateAgent(agent, timeout));
    const results = await Promise.allSettled(agentPromises);

    results.forEach((result, index) => {
      const agent = agents[index];
      batchResult.processed++;
      
      if (result.status === 'fulfilled') {
        batchResult.successful++;
        batchResult.details.push({
          name: agent.name,
          status: 'success',
          duration: result.value.duration
        });
      } else {
        batchResult.failed++;
        batchResult.details.push({
          name: agent.name,
          status: 'failed',
          error: result.reason.message
        });
      }
    });

    batchResult.duration = Date.now() - startTime;
    this.batchReport.batches.push(batchResult);

    return batchResult;
  }

  /**
   * Activate a single agent
   */
  async activateAgent(agent, timeout) {
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      const child = spawn('node', [this.activatorScript], {
        cwd: agent.path,
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        const duration = Date.now() - startTime;
        
        if (code === 0) {
          resolve({ 
            agent: agent.name, 
            duration,
            stdout 
          });
        } else {
          reject(new Error(`Agent ${agent.name} activation failed (exit code ${code}): ${stderr}`));
        }
      });

      child.on('error', (error) => {
        reject(new Error(`Failed to start activation for ${agent.name}: ${error.message}`));
      });

      // Handle timeout
      const timeoutHandle = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`Agent ${agent.name} activation timed out after ${timeout}ms`));
      }, timeout);

      child.on('close', () => {
        clearTimeout(timeoutHandle);
      });
    });
  }

  /**
   * Process agents sequentially (fallback mode)
   */
  async processAgentsSequentially(agents, timeout) {
    console.log('🔄 Processing agents sequentially...\n');

    for (let i = 0; i < agents.length; i++) {
      const agent = agents[i];
      console.log(`${i + 1}/${agents.length}: Activating ${agent.name}...`);

      try {
        const result = await this.activateAgent(agent, timeout);
        this.batchReport.successful++;
        console.log(`  ✅ ${agent.name} (${result.duration}ms)`);
      } catch (error) {
        this.batchReport.failed++;
        console.log(`  ❌ ${agent.name}: ${error.message}`);
        this.batchReport.errors.push({
          agent: agent.name,
          message: error.message,
          timestamp: new Date()
        });
      }

      this.batchReport.processed++;
    }
  }

  /**
   * Print dry run summary
   */
  printDryRunSummary(agentGroups) {
    Object.entries(agentGroups).forEach(([category, agents]) => {
      console.log(`  ${category}:`);
      agents.forEach(agent => {
        console.log(`    - ${agent.name} (priority: ${agent.priority})`);
      });
    });
  }

  /**
   * Generate final report
   */
  generateFinalReport() {
    this.batchReport.processed = this.batchReport.successful + this.batchReport.failed;

    console.log('\n📊 Batch Activation Report');
    console.log('==========================');
    console.log(`Total Duration: ${this.batchReport.totalDuration}ms`);
    console.log(`Total Agents: ${this.batchReport.totalAgents}`);
    console.log(`Processed: ${this.batchReport.processed}`);
    console.log(`Successful: ${this.batchReport.successful}`);
    console.log(`Failed: ${this.batchReport.failed}`);
    console.log(`Success Rate: ${Math.round(this.batchReport.successful / this.batchReport.processed * 100)}%`);

    console.log('\n📋 By Category:');
    Object.entries(this.batchReport.categories).forEach(([category, stats]) => {
      if (stats.error) {
        console.log(`  ${category}: ERROR - ${stats.error}`);
      } else {
        console.log(`  ${category}: ${stats.successful}/${stats.processed} (${Math.round(stats.successful/stats.processed*100)}%, ${stats.duration}ms)`);
      }
    });

    if (this.batchReport.errors.length > 0) {
      console.log('\n❌ Errors:');
      this.batchReport.errors.forEach(error => {
        console.log(`  - ${error.agent || error.category || 'General'}: ${error.message}`);
      });
    }

    // Save detailed report
    fs.writeFileSync(this.reportPath, JSON.stringify(this.batchReport, null, 2));
    console.log(`\n📄 Detailed report saved to: ${this.reportPath}`);
  }

  // Utility methods

  /**
   * Infer agent category from name
   */
  inferCategory(agentName) {
    const name = agentName.toLowerCase();
    
    if (name.includes('connector') || name.includes('connect')) {
      return 'connector';
    } else if (name.includes('sme') || name.includes('expert')) {
      return 'sme';
    } else if (name.includes('agent') || name.includes('engineer') || name.includes('owner') || name.includes('architect')) {
      return 'role';
    } else if (name.includes('processor') || name.includes('generator') || name.includes('analyzer')) {
      return 'processor';
    } else if (name.includes('guardian') || name.includes('monitor') || name.includes('security')) {
      return 'guardian';
    }
    
    return 'utility';
  }

  /**
   * Get priority for agent based on category and name
   */
  getPriority(category, agentName) {
    const priorities = {
      'connector': 10,
      'role': 8,
      'sme': 6,
      'processor': 4,
      'guardian': 4,
      'utility': 2
    };

    let basePriority = priorities[category] || 1;

    // Boost priority for core agents
    const name = agentName.toLowerCase();
    if (name.includes('jira') || name.includes('github') || name.includes('npm')) {
      basePriority += 5;
    }
    if (name.includes('product-owner') || name.includes('architect')) {
      basePriority += 3;
    }

    return basePriority;
  }

  /**
   * Split array into chunks
   */
  chunkArray(array, chunkSize) {
    const chunks = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  const options = {};

  // Parse command line arguments
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--sequential':
        options.parallel = false;
        break;
      case '--batch-size':
        options.batchSize = parseInt(args[++i]);
        break;
      case '--timeout':
        options.timeout = parseInt(args[++i]);
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--help':
        console.log(`
CAIA Batch Agent Activation

Usage: node batch-activate.js [options]

Options:
  --sequential     Process agents one by one instead of in parallel
  --batch-size N   Number of agents to process concurrently (default: 10)
  --timeout N      Timeout per agent in milliseconds (default: 300000)
  --dry-run        Show what would be processed without actually doing it
  --help           Show this help message

Examples:
  node batch-activate.js                    # Default parallel processing
  node batch-activate.js --sequential       # Sequential processing
  node batch-activate.js --batch-size 5     # Smaller batches
  node batch-activate.js --dry-run          # Preview mode
        `);
        process.exit(0);
        break;
    }
  }

  const activator = new BatchActivator();
  await activator.activate(options);
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = BatchActivator;