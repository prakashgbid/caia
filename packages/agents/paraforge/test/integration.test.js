/**
 * ParaForge Integration Tests
 * End-to-end testing for the complete ParaForge workflow
 */

const { ParaForgeCore } = require('../src');
const { AgentOrchestrator } = require('../src/agents/AgentOrchestrator');
const { JiraConnector } = require('../src/jira/JiraConnector');
const path = require('path');
const fs = require('fs');

// Load environment variables for testing
require('dotenv').config({ path: path.join(__dirname, '..', '.env.test') });

// Mock jira-connect and product-owner agents if not available
const mockJiraConnect = {
  createIssue: jest.fn().mockResolvedValue({ key: 'TEST-123', id: '123' }),
  createEpic: jest.fn().mockResolvedValue({ key: 'TEST-100', id: '100' }),
  createStory: jest.fn().mockResolvedValue({ key: 'TEST-124', id: '124' }),
  createTask: jest.fn().mockResolvedValue({ key: 'TEST-125', id: '125' }),
  linkIssues: jest.fn().mockResolvedValue({ success: true }),
  getProject: jest.fn().mockResolvedValue({ key: 'TEST', id: '10000' }),
  updateIssue: jest.fn().mockResolvedValue({ success: true })
};

const mockProductOwner = {
  analyzeRequirements: jest.fn().mockResolvedValue({
    epics: [
      {
        title: 'User Management System',
        description: 'Complete user authentication and authorization system',
        stories: [
          {
            title: 'User Registration',
            description: 'As a user, I want to register for an account',
            acceptanceCriteria: ['Email validation', 'Password strength check'],
            tasks: [
              { title: 'Create registration form', estimate: '3h' },
              { title: 'Implement email validation', estimate: '2h' },
              { title: 'Add password strength checker', estimate: '2h' }
            ]
          },
          {
            title: 'User Login',
            description: 'As a user, I want to log into my account',
            acceptanceCriteria: ['Secure authentication', 'Remember me option'],
            tasks: [
              { title: 'Create login form', estimate: '2h' },
              { title: 'Implement JWT authentication', estimate: '4h' },
              { title: 'Add remember me functionality', estimate: '2h' }
            ]
          }
        ]
      }
    ],
    projectMetadata: {
      estimatedDuration: '2 weeks',
      teamSize: 3,
      technologies: ['Node.js', 'React', 'PostgreSQL'],
      risks: ['Security vulnerabilities', 'Scalability concerns']
    }
  }),
  prioritizeBacklog: jest.fn().mockResolvedValue({
    prioritizedItems: [
      { id: 'TEST-124', priority: 'High', score: 95 },
      { id: 'TEST-125', priority: 'Medium', score: 75 }
    ]
  }),
  generateAcceptanceCriteria: jest.fn().mockResolvedValue({
    criteria: [
      'Given a new user, when they submit valid registration data, then an account is created',
      'Given an existing user, when they enter correct credentials, then they are logged in'
    ]
  })
};

describe('ParaForge Integration Tests', () => {
  let paraforge;
  let orchestrator;
  let jiraConnector;

  beforeAll(async () => {
    // Initialize ParaForge with test configuration
    paraforge = new ParaForgeCore({
      jira: {
        host: process.env.JIRA_HOST || 'test.atlassian.net',
        email: process.env.JIRA_EMAIL || 'test@example.com',
        apiToken: process.env.JIRA_API_TOKEN || 'test-token'
      },
      ai: {
        openai: process.env.OPENAI_API_KEY || 'test-key',
        anthropic: process.env.ANTHROPIC_API_KEY || 'test-key'
      },
      testing: true // Enable test mode
    });

    // Override with mocks if in test mode
    if (!process.env.INTEGRATION_TEST_LIVE) {
      paraforge.jiraConnect = mockJiraConnect;
      paraforge.productOwner = mockProductOwner;
    }

    await paraforge.initialize();
    orchestrator = paraforge.getOrchestrator();
    jiraConnector = paraforge.getJiraConnector();
  });

  afterAll(async () => {
    await paraforge.shutdown();
  });

  describe('End-to-End Workflow', () => {
    test('should process idea to JIRA tickets', async () => {
      const idea = {
        title: 'E-commerce Platform',
        description: 'Build a modern e-commerce platform with user accounts, product catalog, shopping cart, and payment processing',
        goals: [
          'User can browse products',
          'User can add items to cart',
          'User can checkout and pay',
          'Admin can manage products'
        ],
        constraints: {
          timeline: '3 months',
          budget: '$50,000',
          team: 'Full-stack developers'
        }
      };

      // Process the idea through ParaForge
      const result = await paraforge.processIdea(idea);

      expect(result).toBeDefined();
      expect(result.project).toBeDefined();
      expect(result.epics).toBeInstanceOf(Array);
      expect(result.epics.length).toBeGreaterThan(0);
      expect(result.stories).toBeInstanceOf(Array);
      expect(result.tasks).toBeInstanceOf(Array);
      expect(result.metadata).toBeDefined();
      expect(result.metadata.totalEstimate).toBeDefined();
      expect(result.metadata.teamAllocation).toBeDefined();
    });

    test('should handle requirements analysis', async () => {
      const requirements = `
        User Story: As a customer, I want to search for products
        - Search by name, category, price range
        - Filter and sort results
        - View product details
        - See product reviews
      `;

      const analysis = await orchestrator.analyzeRequirements(requirements);

      expect(analysis).toBeDefined();
      expect(analysis.epics).toBeInstanceOf(Array);
      expect(analysis.epics[0]).toHaveProperty('title');
      expect(analysis.epics[0]).toHaveProperty('stories');
      expect(analysis.epics[0].stories[0]).toHaveProperty('tasks');
    });

    test('should create JIRA hierarchy', async () => {
      const projectData = {
        name: 'Test Project',
        key: 'TEST',
        epics: [
          {
            title: 'Authentication System',
            stories: [
              {
                title: 'User Registration',
                tasks: [
                  { title: 'Design registration form', estimate: '2h' },
                  { title: 'Implement backend API', estimate: '4h' }
                ]
              }
            ]
          }
        ]
      };

      const jiraResult = await paraforge.createJiraHierarchy(projectData);

      expect(jiraResult).toBeDefined();
      expect(jiraResult.project).toBeDefined();
      expect(jiraResult.created).toBeDefined();
      expect(jiraResult.created.epics).toBeGreaterThan(0);
      expect(jiraResult.created.stories).toBeGreaterThan(0);
      expect(jiraResult.created.tasks).toBeGreaterThan(0);
    });

    test('should optimize parallel execution', async () => {
      const tasks = [
        { id: '1', dependencies: [], estimate: '2h' },
        { id: '2', dependencies: ['1'], estimate: '3h' },
        { id: '3', dependencies: [], estimate: '4h' },
        { id: '4', dependencies: ['2', '3'], estimate: '2h' }
      ];

      const optimizer = paraforge.getOptimizer();
      const schedule = await optimizer.optimizeSchedule(tasks);

      expect(schedule).toBeDefined();
      expect(schedule.parallelGroups).toBeInstanceOf(Array);
      expect(schedule.totalDuration).toBeDefined();
      expect(schedule.criticalPath).toBeInstanceOf(Array);
    });
  });

  describe('Agent Integration', () => {
    test('should coordinate multiple agents', async () => {
      const request = {
        type: 'feature',
        description: 'Add social login functionality',
        priority: 'high'
      };

      const coordination = await orchestrator.coordinateAgents(request);

      expect(coordination).toBeDefined();
      expect(coordination.agents).toBeInstanceOf(Array);
      expect(coordination.agents).toContain('product-owner');
      expect(coordination.agents).toContain('solution-architect');
      expect(coordination.results).toBeDefined();
    });

    test('should handle agent failures gracefully', async () => {
      const faultyRequest = {
        type: 'invalid',
        description: null
      };

      const result = await orchestrator.coordinateAgents(faultyRequest).catch(err => err);

      expect(result).toBeInstanceOf(Error);
      expect(result.message).toContain('validation');
    });
  });

  describe('JIRA Integration', () => {
    test('should connect to JIRA', async () => {
      const connection = await jiraConnector.testConnection();
      expect(connection).toBeDefined();
      expect(connection.success).toBe(true);
    });

    test('should create and link issues', async () => {
      const epic = {
        type: 'Epic',
        summary: 'Test Epic',
        description: 'Test epic description'
      };

      const story = {
        type: 'Story',
        summary: 'Test Story',
        description: 'Test story description'
      };

      const epicResult = await jiraConnector.createIssue(epic);
      const storyResult = await jiraConnector.createIssue(story);
      
      const linkResult = await jiraConnector.linkIssues(
        epicResult.key,
        storyResult.key,
        'Epic-Story'
      );

      expect(epicResult).toHaveProperty('key');
      expect(storyResult).toHaveProperty('key');
      expect(linkResult.success).toBe(true);
    });
  });

  describe('Learning System', () => {
    test('should learn from project outcomes', async () => {
      const projectOutcome = {
        projectId: 'TEST-PROJECT',
        success: true,
        metrics: {
          onTime: true,
          onBudget: false,
          qualityScore: 85,
          teamSatisfaction: 90
        },
        lessons: [
          'Better estimation needed for frontend tasks',
          'Parallel execution improved delivery speed'
        ]
      };

      const learningSystem = paraforge.getLearningSystem();
      const learned = await learningSystem.learn(projectOutcome);

      expect(learned).toBeDefined();
      expect(learned.improvements).toBeInstanceOf(Array);
      expect(learned.adjustments).toBeDefined();
    });
  });

  describe('Performance', () => {
    test('should handle large project efficiently', async () => {
      const largeProject = {
        title: 'Enterprise System',
        epics: Array(10).fill(null).map((_, i) => ({
          title: `Epic ${i + 1}`,
          stories: Array(5).fill(null).map((_, j) => ({
            title: `Story ${i + 1}-${j + 1}`,
            tasks: Array(10).fill(null).map((_, k) => ({
              title: `Task ${i + 1}-${j + 1}-${k + 1}`,
              estimate: '2h'
            }))
          }))
        }))
      };

      const startTime = Date.now();
      const result = await paraforge.processProject(largeProject);
      const duration = Date.now() - startTime;

      expect(result).toBeDefined();
      expect(result.stats.totalTasks).toBe(500);
      expect(duration).toBeLessThan(30000); // Should complete within 30 seconds
    });
  });
});

// Helper function for manual testing
if (require.main === module) {
  console.log('Running ParaForge integration tests...');
  
  const runTests = async () => {
    try {
      const paraforge = new ParaForgeCore({
        jira: {
          host: process.env.JIRA_HOST,
          email: process.env.JIRA_EMAIL,
          apiToken: process.env.JIRA_API_TOKEN
        },
        ai: {
          openai: process.env.OPENAI_API_KEY,
          anthropic: process.env.ANTHROPIC_API_KEY
        }
      });

      await paraforge.initialize();

      // Test idea processing
      const result = await paraforge.processIdea({
        title: 'Test Project',
        description: 'A test project for integration testing',
        goals: ['Test goal 1', 'Test goal 2']
      });

      console.log('Test completed successfully:', result);
      await paraforge.shutdown();
    } catch (error) {
      console.error('Test failed:', error);
      process.exit(1);
    }
  };

  runTests();
}