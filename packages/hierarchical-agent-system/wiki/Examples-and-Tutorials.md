# Examples and Tutorials

Step-by-step tutorials and real-world examples for the CAIA Hierarchical Agent System.

---

## 🎆 Quick Start Examples

### 1. Basic Project Processing

```bash
# Process a simple idea
caia-hierarchical process "Build a todo application with user authentication"

# Expected output:
# Processing project: Build a todo application...
# Decomposing idea into hierarchical structure...
# Generated 1 epic, 4 stories, 12 tasks
# Confidence score: 0.87
```

### 2. With JIRA Integration

```bash
# Setup JIRA credentials first
export JIRA_HOST_URL="https://company.atlassian.net"
export JIRA_USERNAME="pm@company.com"
export JIRA_API_TOKEN="your-api-token"

# Process with JIRA creation
caia-hierarchical process "E-commerce platform with payment processing" \
  --project "ECOM" \
  --create-jira \
  --output "ecommerce-results.json"
```

### 3. API Integration

```typescript
import { HierarchicalAgentSystem } from '@caia/hierarchical-agent-system';

const system = new HierarchicalAgentSystem({
  jiraConnect: {
    hostUrl: 'https://company.atlassian.net',
    username: 'pm@company.com',
    apiToken: process.env.JIRA_API_TOKEN
  }
});

await system.initialize();

const results = await system.processProject({
  idea: "Customer support chatbot with AI",
  enableJiraCreation: true
});

console.log(`Created ${results.jiraResults.created_issues.length} JIRA issues`);
```

---

## 🏢 Enterprise Examples

### Complete CRM System

```typescript
// Enterprise-scale CRM system processing
const processCRMProject = async () => {
  const system = new HierarchicalAgentSystem({
    taskDecomposer: {
      qualityGateThreshold: 0.90, // Higher quality for enterprise
      maxReworkCycles: 5
    },
    jiraConnect: {
      hostUrl: process.env.JIRA_HOST_URL,
      username: process.env.JIRA_USERNAME,
      apiToken: process.env.JIRA_API_TOKEN,
      enableAdvancedRoadmaps: true
    },
    intelligence: {
      enableAnalytics: true
    }
  });

  await system.initialize();

  const results = await system.processProject({
    idea: `Build a comprehensive CRM system with:
      - Customer data management and 360-degree view
      - Sales pipeline automation with forecasting
      - Marketing campaign management and attribution
      - Customer service ticketing and knowledge base
      - Advanced analytics and reporting dashboard
      - Mobile applications for sales and service teams
      - Integration with email, calendar, and accounting systems
      - Multi-tenant architecture for enterprise clients
      - AI-powered insights and recommendations`,
    
    context: `
      Technical Requirements:
      - Microservices architecture with API-first design
      - React frontend with TypeScript and modern UI/UX
      - Node.js backend services with GraphQL APIs
      - PostgreSQL for transactional data with read replicas
      - Redis for caching and real-time session management
      - Elasticsearch for full-text search and analytics
      - Docker containerization with Kubernetes orchestration
      - AWS cloud deployment with auto-scaling
      - CI/CD pipelines with automated testing and deployment
      
      Business Requirements:
      - Support 50,000+ concurrent users across multiple tenants
      - 99.99% uptime SLA with disaster recovery
      - GDPR, CCPA, and SOC2 compliance
      - Multi-language support (English, Spanish, French, German)
      - Real-time notifications and collaborative features
      - Advanced security with SSO, MFA, and audit logging
      - Configurable workflows and business rules
    `,
    
    projectKey: "CRM",
    
    teamContext: {
      size: 25,
      experience_level: "senior",
      previous_projects: ["salesforce-integration", "customer-portal", "analytics-platform"],
      technologies: ["nodejs", "react", "typescript", "postgresql", "redis", "elasticsearch", "docker", "kubernetes", "aws"],
      timeline_months: 12,
      budget: 2500000
    },
    
    enableJiraCreation: true
  });

  // Generate comprehensive reporting
  console.log('\n=== CRM PROJECT ANALYSIS ===');
  console.log(`Project Scope: ${results.decomposition.initiatives.length} initiatives`);
  console.log(`Development Work: ${results.decomposition.epics.length} epics, ${results.decomposition.stories.length} stories`);
  console.log(`Implementation Tasks: ${results.decomposition.tasks.length} tasks`);
  console.log(`Overall Confidence: ${(results.decomposition.confidenceScore * 100).toFixed(1)}%`);
  
  console.log('\n=== RISK ASSESSMENT ===');
  console.log(`Risk Level: ${results.analysis.risk_assessment.overall_risk_level}`);
  console.log(`Success Probability: ${(results.analysis.success_predictions.overall_success_probability * 100).toFixed(1)}%`);
  console.log(`Estimated Effort: ${results.analysis.estimation_analysis.total_estimated_hours} hours`);
  
  console.log('\n=== KEY RECOMMENDATIONS ===');
  results.recommendations.slice(0, 5).forEach((rec, index) => {
    console.log(`${index + 1}. [${rec.priority}] ${rec.title}`);
    console.log(`   Impact: ${rec.impact}, Effort: ${rec.effort}`);
    console.log(`   ${rec.description}`);
  });
  
  if (results.jiraResults) {
    console.log('\n=== JIRA INTEGRATION RESULTS ===');
    console.log(`Total Issues Created: ${results.jiraResults.created_issues.length}`);
    console.log(`Creation Errors: ${results.jiraResults.errors.length}`);
    
    // Group by issue type
    const issuesByType = results.jiraResults.created_issues.reduce((acc, issue) => {
      acc[issue.type] = (acc[issue.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    Object.entries(issuesByType).forEach(([type, count]) => {
      console.log(`- ${type.charAt(0).toUpperCase() + type.slice(1)}s: ${count}`);
    });
    
    // Show sample issue keys for verification
    console.log('\nSample Created Issues:');
    results.jiraResults.created_issues.slice(0, 10).forEach(issue => {
      console.log(`- ${issue.jira_key}: ${issue.type}`);
    });
    
    if (results.jiraResults.errors.length > 0) {
      console.log('\nCreation Errors:');
      results.jiraResults.errors.slice(0, 3).forEach(error => {
        console.log(`- ${error.type}: ${error.error}`);
      });
    }
  }
  
  return results;
};

// Execute the CRM processing
processCRMProject()
  .then(results => {
    console.log('\nCRM project processing completed successfully!');
    console.log('Review the JIRA project and roadmap for next steps.');
  })
  .catch(error => {
    console.error('CRM project processing failed:', error);
  });
```

---

## 🚀 Startup Examples

### MVP Development

```bash
# Quick MVP processing for startup
caia-hierarchical process "Social media analytics platform for small businesses" \
  --context "React dashboard, REST APIs, basic analytics, freemium model" \
  --project "SOCIAL" \
  --team-size 4 \
  --timeline 3 \
  --experience "intermediate" \
  --create-jira
```

### Mobile App Development

```typescript
// Mobile app project processing
const processMobileApp = async () => {
  const system = new HierarchicalAgentSystem();
  await system.initialize();
  
  const results = await system.processProject({
    idea: "Fitness tracking app with social features and AI coaching",
    context: `
      - React Native for iOS and Android
      - Wearable device integration (Apple Watch, Fitbit)
      - Social features (friends, challenges, leaderboards)
      - AI-powered workout recommendations
      - Nutrition tracking with barcode scanning
      - Premium subscription model
    `,
    projectKey: "FITNESS",
    teamContext: {
      size: 6,
      experience_level: "intermediate",
      timeline_months: 4,
      technologies: ["react-native", "nodejs", "mongodb", "tensorflow"]
    },
    enableJiraCreation: true
  });
  
  // Focus on MVP features
  console.log('MVP Recommendations:');
  const mvpRecommendations = results.recommendations
    .filter(rec => rec.category === 'process' || rec.priority === 'High')
    .slice(0, 3);
    
  mvpRecommendations.forEach(rec => {
    console.log(`- ${rec.title}: ${rec.description}`);
  });
  
  return results;
};
```

---

## 🎨 Creative Industry Examples

### Digital Agency Project

```bash
# Agency client project
caia-hierarchical process "E-learning platform for professional certifications" \
  --context "LMS features, video streaming, progress tracking, certification management" \
  --project "LEARN" \
  --labels "client-work,education,lms" \
  --priority "high" \
  --create-jira \
  --output "client-elearning-project.json"
```

---

## 🔧 Integration Tutorials

### Custom Integration

```typescript
// Custom integration with external project management tool
import { HierarchicalAgentSystem } from '@caia/hierarchical-agent-system';
import { LinearClient } from '@linear/sdk';

class LinearIntegration {
  private linearClient: LinearClient;
  private hierarchicalSystem: HierarchicalAgentSystem;
  
  constructor() {
    this.linearClient = new LinearClient({
      apiKey: process.env.LINEAR_API_KEY
    });
    
    this.hierarchicalSystem = new HierarchicalAgentSystem();
  }
  
  async processToLinear(idea: string, teamId: string): Promise<void> {
    // Process with hierarchical system
    await this.hierarchicalSystem.initialize();
    const results = await this.hierarchicalSystem.processProject({ idea });
    
    // Create Linear issues
    for (const epic of results.decomposition.epics) {
      const linearIssue = await this.linearClient.issueCreate({
        teamId,
        title: epic.title,
        description: epic.description,
        priority: this.mapPriority(epic.priority),
        labels: epic.labels
      });
      
      console.log(`Created Linear issue: ${linearIssue.issue?.title}`);
    }
  }
  
  private mapPriority(priority: string): number {
    const priorityMap: Record<string, number> = {
      'Low': 1, 'Medium': 2, 'High': 3, 'Critical': 4
    };
    return priorityMap[priority] || 2;
  }
}

// Usage
const integration = new LinearIntegration();
await integration.processToLinear(
  "Next-generation project management tool",
  "team_123456"
);
```

---

## 📊 Analytics Examples

### Performance Analysis

```typescript
// Analyze processing performance across multiple projects
const analyzePerformance = async () => {
  const projects = [
    "E-commerce marketplace",
    "Healthcare patient portal",
    "Financial trading platform",
    "Educational management system",
    "IoT device management platform"
  ];
  
  const results: any[] = [];
  
  for (const [index, project] of projects.entries()) {
    const startTime = Date.now();
    
    const system = new HierarchicalAgentSystem();
    await system.initialize();
    
    const result = await system.processProject({
      idea: project,
      projectKey: `PROJ${index + 1}`
    });
    
    const processingTime = Date.now() - startTime;
    
    results.push({
      project,
      processingTime,
      epics: result.decomposition.epics.length,
      stories: result.decomposition.stories.length,
      tasks: result.decomposition.tasks.length,
      confidence: result.decomposition.confidenceScore,
      riskLevel: result.analysis.risk_assessment.overall_risk_level,
      successProbability: result.analysis.success_predictions.overall_success_probability
    });
    
    console.log(`Processed: ${project} (${processingTime}ms)`);
  }
  
  // Generate performance report
  console.log('\n=== PERFORMANCE ANALYSIS ===');
  
  const avgProcessingTime = results.reduce((sum, r) => sum + r.processingTime, 0) / results.length;
  const avgConfidence = results.reduce((sum, r) => sum + r.confidence, 0) / results.length;
  const avgSuccess = results.reduce((sum, r) => sum + r.successProbability, 0) / results.length;
  
  console.log(`Average Processing Time: ${avgProcessingTime.toFixed(0)}ms`);
  console.log(`Average Confidence: ${(avgConfidence * 100).toFixed(1)}%`);
  console.log(`Average Success Probability: ${(avgSuccess * 100).toFixed(1)}%`);
  
  // Find patterns
  const highConfidenceProjects = results.filter(r => r.confidence > 0.85);
  const complexProjects = results.filter(r => r.stories > 20);
  
  console.log(`\nHigh Confidence Projects: ${highConfidenceProjects.length}/${results.length}`);
  console.log(`Complex Projects (>20 stories): ${complexProjects.length}/${results.length}`);
  
  return results;
};
```

---

## 🧪 Batch Processing

### Process Multiple Ideas

```typescript
// Batch process multiple project ideas
const batchProcess = async (ideas: string[]) => {
  const system = new HierarchicalAgentSystem({
    orchestration: {
      maxConcurrency: 5 // Process 5 projects concurrently
    }
  });
  
  await system.initialize();
  
  const results = await Promise.allSettled(
    ideas.map(async (idea, index) => {
      const result = await system.processProject({
        idea,
        projectKey: `BATCH${index + 1}`,
        enableJiraCreation: true
      });
      
      return {
        idea,
        success: true,
        ...result
      };
    })
  );
  
  // Analyze batch results
  const successful = results.filter(r => r.status === 'fulfilled').length;
  const failed = results.length - successful;
  
  console.log(`\nBatch Processing Results:`);
  console.log(`Successful: ${successful}/${results.length}`);
  console.log(`Failed: ${failed}/${results.length}`);
  
  // Report on failures
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      console.log(`Failed: "${ideas[index]}" - ${result.reason}`);
    }
  });
  
  return results;
};

// Example usage
const projectIdeas = [
  "Real-time collaboration whiteboard",
  "Inventory management for retail",
  "Customer feedback analysis tool",
  "Employee onboarding platform",
  "Document management system"
];

batchProcess(projectIdeas)
  .then(results => {
    console.log('Batch processing completed!');
  })
  .catch(error => {
    console.error('Batch processing failed:', error);
  });
```

---

## 🔍 Advanced Use Cases

### Custom Quality Gates

```typescript
// Implement custom quality validation
class CustomQualityGate {
  private requirements: string[];
  
  constructor(requirements: string[]) {
    this.requirements = requirements;
  }
  
  async validateDecomposition(hierarchy: TaskHierarchy): Promise<QualityResult> {
    const issues: string[] = [];
    let score = 1.0;
    
    // Check for required security considerations
    if (this.requirements.includes('security')) {
      const hasSecurityTasks = hierarchy.tasks.some(task => 
        task.description.toLowerCase().includes('security') ||
        task.description.toLowerCase().includes('authentication') ||
        task.description.toLowerCase().includes('authorization')
      );
      
      if (!hasSecurityTasks) {
        issues.push('Missing security-related tasks');
        score -= 0.2;
      }
    }
    
    // Check for testing considerations
    if (this.requirements.includes('testing')) {
      const hasTestingTasks = hierarchy.tasks.some(task =>
        task.type === 'Testing' ||
        task.description.toLowerCase().includes('test')
      );
      
      if (!hasTestingTasks) {
        issues.push('Missing testing tasks');
        score -= 0.15;
      }
    }
    
    return {
      passed: score >= 0.8,
      confidence: Math.max(0, score),
      issues,
      suggestions: issues.map(issue => `Consider adding: ${issue}`)
    };
  }
}

// Usage with custom validation
const processWithCustomValidation = async (idea: string) => {
  const system = new HierarchicalAgentSystem();
  await system.initialize();
  
  // Process normally
  const results = await system.processProject({ idea });
  
  // Apply custom validation
  const customGate = new CustomQualityGate(['security', 'testing', 'performance']);
  const validation = await customGate.validateDecomposition(results.decomposition);
  
  if (!validation.passed) {
    console.log('Custom quality gate failed:');
    validation.issues.forEach(issue => console.log(`- ${issue}`));
    console.log('\nSuggestions:');
    validation.suggestions.forEach(suggestion => console.log(`- ${suggestion}`));
  } else {
    console.log('Custom quality gate passed!');
  }
  
  return { results, validation };
};
```

---

## 📝 Documentation Generation

### Auto-Generate Project Documentation

```typescript
// Generate comprehensive project documentation
const generateProjectDocs = async (idea: string, projectKey: string) => {
  const system = new HierarchicalAgentSystem();
  await system.initialize();
  
  const results = await system.processProject({
    idea,
    projectKey,
    enableJiraCreation: false // Just for documentation
  });
  
  // Generate markdown documentation
  const documentation = `
# ${projectKey} - Project Documentation

## Overview
${idea}

## Project Structure

### Initiatives (${results.decomposition.initiatives.length})
${results.decomposition.initiatives.map(init => `
#### ${init.title}
${init.description}
**Business Value:** ${init.businessValue}
**Timeline:** ${init.timeline.estimated_months} months
`).join('')}

### Epics (${results.decomposition.epics.length})
${results.decomposition.epics.map(epic => `
#### ${epic.title}
${epic.description}
**User Persona:** ${epic.userPersona}
**Story Points:** ${epic.estimatedStoryPoints}
**Priority:** ${epic.priority}
`).join('')}

### User Stories (${results.decomposition.stories.length})
${results.decomposition.stories.map(story => `
#### ${story.title}
${story.userStory}

**Acceptance Criteria:**
${story.acceptanceCriteria.map(ac => `- ${ac}`).join('\n')}

**Priority:** ${story.priority} | **Points:** ${story.estimatedStoryPoints}
`).join('')}

## Risk Assessment

**Overall Risk Level:** ${results.analysis.risk_assessment.overall_risk_level}
**Success Probability:** ${(results.analysis.success_predictions.overall_success_probability * 100).toFixed(1)}%

### Key Risks
${results.analysis.risk_assessment.risk_items.map(risk => `
- **${risk.category}**: ${risk.description}
  - Probability: ${(risk.probability * 100).toFixed(0)}%
  - Impact: ${risk.impact}
  - Mitigation: ${risk.mitigation_strategy}
`).join('')}

## Recommendations

${results.recommendations.map((rec, index) => `
### ${index + 1}. ${rec.title} (${rec.priority})

${rec.description}

**Impact:** ${rec.impact} | **Effort:** ${rec.effort}

**Implementation Steps:**
${rec.implementation_steps.map(step => `1. ${step}`).join('\n')}
`).join('')}

## Generated: ${new Date().toISOString()}
`;
  
  // Save documentation
  const fs = require('fs').promises;
  await fs.writeFile(`${projectKey}-documentation.md`, documentation);
  
  console.log(`Documentation generated: ${projectKey}-documentation.md`);
  
  return documentation;
};

// Generate docs for multiple projects
const projects = [
  { idea: "Customer support chatbot", key: "CHATBOT" },
  { idea: "Inventory management system", key: "INVENTORY" },
  { idea: "Employee performance dashboard", key: "PERF" }
];

for (const project of projects) {
  await generateProjectDocs(project.idea, project.key);
}
```

---

These examples demonstrate the full range of capabilities from simple CLI usage to complex enterprise integrations. The system adapts to different scales and requirements while maintaining consistent quality and performance.