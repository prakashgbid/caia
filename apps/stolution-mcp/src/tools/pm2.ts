import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// ─── Tool Handlers ────────────────────────────────────────────────────────────

export async function handlePm2List(_args: Record<string, unknown>): Promise<string> {
  const { stdout } = await execAsync('pm2 list --no-color 2>&1');
  return stdout || '(no PM2 processes)';
}

export async function handlePm2Restart(args: Record<string, unknown>): Promise<string> {
  const name = args.name as string;
  if (!name) throw new Error('name is required');

  // Prevent restarting the MCP server itself in a confusing loop
  if (name === 'stolution-mcp') {
    throw new Error('Cannot restart the MCP server itself via MCP. SSH in directly to restart it.');
  }

  const { stdout } = await execAsync(`pm2 restart "${name}" --no-color 2>&1`);
  return stdout || `✅ Restarted: ${name}`;
}

export async function handlePm2Logs(args: Record<string, unknown>): Promise<string> {
  const name = args.name as string;
  const lines = (args.lines as number) ?? 50;
  if (!name) throw new Error('name is required');
  if (lines > 500) throw new Error('lines cannot exceed 500');

  const { stdout } = await execAsync(`pm2 logs "${name}" --lines ${lines} --no-color --nostream 2>&1`);
  return stdout || '(no logs)';
}

// ─── Tool Definitions ─────────────────────────────────────────────────────────

export const pm2ToolDefs = [
  {
    name: 'stolution_pm2_list',
    description: 'List all PM2 managed processes on the stolution server. Shows name, status, CPU, memory, uptime.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'stolution_pm2_restart',
    description: 'Restart a PM2 process on the stolution server by name. Cannot restart the MCP server itself.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'PM2 process name or ID' },
      },
      required: ['name'],
    },
  },
  {
    name: 'stolution_pm2_logs',
    description: 'Retrieve recent logs for a PM2 process on the stolution server.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'PM2 process name or ID' },
        lines: {
          type: 'number',
          description: 'Number of log lines to retrieve (default 50, max 500)',
          default: 50,
        },
      },
      required: ['name'],
    },
  },
];
