import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// ─── Configuration ────────────────────────────────────────────────────────────

/**
 * The Vault container name. Adjust if your setup differs.
 * Alternatively, set VAULT_ADDR and VAULT_TOKEN in the environment
 * and use the vault CLI directly (if installed on the host).
 */
const VAULT_CONTAINER = process.env.VAULT_CONTAINER ?? 'vault';
const VAULT_ADDR = process.env.VAULT_ADDR ?? 'http://127.0.0.1:8200';
const VAULT_TOKEN = process.env.VAULT_TOKEN; // read from env at runtime

/**
 * Build the vault CLI invocation — either via docker exec (if containerized)
 * or via local vault binary (if VAULT_TOKEN is set in env).
 */
function vaultCmd(subcommand: string): string {
  if (VAULT_TOKEN) {
    // Use host vault CLI
    return `VAULT_ADDR="${VAULT_ADDR}" VAULT_TOKEN="${VAULT_TOKEN}" vault ${subcommand} 2>&1`;
  }
  // Fall back to docker exec
  return `docker exec ${VAULT_CONTAINER} vault ${subcommand} 2>/dev/null`;
}

// ─── Tool Handlers ────────────────────────────────────────────────────────────

export async function handleVaultGet(args: Record<string, unknown>): Promise<string> {
  const secretPath = args.secret_path as string;
  const field = args.field as string;
  if (!secretPath) throw new Error('secret_path is required');

  let cmd: string;
  if (field) {
    cmd = vaultCmd(`kv get -field="${field}" "${secretPath}"`);
  } else {
    // Return all fields — format as key=value table
    cmd = vaultCmd(`kv get -format=json "${secretPath}"`);
  }

  const { stdout } = await execAsync(cmd, { timeout: 15_000 });
  const result = stdout.trim();
  if (!result || result.includes('Error') || result.includes('No value found')) {
    throw new Error(`Vault: no secret found at ${secretPath}${field ? `[${field}]` : ''}`);
  }
  return result;
}

export async function handleVaultList(_args: Record<string, unknown>): Promise<string> {
  const cmd = vaultCmd('kv list -format=json secret/');
  try {
    const { stdout } = await execAsync(cmd, { timeout: 15_000 });
    const paths: string[] = JSON.parse(stdout);
    return `=== Vault Secret Paths (secret/) ===\n${paths.map(p => `  ${p}`).join('\n')}`;
  } catch {
    // Fallback to text output
    const { stdout } = await execAsync(vaultCmd('kv list secret/'), { timeout: 15_000 });
    return `=== Vault Secret Paths ===\n${stdout}`;
  }
}

// ─── Tool Definitions ─────────────────────────────────────────────────────────

export const vaultToolDefs = [
  {
    name: 'stolution_vault_get',
    description: [
      'Read a secret from HashiCorp Vault running on the stolution server.',
      'If field is specified, returns only that field value.',
      'If field is omitted, returns all fields as JSON.',
      'Requires VAULT_TOKEN env var or a running "vault" Docker container.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        secret_path: {
          type: 'string',
          description: 'Vault KV path, e.g. "secret/stolution/postgres"',
        },
        field: {
          type: 'string',
          description: 'Specific field to retrieve, e.g. "password". Omit to get all fields.',
        },
      },
      required: ['secret_path'],
    },
  },
  {
    name: 'stolution_vault_list',
    description: 'List available secret paths in HashiCorp Vault at secret/ (top-level). Use stolution_vault_get to read specific values.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];
