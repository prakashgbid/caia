import { readFile, writeFile, readdir, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execAsync = promisify(exec);

// ─── Safety Configuration ─────────────────────────────────────────────────────

const ALLOWED_READ_PATHS = [
  '/home/s903/stolution',
  '/home/s903/stolution-mcp',
  '/var/log',
  '/etc/nginx',
];

const ALLOWED_WRITE_PATHS = [
  '/home/s903/stolution/apps',
  '/home/s903/stolution/config',
  '/home/s903/stolution-mcp',
  '/tmp',
];

export function isSafeReadPath(p: string): boolean {
  const resolved = path.resolve(p);
  return ALLOWED_READ_PATHS.some(allowed => resolved.startsWith(allowed));
}

export function isSafeWritePath(p: string): boolean {
  const resolved = path.resolve(p);
  return ALLOWED_WRITE_PATHS.some(allowed => resolved.startsWith(allowed));
}

// ─── Tool Handlers ────────────────────────────────────────────────────────────

export async function handleReadFile(args: Record<string, unknown>): Promise<string> {
  const filePath = args.path as string;
  if (!filePath) throw new Error('path is required');
  if (!isSafeReadPath(filePath)) {
    throw new Error(`Path not in allowed read locations: ${filePath}\nAllowed: ${ALLOWED_READ_PATHS.join(', ')}`);
  }
  if (!existsSync(filePath)) throw new Error(`File not found: ${filePath}`);

  const fileStat = await stat(filePath);
  if (fileStat.isDirectory()) throw new Error(`Path is a directory, use stolution_list_dir instead: ${filePath}`);

  // Warn if file is large (>500KB)
  if (fileStat.size > 512_000) {
    throw new Error(`File too large (${(fileStat.size / 1024).toFixed(0)}KB). Use stolution_bash with head/tail/grep instead.`);
  }

  const content = await readFile(filePath, 'utf-8');
  return `=== ${filePath} (${fileStat.size} bytes) ===\n${content}`;
}

export async function handleListDir(args: Record<string, unknown>): Promise<string> {
  const dirPath = args.path as string;
  if (!dirPath) throw new Error('path is required');

  const { stdout } = await execAsync(`ls -lahF "${dirPath}" 2>&1`);
  return `=== ${dirPath} ===\n${stdout}`;
}

export async function handleWriteFile(args: Record<string, unknown>): Promise<string> {
  const filePath = args.path as string;
  const content = args.content as string;
  if (!filePath) throw new Error('path is required');
  if (content === undefined || content === null) throw new Error('content is required');
  if (!isSafeWritePath(filePath)) {
    throw new Error(`Path not in allowed write locations: ${filePath}\nAllowed: ${ALLOWED_WRITE_PATHS.join(', ')}`);
  }

  const exists = existsSync(filePath);
  await writeFile(filePath, content, 'utf-8');
  return `✅ ${exists ? 'Updated' : 'Created'} ${filePath} (${Buffer.byteLength(content)} bytes)`;
}

export async function handleGrep(args: Record<string, unknown>): Promise<string> {
  const pattern = args.pattern as string;
  const searchPath = args.path as string;
  const options = (args.options as string) || '';
  if (!pattern) throw new Error('pattern is required');
  if (!searchPath) throw new Error('path is required');

  // Build a safe ripgrep / grep command
  const flags = options.includes('-i') ? '-i' : '';
  const recursive = options.includes('-r') ? '-r' : '';

  const cmd = `grep -n ${flags} ${recursive} --include="*.ts" --include="*.js" --include="*.json" --include="*.env*" --include="*.yml" --include="*.yaml" --include="*.sh" --include="*.md" -E "${pattern.replace(/"/g, '\\"')}" "${searchPath}" 2>&1 | head -200`;
  const { stdout } = await execAsync(cmd);
  return stdout || '(no matches)';
}

// ─── Tool Definitions (for ListTools) ────────────────────────────────────────

export const filesystemToolDefs = [
  {
    name: 'stolution_read_file',
    description: 'Read a file from the stolution remote server. Restricted to allowed directories (stolution project, logs, nginx config).',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to the file on the remote server' },
      },
      required: ['path'],
    },
  },
  {
    name: 'stolution_list_dir',
    description: 'List directory contents on the stolution remote server (ls -lahF).',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to the directory' },
      },
      required: ['path'],
    },
  },
  {
    name: 'stolution_write_file',
    description: 'Write (create or overwrite) a file on the stolution remote server. Restricted to apps/, config/, and /tmp.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to the file' },
        content: { type: 'string', description: 'File content to write' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'stolution_grep',
    description: 'Search files on the stolution server using grep. Returns up to 200 matching lines.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Regex pattern to search for' },
        path: { type: 'string', description: 'File or directory to search in' },
        options: { type: 'string', description: 'Optional flags: -i (case-insensitive), -r (recursive)', default: '' },
      },
      required: ['pattern', 'path'],
    },
  },
];
