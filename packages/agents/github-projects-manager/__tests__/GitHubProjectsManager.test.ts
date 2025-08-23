import { GitHubProjectsManager, CCInstance, Issue } from '../src';

describe('GitHubProjectsManager', () => {
  let manager: GitHubProjectsManager;
  const mockToken = 'fake-github-token';

  beforeEach(() => {
    manager = new GitHubProjectsManager(mockToken);
  });

  describe('CC Instance Management', () => {
    it('should register CC instances', () => {
      const instance: CCInstance = {
        id: 'cc-1',
        capacity: 10,
        currentLoad: 0,
        assignedTasks: [],
        performance: 0.95,
        specialization: ['frontend', 'react']
      };

      const spy = jest.fn();
      manager.on('instance:registered', spy);
      
      manager.registerCCInstance(instance);
      
      expect(spy).toHaveBeenCalledWith(instance);
    });

    it('should unregister CC instances and reassign tasks', () => {
      const instance: CCInstance = {
        id: 'cc-1',
        capacity: 10,
        currentLoad: 5,
        assignedTasks: [1, 2, 3],
        performance: 0.95
      };

      manager.registerCCInstance(instance);
      
      const spy = jest.fn();
      manager.on('instance:unregistered', spy);
      
      manager.unregisterCCInstance('cc-1');
      
      expect(spy).toHaveBeenCalledWith('cc-1');
    });

    it('should get instance status', () => {
      const instance1: CCInstance = {
        id: 'cc-1',
        capacity: 10,
        currentLoad: 5,
        assignedTasks: [1, 2],
        performance: 0.95
      };

      const instance2: CCInstance = {
        id: 'cc-2',
        capacity: 8,
        currentLoad: 3,
        assignedTasks: [3],
        performance: 0.90
      };

      manager.registerCCInstance(instance1);
      manager.registerCCInstance(instance2);

      const status = manager.getInstanceStatus();

      expect(status.totalInstances).toBe(2);
      expect(status.totalCapacity).toBe(18);
      expect(status.totalLoad).toBe(8);
      expect(status.utilizationRate).toBeCloseTo(44.44, 1);
    });
  });

  describe('Task Allocation', () => {
    beforeEach(() => {
      const instance: CCInstance = {
        id: 'cc-1',
        capacity: 20,
        currentLoad: 0,
        assignedTasks: [],
        performance: 0.95,
        specialization: ['backend', 'api']
      };
      manager.registerCCInstance(instance);
    });

    it('should allocate tasks to available instances', async () => {
      const issues: Issue[] = [
        {
          id: 1,
          title: 'Fix API bug',
          state: 'open',
          labels: ['bug', 'api'],
          assignees: [],
          estimatedHours: 2
        },
        {
          id: 2,
          title: 'Add new feature',
          state: 'open',
          labels: ['feature'],
          assignees: [],
          estimatedHours: 5
        }
      ];

      const allocations = await manager.allocateTasks(issues);

      expect(allocations).toHaveLength(2);
      expect(allocations[0].status).toBe('assigned');
      expect(allocations[0].instanceId).toBe('cc-1');
      expect(allocations[1].status).toBe('assigned');
    });

    it('should prioritize critical issues', async () => {
      const issues: Issue[] = [
        {
          id: 1,
          title: 'Low priority task',
          state: 'open',
          labels: ['low'],
          assignees: [],
          estimatedHours: 1
        },
        {
          id: 2,
          title: 'Critical bug',
          state: 'open',
          labels: ['critical', 'bug'],
          assignees: [],
          estimatedHours: 1
        }
      ];

      const allocations = await manager.allocateTasks(issues);
      
      expect(allocations[0].issueId).toBe(2);
      expect(allocations[0].priority).toBeGreaterThan(allocations[1].priority);
    });

    it('should handle instance capacity limits', async () => {
      const issues: Issue[] = [
        {
          id: 1,
          title: 'Large task',
          state: 'open',
          labels: [],
          assignees: [],
          estimatedHours: 15
        },
        {
          id: 2,
          title: 'Huge task',
          state: 'open',
          labels: [],
          assignees: [],
          estimatedHours: 25
        }
      ];

      const allocations = await manager.allocateTasks(issues);
      
      expect(allocations[0].status).toBe('assigned');
      expect(allocations[1].status).toBe('pending');
    });

    it('should match instance specializations', async () => {
      const frontendInstance: CCInstance = {
        id: 'cc-frontend',
        capacity: 10,
        currentLoad: 0,
        assignedTasks: [],
        performance: 0.95,
        specialization: ['frontend', 'react']
      };
      manager.registerCCInstance(frontendInstance);

      const issues: Issue[] = [
        {
          id: 1,
          title: 'Update React component',
          state: 'open',
          labels: ['frontend', 'react'],
          assignees: [],
          estimatedHours: 3
        }
      ];

      const allocations = await manager.allocateTasks(issues);
      
      expect(allocations[0].instanceId).toBe('cc-frontend');
    });

    it('should extract dependencies from issue body', async () => {
      const issues: Issue[] = [
        {
          id: 3,
          title: 'Task with dependencies',
          body: 'This task depends on #1 and #2',
          state: 'open',
          labels: [],
          assignees: [],
          estimatedHours: 2
        }
      ];

      const allocations = await manager.allocateTasks(issues);
      
      expect(allocations[0].dependencies).toEqual([1, 2]);
    });
  });

  describe('Task Status Management', () => {
    it('should update task status', async () => {
      const instance: CCInstance = {
        id: 'cc-1',
        capacity: 10,
        currentLoad: 0,
        assignedTasks: [],
        performance: 0.95
      };
      manager.registerCCInstance(instance);

      const issues: Issue[] = [
        {
          id: 1,
          title: 'Test task',
          state: 'open',
          labels: [],
          assignees: [],
          estimatedHours: 2
        }
      ];

      await manager.allocateTasks(issues);
      
      const spy = jest.fn();
      manager.on('task:status:updated', spy);
      
      await manager.updateTaskStatus(1, 'in_progress');
      
      expect(spy).toHaveBeenCalledWith({ issueId: 1, status: 'in_progress' });
    });

    it('should free up instance capacity when task is completed', async () => {
      const instance: CCInstance = {
        id: 'cc-1',
        capacity: 10,
        currentLoad: 0,
        assignedTasks: [],
        performance: 0.95
      };
      manager.registerCCInstance(instance);

      const issues: Issue[] = [
        {
          id: 1,
          title: 'Test task',
          state: 'open',
          labels: [],
          assignees: [],
          estimatedHours: 5
        }
      ];

      await manager.allocateTasks(issues);
      expect(instance.currentLoad).toBe(5);
      
      await manager.updateTaskStatus(1, 'completed');
      expect(instance.currentLoad).toBe(0);
      expect(instance.assignedTasks).toHaveLength(0);
    });
  });

  describe('Allocation Status', () => {
    it('should track allocation status', async () => {
      const instance: CCInstance = {
        id: 'cc-1',
        capacity: 10,
        currentLoad: 0,
        assignedTasks: [],
        performance: 0.95
      };
      manager.registerCCInstance(instance);

      const issues: Issue[] = [
        {
          id: 1,
          title: 'Task 1',
          state: 'open',
          labels: [],
          assignees: [],
          estimatedHours: 2
        },
        {
          id: 2,
          title: 'Task 2',
          state: 'open',
          labels: [],
          assignees: [],
          estimatedHours: 3
        }
      ];

      await manager.allocateTasks(issues);
      await manager.updateTaskStatus(1, 'in_progress');
      
      const status = manager.getAllocationStatus();
      
      expect(status.totalTasks).toBe(2);
      expect(status.assigned).toBe(1);
      expect(status.inProgress).toBe(1);
      expect(status.completed).toBe(0);
      expect(status.pending).toBe(0);
    });
  });

  describe('Issue Creation', () => {
    it('should format issue body correctly', async () => {
      const mockCreate = jest.fn().mockResolvedValue({
        data: {
          number: 1,
          title: 'Test Task',
          body: 'Test body',
          state: 'open',
          labels: [],
          assignees: []
        }
      });

      (manager as any).octokit = {
        issues: { create: mockCreate }
      };

      const task = {
        title: 'Test Task',
        description: 'Test description',
        technicalDetails: ['Detail 1', 'Detail 2'],
        acceptanceCriteria: ['Criteria 1'],
        estimatedHours: 5,
        complexity: 'medium',
        dependencies: ['Dep 1']
      };

      await manager.createIssueFromTask('owner', 'repo', task);
      
      expect(mockCreate).toHaveBeenCalled();
      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.body).toContain('Test description');
      expect(callArgs.body).toContain('Detail 1');
      expect(callArgs.body).toContain('Criteria 1');
    });
  });

  describe('Complexity Estimation', () => {
    it('should estimate complexity based on task factors', async () => {
      const mockCreate = jest.fn().mockResolvedValue({
        data: {
          number: 1,
          title: 'Complex Task',
          state: 'open',
          labels: [],
          assignees: []
        }
      });

      (manager as any).octokit = {
        issues: { create: mockCreate }
      };

      const complexTask = {
        title: 'Complex Task',
        dependencies: ['1', '2', '3', '4'],
        technicalDetails: ['1', '2', '3', '4', '5'],
        acceptanceCriteria: ['1', '2', '3']
      };

      const issue = await manager.createIssueFromTask('owner', 'repo', complexTask);
      
      expect(issue.complexity).toBe(8);
      expect(issue.estimatedHours).toBeGreaterThan(10);
    });
  });

  describe('Event Emissions', () => {
    it('should emit events during task allocation', async () => {
      const instance: CCInstance = {
        id: 'cc-1',
        capacity: 10,
        currentLoad: 0,
        assignedTasks: [],
        performance: 0.95
      };
      manager.registerCCInstance(instance);

      const startSpy = jest.fn();
      const completeSpy = jest.fn();
      const allocatedSpy = jest.fn();
      
      manager.on('allocation:start', startSpy);
      manager.on('allocation:complete', completeSpy);
      manager.on('task:allocated', allocatedSpy);

      const issues: Issue[] = [
        {
          id: 1,
          title: 'Test',
          state: 'open',
          labels: [],
          assignees: [],
          estimatedHours: 1
        }
      ];

      await manager.allocateTasks(issues);
      
      expect(startSpy).toHaveBeenCalled();
      expect(completeSpy).toHaveBeenCalled();
      expect(allocatedSpy).toHaveBeenCalled();
    });
  });
});