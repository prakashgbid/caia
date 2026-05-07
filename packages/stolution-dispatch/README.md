# @chiefaia/stolution-dispatch

MCP tool wrapper for spawning remote Claude Code workers on stolution via SSH.

## Overview

This package provides a single MCP tool `stolution_claude_dispatch` that allows Cowork (or any other MCP client) to dispatch tasks to a remote Claude Code worker on the stolution server. The wrapper handles SSH transport, session management, output extraction, and cleanup.

## Usage

### Basic Task Dispatch

```typescript
import { dispatch } from '@chiefaia/stolution-dispatch';

const result = await dispatch({
  task_brief: 'What is 2 + 2?',
  expected_output_shape: 'text',
  timeout_seconds: 60,
});

console.log(result.output); // Claude's response
console.log(result.duration_ms); // How long it took
```

### JSON Output

```typescript
const result = await dispatch({
  task_brief: 'Return a JSON object with keys "name" and "status"',
  expected_output_shape: 'json',
  timeout_seconds: 60,
});

// result.output will contain the JSON
const data = JSON.parse(result.output);
```

### Full Transcript

```typescript
const result = await dispatch({
  task_brief: 'Analyze this codebase',
  expected_output_shape: 'transcript',
  timeout_seconds: 300,
  cleanup_on_completion: false, // Keep session for inspection
});

console.log(result.transcript_path); // Path to JSONL on stolution
console.log(result.remote_session_id); // Session ID for reference
```

## Input Schema

```typescript
interface StolutionDispatchInput {
  task_brief: string;                  // Required: the prompt for the remote worker
  expected_output_shape?: 'text' | 'json' | 'transcript'; // Default: 'text'
  timeout_seconds?: number;            // Default: 600 (10 min), max: 7200 (2 hr)
  working_directory?: string;          // Default: /home/s903/stolution
  cleanup_on_completion?: boolean;     // Default: true
}
```

## Output Schema

```typescript
interface StolutionDispatchOutput {
  ok: boolean;                // Whether the dispatch succeeded
  output: string;             // The worker's final message or output
  transcript_path?: string;   // Path to transcript if expected_output_shape==='transcript'
  duration_ms: number;        // Total duration in milliseconds
  remote_session_id?: string; // Session ID if cleanup_on_completion===false
  error?: string;             // Error message if ok === false
}
```

## How It Works

1. **SSH Connection**: Establishes a non-interactive SSH connection to stolution (s903@stolution)
2. **Session Setup**: Creates a temporary directory `/tmp/cowork-dispatch/<uuid>/` on stolution
3. **Task Execution**: Writes the task brief to a file and pipes it to `claude --print`
4. **Output Capture**: Captures stdout and extracts the final assistant message
5. **Cleanup**: Removes the session directory (configurable)

## Error Handling

The dispatch function can fail in several ways:

- **SSH Connection Failed**: The stolution host is unreachable or SSH key auth failed
- **Claude Not Found**: The remote claude binary is missing or not executable
- **Timeout**: The remote task exceeded the timeout
- **Cleanup Failed**: Session directory couldn't be removed (non-fatal, sessions expire)

All errors are returned with `ok: false` and an `error` field explaining the failure.

## Integration with Cowork

When registered as an MCP server, this tool is available in Cowork as `stolution_claude_dispatch`. Cowork can use it to spawn workers for long-running or resource-intensive tasks:

```javascript
// In Cowork or any MCP client
const result = await client.tools.stolution_claude_dispatch({
  task_brief: 'Run a 10-minute analysis',
  timeout_seconds: 600,
});
```

## Prerequisites

- SSH key auth configured for stolution (s903@stolution)
- Remote Claude Code binary at `/home/s903/.local/bin/claude`
- Shared memory path synced via Syncthing: `/home/s903/agent-memory/` ↔ `~/Documents/projects/agent-memory/`

## Testing

### Unit Tests

```bash
pnpm --filter @chiefaia/stolution-dispatch test
```

### Integration Tests

Integration tests actually round-trip to stolution. They are skipped by default; to run them:

```bash
SKIP_INTEGRATION_TESTS=0 pnpm --filter @chiefaia/stolution-dispatch test:integration
```

## Limitations & Future Work

- **Concurrency**: Currently no mutex on stolution side; concurrent dispatches to the same working directory could interfere. A future version may add per-dispatch working directories.
- **Large Output**: Stdout is limited to 50 MB per dispatch. Very large transcripts may be truncated.
- **Credentials**: The dispatch transport is a plain SSH wrapper. Sensitive credentials passed in task_brief are not encrypted in transit (SSH provides encryption at the transport layer).

## Architecture Decision Record

See `agent/memory/single_front_door_architecture_2026-05-07.md` for the rationale behind this package.
