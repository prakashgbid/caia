/**
 * @chiefaia/orchestrator-elevate
 *
 * Root-owned sudo wrapper + scoped Vault AppRole for permanent Cowork
 * orchestrator privilege escalation on stolution.
 *
 * This package provides:
 * - /usr/local/bin/orchestrator-exec: shell wrapper with exhaustive allowlisting
 * - /etc/sudoers.d/orchestrator: NOPASSWD entry for s903
 * - Vault policy & AppRole for scoped credential access
 * - Bootstrap installer script
 *
 * Architecture:
 * - All privilege escalation flows through the single wrapper script
 * - Wrapper validates every operation against an allowlist
 * - All invocations logged to JSONL + syslog
 * - Vault AppRole restricted to orchestrator/* namespace
 * - Secret ID renewable with 365-day TTL
 */

export interface OrchestratorConfig {
  wrapperPath: string;
  sudoersPath: string;
  logPath: string;
  vaultAppRolePath: string;
  credentialsPath: string;
}

export const DEFAULT_CONFIG: OrchestratorConfig = {
  wrapperPath: '/usr/local/bin/orchestrator-exec',
  sudoersPath: '/etc/sudoers.d/orchestrator',
  logPath: '/var/log/orchestrator-exec.log',
  vaultAppRolePath: 'auth/approle/role/orchestrator',
  credentialsPath: '/home/s903/.orchestrator-vault-creds',
};

export interface OperationResult {
  success: boolean;
  operation: string;
  message: string;
  exitCode: number;
  durationMs: number;
}

// Exported for test harnesses and inspection tools
export const ALLOWED_OPERATIONS = [
  'install-systemd-unit',
  'systemctl-action',
  'install-sudoers-entry',
  'apt-install-package',
  'service-reload',
  'cron-install',
] as const;

export type AllowedOperation = (typeof ALLOWED_OPERATIONS)[number];

export const OPERATION_DESCRIPTIONS: Record<AllowedOperation, string> = {
  'install-systemd-unit': 'Install a systemd unit file under /etc/systemd/system/',
  'systemctl-action': 'Execute systemctl actions (enable, disable, start, stop, restart, etc.)',
  'install-sudoers-entry': 'Install a sudoers configuration file under /etc/sudoers.d/',
  'apt-install-package': 'Install a package from apt (vetted list only)',
  'service-reload': 'Reload or restart a system service',
  'cron-install': 'Install a cron job under /etc/cron.d/',
};

export const SYSTEMD_UNIT_REGEX =
  /^(actions\.runner\.[a-z0-9-]+|caia-[a-z0-9-]+|stolution-[a-z0-9-]+|cowork-[a-z0-9-]+)\.service$/;
export const SUDOERS_NAME_REGEX = /^[a-z][a-z0-9-]*-orchestrator$/;
export const CRON_NAME_REGEX = /^[a-z][a-z0-9-]*-orchestrator$/;

export const VETTED_PACKAGES = [
  'curl',
  'jq',
  'git',
  'tmux',
  'htop',
  'iotop',
  'tree',
  'unzip',
  'zip',
  'nodejs',
  'npm',
  'nginx',
  'certbot',
  'python3-certbot-nginx',
  'postgresql-client',
  'redis-tools',
  'prometheus-node-exporter',
];

export const ALLOWED_SERVICES = ['nginx', 'cloudflared', 'prometheus-node-exporter', 'syncthing'];

// Security constants
export const FORBIDDEN_PATHS = [
  '/etc/sudoers',
  '/etc/passwd',
  '/etc/shadow',
  '/etc/group',
  '/root/',
  '/etc/ssh/sshd_config',
  '/etc/sudoers.d/orchestrator',
  '/usr/local/bin/orchestrator-exec',
];

export const ALLOWED_SOURCE_PATHS = ['/tmp/', '/home/s903/'];
