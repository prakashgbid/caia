/**
 * ParaForge - Intelligent AI-Orchestrated Project Management for Jira
 * Main entry point
 */

import dotenv from 'dotenv';
import { ParaForgeCore } from './core/ParaForgeCore';
import { logger } from './utils/logger';

// Load environment variables
dotenv.config();

export { ParaForgeCore } from './core/ParaForgeCore';
export { AgentOrchestrator } from './agents/AgentOrchestrator';
export { SynthesisEngine } from './synthesis/SynthesisEngine';
export { ParallelizationOptimizer } from './optimizer/ParallelizationOptimizer';
export { JiraConnector } from './jira/JiraConnector';
export { LearningSystem } from './learning/LearningSystem';

// CLI entry point
if (require.main === module) {
  logger.info('ParaForge starting...');
  
  const forge = new ParaForgeCore({
    jira: {
      host: process.env.JIRA_HOST!,
      email: process.env.JIRA_EMAIL!,
      apiToken: process.env.JIRA_API_TOKEN!
    },
    ai: {
      openai: process.env.OPENAI_API_KEY,
      anthropic: process.env.ANTHROPIC_API_KEY,
      gemini: process.env.GEMINI_API_KEY
    }
  });

  forge.initialize()
    .then(() => {
      logger.info('ParaForge initialized successfully');
    })
    .catch(error => {
      logger.error('Failed to initialize ParaForge:', error);
      process.exit(1);
    });
}