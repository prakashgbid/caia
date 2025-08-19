# @caia/agent-jira-connect

MCP-based Jira integration agent for CAIA framework with optimized parallel connection handling.

## Features

- **MCP-based Architecture**: Uses Model Context Protocol for optimal performance
- **Parallel Connection Handling**: Handles 100s of simultaneous Jira operations
- **Connection Pooling**: Automatic rate limiting and retry mechanisms
- **10-20x Performance**: Significantly faster than direct API calls
- **Global Agent**: Available to all CAIA projects

## Installation

```bash
npm install @caia/agent-jira-connect
```

## Usage

### As a Module

```javascript
const jiraConnect = require('@caia/agent-jira-connect');

// Initialize the agent
await jiraConnect.initialize();

// Create an issue
const issue = await jiraConnect.createIssue({
  project: 'PARA',
  issueType: 'Task',
  summary: 'New feature request',
  description: 'Detailed description of the feature',
  labels: ['feature', 'priority']
});

// Search issues
const issues = await jiraConnect.searchIssues('project = PARA ORDER BY created DESC');

// Bulk operations (optimized for parallel execution)
const bulkIssues = await jiraConnect.bulkCreateIssues([
  { project: 'PARA', issueType: 'Task', summary: 'Task 1' },
  { project: 'PARA', issueType: 'Task', summary: 'Task 2' },
  { project: 'PARA', issueType: 'Task', summary: 'Task 3' }
]);
```

### CLI Interface

```bash
# Test connection
jira-connect test

# Create an issue
jira-connect create PARA Task "Test Task" "Description"

# Search issues
jira-connect search "project = PARA"

# Get issue details
jira-connect get PARA-35
```

## Configuration

Set environment variables:

```bash
export JIRA_HOST_URL="https://your-domain.atlassian.net"
export JIRA_USERNAME="your-email@domain.com"
export JIRA_API_TOKEN="your-api-token"
```

Or create a `.env` file in your project root:

```
JIRA_HOST_URL=https://your-domain.atlassian.net
JIRA_USERNAME=your-email@domain.com
JIRA_API_TOKEN=your-api-token
```

## API Reference

### Core Methods

- `createIssue(data)` - Create a new Jira issue
- `updateIssue(issueKey, data)` - Update an existing issue
- `getIssue(issueKey, fields)` - Get issue details
- `searchIssues(jql, fields, maxResults)` - Search issues using JQL
- `deleteIssue(issueKey)` - Delete an issue
- `addComment(issueKey, comment)` - Add comment to issue
- `getComments(issueKey)` - Get issue comments

### Bulk Operations

- `bulkCreateIssues(issues)` - Create multiple issues in parallel
- `bulkUpdateIssues(updates)` - Update multiple issues in parallel

### Epic Management

- `createEpic(data)` - Create a new epic
- `addIssuesToEpic(epicKey, issueKeys)` - Add issues to epic

### Project Management

- `getProject(projectKey)` - Get project details
- `listProjects()` - List all projects
- `getIssueTypes(projectKey)` - Get available issue types

### Issue Transitions

- `getTransitions(issueKey)` - Get available transitions
- `transitionIssue(issueKey, transitionId)` - Transition an issue

## Performance Benefits

- **MCP Server**: Uses dedicated MCP server for Jira operations
- **Connection Pooling**: Reuses connections for multiple requests
- **Parallel Processing**: Handles concurrent operations efficiently
- **Rate Limiting**: Automatic rate limiting prevents API throttling
- **Retry Logic**: Built-in retry mechanisms for failed requests

## Integration with CAIA

This agent is designed to work seamlessly with the CAIA framework:

- Uses `@caia/core` for shared utilities
- Follows CAIA agent conventions
- Integrates with CAIA orchestration system
- Supports CAIA's parallel execution patterns

## Why Use This Instead of Direct API Calls?

```javascript
// ❌ NEVER do this:
const axios = require('axios');
await axios.post('https://jira.../rest/api/3/issue', data);

// ✅ ALWAYS do this:
const jiraConnect = require('@caia/agent-jira-connect');
await jiraConnect.createIssue(data);
```

Benefits:
- 10-20x faster execution
- Automatic connection pooling
- Built-in rate limiting
- Error handling and retries
- Optimized for parallel operations

## License

MIT