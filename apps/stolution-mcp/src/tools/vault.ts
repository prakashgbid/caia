import { exec } from 'child_process';
import { promisify } from 'util';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { homedir } from 'os';
import path from 'path';

const execAsync = promisify(exec);

// ─── Configuration ────────────────────────────────────────────────────────────

/**
 * Vault container name on the stolution host. The container is named
 * `stolution-vault`; older docs/code referenced `vault` which is incorrect.
 * Override with VAULT_CONTAINER if the deployment ever changes.
 */
const VAULT_CONTAINER = process.env.VAULT_CONTAINER ?? 'stolution-vault';
const VAULT_ADDR = process.env.VAULT_ADDR ?? 'http://127.0.0.1:8200';

/**
 * AppRole credentials file. This MCP server runs on the stolution host
 * (spawned via `ssh stolution node /home/s903/stolution-mcp/dist/index.js`),
 * so we read the file directly off the local filesystem — no ssh hop needed.
 *
 * File format (created by the operator, mode 600):
 *   ROLE_ID=<uuid>
 *   SECRET_ID=<uuid>
 *
 * Override with VAULT_APPROLE_ENV.
 */
const APPROLE_ENV_PATH =
  process.env.VAULT_APPROLE_ENV ??
  path.join(homedir(), '.stolution-vault', 'claude-orchestrator-approle.env');

/**
 * Vault default token TTL is 1h. Re-login after 50 min so a long-running
 * MCP session never tries to use a near-expired token.
 */
const TOKEN_CACHE_MAX_AGE_MS = 50 * 60 * 1000;

/**
 * Prefixes the claude-orchestrator AppRole policy grants list+read on. We
 * try `secret/` first (works for admin/ops tokens). If that 403s — which it
 * does for the AppRole — we fall back to listing each of these prefixes and
 * combine the results, so a caller using AppRole still gets a useful answer.
 *
 * Override with VAULT_LIST_FALLBACK_PREFIXES (comma-separated) if the policy
 * ever expands.
 */
const FALLBACK_LIST_PREFIXES = (
  process.env.VAULT_LIST_FALLBACK_PREFIXES ??
  'secret/stolution/prod,secret/stolution/staging'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// ─── Token cache (module-level — process lives for one MCP session) ──────────

interface CachedToken {
  token: string;
  acquiredAt: number;
}

let cachedToken: CachedToken | null = null;

function tokenIsFresh(now: number = Date.now()): boolean {
  return cachedToken !== null && now - cachedToken.acquiredAt < TOKEN_CACHE_MAX_AGE_MS;
}

// ─── AppRole login ────────────────────────────────────────────────────────────

/**
 * Parse a dotenv-style file: ignores blank lines and `#` comments, strips
 * surrounding quotes from values. Returns a plain key→value map.
 */
function parseEnvFile(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/**
 * Read AppRole credentials and login via the Vault container. Returns the
 * resulting client token. Throws on missing file, missing fields, or login
 * failure. Caller is responsible for caching the result.
 */
async function loginViaAppRole(): Promise<string> {
  if (!existsSync(APPROLE_ENV_PATH)) {
    throw new Error(
      `Vault: cannot authenticate — VAULT_TOKEN unset and AppRole credentials ` +
        `file not found at ${APPROLE_ENV_PATH}. Either set VAULT_TOKEN in the MCP ` +
        `environment or create the AppRole .env file (mode 600, with ROLE_ID and SECRET_ID).`,
    );
  }

  const raw = await readFile(APPROLE_ENV_PATH, 'utf-8');
  const env = parseEnvFile(raw);
  const roleId = env.ROLE_ID;
  const secretId = env.SECRET_ID;
  if (!roleId || !secretId) {
    throw new Error(
      `Vault: AppRole .env at ${APPROLE_ENV_PATH} is missing ROLE_ID or SECRET_ID`,
    );
  }

  // Reject embedded shell metacharacters defensively. UUID-shaped values
  // contain none of these, so legit credentials always pass.
  if (/['"\\$`]/.test(roleId) || /['"\\$`]/.test(secretId)) {
    throw new Error(`Vault: AppRole credentials contain unexpected characters; refusing to exec`);
  }

  // We exec inside the Vault container to use its bundled vault binary; the
  // host doesn't necessarily have a vault CLI installed.
  const cmd =
    `docker exec ${VAULT_CONTAINER} vault write -field=token auth/approle/login ` +
    `role_id='${roleId}' secret_id='${secretId}' 2>&1`;

  const { stdout } = await execAsync(cmd, { timeout: 15_000 });
  const token = stdout.trim();
  // A successful response is a single token string (no whitespace, no "Error").
  if (!token || token.includes('Error') || /\s/.test(token)) {
    // Truncate so any stray secret material doesn't go to logs verbatim.
    throw new Error(`Vault: AppRole login failed: ${token.slice(0, 200)}`);
  }
  return token;
}

/**
 * Acquire a Vault token. Strategy:
 *   1. If VAULT_TOKEN env is set, use it (existing operator-token path).
 *   2. Else if a cached AppRole token is still fresh, reuse it.
 *   3. Else login via AppRole and cache the result.
 */
async function getToken(): Promise<string> {
  const envToken = process.env.VAULT_TOKEN;
  if (envToken) return envToken;

  if (tokenIsFresh()) return cachedToken!.token;

  const fresh = await loginViaAppRole();
  cachedToken = { token: fresh, acquiredAt: Date.now() };
  return fresh;
}

// ─── Vault command runner ─────────────────────────────────────────────────────

/**
 * The shape of the error that `child_process.exec` rejects with on non-zero
 * exit. We need .stdout/.stderr to inspect the actual command output (the
 * default error.message is just "Command failed: <cmd>").
 */
interface ExecError extends Error {
  stdout?: string;
  stderr?: string;
  code?: number | string;
}

/**
 * Pull all observable error text out of an exec rejection — message, stdout,
 * stderr — joined into one string. Used for capability/error sniffing.
 */
function errorText(err: unknown): string {
  if (!err) return '';
  if (err instanceof Error) {
    const e = err as ExecError;
    return [e.message, e.stdout, e.stderr].filter(Boolean).join('\n');
  }
  return String(err);
}

function isPermissionDeniedError(err: unknown): boolean {
  return /permission denied|403/i.test(errorText(err));
}

/**
 * Run a vault subcommand inside the Vault container. The token is passed via
 * the docker client's environment (`-e VAULT_TOKEN`), NOT in argv, so it never
 * appears in `ps` output on the host.
 *
 * Throws a descriptive Error on non-zero exit; the message includes the
 * command's stdout/stderr so callers can sniff for "permission denied" etc.
 */
async function runVaultCmd(subcommand: string, timeoutMs = 15_000): Promise<string> {
  const token = await getToken();
  const cmd = `docker exec -e VAULT_TOKEN -e VAULT_ADDR ${VAULT_CONTAINER} vault ${subcommand} 2>&1`;
  try {
    const { stdout } = await execAsync(cmd, {
      timeout: timeoutMs,
      env: {
        ...process.env,
        VAULT_TOKEN: token,
        VAULT_ADDR,
      },
    });
    return stdout;
  } catch (err) {
    // Re-throw with a richer message so the caller (and the user) can see why.
    const e = err as ExecError;
    const body = (e.stdout || e.stderr || '').trim();
    const enriched: ExecError = new Error(`vault ${subcommand} failed: ${body || e.message}`);
    enriched.stdout = e.stdout;
    enriched.stderr = e.stderr;
    enriched.code = e.code;
    throw enriched;
  }
}

// ─── Tool Handlers ────────────────────────────────────────────────────────────

export async function handleVaultGet(args: Record<string, unknown>): Promise<string> {
  const secretPath = args.secret_path as string;
  const field = args.field as string;
  if (!secretPath) throw new Error('secret_path is required');

  const sub = field
    ? `kv get -field="${field}" "${secretPath}"`
    : `kv get -format=json "${secretPath}"`;
  const stdout = await runVaultCmd(sub);
  const result = stdout.trim();

  if (!result || result.includes('No value found')) {
    throw new Error(`Vault: no secret found at ${secretPath}${field ? `[${field}]` : ''}`);
  }
  if (result.startsWith('Error ')) {
    throw new Error(`Vault: ${result.split('\n')[0]}`);
  }
  return result;
}

export async function handleVaultList(_args: Record<string, unknown>): Promise<string> {
  // Path 1: try top-level — works for admin/ops tokens.
  try {
    const stdout = await runVaultCmd('kv list -format=json secret/');
    const paths: string[] = JSON.parse(stdout.trim());
    return `=== Vault Secret Paths (secret/) ===\n${paths.map((p) => `  ${p}`).join('\n')}`;
  } catch (err) {
    if (!isPermissionDeniedError(err)) {
      // Non-403: try text-mode once (vault occasionally emits non-JSON when empty)
      // before falling through to the scoped path.
      try {
        const stdout = await runVaultCmd('kv list secret/');
        return `=== Vault Secret Paths ===\n${stdout}`;
      } catch (err2) {
        if (!isPermissionDeniedError(err2)) throw err2;
      }
    }
  }

  // Path 2: scoped listing. The token can't see the root namespace, so list
  // each known accessible prefix and aggregate.
  const sections: string[] = [];
  for (const prefix of FALLBACK_LIST_PREFIXES) {
    try {
      const stdout = await runVaultCmd(`kv list -format=json ${prefix}`);
      const paths: string[] = JSON.parse(stdout.trim());
      const formatted = paths.map((p) => `  ${prefix}/${p}`).join('\n');
      sections.push(`-- ${prefix}/ --\n${formatted}`);
    } catch (err) {
      if (!isPermissionDeniedError(err)) throw err;
      // permission denied on this prefix — skip silently
    }
  }

  if (sections.length === 0) {
    throw new Error(
      `Vault: token has no listable paths under secret/ (tried top-level and ${FALLBACK_LIST_PREFIXES.join(', ')}). ` +
        `Either set VAULT_TOKEN to an ops token or grant the AppRole list capability on additional prefixes.`,
    );
  }

  return `=== Vault Secret Paths (token-scoped) ===\n${sections.join('\n\n')}`;
}

// ─── Tool Definitions ─────────────────────────────────────────────────────────

export const vaultToolDefs = [
  {
    name: 'stolution_vault_get',
    description: [
      'Read a secret from HashiCorp Vault running on the stolution server.',
      'If field is specified, returns only that field value.',
      'If field is omitted, returns all fields as JSON.',
      'Authenticates via VAULT_TOKEN env var if set, otherwise via AppRole login',
      'using credentials at ~/.stolution-vault/claude-orchestrator-approle.env',
      '(token cached in-process for ~50 min).',
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
    description: [
      'List secret paths in HashiCorp Vault.',
      'For admin/ops tokens, lists secret/ at top level.',
      'For AppRole tokens (default), lists known accessible prefixes',
      '(secret/stolution/prod, secret/stolution/staging by default; override',
      'via VAULT_LIST_FALLBACK_PREFIXES). Use stolution_vault_get to read values.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];
