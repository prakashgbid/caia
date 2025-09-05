# API Reference

Complete API documentation for the CAIA Hierarchical Agent System with examples and type definitions.

---

## 📚 Table of Contents

1. [Core Classes](#core-classes)
   - [HierarchicalAgentSystem](#hierarchicalagentsystem)
   - [TaskDecomposer](#taskdecomposer)
   - [IntelligenceHub](#intelligencehub)
   - [JiraConnectAgent](#jiraconnectagent)
2. [Configuration Interfaces](#configuration-interfaces)
3. [Data Types & Interfaces](#data-types--interfaces)
4. [Events](#events)
5. [Error Handling](#error-handling)
6. [Usage Examples](#usage-examples)

---

## Core Classes

### HierarchicalAgentSystem

The main orchestration class that coordinates all subsystems.

#### Constructor

```typescript
constructor(config?: HierarchicalAgentConfig)
```

**Parameters:**
- `config` (optional): Configuration object for all subsystems

**Example:**
```typescript
import { HierarchicalAgentSystem } from '@caia/hierarchical-agent-system';

const system = new HierarchicalAgentSystem({
  taskDecomposer: {
    enableHierarchicalDecomposition: true,
    maxDepth: 7,
    qualityGateThreshold: 0.90
  },
  jiraConnect: {
    hostUrl: 'https://company.atlassian.net',
    username: 'pm@company.com',
    apiToken: process.env.JIRA_API_TOKEN
  },
  intelligence: {
    enableAnalytics: true
  }
});
```

#### Methods

##### `initialize(): Promise<void>`

Initializes all subsystems and validates configuration.

**Returns:** `Promise<void>`

**Throws:** 
- `Error` - If initialization fails
- `ConfigurationError` - If configuration is invalid

**Example:**
```typescript
try {
  await system.initialize();
  console.log('System ready');
} catch (error) {
  console.error('Initialization failed:', error);
}
```

##### `processProject(options: ProcessProjectOptions): Promise<ProjectResults>`

Main method for processing ideas into structured hierarchies with optional JIRA creation.

**Parameters:**
```typescript
interface ProcessProjectOptions {
  idea: string;                    // Main project description
  context?: string;                // Additional context
  projectKey?: string;             // JIRA project key
  teamContext?: TeamContext;       // Team information
  enableJiraCreation?: boolean;    // Create JIRA issues
}
```

**Returns:** `Promise<ProjectResults>`
```typescript
interface ProjectResults {
  decomposition: EnhancedTaskHierarchy;
  analysis: AnalysisResults;
  jiraResults?: JiraCreationResults;
  recommendations: Recommendation[];
}
```

**Example:**
```typescript
const results = await system.processProject({
  idea: "Create a microservices-based e-commerce platform",
  context: `
    Technology stack: Node.js, React, MongoDB, Redis
    Target: 100K+ concurrent users
    Timeline: 6 months
    Team: 8 developers, 2 DevOps, 1 PM
  `,
  projectKey: "ECOM",
  teamContext: {
    size: 11,
    experience_level: "senior",
    previous_projects: ["payment-system", "user-management"],
    technologies: ["nodejs", "react", "mongodb"]
  },
  enableJiraCreation: true
});

// Access results
console.log('Decomposition:', {
  initiatives: results.decomposition.initiatives.length,
  epics: results.decomposition.epics.length,
  stories: results.decomposition.stories.length,
  confidence: results.decomposition.confidenceScore
});

console.log('Analysis:', {
  riskLevel: results.analysis.risk_assessment.overall_risk_level,
  successProbability: results.analysis.success_predictions.overall_success_probability,
  estimatedHours: results.analysis.estimation_analysis.total_estimated_hours
});

if (results.jiraResults) {
  console.log(`Created ${results.jiraResults.created_issues.length} JIRA issues`);
}
```

##### `getSystemStatus(): Promise<SystemStatus>`

Returns comprehensive system health information.

**Returns:** `Promise<SystemStatus>`
```typescript
interface SystemStatus {
  overall_status: 'healthy' | 'degraded' | 'unhealthy';
  components: Record<string, ComponentStatus>;
  last_check: string;
}

interface ComponentStatus {
  status: string;
  initialized?: boolean;
  error?: string;
  details?: any;
}
```

**Example:**
```typescript
const status = await system.getSystemStatus();

console.log(`System status: ${status.overall_status}`);
for (const [component, info] of Object.entries(status.components)) {
  console.log(`${component}: ${info.status}`);
}
```

##### `shutdown(): Promise<void>`

Gracefully shuts down all subsystems.

**Returns:** `Promise<void>`

**Example:**
```typescript
process.on('SIGINT', async () => {
  console.log('Shutting down...');
  await system.shutdown();
  process.exit(0);
});
```

---

### TaskDecomposer

Handles hierarchical task breakdown with AI-powered analysis.

#### Constructor

```typescript
constructor(githubToken?: string, config?: EnhancedDecomposerConfig)
```

#### Methods

##### `decomposeEnhanced(idea: string, context?: string, options?: DecompositionOptions): Promise<EnhancedTaskHierarchy>`

Advanced decomposition with quality gates and validation.

**Parameters:**
- `idea`: Main project or feature description
- `context` (optional): Additional context and requirements
- `options` (optional): Decomposition configuration

**Returns:** `Promise<EnhancedTaskHierarchy>`

**Example:**
```typescript
import { TaskDecomposer } from '@caia/hierarchical-agent-system';

const decomposer = new TaskDecomposer(process.env.GITHUB_TOKEN, {
  qualityGate: {
    globalConfidenceThreshold: 0.85,
    maxReworkCycles: 3
  }
});

const hierarchy = await decomposer.decomposeEnhanced(
  "Build a real-time chat application",
  "WebSocket-based, user authentication, message history, file sharing",
  {
    enableHierarchicalDecomposition: true,
    maxDepth: 6
  }
);

console.log(hierarchy);
// Output:
// {
//   initiatives: [...],
//   epics: [...],
//   stories: [...],
//   tasks: [...],
//   subtasks: [...],
//   confidenceScore: 0.87,
//   qualityMetrics: {...},
//   relationships: {...}
// }
```

---

### IntelligenceHub

Provides AI-powered project analysis and recommendations.

#### Constructor

```typescript
constructor(adminRoot?: string)
```

#### Methods

##### `processNewProject(projectId: string, projectData: ProjectData, teamContext?: TeamContext): Promise<AnalysisResults>`

Comprehensive project analysis with risk assessment and recommendations.

**Parameters:**
```typescript
interface ProjectData {
  name: string;
  description?: string;
  hierarchy_data: EnhancedTaskHierarchy;
  requirements?: string[];
  constraints?: string[];
}

interface TeamContext {
  size: number;
  experience_level: 'junior' | 'intermediate' | 'senior' | 'expert';
  previous_projects?: string[];
  technologies?: string[];
  timeline_months?: number;
  budget?: number;
}
```

**Returns:** `Promise<AnalysisResults>`
```typescript
interface AnalysisResults {
  confidence_analysis: ConfidenceAnalysis;
  risk_assessment: RiskAssessment;
  estimation_analysis: EstimationAnalysis;
  pattern_analysis: PatternAnalysis;
  success_predictions: SuccessPredictions;
  integrated_recommendations: Recommendation[];
}
```

**Example:**
```typescript
import { IntelligenceHub } from '@caia/hierarchical-agent-system';

const intelligence = new IntelligenceHub('./intelligence-data');

const analysis = await intelligence.processNewProject('PROJ-123', {
  name: "AI-powered recommendation system",
  description: "Machine learning based product recommendations",
  hierarchy_data: decompositionResults
}, {
  size: 6,
  experience_level: "intermediate",
  timeline_months: 4,
  technologies: ["python", "tensorflow", "react", "postgresql"]
});

// Access analysis components
console.log('Risk Assessment:', {
  overallRisk: analysis.risk_assessment.overall_risk_level,
  riskItems: analysis.risk_assessment.risk_items.length,
  mitigationStrategies: analysis.risk_assessment.mitigation_strategies.length
});

console.log('Success Predictions:', {
  probability: analysis.success_predictions.overall_success_probability,
  deliveryConfidence: analysis.success_predictions.delivery_confidence,
  qualityScore: analysis.success_predictions.quality_score
});

console.log('Recommendations:', analysis.integrated_recommendations.length);
```

##### `getSystemStatus(): SystemStatus`

Returns intelligence hub system status.

**Example:**
```typescript
const status = intelligence.getSystemStatus();
console.log(`Intelligence Hub: ${status.overall_health}`);
```

---

### JiraConnectAgent

Native JIRA integration with Advanced Roadmaps support.

#### Constructor

```typescript
constructor(config: JiraConfig)
```

```typescript
interface JiraConfig {
  hostUrl: string;
  username: string;
  apiToken: string;
}
```

#### Methods

##### `initialize(): Promise<void>`

Initializes and validates JIRA connection.

##### `createInitiative(options: JiraIssueOptions): Promise<JiraIssue>`

Creates an Initiative-type issue in JIRA.

##### `createEpic(options: JiraIssueOptions): Promise<JiraIssue>`

Creates an Epic-type issue in JIRA.

##### `createIssue(options: JiraIssueOptions): Promise<JiraIssue>`

Creates any type of JIRA issue.

**Parameters:**
```typescript
interface JiraIssueOptions {
  project: string;                 // JIRA project key
  summary: string;                 // Issue title
  description?: string;            // Issue description
  issueType?: string;             // Issue type (default: 'Task')
  labels?: string[];              // Issue labels
  assignee?: string;              // Assignee username
  priority?: string;              // Issue priority
  customFields?: Record<string, any>; // Custom field values
  parentKey?: string;             // Parent issue key
}
```

**Returns:** `Promise<JiraIssue>`
```typescript
interface JiraIssue {
  id: string;
  key: string;
  self: string;
  fields: {
    summary: string;
    description?: any;
    issuetype: {
      name: string;
      id: string;
    };
    status: {
      name: string;
      id: string;
    };
    assignee?: {
      displayName: string;
      emailAddress: string;
    };
    labels: string[];
    [key: string]: any;
  };
}
```

**Example:**
```typescript
import { JiraConnectAgent } from '@caia/hierarchical-agent-system';

const jira = new JiraConnectAgent({
  hostUrl: 'https://company.atlassian.net',
  username: 'pm@company.com',
  apiToken: process.env.JIRA_API_TOKEN
});

await jira.initialize();

// Create initiative
const initiative = await jira.createInitiative({
  project: 'PROJ',
  summary: 'Digital Transformation Initiative',
  description: 'Company-wide digital transformation program',
  labels: ['strategic', 'digital-transformation']
});

// Create epic under initiative
const epic = await jira.createEpic({
  project: 'PROJ',
  summary: 'Customer Portal Development',
  description: 'Self-service customer portal with account management',
  labels: ['customer-facing', 'portal'],
  customFields: {
    'customfield_10100': initiative.key // Link to initiative
  }
});

// Create stories under epic
const stories = await Promise.all([
  jira.createIssue({
    project: 'PROJ',
    issueType: 'Story',
    summary: 'User Authentication System',
    description: 'As a customer, I want to securely log into my account',
    labels: ['authentication', 'security'],
    customFields: {
      'customfield_10101': epic.key // Epic Link
    }
  }),
  jira.createIssue({
    project: 'PROJ',
    issueType: 'Story',
    summary: 'Account Dashboard',
    description: 'As a customer, I want to view my account information',
    labels: ['dashboard', 'account'],
    customFields: {
      'customfield_10101': epic.key
    }
  })
]);

console.log(`Created initiative ${initiative.key} with epic ${epic.key}`);
console.log(`Created ${stories.length} stories under epic`);
```

---

## Configuration Interfaces

### HierarchicalAgentConfig

```typescript
interface HierarchicalAgentConfig {
  taskDecomposer?: {
    githubToken?: string;
    enableHierarchicalDecomposition?: boolean; // default: true
    maxDepth?: number;                         // default: 7
    qualityGateThreshold?: number;             // default: 0.85
    maxReworkCycles?: number;                  // default: 3
  };
  
  jiraConnect?: {
    hostUrl?: string;
    username?: string;
    apiToken?: string;
    enableAdvancedRoadmaps?: boolean;          // default: true
  };
  
  intelligence?: {
    adminRoot?: string;                        // default: '/tmp/hierarchical-agent-system'
    enableAnalytics?: boolean;                 // default: true
    confidenceThreshold?: number;              // default: 0.85
  };
  
  orchestration?: {
    maxConcurrency?: number;                   // default: 10
    enableQualityGates?: boolean;              // default: true
    retryAttempts?: number;                    // default: 3
  };
  
  integrations?: {
    enableReporting?: boolean;                 // default: true
    enableDocumentation?: boolean;             // default: true
    enableOrchestra?: boolean;                 // default: true
  };
  
  logging?: {
    level?: 'debug' | 'info' | 'warn' | 'error'; // default: 'info'
    enableFileLogging?: boolean;               // default: true
    logDir?: string;                          // default: './logs'
  };
}
```

---

## Data Types & Interfaces

### Task Hierarchy Types

```typescript
interface EnhancedTaskHierarchy {
  initiatives: Initiative[];
  epics: Epic[];
  stories: Story[];
  tasks: Task[];
  subtasks: SubTask[];
  confidenceScore: number;
  qualityMetrics: QualityMetrics;
  relationships: HierarchyRelationships;
}

interface Initiative {
  id: string;
  title: string;
  description: string;
  businessValue: string;
  strategicAlignment: string;
  timeline: {
    estimated_months: number;
    phases: string[];
  };
  dependencies: string[];
  risks: string[];
  success_criteria: string[];
}

interface Epic {
  id: string;
  initiativeId: string;
  title: string;
  description: string;
  userPersona: string;
  businessGoal: string;
  acceptanceCriteria: string[];
  dependencies: string[];
  estimatedStoryPoints: number;
  priority: 'Critical' | 'High' | 'Medium' | 'Low';
  labels: string[];
}

interface Story {
  id: string;
  epicId: string;
  title: string;
  userStory: string;
  acceptanceCriteria: string[];
  priority: 'Critical' | 'High' | 'Medium' | 'Low';
  estimatedStoryPoints: number;
  dependencies: string[];
  labels: string[];
  definition_of_done: string[];
}

interface Task {
  id: string;
  storyId: string;
  title: string;
  description: string;
  type: 'Development' | 'Testing' | 'Documentation' | 'Research' | 'Design';
  estimatedHours: number;
  skills_required: string[];
  dependencies: string[];
  deliverables: string[];
}

interface SubTask {
  id: string;
  taskId: string;
  title: string;
  description: string;
  estimatedHours: number;
  assignee?: string;
  status: 'To Do' | 'In Progress' | 'Review' | 'Done';
}
```

### Analysis Types

```typescript
interface AnalysisResults {
  confidence_analysis: ConfidenceAnalysis;
  risk_assessment: RiskAssessment;
  estimation_analysis: EstimationAnalysis;
  pattern_analysis: PatternAnalysis;
  success_predictions: SuccessPredictions;
  integrated_recommendations: Recommendation[];
}

interface ConfidenceAnalysis {
  overall_confidence: number;
  decomposition_confidence: number;
  requirement_clarity: number;
  technical_feasibility: number;
  confidence_factors: {
    factor: string;
    weight: number;
    score: number;
    reasoning: string;
  }[];
}

interface RiskAssessment {
  overall_risk_level: 'Low' | 'Medium' | 'High' | 'Critical';
  risk_score: number;
  risk_items: {
    category: string;
    description: string;
    probability: number;
    impact: number;
    severity: 'Low' | 'Medium' | 'High' | 'Critical';
    mitigation_strategy: string;
  }[];
  mitigation_strategies: string[];
}

interface SuccessPredictions {
  overall_success_probability: number;
  delivery_confidence: number;
  quality_score: number;
  team_fit_score: number;
  timeline_confidence: number;
  budget_confidence: number;
  factors_analysis: {
    positive_factors: string[];
    risk_factors: string[];
    recommendation: string;
  };
}

interface Recommendation {
  id: string;
  category: 'architecture' | 'process' | 'team' | 'timeline' | 'risk';
  title: string;
  description: string;
  priority: 'Critical' | 'High' | 'Medium' | 'Low';
  impact: 'High' | 'Medium' | 'Low';
  effort: 'High' | 'Medium' | 'Low';
  implementation_steps: string[];
  success_metrics: string[];
}
```

---

## Events

The HierarchicalAgentSystem extends EventEmitter and provides real-time events:

```typescript
// System lifecycle events
system.on('system:initialized', () => {
  console.log('System ready for processing');
});

system.on('system:shutdown', () => {
  console.log('System shut down cleanly');
});

system.on('system:initialization:error', (error: Error) => {
  console.error('Initialization failed:', error);
});

// Project processing events
system.on('project:processing:start', (options: ProcessProjectOptions) => {
  console.log('Starting project processing:', options.idea);
});

system.on('project:processing:complete', (results: ProjectResults) => {
  console.log('Project processing completed');
});

system.on('project:processing:error', (error: Error) => {
  console.error('Project processing failed:', error);
});

// Task decomposition events
system.on('decomposition:complete', (data: EnhancedTaskHierarchy) => {
  console.log(`Decomposition completed: ${data.epics.length} epics, ${data.stories.length} stories`);
});

system.on('quality:gate:complete', (data: any) => {
  console.log(`Quality gate passed with confidence: ${data.confidence}`);
});

// Intelligence analysis events
system.on('analysis:complete', (data: AnalysisResults) => {
  console.log(`Analysis complete - Risk level: ${data.risk_assessment.overall_risk_level}`);
});

// JIRA integration events
system.on('project:jira:complete', (results: any) => {
  console.log(`JIRA integration complete: ${results.created_issues.length} issues created`);
});

// Performance monitoring events
system.on('performance:metrics', (metrics: any) => {
  console.log('Performance metrics:', metrics);
});
```

---

## Error Handling

### Custom Error Types

```typescript
// Configuration errors
class ConfigurationError extends Error {
  constructor(message: string, public field?: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

// JIRA-related errors
class JiraError extends Error {
  constructor(message: string, public statusCode?: number) {
    super(message);
    this.name = 'JiraError';
  }
}

// Decomposition errors
class DecompositionError extends Error {
  constructor(message: string, public confidence?: number) {
    super(message);
    this.name = 'DecompositionError';
  }
}

// Quality gate errors
class QualityGateError extends Error {
  constructor(message: string, public threshold: number, public actual: number) {
    super(message);
    this.name = 'QualityGateError';
  }
}
```

### Error Handling Patterns

```typescript
// Comprehensive error handling
try {
  const results = await system.processProject(options);
  // Process results
} catch (error) {
  if (error instanceof ConfigurationError) {
    console.error('Configuration issue:', error.message);
    // Guide user to fix configuration
  } else if (error instanceof JiraError) {
    console.error('JIRA integration failed:', error.message);
    // Handle JIRA connectivity issues
  } else if (error instanceof DecompositionError) {
    console.error('Decomposition failed:', error.message);
    // Retry with different parameters or manual intervention
  } else if (error instanceof QualityGateError) {
    console.error(`Quality gate failed: ${error.actual} < ${error.threshold}`);
    // Lower threshold or improve input quality
  } else {
    console.error('Unexpected error:', error);
  }
}
```

---

## Usage Examples

### Complete Enterprise Workflow

```typescript
import { 
  HierarchicalAgentSystem,
  HierarchicalAgentConfig 
} from '@caia/hierarchical-agent-system';

const config: HierarchicalAgentConfig = {
  taskDecomposer: {
    enableHierarchicalDecomposition: true,
    maxDepth: 7,
    qualityGateThreshold: 0.90
  },
  jiraConnect: {
    hostUrl: process.env.JIRA_HOST_URL,
    username: process.env.JIRA_USERNAME,
    apiToken: process.env.JIRA_API_TOKEN,
    enableAdvancedRoadmaps: true
  },
  intelligence: {
    enableAnalytics: true,
    confidenceThreshold: 0.85
  },
  orchestration: {
    maxConcurrency: 10,
    enableQualityGates: true
  }
};

const system = new HierarchicalAgentSystem(config);

// Event handling for real-time updates
system.on('decomposition:complete', (data) => {
  console.log(`Created ${data.epics.length} epics, ${data.stories.length} stories`);
});

system.on('analysis:complete', (data) => {
  console.log(`Risk assessment: ${data.risk_assessment.overall_risk_level}`);
  console.log(`Success probability: ${data.success_predictions.overall_success_probability * 100}%`);
});

try {
  await system.initialize();
  
  const results = await system.processProject({
    idea: `Create a comprehensive customer relationship management (CRM) system with:
      - Customer data management and segmentation
      - Sales pipeline tracking and automation
      - Marketing campaign management
      - Customer service ticketing system
      - Analytics and reporting dashboard
      - Mobile applications for sales teams
      - Third-party integrations (email, calendar, accounting)
      - Multi-tenant architecture for enterprise clients`,
    context: `
      Technology requirements:
      - Microservices architecture
      - React frontend with TypeScript
      - Node.js backend services
      - PostgreSQL for transactional data
      - Redis for caching and session management
      - Elasticsearch for search capabilities
      - Docker containerization
      - Kubernetes orchestration
      - AWS cloud deployment
      
      Business requirements:
      - Support 10,000+ concurrent users
      - 99.9% uptime SLA
      - GDPR and SOC2 compliance
      - Multi-language support (English, Spanish, French)
      - Real-time notifications and updates
      - Advanced security with SSO integration
    `,
    projectKey: "CRM",
    teamContext: {
      size: 15,
      experience_level: "senior",
      previous_projects: ["e-commerce-platform", "user-management-system"],
      technologies: ["nodejs", "react", "postgresql", "docker", "kubernetes"],
      timeline_months: 8,
      budget: 800000
    },
    enableJiraCreation: true
  });
  
  // Process results
  console.log('\n=== DECOMPOSITION SUMMARY ===');
  console.log(`Initiatives: ${results.decomposition.initiatives.length}`);
  console.log(`Epics: ${results.decomposition.epics.length}`);
  console.log(`Stories: ${results.decomposition.stories.length}`);
  console.log(`Tasks: ${results.decomposition.tasks.length}`);
  console.log(`Overall Confidence: ${results.decomposition.confidenceScore}`);
  
  console.log('\n=== INTELLIGENCE ANALYSIS ===');
  console.log(`Risk Level: ${results.analysis.risk_assessment.overall_risk_level}`);
  console.log(`Success Probability: ${(results.analysis.success_predictions.overall_success_probability * 100).toFixed(1)}%`);
  console.log(`Estimated Hours: ${results.analysis.estimation_analysis.total_estimated_hours}`);
  console.log(`Key Risks: ${results.analysis.risk_assessment.risk_items.length}`);
  
  if (results.jiraResults) {
    console.log('\n=== JIRA INTEGRATION ===');
    console.log(`Created Issues: ${results.jiraResults.created_issues.length}`);
    console.log(`Errors: ${results.jiraResults.errors.length}`);
    
    // Display created issues
    results.jiraResults.created_issues.forEach(issue => {
      console.log(`- ${issue.type.toUpperCase()}: ${issue.jira_key}`);
    });
  }
  
  console.log('\n=== RECOMMENDATIONS ===');
  results.recommendations.forEach((rec, index) => {
    console.log(`${index + 1}. [${rec.priority}] ${rec.title}`);
    console.log(`   ${rec.description}`);
  });
  
} catch (error) {
  console.error('Processing failed:', error);
} finally {
  await system.shutdown();
}
```

### Batch Processing Multiple Projects

```typescript
const projectIdeas = [
  {
    idea: "Build a real-time analytics dashboard",
    projectKey: "DASH",
    context: "React, D3.js, WebSocket, high-frequency data"
  },
  {
    idea: "Create a mobile app for inventory management", 
    projectKey: "INV",
    context: "React Native, barcode scanning, offline sync"
  },
  {
    idea: "Develop an API gateway for microservices",
    projectKey: "API",
    context: "Node.js, rate limiting, authentication, monitoring"
  }
];

// Process all projects in parallel
const results = await Promise.all(
  projectIdeas.map(project => 
    system.processProject({
      ...project,
      enableJiraCreation: true
    })
  )
);

// Analyze batch results
const totalIssues = results.reduce((sum, result) => 
  sum + (result.jiraResults?.created_issues.length || 0), 0);

const avgConfidence = results.reduce((sum, result) => 
  sum + result.decomposition.confidenceScore, 0) / results.length;

console.log(`Batch processing complete:`);
console.log(`- Projects processed: ${results.length}`);
console.log(`- Total JIRA issues created: ${totalIssues}`);
console.log(`- Average confidence: ${avgConfidence.toFixed(2)}`);
```

---

This API reference provides comprehensive documentation for all public interfaces and methods. For more examples and advanced usage patterns, see the [Examples and Tutorials](Examples-and-Tutorials) page.