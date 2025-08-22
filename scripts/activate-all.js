#!/usr/bin/env node

/**
 * Master Agent Activation Orchestrator
 * 
 * Complete workflow for activating all CAIA agents:
 * 1. Discovery and analysis
 * 2. Batch activation with parallel processing
 * 3. Validation and testing
 * 4. Report generation
 * 5. Next steps planning
 */

const fs = require('fs');
const path = require('path');
const AgentActivator = require('./activate-agents.js');
const BatchActivator = require('./batch-activate.js');
const AgentValidator = require('./validate-agents.js');

class MasterActivator {
  constructor() {
    this.scriptsDir = __dirname;
    this.startTime = new Date();
    this.masterReport = {
      startTime: this.startTime,
      endTime: null,
      totalDuration: 0,
      phases: {
        discovery: { duration: 0, status: 'pending' },
        activation: { duration: 0, status: 'pending' },
        validation: { duration: 0, status: 'pending' },
        reporting: { duration: 0, status: 'pending' }
      },
      summary: {
        totalAgents: 0,
        activated: 0,
        validated: 0,
        successful: 0,
        failed: 0
      },
      categories: {},
      nextSteps: [],
      errors: []
    };
  }

  /**
   * Execute complete activation workflow
   */
  async execute(options = {}) {
    const {
      dryRun = false,
      skipValidation = false,
      parallel = true,
      batchSize = 10,
      verbose = false
    } = options;

    console.log('🚀 CAIA Master Agent Activation System');
    console.log('======================================\n');

    try {
      // Phase 1: Discovery
      await this.executePhase('discovery', () => this.discoveryPhase(options));

      if (dryRun) {
        console.log('\n🔍 DRY RUN COMPLETED - No actual activation performed');
        return this.masterReport;
      }

      // Phase 2: Activation
      await this.executePhase('activation', () => this.activationPhase(options));

      // Phase 3: Validation
      if (!skipValidation) {
        await this.executePhase('validation', () => this.validationPhase(options));
      } else {
        this.masterReport.phases.validation.status = 'skipped';
      }

      // Phase 4: Reporting
      await this.executePhase('reporting', () => this.reportingPhase(options));

      this.masterReport.endTime = new Date();
      this.masterReport.totalDuration = this.masterReport.endTime - this.startTime;

      console.log('\n🎉 MASTER ACTIVATION COMPLETED!');
      this.printFinalSummary();

      return this.masterReport;

    } catch (error) {
      console.error('\n💥 MASTER ACTIVATION FAILED:', error.message);
      this.masterReport.errors.push({
        phase: 'master',
        message: error.message,
        stack: error.stack,
        timestamp: new Date()
      });
      throw error;
    }
  }

  /**
   * Execute a phase with timing and error handling
   */
  async executePhase(phaseName, phaseFunction) {
    const phaseStart = Date.now();
    
    try {
      console.log(`\n📍 Phase ${this.getPhaseNumber(phaseName)}: ${this.getPhaseTitle(phaseName)}`);
      console.log('─'.repeat(50));
      
      this.masterReport.phases[phaseName].status = 'running';
      await phaseFunction();
      
      this.masterReport.phases[phaseName].status = 'completed';
      this.masterReport.phases[phaseName].duration = Date.now() - phaseStart;
      
      console.log(`✅ ${this.getPhaseTitle(phaseName)} completed (${this.masterReport.phases[phaseName].duration}ms)`);
      
    } catch (error) {
      this.masterReport.phases[phaseName].status = 'failed';
      this.masterReport.phases[phaseName].duration = Date.now() - phaseStart;
      this.masterReport.phases[phaseName].error = error.message;
      
      console.error(`❌ ${this.getPhaseTitle(phaseName)} failed:`, error.message);
      throw error;
    }
  }

  /**
   * Phase 1: Discovery - Analyze current state
   */
  async discoveryPhase(options) {
    console.log('🔍 Analyzing current agent state...');

    // Use single agent activator for discovery
    const activator = new AgentActivator();
    const agents = await activator.scanAgents();

    this.masterReport.summary.totalAgents = activator.activationReport.total;

    // Categorize findings
    const needsActivation = agents.length;
    const alreadyImplemented = activator.activationReport.skipped;

    console.log(`\n📊 Discovery Results:`);
    console.log(`  Total agents found: ${this.masterReport.summary.totalAgents}`);
    console.log(`  Need activation: ${needsActivation}`);
    console.log(`  Already implemented: ${alreadyImplemented}`);

    if (needsActivation === 0) {
      console.log('\n✨ All agents are already activated!');
      this.masterReport.summary.activated = this.masterReport.summary.totalAgents;
      return;
    }

    // Group by category for planning
    const categories = agents.reduce((acc, agent) => {
      if (!acc[agent.category]) {
        acc[agent.category] = 0;
      }
      acc[agent.category]++;
      return acc;
    }, {});

    console.log(`\n📋 Agents by category:`);
    Object.entries(categories).forEach(([category, count]) => {
      console.log(`  ${category}: ${count} agents`);
    });

    this.masterReport.categories = categories;
  }

  /**
   * Phase 2: Activation - Generate implementations
   */
  async activationPhase(options) {
    console.log('🔨 Activating agents...');

    const batchActivator = new BatchActivator();
    const activationResult = await batchActivator.activate({
      parallel: options.parallel,
      batchSize: options.batchSize,
      timeout: 300000
    });

    // Merge results
    this.masterReport.summary.activated = activationResult.successful;
    this.masterReport.summary.failed += activationResult.failed;

    if (activationResult.errors.length > 0) {
      this.masterReport.errors.push(...activationResult.errors);
    }

    console.log(`\n📊 Activation Results:`);
    console.log(`  Successfully activated: ${activationResult.successful}`);
    console.log(`  Failed: ${activationResult.failed}`);
    console.log(`  Success rate: ${Math.round(activationResult.successful / (activationResult.successful + activationResult.failed) * 100)}%`);
  }

  /**
   * Phase 3: Validation - Test implementations
   */
  async validationPhase(options) {
    console.log('🔍 Validating generated implementations...');

    const validator = new AgentValidator();
    const validationResult = await validator.validate({
      skipCompilation: false,
      skipTests: true, // Skip tests for now, just validate structure
      parallel: options.parallel,
      verbose: options.verbose
    });

    this.masterReport.summary.validated = validationResult.validated;
    this.masterReport.summary.successful = validationResult.passed;

    if (validationResult.errors.length > 0) {
      this.masterReport.errors.push(...validationResult.errors);
    }

    console.log(`\n📊 Validation Results:`);
    console.log(`  Validated: ${validationResult.validated}`);
    console.log(`  Passed: ${validationResult.passed}`);
    console.log(`  Failed: ${validationResult.failed}`);
    console.log(`  Success rate: ${Math.round(validationResult.passed / validationResult.validated * 100)}%`);
  }

  /**
   * Phase 4: Reporting - Generate comprehensive report
   */
  async reportingPhase(options) {
    console.log('📄 Generating comprehensive report...');

    // Generate next steps
    this.generateNextSteps();

    // Save master report
    const reportPath = path.join(this.scriptsDir, 'master-activation-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(this.masterReport, null, 2));

    console.log(`\n📊 Master report saved to: ${reportPath}`);
    
    // Generate markdown summary
    this.generateMarkdownReport();
  }

  /**
   * Generate next steps based on results
   */
  generateNextSteps() {
    const steps = [];

    // Based on activation results
    if (this.masterReport.summary.failed > 0) {
      steps.push({
        priority: 'high',
        action: 'Fix failed activations',
        description: `${this.masterReport.summary.failed} agents failed activation and need manual intervention`,
        commands: ['node scripts/activate-agents.js --agent <agent-name>']
      });
    }

    // Based on validation results
    if (this.masterReport.summary.validated < this.masterReport.summary.activated) {
      steps.push({
        priority: 'medium',
        action: 'Complete validation',
        description: `${this.masterReport.summary.activated - this.masterReport.summary.validated} agents were activated but not validated`,
        commands: ['node scripts/validate-agents.js']
      });
    }

    // Implementation refinement
    if (this.masterReport.summary.successful > 0) {
      steps.push({
        priority: 'medium',
        action: 'Refine implementations',
        description: 'Generated implementations are basic stubs that need proper logic',
        commands: [
          'cd packages/agents/<agent-name>',
          'npm run build',
          'npm test'
        ]
      });
    }

    // Core features
    steps.push({
      priority: 'high',
      action: 'Implement core agent methods',
      description: 'Each agent needs proper implementation of its core capabilities',
      commands: [
        'Edit src/<AgentClass>.ts',
        'Implement method stubs with actual logic',
        'Add proper error handling'
      ]
    });

    // Testing
    steps.push({
      priority: 'medium',
      action: 'Expand test coverage',
      description: 'Generated tests are minimal and need expansion',
      commands: [
        'cd packages/agents/<agent-name>',
        'Edit tests/index.test.ts',
        'npm run test:coverage'
      ]
    });

    // Documentation
    steps.push({
      priority: 'low',
      action: 'Update documentation',
      description: 'READMEs may need updates to reflect actual implementations',
      commands: [
        'Review README.md',
        'Update API examples',
        'Add implementation notes'
      ]
    });

    // Integration
    steps.push({
      priority: 'high',
      action: 'Register agents with CAIA core',
      description: 'Activated agents need to be registered in the main orchestrator',
      commands: [
        'Update packages/core/src/index.ts',
        'Add agent imports and registration',
        'Test orchestration'
      ]
    });

    this.masterReport.nextSteps = steps;
  }

  /**
   * Generate markdown report
   */
  generateMarkdownReport() {
    const report = `# CAIA Agent Activation Report

Generated: ${new Date().toISOString()}
Duration: ${this.masterReport.totalDuration}ms

## Summary

- **Total Agents**: ${this.masterReport.summary.totalAgents}
- **Activated**: ${this.masterReport.summary.activated}
- **Validated**: ${this.masterReport.summary.validated}
- **Successful**: ${this.masterReport.summary.successful}
- **Failed**: ${this.masterReport.summary.failed}

## Phases

${Object.entries(this.masterReport.phases).map(([phase, data]) => `
### ${this.getPhaseTitle(phase)}
- Status: ${data.status}
- Duration: ${data.duration}ms
${data.error ? `- Error: ${data.error}` : ''}
`).join('')}

## Categories

${Object.entries(this.masterReport.categories).map(([category, count]) => `
- **${category}**: ${count} agents
`).join('')}

## Next Steps

${this.masterReport.nextSteps.map((step, index) => `
### ${index + 1}. ${step.action} (${step.priority} priority)

${step.description}

\`\`\`bash
${step.commands.join('\n')}
\`\`\`
`).join('')}

## Errors

${this.masterReport.errors.length > 0 ? 
  this.masterReport.errors.map(error => `
- **${error.agent || error.phase || 'General'}**: ${error.message}
`).join('') : 
  'No errors encountered.'
}

---

*Generated by CAIA Master Agent Activation System*
`;

    const reportPath = path.join(this.scriptsDir, 'ACTIVATION-REPORT.md');
    fs.writeFileSync(reportPath, report);
    console.log(`📝 Markdown report saved to: ${reportPath}`);
  }

  /**
   * Print final summary
   */
  printFinalSummary() {
    console.log('\n📊 FINAL SUMMARY');
    console.log('================');
    console.log(`Total Duration: ${this.masterReport.totalDuration}ms`);
    console.log(`Total Agents: ${this.masterReport.summary.totalAgents}`);
    console.log(`Successfully Activated: ${this.masterReport.summary.activated}`);
    console.log(`Successfully Validated: ${this.masterReport.summary.successful}`);
    console.log(`Failed: ${this.masterReport.summary.failed}`);

    if (this.masterReport.summary.totalAgents > 0) {
      const successRate = Math.round(this.masterReport.summary.successful / this.masterReport.summary.totalAgents * 100);
      console.log(`Overall Success Rate: ${successRate}%`);
    }

    console.log(`\n🎯 NEXT STEPS (${this.masterReport.nextSteps.length} items):`);
    this.masterReport.nextSteps
      .filter(step => step.priority === 'high')
      .forEach((step, index) => {
        console.log(`  ${index + 1}. ${step.action} (${step.priority})`);
      });

    if (this.masterReport.errors.length > 0) {
      console.log(`\n⚠️  ${this.masterReport.errors.length} errors encountered - check detailed reports`);
    }

    console.log(`\n📄 Reports saved to:`);
    console.log(`  - JSON: ${path.join(this.scriptsDir, 'master-activation-report.json')}`);
    console.log(`  - Markdown: ${path.join(this.scriptsDir, 'ACTIVATION-REPORT.md')}`);
  }

  // Utility methods

  getPhaseNumber(phaseName) {
    const phases = ['discovery', 'activation', 'validation', 'reporting'];
    return phases.indexOf(phaseName) + 1;
  }

  getPhaseTitle(phaseName) {
    const titles = {
      discovery: 'Discovery & Analysis',
      activation: 'Agent Activation',
      validation: 'Implementation Validation',
      reporting: 'Report Generation'
    };
    return titles[phaseName] || phaseName;
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  const options = {};

  // Parse command line arguments
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--skip-validation':
        options.skipValidation = true;
        break;
      case '--sequential':
        options.parallel = false;
        break;
      case '--batch-size':
        options.batchSize = parseInt(args[++i]);
        break;
      case '--verbose':
        options.verbose = true;
        break;
      case '--help':
        console.log(`
CAIA Master Agent Activation

Usage: node activate-all.js [options]

Options:
  --dry-run             Analyze what would be done without doing it
  --skip-validation     Skip validation phase
  --sequential          Process agents sequentially instead of in parallel
  --batch-size N        Number of agents to process concurrently (default: 10)
  --verbose             Show detailed output
  --help                Show this help message

Examples:
  node activate-all.js                    # Full activation workflow
  node activate-all.js --dry-run          # Preview what would be done
  node activate-all.js --skip-validation  # Activate without validation
        `);
        process.exit(0);
        break;
    }
  }

  const masterActivator = new MasterActivator();
  await masterActivator.execute(options);
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = MasterActivator;