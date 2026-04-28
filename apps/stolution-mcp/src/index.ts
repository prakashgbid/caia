/**
 * stolution-mcp — MCP server for remote stolution server management
 *
 * Exposes tools for: file system, bash, git, Docker, PM2, HashiCorp Vault,
 * and PostgreSQL — all running on the stolution remote server (s903@162.251.161.17).
 *
 * Transport: stdio (SSH tunnels it — `ssh stolution node ~/stolution-mcp/dist/index.js`)
 * Protocol:  Model Context Protocol (MCP) v1.x via @modelcontextprotocol/sdk
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';

// ─── Tool modules ─────────────────────────────────────────────────────────────
import {
  filesystemToolDefs,
  handleReadFile,
  handleListDir,
  handleWriteFile,
  handleGrep,
} from './tools/filesystem.js';

import {
  shellToolDefs,
  handleBash,
  handleGit,
} from './tools/shell.js';

import {
  dockerToolDefs,
  handleDockerPs,
  handleDockerLogs,
} from './tools/docker.js';

import {
  pm2ToolDefs,
  handlePm2List,
  handlePm2Restart,
  handlePm2Logs,
} from './tools/pm2.js';

import {
  vaultToolDefs,
  handleVaultGet,
  handleVaultList,
} from './tools/vault.js';

import {
  databaseToolDefs,
  handleDbQuery,
  handleDbSchema,
} from './tools/database.js';

// ─── Aggregate all tool definitions ──────────────────────────────────────────

const ALL_TOOLS: Tool[] = [
  ...filesystemToolDefs,
  ...shellToolDefs,
  ...dockerToolDefs,
  ...pm2ToolDefs,
  ...vaultToolDefs,
  ...databaseToolDefs,
] as Tool[];

// ─── Create MCP server ────────────────────────────────────────────────────────

const server = new Server(
  {
    name: 'stolution-mcp',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// ─── List tools handler ───────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: ALL_TOOLS,
}));

// ─── Call tool handler ────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const safeArgs = (args ?? {}) as Record<string, unknown>;

  log(`Tool called: ${name}`, safeArgs);

  try {
    let text: string;

    switch (name) {
      // Filesystem
      case 'stolution_read_file':   text = await handleReadFile(safeArgs);   break;
      case 'stolution_list_dir':    text = await handleListDir(safeArgs);     break;
      case 'stolution_write_file':  text = await handleWriteFile(safeArgs);   break;
      case 'stolution_grep':        text = await handleGrep(safeArgs);        break;

      // Shell
      case 'stolution_bash':        text = await handleBash(safeArgs);        break;
      case 'stolution_git':         text = await handleGit(safeArgs);         break;

      // Docker
      case 'stolution_docker_ps':   text = await handleDockerPs(safeArgs);    break;
      case 'stolution_docker_logs': text = await handleDockerLogs(safeArgs);  break;

      // PM2
      case 'stolution_pm2_list':    text = await handlePm2List(safeArgs);     break;
      case 'stolution_pm2_restart': text = await handlePm2Restart(safeArgs);  break;
      case 'stolution_pm2_logs':    text = await handlePm2Logs(safeArgs);     break;

      // Vault
      case 'stolution_vault_get':   text = await handleVaultGet(safeArgs);    break;
      case 'stolution_vault_list':  text = await handleVaultList(safeArgs);   break;

      // Database
      case 'stolution_db_query':    text = await handleDbQuery(safeArgs);     break;
      case 'stolution_db_schema':   text = await handleDbSchema(safeArgs);    break;

      default:
        throw new Error(`Unknown tool: ${name}. Available tools: ${ALL_TOOLS.map(t => t.name).join(', ')}`);
    }

    log(`Tool success: ${name}`);
    return { content: [{ type: 'text' as const, text }] };

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log(`Tool error: ${name} — ${message}`);
    return {
      content: [{ type: 'text' as const, text: `❌ Error in ${name}: ${message}` }],
      isError: true,
    };
  }
});

// ─── Logging (stderr so it doesn't interfere with stdio MCP protocol) ─────────

function log(message: string, data?: unknown): void {
  const ts = new Date().toISOString();
  const extra = data && Object.keys(data).length ? ` ${JSON.stringify(data)}` : '';
  process.stderr.write(`[stolution-mcp] ${ts} ${message}${extra}\n`);
}

// ─── Startup ──────────────────────────────────────────────────────────────────

log('Starting stolution-mcp server...');
log(`Node ${process.version} | PID ${process.pid}`);
log(`Tools registered: ${ALL_TOOLS.map(t => t.name).join(', ')}`);

const transport = new StdioServerTransport();
await server.connect(transport);

log('✅ Server connected on stdio — ready for MCP requests');
