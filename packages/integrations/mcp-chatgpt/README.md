# ChatGPT MCP Server

**Access ChatGPT-5 from Claude Code using your ChatGPT Plus subscription!**

## 🚀 What This Does

This MCP (Model Context Protocol) server gives Claude Code access to ChatGPT-5 features:
- **Chat with GPT-5** - Full conversations
- **Code Interpreter** - Execute Python code
- **DALL-E 3** - Generate images
- **Web Browsing** - Search and research
- **No API costs** - Uses your $20/month ChatGPT Plus subscription

## 📦 Installation

```bash
cd ~/Documents/projects/chatgpt-mcp-server
npm install
npm run setup  # Installs Playwright browsers
```

## 🔧 Configuration

### 1. Add to Claude Code Settings

Edit your Claude Code settings:
```bash
code ~/Library/Application\ Support/Claude/claude_desktop_config.json
```

Add this MCP server:
```json
{
  "mcpServers": {
    "chatgpt": {
      "command": "node",
      "args": ["/Users/MAC/Documents/projects/chatgpt-mcp-server/dist/index.js"],
      "env": {}
    }
  }
}
```

### 2. Build the Server

```bash
npm run build
```

### 3. First-Time Login

The first time you use it, a browser window will open:
1. Log in to your ChatGPT Plus account
2. The session will be saved automatically
3. Future uses will be automatic (no login needed)

## 🎯 Usage in Claude Code

Once configured, you can use these commands in Claude Code:

### Initialize Connection
```
Use the chatgpt MCP server to initialize the connection
```

### Chat with GPT-5
```
Use chatgpt to ask: "Explain quantum computing in simple terms"
```

### Code Interpreter
```
Use chatgpt code_interpreter to run this Python code:
import numpy as np
print(np.random.randn(10))
```

### Generate Images
```
Use chatgpt to generate an image: "A futuristic city at sunset"
```

### Web Search
```
Use chatgpt to search the web for: "Latest AI research papers 2024"
```

## 🏗️ Architecture

```
Claude Code (You)
    ↓
MCP Protocol
    ↓
ChatGPT MCP Server (This)
    ↓
Browser Automation (Playwright)
    ↓
ChatGPT Plus (Your Subscription)
```

## 🔒 Security

- **Session saved locally** in `~/.chatgpt-mcp/session/`
- **No credentials in code** - Uses browser session
- **Headless mode** after first login
- **Automatic session refresh**

## 🐛 Troubleshooting

### Server not found in Claude Code
1. Restart Claude Code after editing config
2. Check the path in config is absolute

### Can't connect to ChatGPT
1. Run with visible browser: Edit `headless: false` in index.ts
2. Log in manually when browser opens
3. Session will be saved for next time

### Session expired
1. Delete `~/.chatgpt-mcp/session/`
2. Run initialize command again
3. Log in when browser opens

## 💡 Pro Tips

1. **Keep session alive**: Use at least once per week
2. **Model selection**: Say "Use GPT-4" or "Use GPT-5" in your prompts
3. **Code execution**: Always specify language in code blocks
4. **Image generation**: Be specific with style and details

## 📊 Value Proposition

- **ChatGPT API cost**: ~$50-200/month for heavy use
- **Your cost**: $0 (uses existing $20/month Plus subscription)
- **Savings**: $30-180/month
- **Features**: All Plus features including GPT-5, Code Interpreter, DALL-E 3

## 🎉 You're Ready!

Now you can use ChatGPT-5 directly from Claude Code:

```
Me: Use chatgpt to write a Python web scraper with error handling

Claude: I'll use the ChatGPT MCP server to help you create a Python web scraper.
[Claude then uses ChatGPT to generate the code]
```

The best of both worlds - Claude's reasoning with ChatGPT's capabilities!