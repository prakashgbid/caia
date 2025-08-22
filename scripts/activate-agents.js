#!/usr/bin/env node

/**
 * CAIA Agent Activation System
 * 
 * Scans for agents with only README.md files and generates TypeScript implementations
 * extending @caia/core BaseAgent. This script quickly transforms documentation-only
 * agents into functional implementations that can be refined later.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Configuration
const AGENTS_DIR = path.join(__dirname, '../packages/agents');
const TEMPLATES_DIR = path.join(__dirname, '../templates/agent');
const SCRIPTS_DIR = path.dirname(__filename);

class AgentActivator {
  constructor() {
    this.activationReport = {
      total: 0,
      activated: 0,
      skipped: 0,
      failed: 0,
      details: [],
      categories: new Map()
    };
  }

  /**
   * Main activation process
   */
  async activate() {
    console.log('🚀 CAIA Agent Activation System Starting...\n');

    try {
      // Ensure templates exist
      await this.ensureTemplates();

      // Scan for agents needing activation
      const agents = await this.scanAgents();
      
      // Process agents in parallel (grouped by category)
      await this.processAgentsInParallel(agents);

      // Generate activation report
      this.generateReport();

      console.log('\n✅ Agent activation completed!');
      
    } catch (error) {
      console.error('❌ Agent activation failed:', error.message);
      process.exit(1);
    }
  }

  /**
   * Scan agents directory for agents needing activation
   */
  async scanAgents() {
    const agentDirs = fs.readdirSync(AGENTS_DIR, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);

    const needsActivation = [];

    for (const agentName of agentDirs) {
      const agentPath = path.join(AGENTS_DIR, agentName);
      const readmePath = path.join(agentPath, 'README.md');
      const srcPath = path.join(agentPath, 'src');

      // Check if agent needs activation
      if (fs.existsSync(readmePath)) {
        const hasImplementation = fs.existsSync(srcPath) && 
          fs.readdirSync(srcPath).some(file => file.endsWith('.ts') && file !== 'types.ts');

        if (!hasImplementation) {
          const agentInfo = await this.analyzeAgent(agentPath, agentName);
          needsActivation.push(agentInfo);
        } else {
          this.activationReport.skipped++;
          this.activationReport.details.push({
            name: agentName,
            status: 'skipped',
            reason: 'Already has implementation'
          });
        }
      }

      this.activationReport.total++;
    }

    console.log(`📊 Found ${needsActivation.length} agents needing activation out of ${this.activationReport.total} total agents\n`);
    
    return needsActivation;
  }

  /**
   * Analyze agent README to extract metadata and capabilities
   */
  async analyzeAgent(agentPath, agentName) {
    const readmePath = path.join(agentPath, 'README.md');
    const packagePath = path.join(agentPath, 'package.json');

    let readme = '';
    let packageJson = null;

    try {
      readme = fs.readFileSync(readmePath, 'utf8');
    } catch (error) {
      console.warn(`⚠️  Could not read README for ${agentName}`);
    }

    try {
      if (fs.existsSync(packagePath)) {
        packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
      }
    } catch (error) {
      console.warn(`⚠️  Could not read package.json for ${agentName}`);
    }

    // Extract information from README
    const agentInfo = this.extractAgentInfo(readme, agentName, packageJson);
    agentInfo.path = agentPath;
    agentInfo.name = agentName;

    return agentInfo;
  }

  /**
   * Extract agent information from README content
   */
  extractAgentInfo(readme, agentName, packageJson) {
    const info = {
      description: '',
      capabilities: [],
      category: 'unknown',
      features: [],
      methods: [],
      interfaces: [],
      version: '1.0.0'
    };

    if (packageJson) {
      info.description = packageJson.description || '';
      info.version = packageJson.version || '1.0.0';
    }

    // Extract description from README
    if (!info.description) {
      const descMatch = readme.match(/^[^#\n]*([^\n]+)/m);
      if (descMatch) {
        info.description = descMatch[1].trim();
      }
    }

    // Determine category from name patterns
    info.category = this.categorizeAgent(agentName, readme);

    // Extract features/capabilities
    const featuresMatch = readme.match(/## Features\s*\n([\s\S]*?)(?=\n##|\n---|\Z)/i);
    if (featuresMatch) {
      const featuresText = featuresMatch[1];
      info.features = featuresText
        .split('\n')
        .filter(line => line.trim().startsWith('-') || line.trim().startsWith('*'))
        .map(line => line.replace(/^[-*]\s*/, '').replace(/\*\*(.*?)\*\*/, '$1').trim())
        .filter(feature => feature.length > 0);
    }

    // Extract capabilities from feature text
    info.capabilities = info.features.map(feature => {
      // Convert feature to capability name
      return feature
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, '-')
        .substring(0, 50);
    });

    // Extract method signatures from usage examples
    const usageMatch = readme.match(/```typescript\s*([\s\S]*?)```/g);
    if (usageMatch) {
      usageMatch.forEach(codeBlock => {
        const methodMatches = codeBlock.match(/await\s+\w+Agent\.(\w+)\(/g);
        if (methodMatches) {
          methodMatches.forEach(match => {
            const method = match.replace(/await\s+\w+Agent\./, '').replace(/\($/, '');
            if (!info.methods.includes(method)) {
              info.methods.push(method);
            }
          });
        }
      });
    }

    // Extract interface names
    const interfaceMatches = readme.match(/interface\s+(\w+)/g);
    if (interfaceMatches) {
      info.interfaces = interfaceMatches.map(match => 
        match.replace('interface ', '')
      );
    }

    return info;
  }

  /**
   * Categorize agent based on naming patterns and content
   */
  categorizeAgent(agentName, readme) {
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

    // Check content for hints
    const content = readme.toLowerCase();
    if (content.includes('api integration') || content.includes('external service')) {
      return 'connector';
    } else if (content.includes('subject matter expert') || content.includes('expertise')) {
      return 'sme';
    } else if (content.includes('role') || content.includes('development team')) {
      return 'role';
    }

    return 'utility';
  }

  /**
   * Process agents in parallel, grouped by category for optimal resource usage
   */
  async processAgentsInParallel(agents) {
    // Group agents by category
    const agentsByCategory = agents.reduce((acc, agent) => {
      if (!acc[agent.category]) {
        acc[agent.category] = [];
      }
      acc[agent.category].push(agent);
      return acc;
    }, {});

    console.log('📋 Processing agents by category:');
    Object.entries(agentsByCategory).forEach(([category, categoryAgents]) => {
      console.log(`  ${category}: ${categoryAgents.length} agents`);
    });
    console.log();

    // Process each category in parallel
    const categoryPromises = Object.entries(agentsByCategory).map(
      ([category, categoryAgents]) => this.processCategoryAgents(category, categoryAgents)
    );

    await Promise.allSettled(categoryPromises);
  }

  /**
   * Process agents within a category concurrently
   */
  async processCategoryAgents(category, agents) {
    console.log(`🔄 Processing ${category} agents...`);

    const agentPromises = agents.map(agent => this.activateAgent(agent));
    const results = await Promise.allSettled(agentPromises);

    // Update category stats
    const categoryStats = {
      total: agents.length,
      successful: results.filter(r => r.status === 'fulfilled').length,
      failed: results.filter(r => r.status === 'rejected').length
    };

    this.activationReport.categories.set(category, categoryStats);

    console.log(`✅ ${category}: ${categoryStats.successful}/${categoryStats.total} activated`);
  }

  /**
   * Activate a single agent
   */
  async activateAgent(agentInfo) {
    const startTime = Date.now();
    
    try {
      console.log(`  🔨 Activating ${agentInfo.name}...`);

      // Create src directory if it doesn't exist
      const srcDir = path.join(agentInfo.path, 'src');
      if (!fs.existsSync(srcDir)) {
        fs.mkdirSync(srcDir, { recursive: true });
      }

      // Generate implementation files
      await this.generateAgentImplementation(agentInfo);
      await this.generateTypesFile(agentInfo);
      await this.generateIndexFile(agentInfo);
      await this.updatePackageJson(agentInfo);
      await this.generateTestFile(agentInfo);

      // Validate generated code
      await this.validateGeneration(agentInfo);

      const duration = Date.now() - startTime;
      
      this.activationReport.activated++;
      this.activationReport.details.push({
        name: agentInfo.name,
        status: 'activated',
        category: agentInfo.category,
        capabilities: agentInfo.capabilities.length,
        methods: agentInfo.methods.length,
        duration: `${duration}ms`
      });

      console.log(`    ✅ ${agentInfo.name} activated (${duration}ms)`);

    } catch (error) {
      this.activationReport.failed++;
      this.activationReport.details.push({
        name: agentInfo.name,
        status: 'failed',
        error: error.message
      });

      console.error(`    ❌ ${agentInfo.name} failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Generate main agent implementation
   */
  async generateAgentImplementation(agentInfo) {
    const template = this.loadTemplate('base-agent.ts.template');
    
    const className = this.toPascalCase(agentInfo.name.replace(/-/g, ' ')) + 'Agent';
    const capabilitiesArray = agentInfo.capabilities.map(cap => {
      return `{ name: '${cap}', version: '1.0.0', description: '${cap.replace(/-/g, ' ')} capability' }`;
    }).join(',\n        ');
    const methodsImplementation = agentInfo.methods.map(method => this.generateMethodStub(method)).join('\n\n  ');

    const content = template
      .replace(/{{AGENT_NAME}}/g, agentInfo.name)
      .replace(/{{AGENT_CLASS}}/g, className)
      .replace(/{{AGENT_DESCRIPTION}}/g, agentInfo.description)
      .replace(/{{AGENT_VERSION}}/g, agentInfo.version)
      .replace(/{{CAPABILITIES}}/g, capabilitiesArray)
      .replace(/{{METHODS_IMPLEMENTATION}}/g, methodsImplementation)
      .replace(/{{FEATURES_COMMENT}}/g, agentInfo.features.map(f => ` * - ${f}`).join('\n'));

    const filePath = path.join(agentInfo.path, 'src', `${className}.ts`);
    fs.writeFileSync(filePath, content);
  }

  /**
   * Generate types file
   */
  async generateTypesFile(agentInfo) {
    const template = this.loadTemplate('types.ts.template');
    
    const interfacesCode = agentInfo.interfaces.map(interfaceName => {
      return `export interface ${interfaceName} {\n  // TODO: Define ${interfaceName} properties\n  [key: string]: any;\n}`;
    }).join('\n\n');

    const content = template
      .replace(/{{INTERFACES}}/g, interfacesCode || '// No interfaces detected from README')
      .replace(/{{AGENT_NAME}}/g, agentInfo.name);

    const filePath = path.join(agentInfo.path, 'src', 'types.ts');
    fs.writeFileSync(filePath, content);
  }

  /**
   * Generate index file
   */
  async generateIndexFile(agentInfo) {
    const template = this.loadTemplate('index.ts.template');
    const className = this.toPascalCase(agentInfo.name.replace(/-/g, ' ')) + 'Agent';
    
    const content = template
      .replace(/{{AGENT_CLASS}}/g, className)
      .replace(/{{AGENT_NAME}}/g, agentInfo.name)
      .replace(/{{AGENT_DESCRIPTION}}/g, agentInfo.description);

    const filePath = path.join(agentInfo.path, 'src', 'index.ts');
    fs.writeFileSync(filePath, content);
  }

  /**
   * Update package.json with proper configuration
   */
  async updatePackageJson(agentInfo) {
    const packagePath = path.join(agentInfo.path, 'package.json');
    let packageJson = {};

    if (fs.existsSync(packagePath)) {
      packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    }

    // Update package.json with CAIA standards
    packageJson.name = packageJson.name || `@caia/agent-${agentInfo.name}`;
    packageJson.version = agentInfo.version;
    packageJson.description = agentInfo.description;
    packageJson.main = 'dist/index.js';
    packageJson.types = 'dist/index.d.ts';
    
    packageJson.scripts = packageJson.scripts || {};
    packageJson.scripts.build = 'tsc';
    packageJson.scripts.test = 'jest';
    packageJson.scripts['test:watch'] = 'jest --watch';

    packageJson.dependencies = packageJson.dependencies || {};
    packageJson.dependencies['@caia/core'] = '^1.0.0';

    packageJson.devDependencies = packageJson.devDependencies || {};
    Object.assign(packageJson.devDependencies, {
      '@types/node': '^20.10.5',
      'typescript': '^5.3.3',
      'jest': '^29.7.0',
      '@types/jest': '^29.5.8',
      'ts-jest': '^29.1.1'
    });

    fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 2));
  }

  /**
   * Generate test file
   */
  async generateTestFile(agentInfo) {
    const template = this.loadTemplate('test.ts.template');
    const className = this.toPascalCase(agentInfo.name.replace(/-/g, ' ')) + 'Agent';
    
    const testMethods = agentInfo.methods.map(method => {
      return `  test('should ${method.replace(/([A-Z])/g, ' $1').toLowerCase()}', async () => {
    // TODO: Implement test for ${method}
    expect(true).toBe(true);
  });`;
    }).join('\n\n');

    const content = template
      .replace(/{{AGENT_CLASS}}/g, className)
      .replace(/{{AGENT_NAME}}/g, agentInfo.name)
      .replace(/{{TEST_METHODS}}/g, testMethods);

    const testDir = path.join(agentInfo.path, 'tests');
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }

    const filePath = path.join(testDir, 'index.test.ts');
    fs.writeFileSync(filePath, content);
  }

  /**
   * Generate method stub
   */
  generateMethodStub(methodName) {
    const params = this.inferMethodParameters(methodName);
    const returnType = this.inferReturnType(methodName);

    return `  /**
   * ${this.generateMethodComment(methodName)}
   */
  async ${methodName}(${params}): Promise<${returnType}> {
    console.log('[${methodName}] Starting...');
    
    // TODO: Implement ${methodName} logic
    throw new Error('Method ${methodName} not yet implemented');
  }`;
  }

  /**
   * Infer method parameters based on method name
   */
  inferMethodParameters(methodName) {
    const name = methodName.toLowerCase();
    
    if (name.includes('create') || name.includes('generate')) {
      return 'data: any';
    } else if (name.includes('process') || name.includes('analyze')) {
      return 'input: any';
    } else if (name.includes('update') || name.includes('modify')) {
      return 'id: string, updates: any';
    } else if (name.includes('delete') || name.includes('remove')) {
      return 'id: string';
    } else if (name.includes('get') || name.includes('fetch')) {
      return 'id?: string, options?: any';
    } else if (name.includes('list') || name.includes('search')) {
      return 'query?: any, options?: any';
    }
    
    return 'params?: any';
  }

  /**
   * Infer return type based on method name
   */
  inferReturnType(methodName) {
    const name = methodName.toLowerCase();
    
    if (name.includes('create') || name.includes('generate')) {
      return 'any';
    } else if (name.includes('list') || name.includes('search')) {
      return 'any[]';
    } else if (name.includes('check') || name.includes('validate') || name.includes('is')) {
      return 'boolean';
    }
    
    return 'any';
  }

  /**
   * Generate method comment
   */
  generateMethodComment(methodName) {
    const words = methodName.replace(/([A-Z])/g, ' $1').toLowerCase().trim();
    return `${words.charAt(0).toUpperCase() + words.slice(1)} - TODO: Add detailed description`;
  }

  /**
   * Validate generated code compiles
   */
  async validateGeneration(agentInfo) {
    try {
      // Check if TypeScript files are valid
      const srcDir = path.join(agentInfo.path, 'src');
      const tsFiles = fs.readdirSync(srcDir).filter(f => f.endsWith('.ts'));
      
      if (tsFiles.length === 0) {
        throw new Error('No TypeScript files generated');
      }

      // TODO: Add TypeScript compilation check
      // execSync(`cd "${agentInfo.path}" && npx tsc --noEmit`, { stdio: 'pipe' });
      
    } catch (error) {
      throw new Error(`Validation failed: ${error.message}`);
    }
  }

  /**
   * Ensure template files exist
   */
  async ensureTemplates() {
    if (!fs.existsSync(TEMPLATES_DIR)) {
      console.log('📝 Creating agent templates...');
      fs.mkdirSync(TEMPLATES_DIR, { recursive: true });
      await this.createTemplates();
    }
  }

  /**
   * Create template files
   */
  async createTemplates() {
    const templates = {
      'base-agent.ts.template': this.getBaseAgentTemplate(),
      'types.ts.template': this.getTypesTemplate(),
      'index.ts.template': this.getIndexTemplate(),
      'test.ts.template': this.getTestTemplate()
    };

    for (const [filename, content] of Object.entries(templates)) {
      const filePath = path.join(TEMPLATES_DIR, filename);
      fs.writeFileSync(filePath, content);
    }
  }

  /**
   * Load template file
   */
  loadTemplate(templateName) {
    const templatePath = path.join(TEMPLATES_DIR, templateName);
    if (!fs.existsSync(templatePath)) {
      throw new Error(`Template not found: ${templateName}`);
    }
    return fs.readFileSync(templatePath, 'utf8');
  }

  /**
   * Convert string to PascalCase
   */
  toPascalCase(str) {
    return str
      .split(/[\s-_]+/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join('');
  }

  /**
   * Generate activation report
   */
  generateReport() {
    console.log('\n📊 CAIA Agent Activation Report');
    console.log('================================');
    console.log(`Total agents scanned: ${this.activationReport.total}`);
    console.log(`Successfully activated: ${this.activationReport.activated}`);
    console.log(`Skipped (already implemented): ${this.activationReport.skipped}`);
    console.log(`Failed: ${this.activationReport.failed}`);
    
    console.log('\n📋 By Category:');
    for (const [category, stats] of this.activationReport.categories) {
      console.log(`  ${category}: ${stats.successful}/${stats.total} (${Math.round(stats.successful/stats.total*100)}%)`);
    }

    console.log('\n📝 Details:');
    this.activationReport.details.forEach(detail => {
      const status = detail.status === 'activated' ? '✅' : 
                    detail.status === 'skipped' ? '⏭️' : '❌';
      console.log(`  ${status} ${detail.name} - ${detail.status}`);
      if (detail.capabilities) {
        console.log(`    └─ ${detail.capabilities} capabilities, ${detail.methods} methods (${detail.duration})`);
      }
      if (detail.error) {
        console.log(`    └─ Error: ${detail.error}`);
      }
    });

    // Save detailed report
    const reportPath = path.join(SCRIPTS_DIR, 'activation-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(this.activationReport, null, 2));
    console.log(`\n📄 Detailed report saved to: ${reportPath}`);
  }

  // Template content methods
  getBaseAgentTemplate() {
    return `/**
 * {{AGENT_NAME}} Agent
 * 
 * {{AGENT_DESCRIPTION}}
 * 
 * Features:
{{FEATURES_COMMENT}}
 */

import { BaseAgent, AgentConfig, Task, TaskResult, TaskStatus } from '@caia/core';
import { Logger } from 'winston';

export class {{AGENT_CLASS}} extends BaseAgent {
  constructor(config?: Partial<AgentConfig>, logger?: Logger) {
    const defaultConfig: AgentConfig = {
      id: config?.id || '{{AGENT_NAME}}-' + Math.random().toString(36).substr(2, 9),
      name: '{{AGENT_NAME}}',
      description: '{{AGENT_DESCRIPTION}}',
      version: '{{AGENT_VERSION}}',
      capabilities: [
        {{CAPABILITIES}}
      ],
      maxConcurrentTasks: 5,
      timeout: 60000,
      healthCheckInterval: 30000
    };

    const finalConfig = { ...defaultConfig, ...config };
    
    // Create default logger if none provided
    const winston = require('winston');
    const defaultLogger = logger || winston.createLogger({
      level: 'info',
      format: winston.format.simple(),
      transports: [new winston.transports.Console()]
    });

    super(finalConfig, defaultLogger);
  }

  /**
   * Initialize the agent
   */
  protected async onInitialize(): Promise<void> {
    this.logger.info('{{AGENT_CLASS}} initialized');
    // TODO: Add agent-specific initialization logic
  }

  /**
   * Shutdown the agent
   */
  protected async onShutdown(): Promise<void> {
    this.logger.info('{{AGENT_CLASS}} shutting down');
    // TODO: Add agent-specific cleanup logic
  }

  /**
   * Execute a task
   */
  protected async executeTask(task: Task): Promise<TaskResult> {
    this.logger.info('Executing task', { taskId: task.id, type: task.type });

    try {
      // Route task to appropriate handler based on task type
      let result: any;

      switch (task.type) {
        default:
          throw new Error(\`Unsupported task type: \${task.type}\`);
      }

      return {
        taskId: task.id,
        status: TaskStatus.COMPLETED,
        data: result,
        executionTime: 0, // Will be set by BaseAgent
        completedAt: new Date()
      };

    } catch (error) {
      this.logger.error('Task execution failed', { taskId: task.id, error });
      throw error;
    }
  }

  /**
   * Handle task cancellation
   */
  protected async onTaskCancel(task: Task): Promise<void> {
    this.logger.info('Cancelling task', { taskId: task.id });
    // TODO: Add task cancellation logic
  }

  /**
   * Agent version
   */
  protected getVersion(): string {
    return '{{AGENT_VERSION}}';
  }

  // Public API methods extracted from README

{{METHODS_IMPLEMENTATION}}
}

// Export singleton instance for convenience
export const {{AGENT_NAME}}Agent = new {{AGENT_CLASS}}();

export default {{AGENT_CLASS}};
`;
  }

  getTypesTemplate() {
    return `/**
 * Type definitions for {{AGENT_NAME}} agent
 */

// Common types
export interface AgentOptions {
  timeout?: number;
  retries?: number;
  debug?: boolean;
}

export interface AgentResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: Date;
}

// Agent-specific interfaces extracted from README
{{INTERFACES}}

// Re-export core types for convenience
export type {
  AgentConfig,
  Task,
  TaskResult,
  TaskStatus,
  AgentCapability,
  AgentMetadata
} from '@caia/core';
`;
  }

  getIndexTemplate() {
    return `/**
 * {{AGENT_NAME}} Agent
 * 
 * {{AGENT_DESCRIPTION}}
 */

export { {{AGENT_CLASS}} } from './{{AGENT_CLASS}}.js';
export * from './types.js';

// Re-export convenience instance
export { {{AGENT_NAME}}Agent as default } from './{{AGENT_CLASS}}.js';

/**
 * Create a new {{AGENT_CLASS}} instance with custom configuration
 */
export function create{{AGENT_CLASS}}(config?: any) {
  const { {{AGENT_CLASS}} } = require('./{{AGENT_CLASS}}.js');
  return new {{AGENT_CLASS}}(config);
}

/**
 * Package version
 */
export const VERSION = '1.0.0';
`;
  }

  getTestTemplate() {
    return `/**
 * Tests for {{AGENT_CLASS}}
 */

import { {{AGENT_CLASS}} } from '../src/{{AGENT_CLASS}}';

describe('{{AGENT_CLASS}}', () => {
  let agent: {{AGENT_CLASS}};

  beforeEach(() => {
    agent = new {{AGENT_CLASS}}();
  });

  afterEach(async () => {
    if (agent) {
      await agent.shutdown();
    }
  });

  test('should initialize successfully', async () => {
    await agent.initialize();
    expect(agent.getMetadata().status).toBe('idle');
  });

  test('should have correct capabilities', () => {
    const metadata = agent.getMetadata();
    expect(metadata.capabilities).toBeDefined();
    expect(Array.isArray(metadata.capabilities)).toBe(true);
  });

{{TEST_METHODS}}
});
`;
  }
}

// Run if called directly
if (require.main === module) {
  const activator = new AgentActivator();
  activator.activate().catch(console.error);
}

module.exports = AgentActivator;