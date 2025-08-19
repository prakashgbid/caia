/**
 * Tests for Product Owner Agent
 */

import { ProductOwnerAgent, BacklogItem } from '../index';

describe('ProductOwnerAgent', () => {
  let agent: ProductOwnerAgent;

  beforeEach(() => {
    agent = new ProductOwnerAgent();
  });

  describe('Product Vision', () => {
    it('should create a comprehensive product vision', async () => {
      const context = {
        businessGoals: ['Increase user engagement', 'Reduce churn'],
        marketResearch: { marketSize: 1000000, growth: 0.15 },
        userPersonas: [
          {
            id: 'p1',
            name: 'Tech Professional',
            role: 'Developer',
            goals: ['Efficiency', 'Automation'],
            painPoints: ['Manual processes', 'Context switching'],
            behaviors: ['Early adopter', 'Tool-focused']
          }
        ],
        competitiveAnalysis: { competitors: ['Tool A', 'Tool B'] }
      };

      const vision = await agent.createProductVision(context);

      expect(vision).toHaveProperty('statement');
      expect(vision).toHaveProperty('goals');
      expect(vision).toHaveProperty('metrics');
      expect(vision).toHaveProperty('targetMarket');
      expect(vision).toHaveProperty('valueProposition');
      expect(vision.goals).toEqual(context.businessGoals);
    });
  });

  describe('Backlog Prioritization', () => {
    const sampleBacklog: BacklogItem[] = [
      {
        id: 'US-001',
        title: 'User Authentication',
        description: 'Implement secure user login',
        acceptanceCriteria: ['Secure password handling', 'Remember me option'],
        priority: 1,
        estimatedValue: 8,
        estimatedEffort: 5,
        labels: ['security', 'foundation'],
        dependencies: [],
        status: 'ready'
      },
      {
        id: 'US-002',
        title: 'Dashboard View',
        description: 'Create main dashboard with key metrics',
        acceptanceCriteria: ['Display key metrics', 'Responsive design'],
        priority: 2,
        estimatedValue: 6,
        estimatedEffort: 8,
        labels: ['ui', 'analytics'],
        dependencies: ['US-001'],
        status: 'ready'
      },
      {
        id: 'US-003',
        title: 'Email Notifications',
        description: 'Send email notifications for important events',
        acceptanceCriteria: ['Configurable notifications', 'Email templates'],
        priority: 3,
        estimatedValue: 4,
        estimatedEffort: 3,
        labels: ['notifications', 'communication'],
        dependencies: [],
        status: 'ready'
      }
    ];

    it('should prioritize backlog using WSJF methodology', async () => {
      const result = await agent.prioritizeBacklog(sampleBacklog, 'WSJF');

      expect(result).toHaveProperty('items');
      expect(result).toHaveProperty('reasoning');
      expect(result).toHaveProperty('methodology');
      expect(result).toHaveProperty('riskFactors');
      expect(result.methodology).toBe('WSJF');
      expect(result.items).toHaveLength(3);
      expect(result.reasoning).toContain('Weighted Shortest Job First');
    });

    it('should prioritize backlog using RICE methodology', async () => {
      const result = await agent.prioritizeBacklog(sampleBacklog, 'RICE');

      expect(result.methodology).toBe('RICE');
      expect(result.reasoning).toContain('RICE scoring');
      expect(result.items).toHaveLength(3);
    });

    it('should prioritize backlog using Value vs Effort methodology', async () => {
      const result = await agent.prioritizeBacklog(sampleBacklog, 'Value-vs-Effort');

      expect(result.methodology).toBe('Value-vs-Effort');
      expect(result.reasoning).toContain('Value vs Effort matrix');
      expect(result.items).toHaveLength(3);
    });

    it('should prioritize backlog using MoSCoW methodology', async () => {
      const result = await agent.prioritizeBacklog(sampleBacklog, 'MoSCoW');

      expect(result.methodology).toBe('MoSCoW');
      expect(result.reasoning).toContain('MoSCoW prioritization');
      expect(result.items).toHaveLength(3);
    });

    it('should identify risk factors in backlog', async () => {
      const riskBacklog: BacklogItem[] = [
        {
          ...sampleBacklog[0],
          dependencies: ['DEP-1', 'DEP-2', 'DEP-3', 'DEP-4'], // High dependency
          estimatedEffort: 25 // Large item
        }
      ];

      const result = await agent.prioritizeBacklog(riskBacklog, 'WSJF');

      expect(result.riskFactors.length).toBeGreaterThan(0);
      expect(result.riskFactors.some(risk => risk.includes('dependency'))).toBe(true);
    });
  });

  describe('Release Planning', () => {
    it('should create a comprehensive release plan', async () => {
      const context = {
        version: '2.1.0',
        targetDate: new Date('2024-03-15'),
        availableCapacity: 100,
        backlogItems: [
          {
            id: 'US-001',
            title: 'Feature A',
            description: 'Important feature',
            acceptanceCriteria: ['Criteria 1'],
            priority: 1,
            estimatedValue: 9,
            estimatedEffort: 10,
            labels: ['feature'],
            dependencies: [],
            status: 'ready' as const
          }
        ],
        businessPriorities: ['user engagement', 'performance']
      };

      const releaseGoal = await agent.planRelease(context);

      expect(releaseGoal).toHaveProperty('version');
      expect(releaseGoal).toHaveProperty('targetDate');
      expect(releaseGoal).toHaveProperty('objectives');
      expect(releaseGoal).toHaveProperty('features');
      expect(releaseGoal).toHaveProperty('successCriteria');
      expect(releaseGoal).toHaveProperty('risks');
      expect(releaseGoal.version).toBe('2.1.0');
      expect(releaseGoal.targetDate).toEqual(context.targetDate);
    });
  });

  describe('Stakeholder Management', () => {
    it('should process stakeholder feedback effectively', async () => {
      const feedback = [
        {
          stakeholder: 'Sales Team',
          priority: 'high' as const,
          feedback: 'Need better reporting features for enterprise clients',
          actionItems: ['Add advanced analytics', 'Implement custom dashboards']
        },
        {
          stakeholder: 'Customer Support',
          priority: 'medium' as const,
          feedback: 'Users struggling with onboarding process',
          actionItems: ['Simplify signup flow', 'Add guided tour']
        }
      ];

      const result = await agent.processStakeholderFeedback(feedback);

      expect(result).toHaveProperty('summary');
      expect(result).toHaveProperty('prioritizedActions');
      expect(result).toHaveProperty('consensusLevel');
      expect(result).toHaveProperty('conflictResolution');
      expect(typeof result.consensusLevel).toBe('number');
      expect(result.consensusLevel).toBeGreaterThanOrEqual(0);
      expect(result.consensusLevel).toBeLessThanOrEqual(100);
    });
  });

  describe('Sprint Planning', () => {
    it('should plan sprint within capacity constraints', async () => {
      const context = {
        sprintNumber: 15,
        capacity: 40,
        prioritizedBacklog: [
          {
            id: 'US-001',
            title: 'Small Task',
            description: 'Quick task',
            acceptanceCriteria: ['Done'],
            priority: 1,
            estimatedValue: 5,
            estimatedEffort: 10,
            labels: ['quick'],
            dependencies: [],
            status: 'ready' as const
          },
          {
            id: 'US-002',
            title: 'Medium Task',
            description: 'Medium task',
            acceptanceCriteria: ['Done'],
            priority: 2,
            estimatedValue: 7,
            estimatedEffort: 20,
            labels: ['medium'],
            dependencies: [],
            status: 'ready' as const
          },
          {
            id: 'US-003',
            title: 'Large Task',
            description: 'Large task',
            acceptanceCriteria: ['Done'],
            priority: 3,
            estimatedValue: 9,
            estimatedEffort: 30,
            labels: ['large'],
            dependencies: [],
            status: 'ready' as const
          }
        ],
        teamVelocity: 35,
        sprintGoal: 'Complete user authentication and basic dashboard'
      };

      const sprintPlan = await agent.planSprint(context);

      expect(sprintPlan).toHaveProperty('selectedItems');
      expect(sprintPlan).toHaveProperty('sprintGoal');
      expect(sprintPlan).toHaveProperty('commitmentLevel');
      expect(sprintPlan).toHaveProperty('risks');

      // Should not exceed capacity
      const totalEffort = sprintPlan.selectedItems.reduce(
        (sum, item) => sum + item.estimatedEffort, 0
      );
      expect(totalEffort).toBeLessThanOrEqual(context.capacity);
    });
  });

  describe('Metrics Definition', () => {
    it('should define comprehensive product metrics', async () => {
      const context = {
        productGoals: ['Increase engagement', 'Reduce support load'],
        userJourney: [
          {
            step: 'Registration',
            description: 'User signs up',
            touchpoints: ['Website', 'Email'],
            painPoints: ['Complex form'],
            metrics: ['Conversion rate']
          }
        ],
        businessKPIs: ['Revenue growth', 'User retention']
      };

      const metrics = await agent.defineProductMetrics(context);

      expect(metrics).toHaveProperty('leadingIndicators');
      expect(metrics).toHaveProperty('laggingIndicators');
      expect(metrics).toHaveProperty('healthMetrics');
      expect(metrics).toHaveProperty('alertThresholds');
      expect(Array.isArray(metrics.leadingIndicators)).toBe(true);
      expect(Array.isArray(metrics.laggingIndicators)).toBe(true);
      expect(Array.isArray(metrics.healthMetrics)).toBe(true);
      expect(typeof metrics.alertThresholds).toBe('object');
    });
  });
});