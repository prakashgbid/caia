---
layout: default
title: JIRA Integration
description: Complete guide to setting up and configuring JIRA integration with Advanced Roadmaps support
---

# JIRA Integration Guide

The Hierarchical Agent System provides deep integration with Atlassian JIRA, including support for Advanced Roadmaps, custom fields, and enterprise-grade workflows. This guide covers everything from basic setup to advanced configuration.

## Overview

Our JIRA integration enables:
- ✅ **Automatic issue creation** with proper hierarchy relationships
- ✅ **Advanced Roadmaps support** for enterprise planning
- ✅ **Custom field mapping** for your organization's workflow
- ✅ **Bulk operations** for efficient processing
- ✅ **Error recovery** with retry mechanisms
- ✅ **Audit trails** for complete traceability

## Prerequisites

Before setting up JIRA integration:

### JIRA Requirements
- **JIRA Cloud** or **JIRA Server** 8.0+
- **Advanced Roadmaps** (optional, for enterprise features)
- **Project Administrator** permissions
- **API Token** or **Service Account**

### Issue Types Setup
Ensure your JIRA project has these issue types configured:
- **Initiative** (requires Advanced Roadmaps)
- **Epic**
- **Story**
- **Task**
- **Sub-task**

## Quick Setup

### 1. Generate JIRA API Token

For **JIRA Cloud**:
1. Go to [Atlassian Account Settings](https://id.atlassian.com/manage-profile/security/api-tokens)
2. Click "Create API token"
3. Copy the generated token (save securely)

For **JIRA Server/Data Center**:
1. Go to **Profile** → **Personal Access Tokens**
2. Create new token with appropriate permissions
3. Copy the token

### 2. Configure Environment

Create or update your `.env` file:

```bash
# JIRA Integration Configuration
JIRA_HOST_URL=https://your-domain.atlassian.net
JIRA_USERNAME=your-email@company.com
JIRA_API_TOKEN=your-generated-api-token

# Optional: Default project settings
JIRA_DEFAULT_PROJECT=PROJ
JIRA_DEFAULT_ASSIGNEE=your-email@company.com
```

### 3. Update Configuration

Edit `hierarchical-config.json`:

```json
{
  "jiraConnect": {
    "hostUrl": "https://your-domain.atlassian.net",
    "enableAdvancedRoadmaps": true,
    "defaultProject": "PROJ",
    "batchSize": 10,
    "retryAttempts": 3,
    "customFields": {
      "storyPoints": "customfield_10001",
      "epicName": "customfield_10002"
    }
  }
}
```

### 4. Test Connection

```bash
caia-hierarchical status
# Should show JIRA connection as healthy

# Or run a test
caia-hierarchical test --integration
```

## Advanced Configuration

### Custom Fields Mapping

Map your organization's custom fields for automatic population:

```json
{
  "jiraConnect": {
    "customFields": {
      // Story fields
      "storyPoints": "customfield_10001",
      "acceptanceCriteria": "customfield_10002",
      "businessValue": "customfield_10003",
      
      // Epic fields  
      "epicName": "customfield_10004",
      "epicColor": "customfield_10005",
      "epicTheme": "customfield_10006",
      
      // Initiative fields (Advanced Roadmaps)
      "initiativeOwner": "customfield_10007",
      "businessObjective": "customfield_10008",
      "strategicAlignment": "customfield_10009",
      
      // Common fields
      "team": "customfield_10010",
      "sprint": "customfield_10011",
      "riskLevel": "customfield_10012"
    }
  }
}
```

### Issue Type Mapping

Configure issue type names for your JIRA instance:

```json
{
  "jiraConnect": {
    "issueTypes": {
      "initiative": "Initiative",      // Advanced Roadmaps
      "epic": "Epic",
      "story": "Story", 
      "task": "Task",
      "subtask": "Sub-task",
      "bug": "Bug",
      "improvement": "Improvement"
    }
  }
}
```

### Project-Specific Settings

Configure different settings per project:

```json
{
  "jiraConnect": {
    "projects": {
      "CORE": {
        "defaultAssignee": "tech-lead@company.com",
        "defaultPriority": "High",
        "components": ["Backend", "API"],
        "customFields": {
          "team": "Core Platform Team"
        }
      },
      "MOBILE": {
        "defaultAssignee": "mobile-lead@company.com",
        "defaultPriority": "Medium", 
        "components": ["iOS", "Android"],
        "customFields": {
          "team": "Mobile Team"
        }
      }
    }
  }
}
```

## Usage Examples

### Basic Project Processing with JIRA

```bash
# Process idea and create JIRA issues
caia-hierarchical process "Build a customer portal with user authentication" \
  --project "PORTAL" \
  --create-jira \
  --output portal-results.json
```

This creates a complete hierarchy in JIRA:

```
Initiative: Customer Portal Platform (PORTAL-1)
├── Epic: User Authentication System (PORTAL-2)
│   ├── Story: User Registration (PORTAL-3)
│   ├── Story: Login/Logout (PORTAL-4)
│   └── Story: Password Reset (PORTAL-5)
├── Epic: Dashboard Interface (PORTAL-6)
│   ├── Story: Personal Dashboard (PORTAL-7)
│   └── Story: Account Settings (PORTAL-8)
└── Epic: Account Management (PORTAL-9)
    ├── Story: Profile Management (PORTAL-10)
    └── Story: Billing Integration (PORTAL-11)
```

### Advanced Project with Context

```bash
caia-hierarchical process \
  "E-commerce platform with AI-powered recommendations" \
  --context "Microservices architecture, React frontend, Node.js backend, MongoDB, Redis, Docker deployment, 100K+ concurrent users" \
  --project "ECOM" \
  --create-jira \
  --output ecommerce-results.json
```

### API Usage

```typescript
import { HierarchicalAgentSystem } from '@caia/hierarchical-agent-system';

const system = new HierarchicalAgentSystem({
  jiraConnect: {
    hostUrl: 'https://company.atlassian.net',
    username: 'service@company.com',
    apiToken: process.env.JIRA_API_TOKEN,
    enableAdvancedRoadmaps: true,
    customFields: {
      storyPoints: 'customfield_10001',
      team: 'customfield_10010'
    }
  }
});

await system.initialize();

const results = await system.processProject({
  idea: "Multi-tenant SaaS platform",
  context: "B2B software, subscription model, enterprise features",
  projectKey: "SAAS",
  enableJiraCreation: true,
  teamContext: {
    size: 12,
    experience_level: "senior",
    technologies: ["nodejs", "react", "postgresql", "kubernetes"]
  }
});

// Access JIRA results
console.log(`Created ${results.jiraResults.created_issues.length} issues`);
console.log(`Success rate: ${results.jiraResults.summary.success_rate * 100}%`);
```

## Advanced Roadmaps Integration

Advanced Roadmaps provides enterprise-grade planning capabilities.

### Enable Advanced Roadmaps

```json
{
  "jiraConnect": {
    "enableAdvancedRoadmaps": true,
    "advancedRoadmaps": {
      "autoCreateRoadmap": true,
      "roadmapName": "Project Roadmap",
      "includeInitiatives": true,
      "timelineView": "quarters",
      "capacityPlanning": true
    }
  }
}
```

### Initiative Management

```typescript
import { JiraConnectAgent } from '@caia/hierarchical-agent-system';

const jiraAgent = new JiraConnectAgent({
  hostUrl: 'https://company.atlassian.net',
  username: 'pm@company.com',
  apiToken: process.env.JIRA_API_TOKEN
});

// Create strategic initiative
const initiative = await jiraAgent.createInitiative({
  project: 'PROJ',
  summary: 'Digital Transformation Initiative Q1-Q3 2024',
  description: 'Company-wide digital transformation focusing on customer experience and operational efficiency',
  labels: ['strategic', 'digital-transformation', '2024'],
  customFields: {
    'customfield_10008': 'Improve customer satisfaction by 25%', // Business Objective
    'customfield_10009': 'Strategic Priority #1' // Strategic Alignment
  }
});

console.log(`Created initiative: ${initiative.key}`);
```

### Roadmap Visualization

After creating your hierarchy, view in Advanced Roadmaps:

1. Go to **Projects** → **Your Project** → **Roadmap**
2. Select **Timeline view** to see hierarchical relationships
3. Use **Capacity planning** to assign team resources
4. Enable **Dependencies** to show task relationships

## Bulk Operations

For large projects, use bulk operations for better performance:

```typescript
// Bulk create stories under an epic
const stories = [
  {
    project: 'PROJ',
    issueType: 'Story',
    summary: 'User Registration Form',
    description: 'Create responsive user registration form with validation',
    parent: epic.key,
    customFields: {
      'customfield_10001': 5 // Story Points
    }
  },
  {
    project: 'PROJ', 
    issueType: 'Story',
    summary: 'Email Verification',
    description: 'Implement email verification workflow',
    parent: epic.key,
    customFields: {
      'customfield_10001': 3 // Story Points
    }
  }
  // ... more stories
];

const results = await jiraAgent.bulkCreateIssues(stories);

console.log(`Created: ${results.successful.length}`);
console.log(`Failed: ${results.failed.length}`);

// Handle failures
results.failed.forEach(failure => {
  console.error(`Failed to create "${failure.summary}": ${failure.error}`);
});
```

## Error Handling & Troubleshooting

### Common Issues

#### Authentication Failures

```bash
# Test JIRA connection manually
curl -u your-email@company.com:your-api-token \
  https://your-domain.atlassian.net/rest/api/3/myself

# Expected response: Your user information
```

**Solutions:**
- Verify API token is correct and not expired
- Check username matches JIRA account
- Ensure account has appropriate permissions

#### Permission Errors

```
Error: You do not have permission to create issues in this project
```

**Solutions:**
- Request **Project Administrator** or **Create Issue** permission
- Check project permissions in JIRA settings
- Verify project key exists and is accessible

#### Custom Field Errors

```
Error: Field 'customfield_10001' cannot be set. It is not on the appropriate screen, or unknown.
```

**Solutions:**
1. **Find correct custom field ID:**
   ```bash
   curl -u user:token \
     "https://domain.atlassian.net/rest/api/3/field" | \
     jq '.[] | select(.name=="Story Points") | .id'
   ```

2. **Add field to screen:**
   - Go to **Project Settings** → **Screens**
   - Add missing fields to appropriate screens

3. **Update configuration:**
   ```json
   {
     "customFields": {
       "storyPoints": "customfield_10001" // Correct field ID
     }
   }
   ```

#### Rate Limiting

```
Error: Rate limit exceeded. Try again later.
```

**Solutions:**
- Reduce batch size in configuration
- Add delays between API calls
- Use service account with higher limits

```json
{
  "jiraConnect": {
    "batchSize": 5,        // Reduced from default 10
    "requestDelay": 1000,  // 1 second between requests
    "retryAttempts": 5
  }
}
```

### Debug Mode

Enable debug logging for troubleshooting:

```bash
# Enable debug output
LOG_LEVEL=debug caia-hierarchical process "Your idea" --create-jira

# Or with verbose CLI flag
caia-hierarchical --verbose process "Your idea" --create-jira
```

**Debug output example:**
```
[DEBUG] JIRA: Connecting to https://company.atlassian.net
[DEBUG] JIRA: Authentication successful
[DEBUG] JIRA: Creating initiative "Customer Portal Platform"
[DEBUG] JIRA: Initiative created: PORTAL-1
[DEBUG] JIRA: Creating epic "User Authentication System"
[DEBUG] JIRA: Epic created: PORTAL-2, linking to parent PORTAL-1
[DEBUG] JIRA: Bulk creating 5 stories under epic PORTAL-2
[INFO] JIRA: Successfully created 5 stories
```

## Best Practices

### Project Organization

#### Use Consistent Project Keys
```bash
# Good: Consistent naming
CORE-1, CORE-2, CORE-3
MOBILE-1, MOBILE-2, MOBILE-3
API-1, API-2, API-3

# Avoid: Mixed patterns
PROJ-1, Core-2, MOBILE_3
```

#### Organize by Business Domain
```json
{
  "projects": {
    "CUSTOMER": "Customer Experience",
    "PAYMENT": "Payment Processing", 
    "INVENTORY": "Inventory Management",
    "ANALYTICS": "Data Analytics"
  }
}
```

### Custom Field Strategy

#### Standardize Field Usage
```json
{
  "customFields": {
    // Use consistent patterns
    "storyPoints": "customfield_10001",    // All projects
    "businessValue": "customfield_10002",  // All projects
    "team": "customfield_10003",           // All projects
    
    // Project-specific fields
    "mobileDevice": "customfield_20001",   // Mobile projects only
    "apiVersion": "customfield_20002"      // API projects only
  }
}
```

#### Document Field Mappings
Create a team reference document:

| Field Name | Field ID | Usage | Projects |
|-----------|----------|-------|----------|
| Story Points | customfield_10001 | Estimation | All |
| Business Value | customfield_10002 | Prioritization | All |
| Team | customfield_10003 | Assignment | All |
| Epic Theme | customfield_10004 | Categorization | Epics only |

### Workflow Integration

#### Pre-Processing Hooks
```typescript
// Add validation before JIRA creation
system.on('jira:issue:creating', (issueData) => {
  // Validate required fields
  if (!issueData.summary || issueData.summary.length < 10) {
    throw new Error('Issue summary must be at least 10 characters');
  }
  
  // Add organizational standards
  if (issueData.issueType === 'Epic' && !issueData.labels.includes('epic')) {
    issueData.labels.push('epic');
  }
});
```

#### Post-Processing Actions
```typescript
// Actions after successful creation
system.on('jira:issue:created', async (issue) => {
  // Add to sprint
  if (issue.fields.issuetype.name === 'Story') {
    await jiraAgent.addToSprint(issue.key, 'current');
  }
  
  // Notify team
  await notifyTeam(`New ${issue.fields.issuetype.name} created: ${issue.key}`);
  
  // Update external systems
  await updateProjectTracker(issue);
});
```

## Enterprise Configuration

### Service Account Setup

For enterprise deployments, use service accounts:

```bash
# Service account configuration
JIRA_SERVICE_ACCOUNT_USERNAME=hierarchical-agent@company.com
JIRA_SERVICE_ACCOUNT_TOKEN=service_account_token

# Higher rate limits
JIRA_BATCH_SIZE=50
JIRA_CONCURRENT_REQUESTS=10
```

### Multi-Instance Support

Configure multiple JIRA instances:

```json
{
  "jiraInstances": {
    "production": {
      "hostUrl": "https://company.atlassian.net",
      "username": "service@company.com",
      "apiToken": "${JIRA_PROD_TOKEN}"
    },
    "staging": {
      "hostUrl": "https://staging.company.com", 
      "username": "test@company.com",
      "apiToken": "${JIRA_STAGING_TOKEN}"
    }
  },
  "defaultInstance": "production"
}
```

### Audit and Compliance

```json
{
  "jiraConnect": {
    "auditLogging": {
      "enabled": true,
      "logLevel": "info",
      "includeRequestData": false,
      "includeResponseData": false,
      "retentionDays": 90
    },
    "compliance": {
      "requireApproval": true,
      "approverField": "customfield_compliance_approver",
      "dataRetention": "7years"
    }
  }
}
```

## Performance Optimization

### Batch Size Tuning

```json
{
  "jiraConnect": {
    "batchSize": 20,           // Issues per batch
    "maxConcurrency": 5,       // Concurrent batches
    "requestTimeout": 30000,   // 30 second timeout
    "retryDelay": 2000        // 2 second delay between retries
  }
}
```

### Caching Strategy

```json
{
  "jiraConnect": {
    "caching": {
      "enabled": true,
      "ttl": 300,               // 5 minutes
      "cacheProjects": true,
      "cacheIssueTypes": true,
      "cacheCustomFields": true
    }
  }
}
```

## Monitoring and Metrics

### Health Checks

```bash
# Regular health monitoring
caia-hierarchical status

# Integration-specific tests
caia-hierarchical test --suite jira-integration
```

### Metrics Collection

```typescript
// Monitor JIRA operations
system.on('jira:metrics', (metrics) => {
  console.log(`JIRA Operations:`, {
    totalRequests: metrics.totalRequests,
    successRate: metrics.successRate,
    averageResponseTime: metrics.averageResponseTime,
    rateLimitRemaining: metrics.rateLimitRemaining
  });
  
  // Send to monitoring system
  sendMetrics('jira.operations', metrics);
});
```

## Migration and Data Import

### Existing Project Import

```typescript
// Import existing JIRA hierarchy
const existingProject = await jiraAgent.getProject('EXISTING');
const hierarchy = await jiraAgent.buildHierarchyFromProject(existingProject);

// Enhance with AI analysis
const enhancedHierarchy = await system.enhanceExistingHierarchy(hierarchy);

console.log(`Enhanced ${enhancedHierarchy.stories.length} stories with AI insights`);
```

### Bulk Data Migration

```bash
# Migration script
#!/bin/bash

# Export from old system
./export-legacy-projects.sh > legacy-projects.json

# Process each project
jq -c '.[]' legacy-projects.json | while read project; do
  IDEA=$(echo $project | jq -r '.description')
  PROJECT_KEY=$(echo $project | jq -r '.key')
  
  caia-hierarchical process "$IDEA" \
    --project "$PROJECT_KEY" \
    --create-jira \
    --output "migrated-$PROJECT_KEY.json"
done
```

## Support and Resources

### Getting Help

- 📖 [JIRA API Documentation](https://developer.atlassian.com/cloud/jira/platform/rest/v3/)
- 💬 [Discord Community]({{ site.discord_invite }}) - Ask questions
- 🐛 [GitHub Issues]({{ site.github_repo }}/issues) - Report bugs
- 📧 [Enterprise Support](mailto:enterprise@caia.dev) - Priority support

### Advanced Training

For enterprise teams:
- Custom integration workshops
- JIRA optimization consulting
- Team training sessions
- Migration assistance

Contact [enterprise@caia.dev](mailto:enterprise@caia.dev) for more information.

---

<div class="integration-success">
  <h2>🎉 JIRA Integration Complete!</h2>
  <p>You've successfully configured JIRA integration for the Hierarchical Agent System. Your ideas will now automatically transform into structured JIRA hierarchies, complete with proper relationships, custom fields, and Advanced Roadmaps support.</p>
  <a href="examples/" class="btn btn-primary">Try Examples</a>
  <a href="api-reference" class="btn btn-secondary">API Reference</a>
</div>