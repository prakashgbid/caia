---
layout: default
title: API Documentation
description: Complete API reference for the Hierarchical Agent System
---

# API Documentation

Comprehensive API reference for integrating the Hierarchical Agent System into your applications.

## Table of Contents

- [Installation](#installation)
- [HierarchicalAgentSystem](#hierarchicalagentsystem)
- [Configuration](#configuration)
- [Core Methods](#core-methods)
- [Event System](#event-system)
- [Component APIs](#component-apis)
- [Type Definitions](#type-definitions)
- [Examples](#examples)

## Installation

```bash
npm install {{ site.npm_package }}
```

```typescript
import { HierarchicalAgentSystem } from '{{ site.npm_package }}';
```

## HierarchicalAgentSystem

The main system class that orchestrates all components.

### Constructor

```typescript
new HierarchicalAgentSystem(config?: HierarchicalAgentConfig)
```

**Parameters:**
- `config` (optional): Configuration object for the system

**Example:**
```typescript
const system = new HierarchicalAgentSystem({
  jiraConnect: {
    hostUrl: 'https://your-domain.atlassian.net',
    username: 'your-email@company.com',
    apiToken: 'your-api-token'
  },
  intelligence: {
    enableAnalytics: true
  }
});
```

## Configuration

### HierarchicalAgentConfig

```typescript
interface HierarchicalAgentConfig {
  taskDecomposer?: TaskDecomposerConfig;
  jiraConnect?: JiraConnectConfig;
  intelligence?: IntelligenceConfig;
  orchestration?: OrchestrationConfig;
  integrations?: IntegrationsConfig;
  logging?: LoggingConfig;
}
```

### TaskDecomposerConfig

```typescript
interface TaskDecomposerConfig {
  githubToken?: string;
  enableHierarchicalDecomposition?: boolean; // Default: true
  maxDepth?: number; // Default: 7
  qualityGateThreshold?: number; // Default: 0.85
  maxReworkCycles?: number; // Default: 3
}
```

### JiraConnectConfig

```typescript
interface JiraConnectConfig {
  hostUrl?: string;
  username?: string;
  apiToken?: string;
  enableAdvancedRoadmaps?: boolean; // Default: false
  customFields?: Record<string, string>;
  issueTypes?: {
    initiative?: string;
    epic?: string;
    story?: string;
    task?: string;
    subtask?: string;
  };
}
```

### IntelligenceConfig

```typescript
interface IntelligenceConfig {
  adminRoot?: string; // Default: './intelligence-data'
  enableAnalytics?: boolean; // Default: true
  confidenceThreshold?: number; // Default: 0.85
}
```

### OrchestrationConfig

```typescript
interface OrchestrationConfig {
  maxConcurrency?: number; // Default: 10
  enableQualityGates?: boolean; // Default: true
  retryAttempts?: number; // Default: 3
  timeoutMs?: number; // Default: 300000
}
```

## Core Methods

### initialize()

Initializes all subsystems and validates configuration.

```typescript
async initialize(): Promise<void>
```

**Example:**
```typescript
const system = new HierarchicalAgentSystem(config);
await system.initialize();
```

### processProject()

Main method for processing ideas into structured hierarchies.

```typescript
async processProject(options: ProcessProjectOptions): Promise<ProjectResults>
```

**Parameters:**
```typescript
interface ProcessProjectOptions {
  idea: string;
  context?: string;
  projectKey?: string;
  teamContext?: TeamContext;
  enableJiraCreation?: boolean;
}
```

**Returns:**
```typescript
interface ProjectResults {
  decomposition: TaskHierarchy;
  analysis: AnalysisResults;
  jiraResults?: JiraCreationResults;
  recommendations: Recommendation[];
}
```

**Example:**
```typescript
const results = await system.processProject({
  idea: "Create a customer feedback system",
  context: "Web application with real-time analytics",
  projectKey: "FEEDBACK",
  enableJiraCreation: true
});
```

### getSystemStatus()

Returns comprehensive system health information.

```typescript
async getSystemStatus(): Promise<SystemStatus>
```

**Returns:**
```typescript
interface SystemStatus {
  overall_status: 'healthy' | 'degraded' | 'unhealthy';
  components: Record<string, ComponentStatus>;
  last_check: string;
  performance_metrics?: PerformanceMetrics;
}
```

**Example:**
```typescript
const status = await system.getSystemStatus();
console.log(`System status: ${status.overall_status}`);
```

### shutdown()

Gracefully shuts down all subsystems.

```typescript
async shutdown(): Promise<void>
```

**Example:**
```typescript
await system.shutdown();
```

## Event System

The system emits events for real-time monitoring and integration.

### Available Events

```typescript
// System lifecycle
system.on('system:initialized', () => {});
system.on('system:shutdown', () => {});
system.on('system:error', (error: Error) => {});

// Processing events
system.on('project:processing:start', (data: ProcessingStartData) => {});
system.on('project:processing:complete', (results: ProjectResults) => {});
system.on('project:processing:error', (error: Error) => {});

// Decomposition events
system.on('decomposition:start', (data: DecompositionStartData) => {});
system.on('decomposition:complete', (data: TaskHierarchy) => {});
system.on('decomposition:quality_gate', (data: QualityGateData) => {});

// Analysis events
system.on('analysis:start', (data: AnalysisStartData) => {});
system.on('analysis:complete', (data: AnalysisResults) => {});

// JIRA events
system.on('jira:creation:start', (data: JiraCreationStartData) => {});
system.on('jira:creation:complete', (data: JiraCreationResults) => {});
system.on('jira:creation:error', (error: Error) => {});

// Performance events
system.on('performance:metrics', (metrics: PerformanceMetrics) => {});
```

### Event Examples

```typescript
// Monitor processing progress
system.on('decomposition:complete', (data) => {
  console.log(`Decomposition completed:`);
  console.log(`- ${data.epics.length} epics`);
  console.log(`- ${data.stories.length} stories`);
  console.log(`- ${data.tasks.length} tasks`);
  console.log(`- Confidence: ${data.confidenceScore}`);
});

// Track analysis results
system.on('analysis:complete', (data) => {
  console.log(`Analysis completed:`);
  console.log(`- Risk level: ${data.risk_assessment.overall_risk_level}`);
  console.log(`- Success probability: ${data.success_predictions.overall_success_probability}`);
});

// Monitor JIRA creation
system.on('jira:creation:complete', (data) => {
  console.log(`Created ${data.created_issues.length} JIRA issues`);
  if (data.errors.length > 0) {
    console.warn(`${data.errors.length} errors occurred`);
  }
});
```

## Component APIs

### TaskDecomposer

Handles hierarchical task breakdown with AI-powered analysis.

```typescript
import { TaskDecomposer } from '{{ site.npm_package }}';

const decomposer = new TaskDecomposer({
  githubToken: 'your-token',
  maxDepth: 7,
  qualityGateThreshold: 0.85
});

// Enhanced decomposition with quality gates
const hierarchy = await decomposer.decomposeEnhanced(
  "Build a mobile app",
  "React Native with offline support",
  { enableQualityGates: true }
);
```

### IntelligenceHub

Provides AI-powered project analysis and recommendations.

```typescript
import { IntelligenceHub } from '{{ site.npm_package }}';

const intelligence = new IntelligenceHub('./intelligence-data');

// Analyze a project
const analysis = await intelligence.processNewProject(
  'PROJ-123',
  {
    name: "AI-powered recommendation system",
    hierarchy_data: decompositionResults
  },
  {
    team_size: 6,
    experience_level: "intermediate",
    timeline_months: 4
  }
);
```

### JiraConnectAgent

Native JIRA integration with Advanced Roadmaps support.

```typescript
import { JiraConnectAgent } from '{{ site.npm_package }}';

const jiraAgent = new JiraConnectAgent({
  hostUrl: 'https://company.atlassian.net',
  username: 'pm@company.com',
  apiToken: process.env.JIRA_API_TOKEN
});

await jiraAgent.initialize();

// Create a complete project hierarchy
const initiative = await jiraAgent.createInitiative({
  project: 'PROJ',
  summary: 'Digital Transformation Initiative',
  description: 'Company-wide digital transformation program'
});
```

## Type Definitions

### Core Types

```typescript
// Task hierarchy structure
interface TaskHierarchy {
  initiatives: Initiative[];
  epics: Epic[];
  stories: Story[];
  tasks: Task[];
  subtasks: SubTask[];
  confidenceScore: number;
  qualityMetrics: QualityMetrics;
  relationships: HierarchyRelationships;
}

// Individual hierarchy items
interface Initiative {
  id: string;
  title: string;
  description: string;
  confidence_score: number;
  business_value?: string;
  strategic_alignment?: string;
}

interface Epic {
  id: string;
  title: string;
  description: string;
  parent_initiative: string;
  confidence_score: number;
  estimated_effort?: number;
  priority?: 'high' | 'medium' | 'low';
}

interface Story {
  id: string;
  title: string;
  description: string;
  parent_epic: string;
  confidence_score: number;
  story_points?: number;
  acceptance_criteria?: string[];
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
  overall_risk_level: 'low' | 'medium' | 'high';
  risk_score: number;
  risk_items: RiskItem[];
}

interface SuccessPredictions {
  overall_success_probability: number;
  timeline_accuracy: number;
  quality_predictions: QualityPredictions;
}
```

### JIRA Types

```typescript
interface JiraCreationResults {
  created_issues: JiraIssue[];
  errors: JiraError[];
  summary: {
    total_created: number;
    initiatives: number;
    epics: number;
    stories: number;
    tasks: number;
    subtasks: number;
  };
}

interface JiraIssue {
  key: string;
  id: string;
  type: string;
  summary: string;
  url: string;
  status: string;
}
```

## Examples

### Basic Usage

```typescript
import { HierarchicalAgentSystem } from '{{ site.npm_package }}';

const system = new HierarchicalAgentSystem({
  jiraConnect: {
    hostUrl: process.env.JIRA_HOST_URL,
    username: process.env.JIRA_USERNAME,
    apiToken: process.env.JIRA_API_TOKEN
  }
});

await system.initialize();

const results = await system.processProject({
  idea: "Create a task management application",
  context: "Web-based, real-time collaboration, mobile-responsive",
  projectKey: "TASK",
  enableJiraCreation: true
});

console.log('Processing complete:', results.decomposition);
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
    hostUrl: 'https://company.atlassian.net',
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
    maxConcurrency: 15,
    enableQualityGates: true,
    retryAttempts: 5
  },
  logging: {
    level: 'info',
    enableFileLogging: true
  }
});
```

### Event-Driven Processing

```typescript
// Set up event handlers
system.on('decomposition:complete', (data) => {
  console.log(`Decomposition completed with ${data.epics.length} epics`);
});

system.on('analysis:complete', (data) => {
  console.log(`Risk assessment: ${data.risk_assessment.overall_risk_level}`);
});

system.on('project:processing:complete', (results) => {
  console.log('Project processing finished successfully');
});

system.on('project:processing:error', (error) => {
  console.error('Processing failed:', error);
});

// Process project with event monitoring
const results = await system.processProject({
  idea: "Enterprise data analytics platform",
  enableJiraCreation: true
});
```

### Custom Intelligence Analysis

```typescript
import { IntelligenceHub } from '{{ site.npm_package }}';

const intelligence = new IntelligenceHub('./custom-intelligence');

const analysis = await intelligence.processNewProject(
  'ANALYTICS-001',
  {
    name: "Customer Analytics Dashboard",
    hierarchy_data: decompositionResults
  },
  {
    team_size: 8,
    experience_level: "senior",
    timeline_months: 6,
    budget: 500000,
    technologies: ['React', 'Node.js', 'MongoDB', 'Redis']
  }
);

console.log('Analysis Results:');
console.log(`- Overall confidence: ${analysis.confidence_analysis.overall_confidence}`);
console.log(`- Risk level: ${analysis.risk_assessment.overall_risk_level}`);
console.log(`- Success probability: ${analysis.success_predictions.overall_success_probability}`);
console.log(`- Estimated effort: ${analysis.estimation_analysis.total_estimated_hours} hours`);
```

---

## More Resources

- [Getting Started Guide](../getting-started)
- [Installation Guide](../guides/installation)
- [JIRA Integration Guide](../guides/jira-integration)
- [Examples and Tutorials](../examples/basic-usage)
- [CLI Reference](../reference/cli)
- [Support and Community](../support)

---

**Need help?** Check out our [support resources](../support) or join our [Discord community]({{ site.discord_invite }}).