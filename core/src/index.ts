/**
 * CAIA Core - The Orchestrator of Orchestrators
 */

import { EventEmitter } from 'eventemitter3';
import pLimit from 'p-limit';

export interface CAIAConfig {
  agents?: string[];
  engines?: string[];
  utils?: string[];
  modules?: string[];
  debug?: boolean;
}

export interface Agent {
  name: string;
  version: string;
  execute(input: any): Promise<any>;
}

export interface Engine {
  name: string;
  version: string;
  process(input: any): Promise<any>;
}

export class CAIA extends EventEmitter {
  private agents = new Map<string, Agent>();
  private engines = new Map<string, Engine>();
  private cache = new Map<string, any>();
  private config: CAIAConfig;

  constructor(config: CAIAConfig = {}) {
    super();
    this.config = config;
    this.initialize();
  }

  private async initialize() {
    this.emit('initializing');
    // Load configured agents and engines
    if (this.config.agents) {
      await this.loadAgents(this.config.agents);
    }
    if (this.config.engines) {
      await this.loadEngines(this.config.engines);
    }
    this.emit('ready');
  }

  async loadAgents(agentNames: string[]) {
    for (const name of agentNames) {
      try {
        const agent = await import(`@caia/agent-${name}`);
        this.registerAgent(name, agent.default || agent);
      } catch (error) {
        console.error(`Failed to load agent ${name}:`, error);
      }
    }
  }

  async loadEngines(engineNames: string[]) {
    for (const name of engineNames) {
      try {
        const engine = await import(`@caia/engine-${name}`);
        this.registerEngine(name, engine.default || engine);
      } catch (error) {
        console.error(`Failed to load engine ${name}:`, error);
      }
    }
  }

  registerAgent(name: string, agent: Agent) {
    this.agents.set(name, agent);
    this.emit('agent:registered', { name, agent });
  }

  registerEngine(name: string, engine: Engine) {
    this.engines.set(name, engine);
    this.emit('engine:registered', { name, engine });
  }

  async execute(options: {
    task?: string;
    agent?: string;
    agents?: string[];
    input?: any;
    parallel?: boolean;
    useCache?: boolean;
  }): Promise<any> {
    this.emit('execution:start', options);

    const cacheKey = JSON.stringify(options);
    if (options.useCache && this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    try {
      let result;

      if (options.agent) {
        // Single agent execution
        const agent = this.agents.get(options.agent);
        if (!agent) throw new Error(`Agent ${options.agent} not found`);
        result = await agent.execute(options.input);
      } else if (options.agents && options.agents.length > 0) {
        // Multi-agent execution
        if (options.parallel) {
          // Parallel execution
          const limit = pLimit(10);
          const promises = options.agents.map(name => {
            const agent = this.agents.get(name);
            if (!agent) throw new Error(`Agent ${name} not found`);
            return limit(() => agent.execute(options.input));
          });
          result = await Promise.all(promises);
        } else {
          // Sequential execution
          result = [];
          for (const name of options.agents) {
            const agent = this.agents.get(name);
            if (!agent) throw new Error(`Agent ${name} not found`);
            const agentResult = await agent.execute(options.input);
            result.push(agentResult);
          }
        }
      } else {
        // Orchestrated execution based on task
        result = await this.orchestrate(options.task!, options.input);
      }

      this.emit('execution:complete', { options, result });

      if (options.useCache) {
        this.cache.set(cacheKey, result);
      }

      return result;
    } catch (error) {
      this.emit('execution:error', { options, error });
      throw error;
    }
  }

  private async orchestrate(task: string, input: any): Promise<any> {
    // Task-based orchestration logic
    switch (task) {
      case 'build-app':
        return this.orchestrateBuildApp(input);
      case 'gather-requirements':
        return this.orchestrateRequirements(input);
      case 'generate-tests':
        return this.orchestrateTests(input);
      default:
        throw new Error(`Unknown task: ${task}`);
    }
  }

  private async orchestrateBuildApp(input: any) {
    // Complex orchestration for building an app
    const agents = ['product-owner', 'solution-architect', 'frontend-engineer', 'backend-engineer'];
    return this.execute({ agents, input, parallel: false });
  }

  private async orchestrateRequirements(input: any) {
    const agent = this.agents.get('product-owner');
    if (!agent) throw new Error('Product Owner agent required');
    return agent.execute(input);
  }

  private async orchestrateTests(input: any) {
    const agent = this.agents.get('qa-engineer');
    if (!agent) throw new Error('QA Engineer agent required');
    return agent.execute(input);
  }

  listAgents(): string[] {
    return Array.from(this.agents.keys());
  }

  listEngines(): string[] {
    return Array.from(this.engines.keys());
  }

  getAgent(name: string): Agent | undefined {
    return this.agents.get(name);
  }

  getEngine(name: string): Engine | undefined {
    return this.engines.get(name);
  }
}

// Export types
export * from './types';

// Default export
export default CAIA;