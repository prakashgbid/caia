import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// ─── Tool Handlers ────────────────────────────────────────────────────────────

export async function handleDockerPs(_args: Record<string, unknown>): Promise<string> {
  const { stdout } = await execAsync(
    'docker ps --format "table {{.Names}}\\t{{.Image}}\\t{{.Status}}\\t{{.Ports}}" 2>&1'
  );
  const all = await execAsync('docker ps -a --format "table {{.Names}}\\t{{.Image}}\\t{{.Status}}" 2>&1');
  return `=== Running Containers ===\n${stdout}\n=== All Containers ===\n${all.stdout}`;
}

export async function handleDockerLogs(args: Record<string, unknown>): Promise<string> {
  const container = args.container as string;
  const lines = (args.lines as number) ?? 50;
  if (!container) throw new Error('container is required');
  if (lines > 500) throw new Error('lines cannot exceed 500');

  const { stdout } = await execAsync(
    `docker logs --tail=${lines} --timestamps "${container}" 2>&1`
  );
  return stdout || '(no logs)';
}

// ─── Tool Definitions ─────────────────────────────────────────────────────────

export const dockerToolDefs = [
  {
    name: 'stolution_docker_ps',
    description: 'List Docker containers on the stolution server (running + all). Shows name, image, status, ports.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'stolution_docker_logs',
    description: 'Fetch logs from a Docker container on the stolution server. Includes timestamps.',
    inputSchema: {
      type: 'object',
      properties: {
        container: { type: 'string', description: 'Container name or ID' },
        lines: {
          type: 'number',
          description: 'Number of log lines to retrieve (default 50, max 500)',
          default: 50,
        },
      },
      required: ['container'],
    },
  },
];
