import { SolutionArchitectAgent } from '../SolutionArchitectAgent';
import { AgentConfig, TaskStatus } from '@caia/core';
import { createLogger } from 'winston';

describe('SolutionArchitectAgent', () => {
  let agent: SolutionArchitectAgent;
  let config: AgentConfig;
  let logger: any;

  beforeEach(() => {
    logger = createLogger({ silent: true });
    config = SolutionArchitectAgent.createDefaultConfig('test-agent');
    agent = new SolutionArchitectAgent(config, logger);
  });

  afterEach(async () => {
    if (agent) {
      await agent.shutdown();
    }
  });

  describe('initialization', () => {
    it('should initialize successfully', async () => {
      await expect(agent.initialize()).resolves.not.toThrow();
    });

    it('should have correct capabilities', () => {
      const capabilities = SolutionArchitectAgent.getDefaultCapabilities();
      expect(capabilities).toContain(
        expect.objectContaining({
          name: 'design_solution_architecture',
          version: '1.0.0'
        })
      );
    });
  });

  describe('task execution', () => {
    beforeEach(async () => {
      await agent.initialize();
    });

    it('should execute design_solution_architecture task', async () => {
      const task = {
        id: 'test-task',
        type: 'design_solution_architecture',
        priority: 1,
        payload: {
          requirements: {
            functional: ['user authentication', 'data storage'],
            nonFunctional: ['scalability', 'security']
          },
          constraints: {},
          preferences: {}
        },
        createdAt: new Date()
      };

      const result = await agent.assignTask(task);
      expect(result).toBeUndefined(); // assignTask doesn't return result directly
      
      // Wait for task completion event
      await new Promise(resolve => {
        agent.on('taskCompleted', (taskResult) => {
          expect(taskResult.taskId).toBe(task.id);
          expect(taskResult.status).toBe(TaskStatus.COMPLETED);
          expect(taskResult.result).toBeDefined();
          resolve(taskResult);
        });
      });
    });

    it('should handle unknown task types', async () => {
      const task = {
        id: 'test-task',
        type: 'unknown_task_type',
        priority: 1,
        payload: {},
        createdAt: new Date()
      };

      await agent.assignTask(task);
      
      // Wait for task completion event
      await new Promise(resolve => {
        agent.on('taskCompleted', (taskResult) => {
          expect(taskResult.taskId).toBe(task.id);
          expect(taskResult.status).toBe(TaskStatus.FAILED);
          expect(taskResult.error).toBeDefined();
          resolve(taskResult);
        });
      });
    });
  });

  describe('configuration', () => {
    it('should create default configuration', () => {
      const defaultConfig = SolutionArchitectAgent.createDefaultConfig();
      expect(defaultConfig.name).toBe('Solution Architect Agent');
      expect(defaultConfig.capabilities.length).toBeGreaterThan(0);
      expect(defaultConfig.maxConcurrentTasks).toBe(5);
    });
  });
});