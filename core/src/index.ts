/**
 * CAIA Core - The Orchestrator of Orchestrators
 */

import { EventEmitter } from 'eventemitter3';

export interface CAIAConfig {
  agents?: string[];
  engines?: string[];
  utils?: string[];
  modules?: string[];
  debug?: boolean;
}

import { BaseAgent, BaseEngine, TaskDefinition } from './types';

export class CAIA extends EventEmitter {
  private agents = new Map<string, BaseAgent>();
  private engines = new Map<string, BaseEngine>();
  private tasks = new Map<string, TaskDefinition>();
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

  registerAgent(name: string, agent: BaseAgent) {
    this.agents.set(name, agent);
    this.emit('agent:registered', { name, agent });
  }

  registerEngine(name: string, engine: BaseEngine) {
    this.engines.set(name, engine);
    this.emit('engine:registered', { name, engine });
  }

  registerTask(task: TaskDefinition) {
    this.tasks.set(task.name, task);
    this.emit('task:registered', { task });
  }

  async execute(options: {
    task?: string;
    agent?: string;
    agents?: string[];
    input?: any;
    parallel?: boolean;
  }): Promise<any> {
    this.emit('execution:start', options);

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
          const promises = options.agents.map(name => {
            const agent = this.agents.get(name);
            if (!agent) throw new Error(`Agent ${name} not found`);
            return agent.execute(options.input);
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
      return result;
    } catch (error) {
      this.emit('execution:error', { options, error });
      throw error;
    }
  }

  private async orchestrate(taskName: string, input: any): Promise<any> {
    const task = this.tasks.get(taskName);
    if (!task) {
      throw new Error(`Unknown task: ${taskName}`);
    }

    // This is a simplified implementation of the orchestration logic.
    // A more complete implementation would handle dependencies and parallel execution.
    let lastResult: any = input;
    for (const step of task.workflow.steps) {
      if (step.agent) {
        const agent = this.agents.get(step.agent);
        if (!agent) {
          throw new Error(`Agent ${step.agent} not found`);
        }
        lastResult = await agent.execute(lastResult);
      } else if (step.engine) {
        const engine = this.engines.get(step.engine);
        if (!engine) {
          throw new Error(`Engine ${step.engine} not found`);
        }
        lastResult = await engine.process(lastResult);
      }
    }
    return lastResult;
  }

  listAgents(): string[] {
    return Array.from(this.agents.keys());
  }

  listEngines(): string[] {
    return Array.from(this.engines.keys());
  }

  getAgent(name: string): BaseAgent | undefined {
    return this.agents.get(name);
  }

  getEngine(name: string): BaseEngine | undefined {
    return this.engines.get(name);
  }
}

// Export types
export * from './types';

// Default export
export default CAIA;