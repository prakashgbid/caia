/**
 * SATS - Smart Agents Training System
 * Main entry point for the library
 */

export { SuperIntelligentAgent } from './core/llm-alliance/SuperIntelligentAgent';
export { AgentOrchestrator } from './core/agent-orchestrator/AgentOrchestrator';
export { DecisionEngine } from './core/decision-engine/DecisionEngine';
export { VectorMemory } from './core/memory/VectorMemory';

export { BaseAgent } from './agents/base/BaseAgent';
export { SpecialistAgent } from './agents/specialists/SpecialistAgent';
export { SupervisorAgent } from './agents/supervisors/SupervisorAgent';

export { OpenAIProvider } from './models/openai/OpenAIProvider';
export { GoogleProvider } from './models/google/GoogleProvider';
export { AnthropicProvider } from './models/anthropic/AnthropicProvider';

export * from './types';
export * from './utils';

// Version
export const VERSION = '0.1.0';

// Default export
export default {
  SuperIntelligentAgent,
  AgentOrchestrator,
  DecisionEngine,
  VectorMemory,
  VERSION
};