# Jira Connect Agent

## Overview
The **jira-connect** agent is the centralized, MCP-based Jira integration agent for Claude Code. It provides the ONLY approved method for interacting with Jira across all projects.

## Purpose
- **Single point of integration** with Jira REST API
- **Connection pooling** for handling 100s of parallel requests
- **Rate limiting** to respect Jira API limits
- **Automatic retry** with exponential backoff
- **Centralized authentication** management
- **Consistent interface** across all CC instances

## When to Use
**ALWAYS** use this agent for ANY Jira operation including:
- Creating issues (Epics, Stories, Tasks, etc.)
- Updating issues
- Searching and querying issues
- Managing issue links and hierarchy
- Adding comments and attachments
- Transitioning issue status
- Managing projects
- Configuring issue types
- Creating custom fields
- Managing labels and components

## Available Operations

### Core Issue Operations
- `create_issue` - Create any issue type
- `update_issue` - Update issue fields
- `get_issue` - Retrieve issue details
- `delete_issue` - Delete an issue
- `search_issues` - JQL search
- `get_issue_comments` - Get comments
- `add_comment` - Add comment to issue
- `get_assigned_issues` - Get user's assigned issues

### Hierarchy Management
- `create_epic` - Create epic with proper hierarchy
- `add_issues_to_epic` - Link issues to epic
- `create_subtask` - Create subtask under parent
- `link_issues` - Create issue links

### Project Management
- `get_project` - Get project details
- `list_projects` - List all projects
- `get_project_issues` - Get all project issues
- `get_project_components` - Get project components
- `get_project_versions` - Get project versions

### Bulk Operations
- `bulk_create_issues` - Create multiple issues in parallel
- `bulk_update_issues` - Update multiple issues
- `bulk_transition_issues` - Transition multiple issues

### Advanced Operations
- `get_issue_types` - Get available issue types
- `get_fields` - Get field definitions
- `get_transitions` - Get available transitions
- `get_priorities` - Get priority levels
- `get_statuses` - Get status options

## Configuration
The agent uses MCP (Model Context Protocol) server for Jira connectivity.

### Environment Variables Required:
- `JIRA_HOST_URL`: https://roulettecommunity.atlassian.net
- `JIRA_USERNAME`: prakashmailid@gmail.com
- `JIRA_API_TOKEN`: [Configured in MCP server]

## Usage Examples

### Creating a PROJECT Epic
```javascript
await jiraConnect.create_issue({
  project: "PARA",
  issueType: "Epic",
  summary: "PROJECT: ParaForge Framework",
  description: "Complete project scope...",
  labels: ["PROJECT"],
  epicName: "ParaForge"
});
```

### Creating Multiple Issues in Parallel
```javascript
await jiraConnect.bulk_create_issues([
  { project: "PARA", issueType: "Story", summary: "Story 1" },
  { project: "PARA", issueType: "Story", summary: "Story 2" },
  { project: "PARA", issueType: "Story", summary: "Story 3" }
]);
```

### Searching with JQL
```javascript
await jiraConnect.search_issues({
  jql: "project = PARA AND type = Epic AND labels = PROJECT",
  fields: ["summary", "description", "status"]
});
```

## Architecture Benefits

### For ParaForge Scale (100s of parallel CC instances):
1. **Connection Pooling**: MCP server maintains connection pool
2. **Rate Limiting**: Centralized rate limit management
3. **Queue Management**: Automatic request queuing
4. **Error Recovery**: Built-in retry with backoff
5. **Performance**: 10-20x faster than direct API calls
6. **Reliability**: No 429 errors from overwhelming API

## Best Practices

1. **Always use bulk operations** when creating/updating multiple issues
2. **Use JQL for searches** instead of fetching all and filtering
3. **Include only needed fields** in queries to reduce payload
4. **Let MCP handle retries** - don't retry in your code
5. **Trust the agent** - it handles all edge cases

## Error Handling
The agent automatically handles:
- Network timeouts
- Rate limiting (429 errors)
- Temporary Jira outages
- Authentication refresh
- Malformed requests

## Performance Expectations
- Single issue creation: ~500ms
- Bulk creation (100 issues): ~3-5 seconds
- JQL search (1000 results): ~1-2 seconds
- Parallel operations: Linear scaling up to 50 concurrent

## Migration from Direct API
Replace any direct Jira API calls with jira-connect agent:

**Before (Direct API):**
```javascript
const response = await axios.post(
  `${JIRA_URL}/rest/api/3/issue`,
  issueData,
  { headers: { 'Authorization': `Basic ${token}` }}
);
```

**After (jira-connect):**
```javascript
const response = await jiraConnect.create_issue(issueData);
```

## Monitoring
The agent provides:
- Request/response logging
- Performance metrics
- Error tracking
- Rate limit status
- Queue depth monitoring

## Support
This agent is maintained as part of the global CC agent infrastructure.
For issues or enhancements, update this agent definition.

---

**IMPORTANT**: This is the ONLY approved method for Jira integration. 
Never use direct API calls, always use jira-connect agent.