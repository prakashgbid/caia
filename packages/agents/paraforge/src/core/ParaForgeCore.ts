/**
 * ParaForge Core - Main orchestration class
 */

import { AgentOrchestrator } from '../agents/AgentOrchestrator';
import { SynthesisEngine } from '../synthesis/SynthesisEngine';
import { ParallelizationOptimizer } from '../optimizer/ParallelizationOptimizer';
import { JiraConnector } from '../agents/JiraConnectWrapper';
import { LearningSystem } from '../learning/LearningSystem';
import { logger } from '../utils/logger';

export interface ParaForgeConfig {
  jira: {
    host: string;
    email: string;
    apiToken: string;
  };
  ai?: {
    openai?: string;
    anthropic?: string;
    gemini?: string;
  };
  learning?: {
    enabled: boolean;
    databaseUrl?: string;
  };
}

export interface ProjectIdea {
  description: string;
  constraints?: {
    timeline?: string;
    team?: string[];
    technology?: string[];
    budget?: number;
  };
  context?: Record<string, any>;
}

export class ParaForgeCore {
  private agentOrchestrator: AgentOrchestrator;
  private synthesisEngine: SynthesisEngine;
  private optimizer: ParallelizationOptimizer;
  private jiraConnector: JiraConnector;
  private learningSystem?: LearningSystem;

  constructor(private config: ParaForgeConfig) {
    this.agentOrchestrator = new AgentOrchestrator(config.ai);
    this.synthesisEngine = new SynthesisEngine();
    this.optimizer = new ParallelizationOptimizer();
    this.jiraConnector = new JiraConnector(config.jira);

    if (config.learning?.enabled) {
      this.learningSystem = new LearningSystem(config.learning.databaseUrl);
    }
  }

  async initialize(): Promise<void> {
    logger.info('Initializing ParaForge Core...');
    
    // Initialize all components
    await Promise.all([
      this.agentOrchestrator.initialize(),
      this.jiraConnector.connect(),
      this.learningSystem?.initialize()
    ]);

    logger.info('ParaForge Core initialized');
  }

  /**
   * Main decomposition method - takes an idea and generates optimized Jira structure
   */
  async decompose(idea: ProjectIdea): Promise<any> {
    logger.info('Starting project decomposition', { idea: idea.description });

    // Step 1: Multi-agent analysis
    const agentAnalyses = await this.agentOrchestrator.analyzeProject(idea);
    
    // Step 2: Synthesis and consensus
    const synthesizedPlan = await this.synthesisEngine.synthesize(agentAnalyses);
    
    // Step 3: Optimization for parallelization
    const optimizedPlan = await this.optimizer.optimize(synthesizedPlan);
    
    // Step 4: Learn from this decomposition (if enabled)
    if (this.learningSystem) {
      await this.learningSystem.recordDecomposition(idea, optimizedPlan);
    }

    return optimizedPlan;
  }

  /**
   * Generate Jira model from decomposed project
   */
  async generateJiraModel(project: any): Promise<any> {
    logger.info('Generating Jira model');
    return this.jiraConnector.generateModel(project);
  }

  /**
   * Execute the model in Jira
   */
  async executeInJira(jiraModel: any): Promise<any> {
    logger.info('Executing in Jira');
    const result = await this.jiraConnector.execute(jiraModel);
    
    // Record execution results for learning
    if (this.learningSystem) {
      await this.learningSystem.recordExecution(jiraModel, result);
    }

    return result;
  }

  /**
   * Get patterns and templates from learning system
   */
  async getPatterns(domain?: string): Promise<any[]> {
    if (!this.learningSystem) {
      return [];
    }
    return this.learningSystem.getPatterns(domain);
  }
}