---
layout: default
title: JIRA Integration Guide
description: Complete guide for setting up and configuring JIRA integration with Advanced Roadmaps support
---

# JIRA Integration Guide

Comprehensive guide for integrating the Hierarchical Agent System with Atlassian JIRA, including Advanced Roadmaps configuration and enterprise features.

## Overview

The JIRA integration provides:
- **Native API Integration** with JIRA Cloud and Server
- **Advanced Roadmaps Support** for enterprise planning
- **Bulk Issue Creation** with hierarchical relationships
- **Custom Field Mapping** for organization-specific workflows
- **Automatic Linking** of parent-child relationships
- **Error Recovery** and robust API handling

## Prerequisites

- JIRA Cloud or Server instance
- JIRA user account with appropriate permissions
- API token for authentication
- Advanced Roadmaps license (for enterprise features)

## Authentication Setup

### Step 1: Generate JIRA API Token

1. Navigate to [Atlassian Account Settings](https://id.atlassian.com/manage-profile/security/api-tokens)
2. Click "Create API token"
3. Enter a descriptive label: "Hierarchical Agent System"
4. Click "Create"
5. **Copy the token immediately** (you won't see it again)

### Step 2: Configure Environment Variables

```bash
# Add to your .env file
JIRA_HOST_URL=https://your-domain.atlassian.net
JIRA_USERNAME=your-email@company.com
JIRA_API_TOKEN=your-generated-api-token
```

### Step 3: Test Connection

```bash
# Verify JIRA connectivity
caia-hierarchical config --validate

# Test JIRA-specific functionality
caia-hierarchical test --jira
```

## Basic Configuration

### Simple JIRA Setup

```typescript
import { HierarchicalAgentSystem } from '{{ site.npm_package }}';

const system = new HierarchicalAgentSystem({
  jiraConnect: {
    hostUrl: 'https://your-domain.atlassian.net',
    username: 'your-email@company.com',
    apiToken: 'your-api-token',
    enableAdvancedRoadmaps: false // Start with basic features
  }
});
```

### CLI Configuration

```bash
# Process idea and create JIRA issues
caia-hierarchical process "Build customer portal" \
  --project "PORTAL" \
  --create-jira
```

## Advanced Roadmaps Integration

### Enable Advanced Roadmaps

```typescript
const system = new HierarchicalAgentSystem({
  jiraConnect: {
    hostUrl: 'https://your-domain.atlassian.net',
    username: 'your-email@company.com',
    apiToken: 'your-api-token',
    enableAdvancedRoadmaps: true, // Enable enterprise features
    customFields: {
      // Advanced Roadmaps custom fields
      epicName: 'customfield_10011',
      epicColor: 'customfield_10012',
      businessValue: 'customfield_10013',
      timeTracking: 'customfield_10014'
    },
    issueTypes: {
      initiative: 'Initiative',
      epic: 'Epic',
      story: 'Story',
      task: 'Task',
      subtask: 'Sub-task'
    }
  }
});
```

### Advanced Roadmaps Features

#### 1. Initiative Creation

```typescript
// Initiatives are top-level business objectives
const initiative = await jiraAgent.createInitiative({
  project: 'ECOM',
  summary: 'Digital Commerce Platform',
  description: 'Complete e-commerce platform with mobile apps',
  labels: ['strategic', 'digital-transformation'],
  customFields: {
    businessValue: 'High',
    strategicAlignment: 'Core Business'
  }
});
```

#### 2. Epic Hierarchy

```typescript
// Epics are grouped under initiatives
const epic = await jiraAgent.createEpic({
  project: 'ECOM',
  summary: 'User Management System',
  description: 'Complete user registration, authentication, and profile management',
  parentInitiative: 'ECOM-1', // Link to initiative
  epicName: 'User Management',
  epicColor: 'blue',
  labels: ['backend', 'security']
});
```

#### 3. Story and Task Creation

```typescript
// Stories under epics
const story = await jiraAgent.createIssue({
  project: 'ECOM',
  issueType: 'Story',
  summary: 'User Registration API',
  description: 'As a new user, I want to create an account',
  parentEpic: 'ECOM-2',
  storyPoints: 5,
  labels: ['api', 'registration']
});

// Tasks under stories
const task = await jiraAgent.createIssue({
  project: 'ECOM',
  issueType: 'Task',
  summary: 'Design user registration database schema',
  description: 'Create database tables for user accounts',
  parentStory: 'ECOM-3',
  estimatedHours: 8,
  labels: ['database', 'design']
});
```

## Custom Field Configuration

### Discover Custom Fields

```bash
# List available custom fields
caia-hierarchical jira --list-fields --project PROJ

# Get field configuration
caia-hierarchical jira --field-info customfield_10001
```

### Common Custom Field Mappings

```typescript
const customFields = {
  // Story Points (Agile)
  storyPoints: 'customfield_10002',
  
  // Epic fields
  epicName: 'customfield_10011',
  epicColor: 'customfield_10012',
  
  // Advanced Roadmaps fields
  businessValue: 'customfield_10020',
  strategicAlignment: 'customfield_10021',
  
  // Time tracking
  originalEstimate: 'customfield_10030',
  remainingEstimate: 'customfield_10031',
  
  // Custom organization fields
  teamAssignment: 'customfield_10040',
  clientImpact: 'customfield_10041',
  complianceFlag: 'customfield_10042'
};
```

### Field Mapping Configuration

```json
{
  "jiraConnect": {
    "customFields": {
      "initiative": {
        "businessValue": "customfield_10100",
        "strategicAlignment": "customfield_10101",
        "executiveSponsor": "customfield_10102"
      },
      "epic": {
        "epicName": "customfield_10011",
        "epicColor": "customfield_10012",
        "targetQuarter": "customfield_10103"
      },
      "story": {
        "storyPoints": "customfield_10002",
        "acceptanceCriteria": "customfield_10104",
        "userPersona": "customfield_10105"
      },
      "task": {
        "estimatedHours": "customfield_10003",
        "skillRequired": "customfield_10106",
        "complexity": "customfield_10107"
      }
    }
  }
}
```

## Issue Type Configuration

### Standard Issue Types

```typescript
const issueTypes = {
  initiative: 'Initiative',    // Top-level business objective
  epic: 'Epic',               // Large feature or capability
  story: 'Story',             // User story or requirement
  task: 'Task',               // Development task
  subtask: 'Sub-task',        // Subtask or component
  bug: 'Bug',                 // Defect or issue
  improvement: 'Improvement'   // Enhancement
};
```

### Custom Issue Types

```typescript
// Organization-specific issue types
const customIssueTypes = {
  initiative: 'Business Initiative',
  epic: 'Feature Epic',
  story: 'User Story',
  task: 'Development Task',
  subtask: 'Technical Task',
  spike: 'Research Spike',
  debt: 'Technical Debt'
};
```

## Bulk Operations

### Batch Issue Creation

```typescript
// Process large project with batch creation
const results = await system.processProject({
  idea: `Enterprise Resource Planning System with:
    - Human Resources Management
    - Financial Management
    - Supply Chain Management
    - Customer Relationship Management
    - Business Intelligence Dashboard`,
  context: `
    Technology: Java Spring Boot, React, PostgreSQL
    Team: 25 developers, 3 architects, 5 QA
    Timeline: 18 months
    Budget: $2.5M
  `,
  projectKey: "ERP",
  enableJiraCreation: true
});

// Results in 200+ JIRA issues created efficiently
console.log(`Created ${results.jiraResults.created_issues.length} issues`);
console.log(`Processing time: ${results.performance.total_time_ms}ms`);
```

### Parallel Processing

```typescript
// Configure for high-throughput scenarios
const system = new HierarchicalAgentSystem({
  jiraConnect: {
    // ... other config
    batchSize: 20,           // Issues per batch
    parallelBatches: 5,      // Concurrent batches
    rateLimitBuffer: 100     // API calls per minute buffer
  },
  orchestration: {
    maxConcurrency: 25,      // Higher concurrency
    retryAttempts: 5,        // More retries for reliability
    backoffMultiplier: 1.5   // Exponential backoff
  }
});
```

## Error Handling and Recovery

### Robust Error Recovery

```typescript
// The system automatically handles:
// - API rate limits
// - Network timeouts
// - Authentication issues
// - Invalid field configurations
// - Duplicate issue detection

const results = await system.processProject({
  idea: "Complex enterprise system",
  projectKey: "COMPLEX",
  enableJiraCreation: true
});

// Check for errors
if (results.jiraResults.errors.length > 0) {
  console.log('Encountered errors:');
  results.jiraResults.errors.forEach(error => {
    console.log(`- ${error.type}: ${error.message}`);
    console.log(`  Issue: ${error.attempted_issue?.summary}`);
    console.log(`  Resolution: ${error.resolution}`);
  });
}

// Retry failed issues
if (results.jiraResults.errors.length > 0) {
  const retryResults = await system.retryFailedIssues(
    results.jiraResults.errors,
    { maxRetries: 3 }
  );
  console.log(`Retry created ${retryResults.successful_retries} additional issues`);
}
```

### Error Types and Solutions

```typescript
// Common error types and automatic resolutions
interface JiraError {
  type: 'authentication' | 'permissions' | 'field_mapping' | 
        'rate_limit' | 'network' | 'validation' | 'duplicate';
  message: string;
  attempted_issue?: Partial<JiraIssue>;
  resolution: string;
  retry_recommended: boolean;
}

// Example error handling
results.jiraResults.errors.forEach(error => {
  switch (error.type) {
    case 'authentication':
      // System automatically refreshes token
      break;
    case 'rate_limit':
      // System automatically waits and retries
      break;
    case 'field_mapping':
      // System falls back to standard fields
      break;
    case 'duplicate':
      // System links to existing issue instead
      break;
  }
});
```

## Advanced Features

### 1. Dependency Management

```typescript
// Automatic dependency detection and linking
const results = await system.processProject({
  idea: "Microservices architecture with API gateway",
  enableJiraCreation: true,
  enableDependencyMapping: true
});

// System automatically creates:
// - Blocks/Blocked By relationships
// - Dependency chains between services
// - Critical path identification
```

### 2. Timeline and Capacity Planning

```typescript
// Integration with Advanced Roadmaps timeline
const system = new HierarchicalAgentSystem({
  jiraConnect: {
    // ... other config
    enableTimelinePlanning: true,
    enableCapacityPlanning: true,
    teamCapacity: {
      "backend-team": { capacity: 40, unit: "story_points" },
      "frontend-team": { capacity: 35, unit: "story_points" },
      "devops-team": { capacity: 20, unit: "story_points" }
    }
  }
});
```

### 3. Automated Labeling and Components

```typescript
// Intelligent labeling based on project analysis
const labelingConfig = {
  enableAutoLabeling: true,
  labelMappings: {
    technology: {
      "React": ["frontend", "react"],
      "Node.js": ["backend", "nodejs"],
      "MongoDB": ["database", "mongodb"]
    },
    complexity: {
      high: ["complex", "architect-review"],
      medium: ["standard"],
      low: ["simple"]
    },
    team: {
      frontend: ["frontend-team"],
      backend: ["backend-team"],
      fullstack: ["fullstack"]
    }
  }
};
```

## Enterprise Configuration Examples

### Large Enterprise Setup

```typescript
const enterpriseConfig = {
  jiraConnect: {
    hostUrl: 'https://enterprise.atlassian.net',
    username: 'service-hierarchical@company.com',
    apiToken: process.env.JIRA_SERVICE_TOKEN,
    
    // Advanced Roadmaps configuration
    enableAdvancedRoadmaps: true,
    enableTimelinePlanning: true,
    enableCapacityPlanning: true,
    
    // Enterprise custom fields
    customFields: {
      initiative: {
        businessValue: 'customfield_10100',
        strategicAlignment: 'customfield_10101',
        executiveSponsor: 'customfield_10102',
        budgetCode: 'customfield_10103',
        complianceLevel: 'customfield_10104'
      },
      epic: {
        epicName: 'customfield_10011',
        epicColor: 'customfield_10012',
        targetQuarter: 'customfield_10105',
        riskLevel: 'customfield_10106',
        dependencyType: 'customfield_10107'
      },
      story: {
        storyPoints: 'customfield_10002',
        acceptanceCriteria: 'customfield_10108',
        userPersona: 'customfield_10109',
        businessImpact: 'customfield_10110'
      }
    },
    
    // Performance optimization
    batchSize: 50,
    parallelBatches: 10,
    rateLimitBuffer: 50,
    
    // Error handling
    maxRetries: 5,
    retryDelay: 2000,
    enableDetailedLogging: true
  },
  
  orchestration: {
    maxConcurrency: 30,
    enableQualityGates: true,
    qualityThreshold: 0.90,
    timeoutMs: 600000 // 10 minutes
  }
};
```

## Monitoring and Metrics

### Real-time Monitoring

```typescript
// Monitor JIRA operations
system.on('jira:creation:start', (data) => {
  console.log(`Starting JIRA creation: ${data.total_issues} issues`);
});

system.on('jira:creation:progress', (data) => {
  console.log(`Progress: ${data.completed}/${data.total} (${data.success_rate}% success)`);
});

system.on('jira:creation:complete', (data) => {
  console.log(`JIRA creation completed:`);
  console.log(`- Created: ${data.created_issues.length}`);
  console.log(`- Errors: ${data.errors.length}`);
  console.log(`- Duration: ${data.duration_ms}ms`);
});
```

### Performance Metrics

```typescript
// Get detailed performance metrics
const metrics = await system.getPerformanceMetrics();

console.log('JIRA Integration Performance:');
console.log(`- API Calls: ${metrics.jira.total_api_calls}`);
console.log(`- Rate Limit Usage: ${metrics.jira.rate_limit_percentage}%`);
console.log(`- Average Response Time: ${metrics.jira.avg_response_time}ms`);
console.log(`- Success Rate: ${metrics.jira.success_rate}%`);
console.log(`- Issues Created: ${metrics.jira.total_issues_created}`);
```

## Troubleshooting

### Common Issues

**1. Authentication Failures**
```bash
# Verify credentials
curl -u $JIRA_USERNAME:$JIRA_API_TOKEN \
  $JIRA_HOST_URL/rest/api/3/myself

# Check API token permissions
# Ensure service account has proper project permissions
```

**2. Custom Field Errors**
```bash
# List available fields
caia-hierarchical jira --list-fields --project PROJ

# Test field mapping
caia-hierarchical jira --test-fields --project PROJ
```

**3. Rate Limiting**
```typescript
// Adjust rate limiting settings
const config = {
  jiraConnect: {
    rateLimitBuffer: 200,     // Higher buffer
    batchSize: 10,            // Smaller batches
    parallelBatches: 2,       // Fewer parallel operations
    requestDelay: 1000        // Add delay between requests
  }
};
```

**4. Permission Issues**
```bash
# Required JIRA permissions:
# - Create Issues
# - Edit Issues
# - Link Issues
# - Browse Projects
# - Advanced Roadmaps (for enterprise features)
```

## Best Practices

### 1. Project Organization

- Use consistent project key naming (e.g., ECOM, USER, API)
- Implement clear labeling strategy
- Set up proper issue hierarchies
- Use components for team organization

### 2. Performance Optimization

- Configure appropriate batch sizes
- Monitor API rate limits
- Use service accounts for automation
- Implement proper error handling

### 3. Security

- Use service accounts with minimal permissions
- Rotate API tokens regularly
- Monitor API usage
- Implement audit logging

### 4. Team Collaboration

- Set up proper notification schemes
- Configure dashboard access
- Implement workflow transitions
- Train teams on hierarchy navigation

---

## Next Steps

1. **[Review API Documentation](../api/)** for programmatic integration
2. **[Explore Advanced Examples](../examples/advanced-workflows)** for complex scenarios
3. **[Configure Architecture](architecture)** for system understanding
4. **[Join Community](../support)** for best practices and support

---

**Need help?** Check our [support resources](../support) or join our [Discord community]({{ site.discord_invite }}).