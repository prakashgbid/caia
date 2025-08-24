---
layout: default
title: API Reference
description: Complete API documentation for the Hierarchical Agent System with examples and type definitions
---

# API Reference

This comprehensive API reference provides detailed documentation for all classes, methods, and interfaces available in the Hierarchical Agent System.

## Table of Contents

- [HierarchicalAgentSystem](#hierarchicalagentsystem) - Main system orchestrator
- [TaskDecomposer](#taskdecomposer) - AI-powered task breakdown
- [IntelligenceHub](#intelligencehub) - Analytics and intelligence
- [JiraConnectAgent](#jiraconnectagent) - JIRA integration
- [Orchestrator](#orchestrator) - Workflow management
- [Types & Interfaces](#types--interfaces) - TypeScript definitions
- [Events](#events) - Event system reference
- [Error Handling](#error-handling) - Exception types and handling

---

## HierarchicalAgentSystem

The main system class that orchestrates all components for hierarchical project decomposition.

### Constructor

```typescript
new HierarchicalAgentSystem(config?: HierarchicalAgentConfig)
```

**Parameters:**
- `config` (optional): System configuration object

**Example:**
```typescript
import { HierarchicalAgentSystem } from '@caia/hierarchical-agent-system';

const system = new HierarchicalAgentSystem({
  taskDecomposer: {
    enableHierarchicalDecomposition: true,
    qualityGateThreshold: 0.90
  },
  jiraConnect: {
    hostUrl: 'https://company.atlassian.net',
    username: 'user@company.com',
    apiToken: 'your-api-token'
  }
});
```

### Methods

#### `initialize(): Promise<void>`

Initializes all subsystems and validates configuration.

```typescript
await system.initialize();
```

**Throws:**
- `SystemInitializationError` - When initialization fails
- `ConfigurationError` - When configuration is invalid

**Example:**
```typescript
try {
  await system.initialize();
  console.log('System ready');
} catch (error) {
  console.error('Initialization failed:', error.message);
}
```

#### `processProject(options): Promise<ProjectResults>`

Main method for processing ideas into structured hierarchies.

**Parameters:**
```typescript
interface ProcessProjectOptions {
  idea: string;                    // Project description
  context?: string;                // Additional context
  projectKey?: string;             // JIRA project key
  teamContext?: TeamContext;       // Team information
  enableJiraCreation?: boolean;    // Create JIRA issues
  qualityGateThreshold?: number;   // Override quality threshold
}
```

**Returns:** `Promise<ProjectResults>`

**Example:**
```typescript
const results = await system.processProject({
  idea: "Create a microservices-based e-commerce platform",
  context: "Node.js, React, MongoDB, Docker, 100K+ users",
  projectKey: "ECOM",
  teamContext: {
    size: 8,
    experience_level: "senior",
    technologies: ["nodejs", "react", "mongodb"]
  },
  enableJiraCreation: true
});

console.log(`Created ${results.decomposition.epics.length} epics`);
console.log(`Success probability: ${results.analysis.success_predictions.overall_success_probability}%`);
```

#### `getSystemStatus(): Promise<SystemStatus>`

Returns comprehensive system health information.

**Returns:** `Promise<SystemStatus>`

**Example:**
```typescript
const status = await system.getSystemStatus();

console.log(`Overall status: ${status.overall_status}`);
Object.entries(status.components).forEach(([name, info]) => {
  console.log(`${name}: ${info.status}`);
});
```

#### `shutdown(): Promise<void>`

Gracefully shuts down all subsystems.

```typescript
await system.shutdown();
```

### Events

The system emits events for real-time monitoring:

```typescript
system.on('system:initialized', () => {
  console.log('System ready for processing');
});

system.on('decomposition:started', (data) => {
  console.log(`Starting decomposition for: ${data.idea}`);
});

system.on('decomposition:complete', (data: TaskHierarchy) => {
  console.log(`Decomposition completed: ${data.epics.length} epics`);
});

system.on('analysis:complete', (data: AnalysisResults) => {
  console.log(`Risk level: ${data.risk_assessment.overall_risk_level}`);
});

system.on('project:processing:complete', (results: ProjectResults) => {
  console.log('Project processing finished successfully');
});

system.on('project:processing:error', (error: Error) => {
  console.error('Processing failed:', error);
});
```

---

## TaskDecomposer

Handles hierarchical task breakdown with AI-powered analysis.

### Constructor

```typescript
new TaskDecomposer(config?: TaskDecomposerConfig)
```

### Methods

#### `decomposeEnhanced(idea, context?, options?): Promise<EnhancedTaskHierarchy>`

Advanced decomposition with quality gates and validation.

**Parameters:**
```typescript
decomposeEnhanced(
  idea: string,
  context?: string,
  options?: {
    maxDepth?: number;
    qualityGateThreshold?: number;
    enableGitHubAnalysis?: boolean;
  }
): Promise<EnhancedTaskHierarchy>
```

**Example:**
```typescript
const decomposer = new TaskDecomposer({
  enableHierarchicalDecomposition: true,
  maxDepth: 7,
  qualityGateThreshold: 0.85
});

const hierarchy = await decomposer.decomposeEnhanced(
  "Build a real-time chat application",
  "WebSocket-based, React frontend, Node.js backend, support 10K concurrent users",
  {
    maxDepth: 6,
    qualityGateThreshold: 0.90
  }
);

console.log(`Confidence score: ${hierarchy.confidenceScore}`);
console.log(`Generated ${hierarchy.stories.length} user stories`);
```

#### `analyzeComplexity(hierarchy): Promise<ComplexityAnalysis>`

Analyzes the complexity of a decomposed hierarchy.

**Example:**
```typescript
const complexity = await decomposer.analyzeComplexity(hierarchy);

console.log(`Estimated effort: ${complexity.estimated_hours} hours`);
console.log(`Complexity level: ${complexity.complexity_level}`);
console.log(`Risk factors: ${complexity.risk_factors.length}`);
```

---

## IntelligenceHub

Provides AI-powered project analysis and recommendations.

### Constructor

```typescript
new IntelligenceHub(adminRoot?: string)
```

### Methods

#### `processNewProject(projectId, projectData, teamContext?): Promise<AnalysisResults>`

Comprehensive project analysis with risk assessment and recommendations.

**Parameters:**
```typescript
processNewProject(
  projectId: string,
  projectData: {
    name: string;
    hierarchy_data: TaskHierarchy;
    description?: string;
  },
  teamContext?: TeamContext
): Promise<AnalysisResults>
```

**Example:**
```typescript
const intelligence = new IntelligenceHub('./intelligence-data');

const analysis = await intelligence.processNewProject('PROJ-123', {
  name: "E-commerce Platform",
  hierarchy_data: decompositionResults,
  description: "Modern e-commerce platform with AI recommendations"
}, {
  team_size: 6,
  experience_level: "intermediate",
  timeline_months: 4,
  budget_usd: 500000
});

console.log(`Overall confidence: ${analysis.confidence_analysis.overall_confidence}`);
console.log(`Risk level: ${analysis.risk_assessment.overall_risk_level}`);
console.log(`Success probability: ${analysis.success_predictions.overall_success_probability}`);
```

#### `getRiskAssessment(projectData): Promise<RiskAssessment>`

Dedicated risk assessment for project planning.

**Example:**
```typescript
const risks = await intelligence.getRiskAssessment(projectData);

risks.risk_items.forEach(risk => {
  console.log(`${risk.severity}: ${risk.description}`);
  console.log(`Mitigation: ${risk.mitigation_strategy}`);
});
```

#### `getRecommendations(projectData, teamContext): Promise<Recommendation[]>`

Get actionable recommendations for project success.

**Example:**
```typescript
const recommendations = await intelligence.getRecommendations(projectData, teamContext);

recommendations.forEach((rec, index) => {
  console.log(`${index + 1}. [${rec.priority}] ${rec.title}`);
  console.log(`   ${rec.description}`);
  console.log(`   Expected impact: ${rec.expected_impact}`);
});
```

---

## JiraConnectAgent

Native JIRA integration with Advanced Roadmaps support.

### Constructor

```typescript
new JiraConnectAgent(config: JiraConfig)
```

**Parameters:**
```typescript
interface JiraConfig {
  hostUrl: string;
  username: string;
  apiToken: string;
  enableAdvancedRoadmaps?: boolean;
  customFields?: Record<string, string>;
  issueTypes?: Record<string, string>;
}
```

### Methods

#### `initialize(): Promise<void>`

Initialize JIRA connection and validate credentials.

```typescript
const jiraAgent = new JiraConnectAgent({
  hostUrl: 'https://company.atlassian.net',
  username: 'user@company.com',
  apiToken: process.env.JIRA_API_TOKEN
});

await jiraAgent.initialize();
```

#### `createInitiative(options): Promise<JiraIssue>`

Create a strategic initiative in JIRA.

**Parameters:**
```typescript
interface InitiativeOptions {
  project: string;
  summary: string;
  description?: string;
  labels?: string[];
  assignee?: string;
  priority?: string;
  customFields?: Record<string, any>;
}
```

**Example:**
```typescript
const initiative = await jiraAgent.createInitiative({
  project: 'PROJ',
  summary: 'Digital Transformation Initiative',
  description: 'Company-wide digital transformation program',
  labels: ['strategic', 'digital-transformation'],
  customFields: {
    'customfield_10100': 'High',  // Business Value
    'customfield_10101': 'Strategic'  // Strategic Alignment
  }
});

console.log(`Created initiative: ${initiative.key}`);
```

#### `createEpic(options): Promise<JiraIssue>`

Create an epic with proper hierarchy links.

**Example:**
```typescript
const epic = await jiraAgent.createEpic({
  project: 'PROJ',
  summary: 'Customer Portal Development',
  description: 'Self-service customer portal with account management',
  labels: ['customer-facing', 'portal'],
  parent: initiative.key  // Link to parent initiative
});
```

#### `createIssue(options): Promise<JiraIssue>`

Create any type of JIRA issue.

**Parameters:**
```typescript
interface JiraIssueOptions {
  project: string;
  summary: string;
  description?: string;
  issueType?: string;
  labels?: string[];
  assignee?: string;
  priority?: string;
  parent?: string;
  customFields?: Record<string, any>;
}
```

**Example:**
```typescript
const story = await jiraAgent.createIssue({
  project: 'PROJ',
  issueType: 'Story',
  summary: 'User Authentication System',
  description: 'As a customer, I want to securely log into my account',
  labels: ['authentication', 'security'],
  parent: epic.key,
  customFields: {
    'customfield_10104': 8  // Story Points
  }
});
```

#### `bulkCreateIssues(issues): Promise<BulkCreationResults>`

Create multiple issues efficiently.

**Example:**
```typescript
const issues = [
  {
    project: 'PROJ',
    issueType: 'Story',
    summary: 'Login Form UI',
    parent: epic.key
  },
  {
    project: 'PROJ',
    issueType: 'Story', 
    summary: 'Authentication API',
    parent: epic.key
  }
];

const results = await jiraAgent.bulkCreateIssues(issues);

console.log(`Created: ${results.successful.length}`);
console.log(`Failed: ${results.failed.length}`);
```

#### `linkIssues(sourceKey, targetKey, linkType): Promise<void>`

Create links between issues.

**Example:**
```typescript
await jiraAgent.linkIssues('PROJ-1', 'PROJ-2', 'Blocks');
await jiraAgent.linkIssues('PROJ-3', 'PROJ-4', 'Relates');
```

---

## Types & Interfaces

### Core Configuration Types

```typescript
interface HierarchicalAgentConfig {
  taskDecomposer?: TaskDecomposerConfig;
  jiraConnect?: JiraConfig;
  intelligence?: IntelligenceConfig;
  orchestration?: OrchestrationConfig;
  integrations?: IntegrationsConfig;
  logging?: LoggingConfig;
}

interface TaskDecomposerConfig {
  githubToken?: string;
  enableHierarchicalDecomposition?: boolean;
  maxDepth?: number;
  qualityGateThreshold?: number;
  maxReworkCycles?: number;
}

interface IntelligenceConfig {
  adminRoot?: string;
  enableAnalytics?: boolean;
  confidenceThreshold?: number;
  enableHistoricalAnalysis?: boolean;
}

interface OrchestrationConfig {
  maxConcurrency?: number;
  enableQualityGates?: boolean;
  retryAttempts?: number;
  timeoutMs?: number;
}
```

### Project Processing Types

```typescript
interface ProjectResults {
  decomposition: EnhancedTaskHierarchy;
  analysis: AnalysisResults;
  jiraResults?: JiraCreationResults;
  recommendations: Recommendation[];
  metadata: ProcessingMetadata;
}

interface EnhancedTaskHierarchy {
  initiatives: Initiative[];
  epics: Epic[];
  stories: Story[];
  tasks: Task[];
  subtasks: SubTask[];
  components: Component[];
  atomicUnits: AtomicUnit[];
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
  estimatedDuration: number;
  confidenceScore: number;
}

interface Epic {
  id: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  estimatedStoryPoints: number;
  priority: 'High' | 'Medium' | 'Low';
  dependencies: string[];
  parentInitiativeId: string;
}

interface Story {
  id: string;
  title: string;
  description: string;
  userStory: string;
  acceptanceCriteria: string[];
  estimatedStoryPoints: number;
  priority: 'High' | 'Medium' | 'Low';
  tags: string[];
  parentEpicId: string;
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

interface RiskAssessment {
  overall_risk_level: 'Low' | 'Medium' | 'High' | 'Critical';
  risk_score: number;
  risk_items: RiskItem[];
  mitigation_strategies: MitigationStrategy[];
}

interface RiskItem {
  id: string;
  category: string;
  severity: 'Low' | 'Medium' | 'High' | 'Critical';
  probability: number;
  impact: number;
  description: string;
  mitigation_strategy: string;
  owner?: string;
}

interface Recommendation {
  id: string;
  title: string;
  description: string;
  priority: 'High' | 'Medium' | 'Low';
  category: string;
  expected_impact: string;
  implementation_effort: string;
  timeline: string;
  dependencies: string[];
}
```

### JIRA Types

```typescript
interface JiraIssue {
  id: string;
  key: string;
  self: string;
  fields: {
    summary: string;
    description?: string;
    issuetype: {
      name: string;
      iconUrl: string;
    };
    project: {
      key: string;
      name: string;
    };
    status: {
      name: string;
      statusCategory: {
        name: string;
      };
    };
    assignee?: {
      displayName: string;
      emailAddress: string;
    };
    created: string;
    updated: string;
  };
}

interface JiraCreationResults {
  created_issues: JiraIssue[];
  failed_issues: FailedIssueCreation[];
  errors: string[];
  summary: {
    total_attempted: number;
    total_created: number;
    total_failed: number;
    success_rate: number;
  };
}
```

### Team Context Types

```typescript
interface TeamContext {
  size: number;
  experience_level: 'junior' | 'intermediate' | 'senior' | 'mixed';
  technologies: string[];
  previous_projects: string[];
  timeline_months?: number;
  budget_usd?: number;
  constraints?: string[];
  preferences?: {
    methodology: 'agile' | 'waterfall' | 'hybrid';
    testing_approach: 'tdd' | 'bdd' | 'standard';
    deployment_preference: 'cloud' | 'onprem' | 'hybrid';
  };
}
```

### System Status Types

```typescript
interface SystemStatus {
  overall_status: 'healthy' | 'degraded' | 'unhealthy';
  components: Record<string, ComponentStatus>;
  last_check: string;
  uptime: number;
  version: string;
}

interface ComponentStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  last_check: string;
  response_time_ms?: number;
  error?: string;
  metrics?: Record<string, any>;
}
```

---

## Events

The system uses an event-driven architecture for real-time monitoring and integration.

### System Events

```typescript
// System lifecycle
system.on('system:initializing', () => { /* System startup */ });
system.on('system:initialized', () => { /* System ready */ });
system.on('system:shutdown', () => { /* System shutdown */ });

// Health monitoring
system.on('system:health:check', (status: SystemStatus) => { /* Health update */ });
system.on('system:degraded', (component: string) => { /* Performance issue */ });
system.on('system:recovered', (component: string) => { /* Issue resolved */ });
```

### Processing Events

```typescript
// Project processing lifecycle
system.on('project:processing:started', (data: { idea: string, projectKey?: string }) => {});
system.on('project:processing:progress', (data: { step: string, progress: number }) => {});
system.on('project:processing:complete', (results: ProjectResults) => {});
system.on('project:processing:error', (error: Error) => {});

// Decomposition events
system.on('decomposition:started', (data: { idea: string }) => {});
system.on('decomposition:progress', (data: { level: number, items: number }) => {});
system.on('decomposition:complete', (hierarchy: TaskHierarchy) => {});
system.on('decomposition:quality_gate_failed', (data: { level: number, confidence: number }) => {});

// Analysis events
system.on('analysis:started', (projectId: string) => {});
system.on('analysis:risk_detected', (risk: RiskItem) => {});
system.on('analysis:complete', (results: AnalysisResults) => {});
```

### JIRA Events

```typescript
// JIRA integration events
system.on('jira:connecting', () => {});
system.on('jira:connected', () => {});
system.on('jira:connection_failed', (error: Error) => {});

// Issue creation events
system.on('jira:issue:creating', (summary: string) => {});
system.on('jira:issue:created', (issue: JiraIssue) => {});
system.on('jira:issue:failed', (error: { summary: string, error: string }) => {});
system.on('jira:bulk:complete', (results: BulkCreationResults) => {});
```

### Performance Events

```typescript
// Performance monitoring
system.on('performance:metrics', (metrics: PerformanceMetrics) => {});
system.on('performance:slow_operation', (data: { operation: string, duration: number }) => {});
system.on('performance:memory_warning', (usage: MemoryUsage) => {});

interface PerformanceMetrics {
  decomposition_duration_ms: number;
  analysis_duration_ms: number;
  jira_creation_duration_ms: number;
  overall_confidence_score: number;
  memory_usage_mb: number;
  cpu_usage_percent: number;
}
```

---

## Error Handling

The system provides comprehensive error handling with specific exception types.

### Exception Hierarchy

```typescript
// Base error class
class HierarchicalAgentError extends Error {
  code: string;
  context?: any;
  
  constructor(message: string, code: string, context?: any) {
    super(message);
    this.name = 'HierarchicalAgentError';
    this.code = code;
    this.context = context;
  }
}

// Specific error types
class SystemInitializationError extends HierarchicalAgentError {}
class ConfigurationError extends HierarchicalAgentError {}
class DecompositionError extends HierarchicalAgentError {}
class QualityGateError extends HierarchicalAgentError {}
class JiraIntegrationError extends HierarchicalAgentError {}
class IntelligenceError extends HierarchicalAgentError {}
```

### Error Handling Examples

```typescript
import { 
  SystemInitializationError, 
  DecompositionError, 
  JiraIntegrationError 
} from '@caia/hierarchical-agent-system';

try {
  await system.initialize();
  const results = await system.processProject({
    idea: "Build a complex system",
    enableJiraCreation: true
  });
} catch (error) {
  if (error instanceof SystemInitializationError) {
    console.error('System initialization failed:', error.message);
    console.error('Context:', error.context);
  } else if (error instanceof DecompositionError) {
    console.error('Task decomposition failed:', error.message);
    // Maybe retry with different parameters
  } else if (error instanceof JiraIntegrationError) {
    console.error('JIRA integration failed:', error.message);
    // Continue without JIRA creation
  } else {
    console.error('Unexpected error:', error);
  }
}
```

### Retry Mechanisms

```typescript
// Built-in retry for quality gates
const results = await system.processProject({
  idea: "Complex project",
  options: {
    maxReworkCycles: 5,  // Retry up to 5 times if quality gates fail
    qualityGateThreshold: 0.85
  }
});

// Manual retry logic
async function processWithRetry(idea: string, maxAttempts: number = 3) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await system.processProject({ idea });
    } catch (error) {
      if (attempt === maxAttempts) throw error;
      
      console.log(`Attempt ${attempt} failed, retrying...`);
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
  }
}
```

## Usage Examples

### Basic Usage

```typescript
import { HierarchicalAgentSystem } from '@caia/hierarchical-agent-system';

const system = new HierarchicalAgentSystem();
await system.initialize();

const results = await system.processProject({
  idea: "Create a customer dashboard with real-time analytics"
});

console.log(`Generated ${results.decomposition.stories.length} user stories`);
```

### Advanced Configuration

```typescript
const system = new HierarchicalAgentSystem({
  taskDecomposer: {
    enableHierarchicalDecomposition: true,
    maxDepth: 7,
    qualityGateThreshold: 0.90,
    maxReworkCycles: 5
  },
  jiraConnect: {
    hostUrl: process.env.JIRA_HOST_URL,
    username: process.env.JIRA_USERNAME,
    apiToken: process.env.JIRA_API_TOKEN,
    enableAdvancedRoadmaps: true,
    customFields: {
      storyPoints: 'customfield_10001',
      epicName: 'customfield_10002'
    }
  },
  intelligence: {
    enableAnalytics: true,
    confidenceThreshold: 0.85
  },
  orchestration: {
    maxConcurrency: 20,
    enableQualityGates: true,
    retryAttempts: 5
  }
});
```

### Event-Driven Processing

```typescript
// Set up event listeners for monitoring
system.on('decomposition:complete', (hierarchy) => {
  console.log(`Decomposition completed with ${hierarchy.confidenceScore * 100}% confidence`);
});

system.on('analysis:complete', (analysis) => {
  if (analysis.risk_assessment.overall_risk_level === 'High') {
    console.warn('High risk project detected!');
    // Send notifications, create alerts, etc.
  }
});

system.on('jira:bulk:complete', (results) => {
  console.log(`JIRA creation: ${results.summary.success_rate * 100}% success rate`);
});

// Process project with monitoring
const results = await system.processProject({
  idea: "Enterprise-scale microservices platform",
  enableJiraCreation: true
});
```

---

For more examples and advanced usage patterns, see our [Examples section](examples/) and [GitHub repository]({{ site.github_repo }}).

## Support

- 📖 [Documentation](/)
- 💬 [Discord Community]({{ site.discord_invite }})
- 🐛 [Issue Tracker]({{ site.github_repo }}/issues)
- 📧 [Email Support](mailto:support@caia.dev)