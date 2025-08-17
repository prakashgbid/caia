#!/usr/bin/env node
/**
 * Claude Code Super Agent - Multi-LLM Decision Making Agent
 * 
 * This agent leverages the SATS SuperIntelligentAgent to provide
 * decision making across ChatGPT, Gemini, and Claude through
 * internal debate and consensus building.
 */

import { SuperIntelligentAgent } from './smart-agents-training-system/src/core/llm-alliance/SuperIntelligentAgent';
import { AgentQuery, CollaborationMode } from './smart-agents-training-system/src/types';
import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';

interface SuperAgentConfig {
  openai: {
    apiKey: string;
    model?: string;
  };
  google: {
    apiKey: string;
    model?: string;
  };
  anthropic: {
    apiKey: string;
    model?: string;
  };
  collaborationMode?: CollaborationMode;
  votingThreshold?: number;
  maxDebateRounds?: number;
}

class ClaudeCodeSuperAgent {
  private agent: SuperIntelligentAgent;
  private config: SuperAgentConfig;
  private rl: readline.Interface;

  constructor() {
    this.loadConfiguration();
    this.initializeAgent();
    this.setupReadline();
    
    console.log('🤖 Claude Code Super Agent initialized');
    console.log('✨ Multi-LLM decision making with ChatGPT, Gemini, and Claude');
    console.log('🧠 Internal debate and consensus building enabled');
    console.log('📊 Type "help" for available commands\n');
  }

  private loadConfiguration(): void {
    const configPath = path.join(process.cwd(), '.claude-super-agent.json');
    const envConfigPath = path.join(process.env.HOME || '~', '.claude-super-agent.json');
    
    // Try to load from project directory first, then home directory
    let configFile = '';
    if (fs.existsSync(configPath)) {
      configFile = configPath;
    } else if (fs.existsSync(envConfigPath)) {
      configFile = envConfigPath;
    } else {
      this.createDefaultConfig(configPath);
      configFile = configPath;
    }

    try {
      const configContent = fs.readFileSync(configFile, 'utf-8');
      this.config = JSON.parse(configContent);
      
      // Override with environment variables if available
      this.config.openai.apiKey = process.env.OPENAI_API_KEY || this.config.openai.apiKey;
      this.config.google.apiKey = process.env.GOOGLE_API_KEY || this.config.google.apiKey;
      this.config.anthropic.apiKey = process.env.ANTHROPIC_API_KEY || this.config.anthropic.apiKey;
      
    } catch (error) {
      console.error('❌ Failed to load configuration:', error.message);
      process.exit(1);
    }
  }

  private createDefaultConfig(configPath: string): void {
    const defaultConfig: SuperAgentConfig = {
      openai: {
        apiKey: process.env.OPENAI_API_KEY || 'your-openai-api-key',
        model: 'gpt-4'
      },
      google: {
        apiKey: process.env.GOOGLE_API_KEY || 'your-google-api-key',
        model: 'gemini-1.5-pro'
      },
      anthropic: {
        apiKey: process.env.ANTHROPIC_API_KEY || 'your-anthropic-api-key',
        model: 'claude-3-5-sonnet-20241022'
      },
      collaborationMode: 'democratic_consensus',
      votingThreshold: 0.7,
      maxDebateRounds: 3
    };

    fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
    console.log(`📁 Created default configuration at: ${configPath}`);
    console.log('🔑 Please update the API keys in the configuration file');
  }

  private initializeAgent(): void {
    try {
      this.agent = new SuperIntelligentAgent({
        providers: {
          openai: this.config.openai,
          google: this.config.google,
          anthropic: this.config.anthropic
        },
        collaborationMode: this.config.collaborationMode || 'democratic_consensus',
        votingThreshold: this.config.votingThreshold || 0.7,
        maxDebateRounds: this.config.maxDebateRounds || 3,
        enableMemory: true,
        enableLearning: true
      });

      // Set up event listeners
      this.agent.on('query:start', (data) => {
        console.log('🔄 Starting multi-LLM analysis...');
      });

      this.agent.on('query:complete', (data) => {
        console.log('✅ Consensus reached');
      });

      this.agent.on('query:error', (data) => {
        console.error('❌ Query failed:', data.error.message);
      });

    } catch (error) {
      console.error('❌ Failed to initialize SuperIntelligentAgent:', error.message);
      process.exit(1);
    }
  }

  private setupReadline(): void {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: '🤖 Super Agent > '
    });

    this.rl.on('line', (line) => {
      this.handleInput(line.trim());
    });

    this.rl.on('close', () => {
      console.log('\n👋 Goodbye!');
      process.exit(0);
    });
  }

  private customContext: string | null = null;

  private async handleInput(input: string): Promise<void> {
    if (!input) {
      this.rl.prompt();
      return;
    }

    const [command, ...args] = input.split(' ');

    switch (command.toLowerCase()) {
      case 'help':
        this.showHelp();
        break;
      case 'ask':
        await this.handleAsk(args.join(' '));
        break;
      case 'decide':
        await this.handleDecision(args.join(' '));
        break;
      case 'debate':
        await this.handleDebate(args.join(' '));
        break;
      case 'context':
        await this.handleContext(args);
        break;
      case 'config':
        await this.handleConfig(args);
        break;
      case 'health':
        await this.healthCheck();
        break;
      case 'metrics':
        this.showMetrics();
        break;
      case 'version':
        this.showVersion();
        break;
      case 'exit':
      case 'quit':
        this.rl.close();
        break;
      default:
        // Treat anything else as a question
        await this.handleAsk(input);
        break;
    }

    this.rl.prompt();
  }

  private showHelp(): void {
    console.log(`
🤖 Claude Code Super Agent Commands:

Core Decision Making:
  ask <question>           - Quick single-best answer (no consensus required)
  decide <question>        - Full consensus decision with internal debate
  debate <question>        - Show detailed debate process and reasoning

Context Management:
  context                  - Show detected project context
  context set "<text>"     - Set custom context for this session
  context clear            - Clear custom context
  context file <path>      - Load context from .claude-context.json file
  context auto             - Re-detect context from current directory

Configuration:
  config                   - Show current configuration
  config mode <mode>       - Set collaboration mode (democratic_consensus, expertise_weighted, hierarchical, debate_synthesis)
  config threshold <0-1>   - Set voting threshold for consensus (e.g., 0.7)
  config rounds <1-10>     - Set maximum debate rounds (e.g., 3)
  config reset             - Reset to default configuration

System Commands:
  health                   - Check health of all LLM providers
  metrics                  - Show system performance metrics
  version                  - Show agent version and info
  help                     - Show this help message
  exit/quit               - Exit the agent

Examples:
  ask "What's the best approach for user authentication?"
  decide "Should we use TypeScript or JavaScript for this project?"
  debate "What database should we choose for a social media app?"
  context set "E-commerce platform, handling 100k+ users, AWS infrastructure"
  config mode expertise_weighted
  config threshold 0.8

🧠 The agent automatically detects your project context from:
   • .claude-context.json files
   • package.json and README.md
   • Technology stack (files & dependencies)
   • Git repository info
   • Project structure patterns

🔧 Supports all major tech stacks: Node.js, Python, Rust, Go, Java, PHP, .NET, etc.
`);
  }

  private async handleAsk(question: string): Promise<void> {
    if (!question) {
      console.log('❓ Please provide a question. Usage: ask <your question>');
      return;
    }

    try {
      console.log('🤔 Asking all models...\n');
      
      const result = await this.agent.query({
        prompt: question,
        requireConsensus: false,
        context: this.getProjectContext()
      });

      console.log('💡 Best Answer:');
      console.log(`${result.decision}\n`);
      
      console.log(`📊 Confidence: ${(result.confidence * 100).toFixed(1)}%`);
      console.log(`🤖 Provided by: ${result.participants[0]}`);
      
      if (result.reasoning) {
        console.log(`💭 Reasoning: ${result.reasoning}`);
      }

      console.log(`\n⚡ Cost: $${result.metadata.totalCost.toFixed(4)} | Tokens: ${result.metadata.totalTokens} | Time: ${result.metadata.processingTime}ms\n`);

    } catch (error) {
      console.error('❌ Failed to process question:', error.message);
    }
  }

  private async handleDecision(question: string): Promise<void> {
    if (!question) {
      console.log('❓ Please provide a decision question. Usage: decide <your question>');
      return;
    }

    try {
      console.log('🏛️ Initiating consensus decision process...\n');
      
      const result = await this.agent.query({
        prompt: question,
        requireConsensus: true,
        context: this.getProjectContext(),
        votingThreshold: this.config.votingThreshold,
        maxDebateRounds: this.config.maxDebateRounds
      });

      console.log('🎯 Consensus Decision:');
      console.log(`${result.decision}\n`);
      
      console.log(`🤝 Agreement Level: ${(result.agreement * 100).toFixed(1)}%`);
      console.log(`📊 Confidence: ${(result.confidence * 100).toFixed(1)}%`);
      console.log(`🔄 Debate Rounds: ${result.metadata.rounds}`);
      console.log(`🤖 Participants: ${result.participants.join(', ')}`);
      
      if (result.reasoning) {
        console.log(`\n💭 Consensus Reasoning:`);
        console.log(result.reasoning);
      }

      if (result.dissenting && result.dissenting.length > 0) {
        console.log(`\n⚠️  Dissenting Views: ${result.dissenting.length} models had reservations`);
      }

      console.log(`\n⚡ Cost: $${result.metadata.totalCost.toFixed(4)} | Tokens: ${result.metadata.totalTokens} | Time: ${result.metadata.processingTime}ms\n`);

    } catch (error) {
      console.error('❌ Failed to process decision:', error.message);
    }
  }

  private async handleDebate(question: string): Promise<void> {
    if (!question) {
      console.log('❓ Please provide a question for debate. Usage: debate <your question>');
      return;
    }

    try {
      console.log('🗣️ Starting public debate session...\n');
      
      const result = await this.agent.query({
        prompt: question,
        requireConsensus: true,
        context: this.getProjectContext(),
        showDebate: true,
        votingThreshold: this.config.votingThreshold,
        maxDebateRounds: this.config.maxDebateRounds
      });

      // Show the debate process
      if (result.debate) {
        console.log('🏛️ Debate Transcript:\n');
        
        result.debate.forEach((round, index) => {
          console.log(`📝 Round ${round.round} (Agreement: ${(round.agreement * 100).toFixed(1)}%)`);
          console.log(`💬 Synthesis: ${round.synthesis}\n`);
          
          round.arguments.forEach((arg, argIndex) => {
            console.log(`   🤖 ${arg.provider}: ${arg.response.substring(0, 200)}...`);
            console.log(`   📊 Confidence: ${(arg.confidence * 100).toFixed(1)}%\n`);
          });
        });
      }

      console.log('🎯 Final Consensus:');
      console.log(`${result.decision}\n`);
      
      console.log(`🤝 Final Agreement: ${(result.agreement * 100).toFixed(1)}%`);
      console.log(`📊 Confidence: ${(result.confidence * 100).toFixed(1)}%`);

      console.log(`\n⚡ Cost: $${result.metadata.totalCost.toFixed(4)} | Tokens: ${result.metadata.totalTokens} | Time: ${result.metadata.processingTime}ms\n`);

    } catch (error) {
      console.error('❌ Failed to process debate:', error.message);
    }
  }

  private async healthCheck(): Promise<void> {
    console.log('🏥 Checking health of all LLM providers...\n');
    
    try {
      const health = await this.agent.healthCheck();
      
      Object.entries(health).forEach(([provider, isHealthy]) => {
        const status = isHealthy ? '✅ Healthy' : '❌ Unhealthy';
        console.log(`${provider.toUpperCase()}: ${status}`);
      });
      
      const totalHealthy = Object.values(health).filter(h => h).length;
      const totalProviders = Object.keys(health).length;
      
      console.log(`\n📊 System Health: ${totalHealthy}/${totalProviders} providers healthy\n`);
      
    } catch (error) {
      console.error('❌ Health check failed:', error.message);
    }
  }

  private showMetrics(): void {
    console.log('📊 System Metrics:\n');
    
    const metrics = this.agent.getMetrics();
    
    console.log(`🤖 Active Providers: ${metrics.providers.join(', ')}`);
    console.log(`🤝 Collaboration Mode: ${metrics.collaborationMode}`);
    console.log(`🎯 Voting Threshold: ${metrics.config.votingThreshold}`);
    console.log(`🔄 Max Debate Rounds: ${metrics.config.maxDebateRounds}`);
    console.log(`🧠 Memory Enabled: ${metrics.config.enableMemory ? 'Yes' : 'No'}`);
    console.log(`📚 Learning Enabled: ${metrics.config.enableLearning ? 'Yes' : 'No'}`);
    console.log();
  }

  private async handleContext(args: string[]): Promise<void> {
    const [subcommand, ...rest] = args;

    switch (subcommand?.toLowerCase()) {
      case 'set':
        this.customContext = rest.join(' ').replace(/^["']|["']$/g, ''); // Remove quotes
        console.log(`✅ Custom context set: ${this.customContext}`);
        break;
      
      case 'clear':
        this.customContext = null;
        console.log('✅ Custom context cleared');
        break;
      
      case 'file':
        const filePath = rest[0] || '.claude-context.json';
        try {
          const fullPath = path.resolve(filePath);
          if (fs.existsSync(fullPath)) {
            const contextData = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
            this.customContext = this.formatContextFromFile(contextData);
            console.log(`✅ Context loaded from: ${filePath}`);
            console.log(`📋 Context: ${this.customContext}`);
          } else {
            console.log(`❌ Context file not found: ${filePath}`);
          }
        } catch (error) {
          console.log(`❌ Failed to load context file: ${error.message}`);
        }
        break;
      
      case 'auto':
        this.customContext = null; // Clear custom context to force auto-detection
        const detectedContext = this.detectProjectContext();
        console.log(`🔄 Auto-detected context: ${detectedContext || 'None detected'}`);
        break;
      
      default:
        // Show current context
        const currentContext = this.getProjectContext();
        console.log('📋 Current Project Context:');
        if (this.customContext) {
          console.log(`🎯 Custom: ${this.customContext}`);
        }
        if (currentContext) {
          console.log(`🤖 Detected: ${currentContext}`);
        }
        if (!this.customContext && !currentContext) {
          console.log('❓ No context detected. Use "context set" to add custom context.');
        }
        break;
    }
  }

  private async handleConfig(args: string[]): Promise<void> {
    const [subcommand, value] = args;

    switch (subcommand?.toLowerCase()) {
      case 'mode':
        if (value && ['democratic_consensus', 'expertise_weighted', 'hierarchical', 'debate_synthesis'].includes(value)) {
          this.config.collaborationMode = value as CollaborationMode;
          this.agent.collaborationMode = value as CollaborationMode;
          console.log(`✅ Collaboration mode set to: ${value}`);
        } else {
          console.log('❌ Invalid mode. Options: democratic_consensus, expertise_weighted, hierarchical, debate_synthesis');
        }
        break;
      
      case 'threshold':
        const threshold = parseFloat(value);
        if (!isNaN(threshold) && threshold >= 0 && threshold <= 1) {
          this.config.votingThreshold = threshold;
          console.log(`✅ Voting threshold set to: ${threshold}`);
        } else {
          console.log('❌ Invalid threshold. Must be a number between 0 and 1 (e.g., 0.7)');
        }
        break;
      
      case 'rounds':
        const rounds = parseInt(value);
        if (!isNaN(rounds) && rounds >= 1 && rounds <= 10) {
          this.config.maxDebateRounds = rounds;
          console.log(`✅ Max debate rounds set to: ${rounds}`);
        } else {
          console.log('❌ Invalid rounds. Must be a number between 1 and 10');
        }
        break;
      
      case 'reset':
        this.config.collaborationMode = 'democratic_consensus';
        this.config.votingThreshold = 0.7;
        this.config.maxDebateRounds = 3;
        console.log('✅ Configuration reset to defaults');
        break;
      
      default:
        this.showConfig();
        break;
    }
  }

  private showVersion(): void {
    console.log('🤖 Claude Code Super Agent v1.0.0');
    console.log('⚡ Multi-LLM decision making with ChatGPT, Gemini & Claude');
    console.log('🏗️  Built on SATS (Smart Agents Training System)');
    console.log('🔗 Universal context detection for any project');
    console.log();
  }

  private showConfig(): void {
    console.log('⚙️  Current Configuration:\n');
    
    const safeConfig = {
      ...this.config,
      openai: { ...this.config.openai, apiKey: '***' },
      google: { ...this.config.google, apiKey: '***' },
      anthropic: { ...this.config.anthropic, apiKey: '***' }
    };
    
    console.log(JSON.stringify(safeConfig, null, 2));
    console.log();
  }

  private getProjectContext(): string {
    // Prioritize custom context set in the session
    if (this.customContext) {
      return `Context: ${this.customContext}`;
    }
    
    return this.detectProjectContext() || this.loadCustomContext() || '';
  }

  /**
   * Dynamically detect project context from various sources
   */
  private detectProjectContext(): string | null {
    const cwd = process.cwd();
    const contextSources = [];

    // 1. Check for .claude-context.json file
    const localContextFile = path.join(cwd, '.claude-context.json');
    if (fs.existsSync(localContextFile)) {
      try {
        const contextData = JSON.parse(fs.readFileSync(localContextFile, 'utf-8'));
        return this.formatContextFromFile(contextData);
      } catch (error) {
        console.warn('⚠️  Failed to parse .claude-context.json');
      }
    }

    // 2. Check package.json for project info
    const packageJsonPath = path.join(cwd, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
        contextSources.push(this.extractContextFromPackageJson(packageJson));
      } catch (error) {
        // Ignore package.json parsing errors
      }
    }

    // 3. Check README files for project description
    const readmeFiles = ['README.md', 'README.txt', 'readme.md', 'Readme.md'];
    for (const readmeFile of readmeFiles) {
      const readmePath = path.join(cwd, readmeFile);
      if (fs.existsSync(readmePath)) {
        try {
          const readmeContent = fs.readFileSync(readmePath, 'utf-8');
          const description = this.extractDescriptionFromReadme(readmeContent);
          if (description) {
            contextSources.push(`Project: ${description}`);
          }
          break;
        } catch (error) {
          // Ignore readme parsing errors
        }
      }
    }

    // 4. Detect technology stack from files
    const techStack = this.detectTechnologyStack(cwd);
    if (techStack.length > 0) {
      contextSources.push(`Tech Stack: ${techStack.join(', ')}`);
    }

    // 5. Check git repository info
    const gitInfo = this.getGitRepositoryInfo(cwd);
    if (gitInfo) {
      contextSources.push(gitInfo);
    }

    // 6. Detect project type from directory structure
    const projectType = this.detectProjectType(cwd);
    if (projectType) {
      contextSources.push(`Project Type: ${projectType}`);
    }

    return contextSources.length > 0 ? 
      `Context: ${contextSources.join(' | ')}` : 
      null;
  }

  private formatContextFromFile(contextData: any): string {
    const parts = [];
    
    if (contextData.name) parts.push(`Project: ${contextData.name}`);
    if (contextData.description) parts.push(`Description: ${contextData.description}`);
    if (contextData.domain) parts.push(`Domain: ${contextData.domain}`);
    if (contextData.techStack) parts.push(`Tech: ${contextData.techStack.join(', ')}`);
    if (contextData.phase) parts.push(`Phase: ${contextData.phase}`);
    if (contextData.priorities) parts.push(`Priorities: ${contextData.priorities.join(', ')}`);
    
    return parts.length > 0 ? `Context: ${parts.join(' | ')}` : '';
  }

  private extractContextFromPackageJson(packageJson: any): string {
    const parts = [];
    
    if (packageJson.name) parts.push(`Project: ${packageJson.name}`);
    if (packageJson.description) parts.push(`Description: ${packageJson.description}`);
    
    // Infer tech stack from dependencies
    const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
    const frameworks = [];
    
    if (deps.react) frameworks.push('React');
    if (deps.vue) frameworks.push('Vue');
    if (deps.angular) frameworks.push('Angular');
    if (deps.next) frameworks.push('Next.js');
    if (deps.express) frameworks.push('Express');
    if (deps.fastify) frameworks.push('Fastify');
    if (deps.typescript) frameworks.push('TypeScript');
    
    if (frameworks.length > 0) {
      parts.push(`Tech: ${frameworks.join(', ')}`);
    }
    
    return parts.join(' | ');
  }

  private extractDescriptionFromReadme(content: string): string | null {
    // Extract first substantial paragraph or project title
    const lines = content.split('\n').filter(line => line.trim());
    
    // Look for project title (first # heading)
    const titleMatch = content.match(/^#\s+(.+)$/m);
    if (titleMatch) {
      return titleMatch[1];
    }
    
    // Look for description section
    const descMatch = content.match(/##\s*(?:Description|About|Overview)\s*\n\n?(.+?)(?:\n\n|$)/s);
    if (descMatch) {
      return descMatch[1].trim().split('\n')[0];
    }
    
    // Use first substantial non-heading line
    for (const line of lines) {
      if (!line.startsWith('#') && !line.startsWith('!') && line.length > 20) {
        return line.substring(0, 100) + (line.length > 100 ? '...' : '');
      }
    }
    
    return null;
  }

  private detectTechnologyStack(cwd: string): string[] {
    const techStack = [];
    
    // Check for config files
    const configFiles = {
      'tsconfig.json': 'TypeScript',
      'package.json': 'Node.js',
      'requirements.txt': 'Python',
      'Pipfile': 'Python',
      'pyproject.toml': 'Python',
      'Cargo.toml': 'Rust',
      'go.mod': 'Go',
      'pom.xml': 'Java/Maven',
      'build.gradle': 'Java/Gradle',
      'Gemfile': 'Ruby',
      'composer.json': 'PHP',
      '.csproj': '.NET',
      'mix.exs': 'Elixir',
      'pubspec.yaml': 'Dart/Flutter'
    };
    
    for (const [file, tech] of Object.entries(configFiles)) {
      if (fs.existsSync(path.join(cwd, file))) {
        techStack.push(tech);
      }
    }
    
    // Check for framework-specific files
    const frameworkFiles = {
      'next.config.js': 'Next.js',
      'nuxt.config.js': 'Nuxt.js',
      'angular.json': 'Angular',
      'vue.config.js': 'Vue.js',
      'svelte.config.js': 'Svelte',
      'remix.config.js': 'Remix',
      'gatsby-config.js': 'Gatsby',
      'vite.config.js': 'Vite',
      'webpack.config.js': 'Webpack',
      'rollup.config.js': 'Rollup'
    };
    
    for (const [file, framework] of Object.entries(frameworkFiles)) {
      if (fs.existsSync(path.join(cwd, file))) {
        techStack.push(framework);
      }
    }
    
    return [...new Set(techStack)]; // Remove duplicates
  }

  private getGitRepositoryInfo(cwd: string): string | null {
    try {
      const gitConfigPath = path.join(cwd, '.git', 'config');
      if (fs.existsSync(gitConfigPath)) {
        const gitConfig = fs.readFileSync(gitConfigPath, 'utf-8');
        const urlMatch = gitConfig.match(/url = (.+)/);
        if (urlMatch) {
          const url = urlMatch[1];
          const repoMatch = url.match(/([^\/]+\/[^\/]+)(?:\.git)?$/);
          if (repoMatch) {
            return `Repository: ${repoMatch[1]}`;
          }
        }
      }
    } catch (error) {
      // Ignore git info errors
    }
    return null;
  }

  private detectProjectType(cwd: string): string | null {
    // Check for common project patterns
    const indicators = {
      'Web App': ['src/pages', 'pages', 'app', 'public/index.html'],
      'API/Backend': ['src/routes', 'src/controllers', 'api', 'server.js', 'app.py'],
      'Library/Package': ['src/index.ts', 'lib', 'dist', 'build'],
      'Mobile App': ['android', 'ios', 'mobile', 'App.js', 'App.tsx'],
      'Desktop App': ['electron', 'main.js', 'src-tauri'],
      'CLI Tool': ['bin', 'cli.js', 'command.js'],
      'Documentation': ['docs', 'documentation', '_book'],
      'Monorepo': ['packages', 'apps', 'lerna.json', 'nx.json'],
      'Machine Learning': ['models', 'notebooks', 'data', 'train.py'],
      'Game': ['assets', 'sprites', 'scenes', 'unity', 'godot']
    };
    
    for (const [type, paths] of Object.entries(indicators)) {
      if (paths.some(p => fs.existsSync(path.join(cwd, p)))) {
        return type;
      }
    }
    
    return null;
  }

  /**
   * Load custom context from global config or environment
   */
  private loadCustomContext(): string | null {
    // Check environment variable for custom context
    if (process.env.CLAUDE_AGENT_CONTEXT) {
      return `Context: ${process.env.CLAUDE_AGENT_CONTEXT}`;
    }
    
    return null;
  }

  public start(): void {
    console.log('🚀 Claude Code Super Agent is ready for your questions!\n');
    this.rl.prompt();
  }
}

// CLI Entry Point
if (require.main === module) {
  const agent = new ClaudeCodeSuperAgent();
  agent.start();
}

export { ClaudeCodeSuperAgent };