/**
 * @fileoverview Mock implementations for CAIA agents
 * Provides realistic mocks for testing agent interactions
 */

import { EventEmitter } from 'events';

export interface MockAgent {
  id: string;
  name: string;
  type: string;
  status: AgentStatus;
  capabilities: string[];
  execute: jest.MockedFunction<(task: any) => Promise<any>>;
  stop: jest.MockedFunction<() => Promise<void>>;
  getMetrics: jest.MockedFunction<() => AgentMetrics>;
  on: jest.MockedFunction<(event: string, listener: Function) => void>;
  emit: jest.MockedFunction<(event: string, ...args: any[]) => boolean>;
}

export interface AgentMetrics {
  tasksCompleted: number;
  tasksFailures: number;
  averageExecutionTime: number;
  memoryUsage: number;
  cpuUsage: number;
}

export type AgentStatus = 'idle' | 'running' | 'stopped' | 'error';

/**
 * Create a mock agent with realistic behavior
 */
export function createMockAgent(options?: Partial<MockAgent>): MockAgent {
  const eventEmitter = new EventEmitter();
  
  const agent: MockAgent = {
    id: options?.id || `agent-${Math.random().toString(36).substr(2, 9)}`,
    name: options?.name || 'Mock Agent',
    type: options?.type || 'generic',
    status: options?.status || 'idle',
    capabilities: options?.capabilities || ['execute', 'monitor'],
    
    execute: jest.fn().mockImplementation(async (task: any) => {
      agent.status = 'running';
      eventEmitter.emit('statusChange', 'running');
      
      // Simulate execution time
      await new Promise(resolve => setTimeout(resolve, 10));
      
      agent.status = 'idle';
      eventEmitter.emit('statusChange', 'idle');
      eventEmitter.emit('taskCompleted', { task, result: { success: true } });
      
      return { success: true, result: 'Task completed' };
    }),

    stop: jest.fn().mockImplementation(async () => {
      agent.status = 'stopped';
      eventEmitter.emit('statusChange', 'stopped');
    }),

    getMetrics: jest.fn().mockImplementation(() => ({
      tasksCompleted: 5,
      tasksFailures: 0,
      averageExecutionTime: 150,
      memoryUsage: 1024 * 1024 * 50, // 50MB
      cpuUsage: 0.1
    })),

    on: jest.fn().mockImplementation((event: string, listener: Function) => {
      eventEmitter.on(event, listener);
    }),

    emit: jest.fn().mockImplementation((event: string, ...args: any[]) => {
      return eventEmitter.emit(event, ...args);
    }),

    ...options
  };

  return agent;
}

/**
 * Create a mock orchestrator agent
 */
export function createMockOrchestrator(): MockAgent {
  const orchestrator = createMockAgent({
    name: 'Mock Orchestrator',
    type: 'orchestrator',
    capabilities: ['orchestrate', 'coordinate', 'monitor']
  });

  orchestrator.execute.mockImplementation(async (workflow: any) => {
    // Simulate orchestration
    const steps = workflow.steps || [];
    const results = [];

    for (const step of steps) {
      orchestrator.emit('stepStarted', step);
      await new Promise(resolve => setTimeout(resolve, 5));
      results.push({ step: step.id, success: true });
      orchestrator.emit('stepCompleted', step);
    }

    return { success: true, results };
  });

  return orchestrator;
}

/**
 * Create a mock execution engine
 */
export function createMockExecutionEngine(): MockAgent {
  const engine = createMockAgent({
    name: 'Mock Execution Engine',
    type: 'execution-engine',
    capabilities: ['execute', 'parallel', 'queue']
  });

  engine.execute.mockImplementation(async (tasks: any[]) => {
    const results = [];
    
    for (const task of tasks) {
      engine.emit('taskStarted', task);
      await new Promise(resolve => setTimeout(resolve, Math.random() * 20));
      results.push({ 
        taskId: task.id, 
        success: Math.random() > 0.1, // 90% success rate
        result: `Result for ${task.id}`
      });
      engine.emit('taskCompleted', task);
    }

    return { success: true, results };
  });

  return engine;
}

/**
 * Create a mock decision engine
 */
export function createMockDecisionEngine(): MockAgent {
  const engine = createMockAgent({
    name: 'Mock Decision Engine',
    type: 'decision-engine',
    capabilities: ['analyze', 'decide', 'recommend']
  });

  engine.execute.mockImplementation(async (context: any) => {
    // Simulate decision making
    await new Promise(resolve => setTimeout(resolve, 30));
    
    const decisions = [
      { action: 'proceed', confidence: 0.9 },
      { action: 'retry', confidence: 0.7 },
      { action: 'escalate', confidence: 0.5 }
    ];

    const selectedDecision = decisions[Math.floor(Math.random() * decisions.length)];
    
    engine.emit('decisionMade', selectedDecision);
    
    return {
      success: true,
      decision: selectedDecision,
      reasoning: 'Based on current context and historical data'
    };
  });

  return engine;
}

/**
 * Create multiple mock agents for testing orchestration
 */
export function createMockAgentCluster(count: number = 3): MockAgent[] {
  return Array.from({ length: count }, (_, index) => 
    createMockAgent({
      id: `cluster-agent-${index}`,
      name: `Cluster Agent ${index + 1}`,
      type: 'worker'
    })
  );
}

/**
 * Mock agent registry for testing agent discovery
 */
export class MockAgentRegistry {
  private agents: Map<string, MockAgent> = new Map();

  register(agent: MockAgent): void {
    this.agents.set(agent.id, agent);
  }

  unregister(agentId: string): boolean {
    return this.agents.delete(agentId);
  }

  findById(agentId: string): MockAgent | undefined {
    return this.agents.get(agentId);
  }

  findByType(type: string): MockAgent[] {
    return Array.from(this.agents.values()).filter(agent => agent.type === type);
  }

  findByCapability(capability: string): MockAgent[] {
    return Array.from(this.agents.values()).filter(agent => 
      agent.capabilities.includes(capability)
    );
  }

  getAllAgents(): MockAgent[] {
    return Array.from(this.agents.values());
  }

  getHealthyAgents(): MockAgent[] {
    return Array.from(this.agents.values()).filter(agent => 
      agent.status === 'idle' || agent.status === 'running'
    );
  }

  clear(): void {
    this.agents.clear();
  }
}

/**
 * Utility to wait for agent status change
 */
export function waitForAgentStatus(agent: MockAgent, status: AgentStatus, timeout: number = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (agent.status === status) {
      resolve();
      return;
    }

    const timer = setTimeout(() => {
      reject(new Error(`Agent ${agent.id} did not reach status ${status} within ${timeout}ms`));
    }, timeout);

    agent.on('statusChange', (newStatus: AgentStatus) => {
      if (newStatus === status) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
}

/**
 * Utility to simulate agent failure
 */
export function simulateAgentFailure(agent: MockAgent, errorMessage: string = 'Simulated failure'): void {
  agent.status = 'error';
  agent.execute.mockRejectedValue(new Error(errorMessage));
  agent.emit('error', new Error(errorMessage));
}