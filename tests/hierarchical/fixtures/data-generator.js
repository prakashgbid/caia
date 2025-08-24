#!/usr/bin/env node

/**
 * Data Generator for Test Fixtures
 * Generates various test data scenarios for performance and load testing
 */

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

class TestDataGenerator {
  constructor() {
    this.outputDir = path.join(__dirname, '..', 'fixtures', 'generated');
    this.ensureOutputDirectory();
  }

  ensureOutputDirectory() {
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  /**
   * Generate sample architectures with various scales
   */
  generateArchitectures() {
    const architectures = {
      small: this.generateArchitecture(5, 15, 45, 90),
      medium: this.generateArchitecture(15, 60, 180, 360),
      large: this.generateArchitecture(30, 150, 450, 900),
      xlarge: this.generateArchitecture(50, 250, 750, 1500)
    };

    fs.writeFileSync(
      path.join(this.outputDir, 'sample-architectures.json'),
      JSON.stringify(architectures, null, 2)
    );

    console.log('✅ Generated sample architectures');
    return architectures;
  }

  generateArchitecture(epicCount, featureCount, storyCount, taskCount) {
    const initiative = {
      id: `init-${uuidv4().substring(0, 8)}`,
      title: `Generated Initiative ${epicCount}E-${featureCount}F`,
      description: `Generated initiative with ${epicCount} epics, ${featureCount} features, ${storyCount} stories, and ${taskCount} tasks`,
      status: 'planning',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const epics = this.generateEpics(epicCount, initiative.id);
    const features = this.generateFeatures(featureCount, epics);
    const stories = this.generateStories(storyCount, features);
    const tasks = this.generateTasks(taskCount, stories);

    return {
      initiative,
      epics,
      features,
      stories,
      tasks,
      dependencies: {
        features: this.generateDependencies(features, 0.1),
        stories: this.generateDependencies(stories, 0.05),
        tasks: this.generateDependencies(tasks, 0.03)
      },
      estimations: {
        totalStoryPoints: stories.reduce((sum, s) => sum + s.storyPoints, 0),
        totalHours: tasks.reduce((sum, t) => sum + t.estimatedHours, 0),
        totalFeatures: featureCount,
        totalStories: storyCount,
        totalTasks: taskCount
      },
      metadata: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: '1.0.0',
        generated: true
      }
    };
  }

  generateEpics(count, initiativeId) {
    const epicTemplates = [
      'User Management System',
      'Data Processing Engine',
      'API Integration Layer',
      'Reporting Dashboard',
      'Security Framework',
      'Notification System',
      'File Management',
      'Search and Discovery',
      'Analytics Platform',
      'Mobile Application'
    ];

    return Array(count).fill(null).map((_, i) => {
      const template = epicTemplates[i % epicTemplates.length];
      return {
        id: `epic-${uuidv4().substring(0, 8)}`,
        title: `${template} ${Math.floor(i / epicTemplates.length) + 1}`,
        description: `Generated epic for ${template.toLowerCase()} functionality`,
        parentInitiative: initiativeId,
        priority: ['low', 'medium', 'high', 'critical'][i % 4],
        status: 'planning',
        estimatedEffort: { 
          hours: 40 + Math.floor(Math.random() * 80), 
          confidence: 0.6 + Math.random() * 0.3 
        },
        acceptanceCriteria: this.generateAcceptanceCriteria(3, 5),
        tags: this.generateTags(2, 4),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
    });
  }

  generateFeatures(count, epics) {
    const featureTemplates = [
      'User Registration',
      'Data Validation',
      'API Authentication',
      'Report Generation',
      'Access Control',
      'Email Notifications',
      'File Upload',
      'Search Functionality',
      'Data Visualization',
      'Mobile Interface'
    ];

    return Array(count).fill(null).map((_, i) => {
      const template = featureTemplates[i % featureTemplates.length];
      const parentEpic = epics[i % epics.length];
      
      return {
        id: `feature-${uuidv4().substring(0, 8)}`,
        title: `${template} ${Math.floor(i / featureTemplates.length) + 1}`,
        description: `Generated feature for ${template.toLowerCase()}`,
        parentEpic: parentEpic.id,
        priority: ['low', 'medium', 'high'][i % 3],
        status: 'planning',
        estimatedEffort: { 
          hours: 8 + Math.floor(Math.random() * 16), 
          confidence: 0.7 + Math.random() * 0.2 
        },
        acceptanceCriteria: this.generateAcceptanceCriteria(2, 4),
        tags: this.generateTags(1, 3),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
    });
  }

  generateStories(count, features) {
    const userTypes = ['user', 'admin', 'guest', 'manager', 'developer'];
    const actions = ['create', 'read', 'update', 'delete', 'search', 'export', 'import', 'configure'];
    const objects = ['profile', 'data', 'report', 'settings', 'content', 'permissions', 'notifications'];
    const benefits = ['improve efficiency', 'ensure security', 'enhance usability', 'maintain compliance'];

    return Array(count).fill(null).map((_, i) => {
      const parentFeature = features[i % features.length];
      const userType = userTypes[i % userTypes.length];
      const action = actions[i % actions.length];
      const object = objects[i % objects.length];
      const benefit = benefits[i % benefits.length];

      return {
        id: `story-${uuidv4().substring(0, 8)}`,
        title: `${userType} can ${action} ${object}`,
        description: `As a ${userType}, I want to ${action} ${object} so that I can ${benefit}`,
        parentFeature: parentFeature.id,
        asA: userType,
        iWant: `to ${action} ${object}`,
        soThat: `I can ${benefit}`,
        priority: ['low', 'medium', 'high'][i % 3],
        status: 'planning',
        estimatedEffort: { 
          hours: 2 + Math.floor(Math.random() * 6), 
          confidence: 0.8 + Math.random() * 0.15 
        },
        storyPoints: [1, 2, 3, 5, 8][Math.floor(Math.random() * 5)],
        acceptanceCriteria: this.generateAcceptanceCriteria(1, 3),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
    });
  }

  generateTasks(count, stories) {
    const taskTypes = ['development', 'testing', 'documentation', 'deployment', 'research'];
    const taskTemplates = [
      'Implement core functionality',
      'Create unit tests',
      'Write documentation',
      'Set up deployment pipeline',
      'Research technical requirements',
      'Design user interface',
      'Integrate with API',
      'Perform code review',
      'Configure monitoring',
      'Optimize performance'
    ];
    const skills = ['javascript', 'python', 'react', 'nodejs', 'database', 'devops', 'ui-design', 'testing'];

    return Array(count).fill(null).map((_, i) => {
      const parentStory = stories[i % stories.length];
      const taskType = taskTypes[i % taskTypes.length];
      const template = taskTemplates[i % taskTemplates.length];
      const skill = skills[i % skills.length];

      return {
        id: `task-${uuidv4().substring(0, 8)}`,
        title: `${template} ${Math.floor(i / taskTemplates.length) + 1}`,
        description: `${template} for the parent story`,
        parentStory: parentStory.id,
        type: taskType,
        priority: ['low', 'medium', 'high'][i % 3],
        status: 'planning',
        estimatedHours: 1 + Math.floor(Math.random() * 4),
        skillRequired: skill,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
    });
  }

  generateDependencies(items, probability) {
    const dependencies = [];
    
    for (let i = 1; i < items.length; i++) {
      if (Math.random() < probability) {
        const dependentItem = items[i];
        const dependencyItem = items[Math.floor(Math.random() * i)];
        
        dependencies.push({
          id: `dep-${uuidv4().substring(0, 8)}`,
          dependent: dependentItem.id,
          dependency: dependencyItem.id,
          type: 'blocks',
          description: `${dependencyItem.title} must be completed before ${dependentItem.title}`
        });
      }
    }
    
    return dependencies;
  }

  generateAcceptanceCriteria(min, max) {
    const count = min + Math.floor(Math.random() * (max - min + 1));
    const criteria = [];
    
    for (let i = 0; i < count; i++) {
      criteria.push(`Acceptance criterion ${i + 1}: Verify functionality works as expected`);
    }
    
    return criteria;
  }

  generateTags(min, max) {
    const allTags = [
      'frontend', 'backend', 'database', 'api', 'ui', 'security', 
      'performance', 'testing', 'documentation', 'deployment',
      'mobile', 'web', 'integration', 'validation', 'reporting'
    ];
    
    const count = min + Math.floor(Math.random() * (max - min + 1));
    const tags = [];
    
    for (let i = 0; i < count; i++) {
      const tag = allTags[Math.floor(Math.random() * allTags.length)];
      if (!tags.includes(tag)) {
        tags.push(tag);
      }
    }
    
    return tags;
  }

  /**
   * Generate performance test scenarios
   */
  generatePerformanceScenarios() {
    const scenarios = {
      concurrentUsers: this.generateConcurrentUserScenario(),
      largeBatch: this.generateLargeBatchScenario(),
      memoryStress: this.generateMemoryStressScenario(),
      timeoutTest: this.generateTimeoutTestScenario()
    };

    fs.writeFileSync(
      path.join(this.outputDir, 'performance-scenarios.json'),
      JSON.stringify(scenarios, null, 2)
    );

    console.log('✅ Generated performance test scenarios');
    return scenarios;
  }

  generateConcurrentUserScenario() {
    return {
      name: 'Concurrent Users',
      description: 'Test concurrent user interactions',
      users: Array(20).fill(null).map((_, i) => ({
        id: `user-${i}`,
        name: `Test User ${i}`,
        actions: [
          'create_idea',
          'analyze_idea',
          'create_initiative',
          'generate_architecture'
        ],
        maxConcurrentActions: 5
      }))
    };
  }

  generateLargeBatchScenario() {
    return {
      name: 'Large Batch Processing',
      description: 'Process large batches of items',
      batches: [
        { size: 100, type: 'ideas' },
        { size: 500, type: 'features' },
        { size: 1000, type: 'stories' },
        { size: 2000, type: 'tasks' }
      ]
    };
  }

  generateMemoryStressScenario() {
    return {
      name: 'Memory Stress Test',
      description: 'Test memory usage under load',
      iterations: 50,
      itemsPerIteration: 100,
      memoryThresholds: {
        warning: 256 * 1024 * 1024,  // 256MB
        critical: 512 * 1024 * 1024  // 512MB
      }
    };
  }

  generateTimeoutTestScenario() {
    return {
      name: 'Timeout Testing',
      description: 'Test system behavior with timeouts',
      operations: [
        { name: 'idea_analysis', timeout: 5000, expectedTime: 2000 },
        { name: 'initiative_planning', timeout: 15000, expectedTime: 8000 },
        { name: 'architecture_generation', timeout: 30000, expectedTime: 20000 }
      ]
    };
  }

  /**
   * Generate edge case test data
   */
  generateEdgeCases() {
    const edgeCases = {
      emptyData: {
        idea: {
          id: 'empty-idea',
          title: '',
          description: '',
          complexity: 'simple',
          priority: 'low',
          tags: [],
          metadata: {}
        }
      },
      
      extremelyLongData: {
        idea: {
          id: 'long-idea',
          title: 'A'.repeat(1000),
          description: 'B'.repeat(10000),
          complexity: 'complex',
          priority: 'high',
          tags: Array(100).fill('tag').map((t, i) => `${t}-${i}`),
          metadata: {
            longField: 'C'.repeat(5000)
          }
        }
      },
      
      specialCharacters: {
        idea: {
          id: 'special-chars-idea',
          title: '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~',
          description: 'Testing special characters: <>{}[]|\\`~!@#$%^&*()_+-=',
          complexity: 'medium',
          priority: 'medium',
          tags: ['special-chars', 'edge-case'],
          metadata: {
            unicode: '🚀 Unicode test: café naïve résumé'
          }
        }
      },
      
      numericLimits: {
        estimations: {
          verySmall: 0.1,
          veryLarge: Number.MAX_SAFE_INTEGER,
          negative: -1000,
          infinity: Infinity,
          nan: NaN
        }
      }
    };

    fs.writeFileSync(
      path.join(this.outputDir, 'edge-cases.json'),
      JSON.stringify(edgeCases, null, 2)
    );

    console.log('✅ Generated edge case test data');
    return edgeCases;
  }

  /**
   * Generate baseline performance data
   */
  generateBaselineData() {
    const baseline = {
      timestamp: new Date().toISOString(),
      systemInfo: {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        cpus: require('os').cpus().length,
        totalMemory: require('os').totalmem(),
        freeMemory: require('os').freemem()
      },
      benchmarks: {
        ideaAnalysis: {
          simple: { averageTime: 100, maxTime: 200 },
          medium: { averageTime: 300, maxTime: 600 },
          complex: { averageTime: 800, maxTime: 1500 }
        },
        initiativePlanning: {
          smallEpics: { averageTime: 500, maxTime: 1000 },
          mediumEpics: { averageTime: 2000, maxTime: 4000 },
          largeEpics: { averageTime: 5000, maxTime: 10000 }
        },
        architectureGeneration: {
          smallArch: { averageTime: 2000, maxTime: 4000 },
          mediumArch: { averageTime: 8000, maxTime: 15000 },
          largeArch: { averageTime: 20000, maxTime: 40000 }
        }
      }
    };

    fs.writeFileSync(
      path.join(this.outputDir, 'performance-baseline.json'),
      JSON.stringify(baseline, null, 2)
    );

    console.log('✅ Generated performance baseline data');
    return baseline;
  }

  /**
   * Generate all test data
   */
  generateAll() {
    console.log('🚀 Generating test data...\n');
    
    const results = {
      architectures: this.generateArchitectures(),
      performanceScenarios: this.generatePerformanceScenarios(),
      edgeCases: this.generateEdgeCases(),
      baseline: this.generateBaselineData()
    };

    // Generate summary
    const summary = {
      generatedAt: new Date().toISOString(),
      totalFiles: 4,
      architectureSizes: Object.keys(results.architectures).map(size => ({
        size,
        epics: results.architectures[size].epics.length,
        features: results.architectures[size].features.length,
        stories: results.architectures[size].stories.length,
        tasks: results.architectures[size].tasks.length
      }))
    };

    fs.writeFileSync(
      path.join(this.outputDir, 'generation-summary.json'),
      JSON.stringify(summary, null, 2)
    );

    console.log('\n🎉 Test data generation complete!');
    console.log(`📁 Output directory: ${this.outputDir}`);
    console.log(`📊 Generated ${summary.totalFiles} test data files`);
    
    return results;
  }
}

// Run if called directly
if (require.main === module) {
  const generator = new TestDataGenerator();
  generator.generateAll();
}

module.exports = TestDataGenerator;