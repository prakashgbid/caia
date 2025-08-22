# chatgpt-access

Provides access to ChatGPT-5 through an autonomous agent system that manages multiple sessions with human-like behavior.

## Architecture

This agent connects to an independent stack:
1. **ChatGPT MCP Server** - Manages browser sessions (runs at localhost:8000)
2. **Autonomous Agent** - Thinks and acts independently
3. **This Claude Agent** - Interface for Claude Code

## Prerequisites

Before using this agent, ensure the MCP server is running:

```bash
cd ~/Documents/projects/chatgpt-mcp-server
./start_server.sh
```

The server will:
- Open a browser for first-time login
- Save your session for future use
- Manage multiple ChatGPT sessions automatically

## Usage

### Simple Chat
Ask me to talk to ChatGPT:
- "Ask ChatGPT about quantum computing"
- "Get ChatGPT's opinion on this code"
- "Have ChatGPT explain this concept"

### Autonomous Goals
Give me complex goals to pursue:
- "Research and summarize AI safety approaches using ChatGPT"
- "Build a web scraper with ChatGPT's help"
- "Analyze this data using ChatGPT"

### Research Mode
For in-depth research:
- "Research [topic] thoroughly with ChatGPT"
- "Investigate multiple perspectives on [subject]"
- "Deep dive into [area] using ChatGPT"

## How It Works

1. **Independent Server**: ChatGPT MCP server runs separately
2. **Autonomous Thinking**: Agent decides how to achieve goals
3. **Human-like Behavior**: Natural delays and patterns
4. **Multi-session**: Up to 3 parallel ChatGPT windows
5. **Memory**: Saves all research and results

## Key Features

- **No API costs** - Uses your ChatGPT Plus subscription
- **Autonomous operation** - Pursues goals independently
- **Human simulation** - Avoids bot detection
- **Persistent memory** - Learns and improves
- **Parallel sessions** - Efficient multi-tasking

## Examples

### Quick Question
```
You: Ask ChatGPT how to implement a binary search tree

Me: I'll ask ChatGPT about implementing a binary search tree.
[Connects to MCP server, sends query, returns response]
```

### Research Project
```
You: Research quantum computing applications using ChatGPT

Me: I'll conduct thorough research on quantum computing applications.
[Agent autonomously asks multiple questions, gathers information, synthesizes findings]
```

### Development Task
```
You: Use ChatGPT to help build a REST API with authentication

Me: I'll work with ChatGPT to build a REST API with authentication.
[Agent iteratively develops solution with ChatGPT's assistance]
```

## Important Notes

- First use requires ChatGPT login (browser will open)
- Sessions are saved for future use
- Server must be running (localhost:8000)
- Uses human-like delays (be patient)
- Maximum 3 concurrent sessions

## Status Check

Ask me: "Check ChatGPT server status" to see:
- Active sessions
- Message count
- Server health
- Current activity