#!/usr/bin/env node
/**
 * ChatGPT MCP Server
 * 
 * Provides ChatGPT-5 access to Claude Code via browser automation.
 * Uses your ChatGPT Plus subscription ($20/month) for unlimited access.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { chromium, Browser, Page, BrowserContext } from "playwright";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class ChatGPTMCPServer {
  private server: Server;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private isInitialized = false;
  private sessionDir: string;

  constructor() {
    this.sessionDir = path.join(
      process.env.HOME || process.env.USERPROFILE || "",
      ".chatgpt-mcp",
      "session"
    );
    
    this.server = new Server(
      {
        name: "chatgpt-mcp-server",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
  }

  private setupHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.getTools(),
    }));

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case "chat":
            return await this.handleChat(args.prompt);
          
          case "code_interpreter":
            return await this.handleCodeInterpreter(args.code, args.description);
          
          case "image_generation":
            return await this.handleImageGeneration(args.prompt);
          
          case "web_search":
            return await this.handleWebSearch(args.query);
          
          case "initialize":
            return await this.handleInitialize();
          
          case "status":
            return await this.handleStatus();
          
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    });
  }

  private getTools(): Tool[] {
    return [
      {
        name: "initialize",
        description: "Initialize ChatGPT browser session (run this first)",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "chat",
        description: "Send a message to ChatGPT-5 and get response",
        inputSchema: {
          type: "object",
          properties: {
            prompt: {
              type: "string",
              description: "The message to send to ChatGPT",
            },
          },
          required: ["prompt"],
        },
      },
      {
        name: "code_interpreter",
        description: "Use ChatGPT's Code Interpreter to execute code",
        inputSchema: {
          type: "object",
          properties: {
            code: {
              type: "string",
              description: "The code to execute",
            },
            description: {
              type: "string",
              description: "Description of what the code should do",
            },
          },
          required: ["code", "description"],
        },
      },
      {
        name: "image_generation",
        description: "Generate images using DALL-E 3",
        inputSchema: {
          type: "object",
          properties: {
            prompt: {
              type: "string",
              description: "Description of the image to generate",
            },
          },
          required: ["prompt"],
        },
      },
      {
        name: "web_search",
        description: "Use ChatGPT's web browsing capability",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "What to search for on the web",
            },
          },
          required: ["query"],
        },
      },
      {
        name: "status",
        description: "Check ChatGPT connection status",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
    ];
  }

  private async initializeBrowser(): Promise<void> {
    if (this.isInitialized && this.page) {
      return;
    }

    console.error("🚀 Initializing ChatGPT browser session...");

    // Launch browser
    this.browser = await chromium.launch({
      headless: false, // Set to true after initial login
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    // Create persistent context
    const sessionPath = path.join(this.sessionDir, "chromium");
    await fs.mkdir(sessionPath, { recursive: true });

    this.context = await this.browser.newContext({
      storageState: await this.loadSession(),
      viewport: { width: 1280, height: 800 },
    });

    this.page = await this.context.newPage();

    // Navigate to ChatGPT
    await this.page.goto("https://chat.openai.com", {
      waitUntil: "networkidle",
      timeout: 30000,
    });

    // Check if logged in
    const isLoggedIn = await this.checkLoginStatus();

    if (!isLoggedIn) {
      console.error("⚠️ Please log in to ChatGPT in the browser window");
      console.error("After logging in, the session will be saved for future use");
      
      // Wait for login
      await this.page.waitForSelector('[data-testid="profile-button"]', {
        timeout: 300000, // 5 minutes to log in
      });

      // Save session
      await this.saveSession();
      console.error("✅ Session saved! Future connections will be automatic");
    }

    this.isInitialized = true;
    console.error("✅ ChatGPT browser session initialized");
  }

  private async checkLoginStatus(): Promise<boolean> {
    if (!this.page) return false;

    try {
      await this.page.waitForSelector('[data-testid="profile-button"]', {
        timeout: 5000,
      });
      return true;
    } catch {
      return false;
    }
  }

  private async loadSession(): Promise<any> {
    const sessionFile = path.join(this.sessionDir, "session.json");
    try {
      const data = await fs.readFile(sessionFile, "utf-8");
      return JSON.parse(data);
    } catch {
      return undefined;
    }
  }

  private async saveSession(): Promise<void> {
    if (!this.context) return;

    const sessionFile = path.join(this.sessionDir, "session.json");
    await fs.mkdir(this.sessionDir, { recursive: true });
    
    const state = await this.context.storageState();
    await fs.writeFile(sessionFile, JSON.stringify(state, null, 2));
  }

  private async handleInitialize() {
    await this.initializeBrowser();
    return {
      content: [
        {
          type: "text",
          text: "✅ ChatGPT browser session initialized. You can now use all ChatGPT features!",
        },
      ],
    };
  }

  private async handleChat(prompt: string) {
    await this.initializeBrowser();
    if (!this.page) throw new Error("Browser not initialized");

    // Find the input field
    const input = await this.page.locator('textarea[placeholder*="Message"]').first();
    await input.fill(prompt);

    // Send message
    await input.press("Enter");

    // Wait for response
    await this.page.waitForTimeout(2000);

    // Wait for ChatGPT to finish responding
    await this.page.waitForFunction(
      () => {
        const buttons = Array.from(document.querySelectorAll("button"));
        return buttons.some(btn => btn.textContent?.includes("Stop generating"));
      },
      { timeout: 60000 }
    ).catch(() => {}); // Ignore timeout, response might be quick

    // Get the last response
    const responses = await this.page.locator('[data-message-author-role="assistant"]').all();
    const lastResponse = responses[responses.length - 1];
    
    let responseText = "";
    if (lastResponse) {
      responseText = await lastResponse.textContent() || "";
    }

    return {
      content: [
        {
          type: "text",
          text: responseText || "No response received",
        },
      ],
    };
  }

  private async handleCodeInterpreter(code: string, description: string) {
    const prompt = `Use Code Interpreter to ${description}:\n\n\`\`\`python\n${code}\n\`\`\``;
    return await this.handleChat(prompt);
  }

  private async handleImageGeneration(prompt: string) {
    const imagePrompt = `Generate an image: ${prompt}`;
    return await this.handleChat(imagePrompt);
  }

  private async handleWebSearch(query: string) {
    const searchPrompt = `Search the web for: ${query}`;
    return await this.handleChat(searchPrompt);
  }

  private async handleStatus() {
    const status = {
      initialized: this.isInitialized,
      browserConnected: this.browser !== null,
      pageActive: this.page !== null,
      loggedIn: await this.checkLoginStatus(),
    };

    return {
      content: [
        {
          type: "text",
          text: `ChatGPT Status:\n${JSON.stringify(status, null, 2)}`,
        },
      ],
    };
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("ChatGPT MCP Server running on stdio");
  }

  async cleanup() {
    if (this.browser) {
      await this.saveSession();
      await this.browser.close();
    }
  }
}

// Main execution
const server = new ChatGPTMCPServer();

process.on("SIGINT", async () => {
  await server.cleanup();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await server.cleanup();
  process.exit(0);
});

server.run().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});