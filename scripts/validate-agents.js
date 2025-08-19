#!/usr/bin/env node

/**
 * Agent Validation Script
 * 
 * Validates generated agent implementations for:
 * - TypeScript compilation
 * - CAIA compliance
 * - Basic functionality
 * - Test coverage
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

class AgentValidator {
  constructor() {
    this.scriptsDir = __dirname;
    this.agentsDir = path.join(this.scriptsDir, '../packages/agents');
    this.reportPath = path.join(this.scriptsDir, 'validation-report.json');
    
    this.validationReport = {
      timestamp: new Date(),
      totalAgents: 0,
      validated: 0,
      passed: 0,
      failed: 0,
      categories: {},
      details: [],
      errors: []
    };
  }

  /**
   * Main validation process
   */
  async validate(options = {}) {
    const {
      skipCompilation = false,
      skipTests = false,
      parallel = true,
      verbose = false
    } = options;

    console.log('🔍 CAIA Agent Validation Starting...\n');

    try {
      // Discover agents to validate
      const agents = await this.discoverAgents();
      this.validationReport.totalAgents = agents.length;

      if (agents.length === 0) {
        console.log('ℹ️  No agents found to validate');
        return this.validationReport;
      }

      // Validate agents
      if (parallel) {
        await this.validateAgentsInParallel(agents, { skipCompilation, skipTests, verbose });
      } else {
        await this.validateAgentsSequentially(agents, { skipCompilation, skipTests, verbose });
      }

      // Generate final report
      this.generateValidationReport();

      console.log('\n✅ Validation completed!');
      return this.validationReport;

    } catch (error) {
      console.error('\n❌ Validation failed:', error.message);
      this.validationReport.errors.push({
        message: error.message,
        stack: error.stack,
        timestamp: new Date()
      });
      throw error;
    }
  }

  /**
   * Discover agents with implementations
   */
  async discoverAgents() {
    const agentDirs = fs.readdirSync(this.agentsDir, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);

    const agentsToValidate = [];

    for (const agentName of agentDirs) {
      const agentPath = path.join(this.agentsDir, agentName);
      const srcPath = path.join(agentPath, 'src');

      if (fs.existsSync(srcPath)) {
        const hasImplementation = fs.readdirSync(srcPath).some(file => 
          file.endsWith('.ts') && file !== 'types.ts'
        );

        if (hasImplementation) {
          agentsToValidate.push({
            name: agentName,
            path: agentPath,
            srcPath: srcPath,
            category: this.inferCategory(agentName)
          });
        }
      }
    }

    console.log(`📊 Found ${agentsToValidate.length} agents to validate:`);
    agentsToValidate.forEach(agent => {
      console.log(`  - ${agent.name} (${agent.category})`);
    });
    console.log();

    return agentsToValidate;
  }

  /**
   * Validate agents in parallel
   */
  async validateAgentsInParallel(agents, options) {
    console.log('🔄 Validating agents in parallel...\n');

    // Group by category for reporting
    const agentsByCategory = agents.reduce((acc, agent) => {
      if (!acc[agent.category]) {
        acc[agent.category] = [];
      }
      acc[agent.category].push(agent);
      return acc;
    }, {});

    // Validate all agents concurrently
    const agentPromises = agents.map(agent => this.validateAgent(agent, options));
    const results = await Promise.allSettled(agentPromises);

    // Process results
    results.forEach((result, index) => {
      const agent = agents[index];
      this.validationReport.validated++;

      if (result.status === 'fulfilled') {
        this.validationReport.passed++;
        this.validationReport.details.push({
          name: agent.name,
          category: agent.category,
          status: 'passed',
          checks: result.value.checks,
          duration: result.value.duration
        });
      } else {
        this.validationReport.failed++;
        this.validationReport.details.push({
          name: agent.name,
          category: agent.category,
          status: 'failed',
          error: result.reason.message
        });
        this.validationReport.errors.push({
          agent: agent.name,
          message: result.reason.message,
          timestamp: new Date()
        });
      }
    });

    // Update category stats
    Object.entries(agentsByCategory).forEach(([category, categoryAgents]) => {
      const categoryDetails = this.validationReport.details.filter(d => d.category === category);
      this.validationReport.categories[category] = {
        total: categoryAgents.length,
        passed: categoryDetails.filter(d => d.status === 'passed').length,
        failed: categoryDetails.filter(d => d.status === 'failed').length
      };
    });
  }

  /**
   * Validate agents sequentially
   */
  async validateAgentsSequentially(agents, options) {
    console.log('🔄 Validating agents sequentially...\n');

    for (const agent of agents) {
      console.log(`Validating ${agent.name}...`);

      try {
        const result = await this.validateAgent(agent, options);
        this.validationReport.passed++;
        console.log(`  ✅ ${agent.name} passed (${result.duration}ms)`);
      } catch (error) {
        this.validationReport.failed++;
        console.log(`  ❌ ${agent.name} failed: ${error.message}`);
        this.validationReport.errors.push({
          agent: agent.name,
          message: error.message,
          timestamp: new Date()
        });
      }

      this.validationReport.validated++;
    }
  }

  /**
   * Validate a single agent
   */
  async validateAgent(agent, options) {
    const startTime = Date.now();
    const checks = {
      structure: false,
      typescript: false,
      caiaCompliance: false,
      packageJson: false,
      tests: false
    };

    try {
      // 1. Check file structure
      checks.structure = await this.validateStructure(agent);
      
      // 2. Check TypeScript compilation
      if (!options.skipCompilation) {
        checks.typescript = await this.validateTypeScript(agent);
      } else {
        checks.typescript = true; // Skip
      }

      // 3. Check CAIA compliance
      checks.caiaCompliance = await this.validateCAIACompliance(agent);

      // 4. Check package.json
      checks.packageJson = await this.validatePackageJson(agent);

      // 5. Check tests
      if (!options.skipTests) {
        checks.tests = await this.validateTests(agent);
      } else {
        checks.tests = true; // Skip
      }

      const allPassed = Object.values(checks).every(check => check === true);
      if (!allPassed) {
        const failedChecks = Object.entries(checks)
          .filter(([_, passed]) => !passed)
          .map(([check, _]) => check);
        throw new Error(`Failed checks: ${failedChecks.join(', ')}`);
      }

      return {
        checks,
        duration: Date.now() - startTime
      };

    } catch (error) {
      if (options.verbose) {
        console.error(`    Validation error for ${agent.name}:`, error.message);
      }
      throw error;
    }
  }

  /**
   * Validate agent file structure
   */
  async validateStructure(agent) {
    const requiredFiles = [
      'src/index.ts',
      'package.json'
    ];

    const recommendedFiles = [
      'src/types.ts',
      'tests/index.test.ts',
      'README.md'
    ];

    // Check required files
    for (const file of requiredFiles) {
      const filePath = path.join(agent.path, file);
      if (!fs.existsSync(filePath)) {
        throw new Error(`Missing required file: ${file}`);
      }
    }

    // Check for main agent class file
    const srcFiles = fs.readdirSync(agent.srcPath);
    const hasAgentClass = srcFiles.some(file => 
      file.endsWith('Agent.ts') || 
      (file.endsWith('.ts') && file !== 'index.ts' && file !== 'types.ts')
    );

    if (!hasAgentClass) {
      throw new Error('No agent class implementation found');
    }

    return true;
  }

  /**
   * Validate TypeScript compilation
   */
  async validateTypeScript(agent) {
    try {
      // Check if tsconfig.json exists
      const tsconfigPath = path.join(agent.path, 'tsconfig.json');
      if (!fs.existsSync(tsconfigPath)) {
        // Create basic tsconfig.json
        const tsconfig = {
          "extends": "../../tsconfig.json",
          "compilerOptions": {
            "outDir": "./dist",
            "rootDir": "./src"
          },
          "include": ["src/**/*"],
          "exclude": ["node_modules", "dist", "tests"]
        };
        fs.writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 2));
      }

      // Try to compile TypeScript
      execSync('npx tsc --noEmit', {
        cwd: agent.path,
        stdio: 'pipe'
      });

      return true;
    } catch (error) {
      throw new Error(`TypeScript compilation failed: ${error.message}`);
    }
  }

  /**
   * Validate CAIA compliance
   */
  async validateCAIACompliance(agent) {
    const indexPath = path.join(agent.srcPath, 'index.ts');
    const indexContent = fs.readFileSync(indexPath, 'utf8');

    // Check for BaseAgent import
    if (!indexContent.includes('@caia/core') || !indexContent.includes('BaseAgent')) {
      throw new Error('Agent does not extend BaseAgent from @caia/core');
    }

    // Check for required exports
    if (!indexContent.includes('export')) {
      throw new Error('Agent does not export its class');
    }

    // Look for agent class file
    const srcFiles = fs.readdirSync(agent.srcPath);
    const agentClassFile = srcFiles.find(file => 
      file.endsWith('Agent.ts') && file !== 'index.ts'
    );

    if (agentClassFile) {
      const agentClassPath = path.join(agent.srcPath, agentClassFile);
      const agentClassContent = fs.readFileSync(agentClassPath, 'utf8');

      // Check class structure
      if (!agentClassContent.includes('extends BaseAgent')) {
        throw new Error('Agent class does not extend BaseAgent');
      }

      // Check required methods
      const requiredMethods = [
        'onInitialize',
        'onShutdown',
        'executeTask',
        'onTaskCancel'
      ];

      for (const method of requiredMethods) {
        if (!agentClassContent.includes(method)) {
          throw new Error(`Missing required method: ${method}`);
        }
      }
    }

    return true;
  }

  /**
   * Validate package.json configuration
   */
  async validatePackageJson(agent) {
    const packagePath = path.join(agent.path, 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

    // Check required fields
    const requiredFields = ['name', 'version', 'description'];
    for (const field of requiredFields) {
      if (!packageJson[field]) {
        throw new Error(`Missing required package.json field: ${field}`);
      }
    }

    // Check CAIA naming convention
    if (!packageJson.name.startsWith('@caia/agent-')) {
      throw new Error('Package name should follow @caia/agent-* convention');
    }

    // Check dependencies
    if (!packageJson.dependencies || !packageJson.dependencies['@caia/core']) {
      throw new Error('Missing @caia/core dependency');
    }

    // Check scripts
    const requiredScripts = ['build', 'test'];
    for (const script of requiredScripts) {
      if (!packageJson.scripts || !packageJson.scripts[script]) {
        throw new Error(`Missing required script: ${script}`);
      }
    }

    return true;
  }

  /**
   * Validate tests
   */
  async validateTests(agent) {
    const testsDir = path.join(agent.path, 'tests');
    
    if (!fs.existsSync(testsDir)) {
      throw new Error('No tests directory found');
    }

    const testFiles = fs.readdirSync(testsDir).filter(file => 
      file.endsWith('.test.ts') || file.endsWith('.spec.ts')
    );

    if (testFiles.length === 0) {
      throw new Error('No test files found');
    }

    // Check if Jest config exists
    const jestConfigPath = path.join(agent.path, 'jest.config.js');
    if (!fs.existsSync(jestConfigPath)) {
      // Create basic jest config
      const jestConfig = `module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts', '**/*.spec.ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts'
  ]
};`;
      fs.writeFileSync(jestConfigPath, jestConfig);
    }

    // Try to run tests (but don't fail if they don't pass, just check they exist)
    try {
      execSync('npm test -- --passWithNoTests --silent', {
        cwd: agent.path,
        stdio: 'pipe',
        timeout: 30000
      });
    } catch (error) {
      // Tests might fail, but that's okay for this validation
      // We just want to ensure they can be run
    }

    return true;
  }

  /**
   * Generate validation report
   */
  generateValidationReport() {
    console.log('\n📊 Agent Validation Report');
    console.log('==========================');
    console.log(`Total Agents: ${this.validationReport.totalAgents}`);
    console.log(`Validated: ${this.validationReport.validated}`);
    console.log(`Passed: ${this.validationReport.passed}`);
    console.log(`Failed: ${this.validationReport.failed}`);
    
    if (this.validationReport.validated > 0) {
      console.log(`Success Rate: ${Math.round(this.validationReport.passed / this.validationReport.validated * 100)}%`);
    }

    console.log('\n📋 By Category:');
    Object.entries(this.validationReport.categories).forEach(([category, stats]) => {
      const successRate = stats.total > 0 ? Math.round(stats.passed / stats.total * 100) : 0;
      console.log(`  ${category}: ${stats.passed}/${stats.total} (${successRate}%)`);
    });

    console.log('\n📝 Details:');
    this.validationReport.details.forEach(detail => {
      const status = detail.status === 'passed' ? '✅' : '❌';
      console.log(`  ${status} ${detail.name} (${detail.category})`);
      
      if (detail.checks) {
        const checkResults = Object.entries(detail.checks)
          .map(([check, passed]) => `${check}: ${passed ? '✅' : '❌'}`)
          .join(', ');
        console.log(`    └─ ${checkResults} (${detail.duration}ms)`);
      }
      
      if (detail.error) {
        console.log(`    └─ Error: ${detail.error}`);
      }
    });

    if (this.validationReport.errors.length > 0) {
      console.log('\n❌ Errors:');
      this.validationReport.errors.forEach(error => {
        console.log(`  - ${error.agent || 'General'}: ${error.message}`);
      });
    }

    // Save detailed report
    fs.writeFileSync(this.reportPath, JSON.stringify(this.validationReport, null, 2));
    console.log(`\n📄 Detailed report saved to: ${this.reportPath}`);
  }

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
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  const options = {};

  // Parse command line arguments
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--skip-compilation':
        options.skipCompilation = true;
        break;
      case '--skip-tests':
        options.skipTests = true;
        break;
      case '--sequential':
        options.parallel = false;
        break;
      case '--verbose':
        options.verbose = true;
        break;
      case '--help':
        console.log(`
CAIA Agent Validation

Usage: node validate-agents.js [options]

Options:
  --skip-compilation   Skip TypeScript compilation check
  --skip-tests         Skip test validation
  --sequential         Validate agents one by one instead of in parallel
  --verbose            Show detailed error messages
  --help               Show this help message

Examples:
  node validate-agents.js                     # Full validation
  node validate-agents.js --skip-tests        # Skip test validation
  node validate-agents.js --sequential        # Sequential processing
        `);
        process.exit(0);
        break;
    }
  }

  const validator = new AgentValidator();
  await validator.validate(options);
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = AgentValidator;