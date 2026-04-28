import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// ─── Safety Configuration ─────────────────────────────────────────────────────

/**
 * Commands that are outright blocked regardless of context.
 * This is a defence-in-depth measure — the real safety comes from
 * running the server as a non-root user (s903) with limited sudo.
 */
const BLOCKED_PATTERNS = [
  /\brm\s+-[a-z]*r[a-z]*f\b/i,   // rm -rf
  /\brm\s+-[a-z]*f[a-z]*r\b/i,   // rm -fr
  /\bmkfs\b/,
  /\bdd\s+if=/,
  /\bshutdown\b/,
  /\breboot\b/,
  /\bhalt\b/,
  /\bpasswd\b/,
  /\bsudo\s+su\b/,
  /\bchmod\s+777\b/,
  /\bcurl\b.*\|\s*(bash|sh)/,     // curl | bash
  /\bwget\b.*\|\s*(bash|sh)/,     // wget | bash
  />\s*\/etc\//,                   // writing to /etc
  />\s*\/boot\//,                  // writing to /boot
];

export function isSafeCommand(cmd: string): { safe: boolean; reason?: string } {
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(cmd)) {
      return { safe: false, reason: `Matches blocked pattern: ${pattern}` };
    }
  }
  return { safe: true };
}

// ─── Tool Handlers ────────────────────────────────────────────────────────────

export async function handleBash(args: Record<string, unknown>): Promise<string> {
  const command = args.command as string;
  const timeoutSeconds = (args.timeout as number) ?? 30;

  if (!command) throw new Error('command is required');
  if (timeoutSeconds > 120) throw new Error('timeout cannot exceed 120 seconds');

  const { safe, reason } = isSafeCommand(command);
  if (!safe) throw new Error(`Command blocked for safety: ${reason}`);

  try {
    const { stdout, stderr } = await execAsync(command, {
      timeout: timeoutSeconds * 1000,
      maxBuffer: 2 * 1024 * 1024, // 2MB output cap
      env: { ...process.env, TERM: 'dumb' },
    });
    const out = [stdout, stderr].filter(Boolean).join('\n--- stderr ---\n');
    return out || '(command completed with no output)';
  } catch (err: unknown) {
    if (err instanceof Error && 'killed' in err && (err as NodeJS.ErrnoException & { killed?: boolean }).killed) {
      throw new Error(`Command timed out after ${timeoutSeconds}s: ${command}`);
    }
    // Non-zero exit — return the stderr/stdout so Claude can read it
    const e = err as { stdout?: string; stderr?: string; code?: number };
    const out = [e.stdout, e.stderr].filter(Boolean).join('\n');
    return `[exit code ${e.code ?? '?'}]\n${out || '(no output)'}`;
  }
}

export async function handleGit(args: Record<string, unknown>): Promise<string> {
  const gitArgs = args.args as string;
  const repoPath = (args.repo_path as string) ?? '/home/s903/stolution';

  if (!gitArgs) throw new Error('args is required (e.g. "status", "log --oneline -20")');

  // Disallow destructive git commands
  const BLOCKED_GIT = ['push --force', 'push -f', 'reset --hard', 'clean -fd', 'branch -D'];
  for (const blocked of BLOCKED_GIT) {
    if (gitArgs.includes(blocked)) {
      throw new Error(`Blocked git operation: git ${blocked}`);
    }
  }

  const cmd = `git -C "${repoPath}" ${gitArgs} 2>&1`;
  const { stdout } = await execAsync(cmd, { timeout: 30_000 });
  return stdout || '(no output)';
}

// ─── Tool Definitions ─────────────────────────────────────────────────────────

export const shellToolDefs = [
  {
    name: 'stolution_bash',
    description: [
      'Run a bash command on the stolution remote server.',
      'Safety: blocks rm -rf, mkfs, dd, shutdown, reboot, passwd, curl|bash, writes to /etc or /boot.',
      'Output capped at 2MB. Timeout: 1–120 seconds.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The bash command to execute' },
        timeout: {
          type: 'number',
          description: 'Timeout in seconds (default 30, max 120)',
          default: 30,
        },
      },
      required: ['command'],
    },
  },
  {
    name: 'stolution_git',
    description: 'Run a git command inside the stolution repository (or a specified repo path). Destructive force-pushes and hard resets are blocked.',
    inputSchema: {
      type: 'object',
      properties: {
        args: { type: 'string', description: 'Git subcommand and arguments, e.g. "status", "log --oneline -20", "diff HEAD~1"' },
        repo_path: {
          type: 'string',
          description: 'Absolute path to the git repository (default: /home/s903/stolution)',
          default: '/home/s903/stolution',
        },
      },
      required: ['args'],
    },
  },
];
