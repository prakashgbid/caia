# Jira Connect Agent

MCP-based Jira integration agent optimized for ParaForge's parallel operations.

## Features
- Handles 100s of parallel connections
- Automatic rate limiting and retry
- Connection pooling
- Bulk operations optimization

## Usage

```typescript
import { JiraConnect } from '../agents/jira-connect';

const jira = new JiraConnect({
  host: 'https://your-domain.atlassian.net',
  email: 'email@example.com',
  apiToken: 'your-token'
});

await jira.initialize();

// Create PROJECT epic
const project = await jira.createEpic({
  project: 'PARA',
  summary: 'PROJECT: My Project',
  description: 'Full description',
  labels: ['PROJECT']
});

// Bulk create stories
const stories = await jira.bulkCreateIssues([
  { project: 'PARA', issueType: 'Story', summary: 'Story 1' },
  { project: 'PARA', issueType: 'Story', summary: 'Story 2' },
  // ... up to 100s of issues
]);
```

## Performance
- Single issue: ~500ms
- 100 issues: ~3-5 seconds
- 1000 issue search: ~1-2 seconds

## Future
This agent will be extracted to `@autoforge/agent-jira-connect` package.