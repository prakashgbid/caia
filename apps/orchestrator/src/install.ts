import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
// When built, __dirname is dist/ — templates and hooks are siblings of dist/
const PACKAGE_ROOT = path.resolve(__dirname, '..');

interface ClaudeSettings {
  hooks?: {
    PreToolUse?: Array<{
      matcher?: string;
      hooks?: Array<{ type: string; command: string }>;
    }>;
  };
}

interface McpConfig {
  mcpServers?: Record<string, { command: string; args: string[] }>;
}

export async function install(): Promise<void> {
  console.log('Installing Conductor...');

  ensureConductorDir();
  installHook();
  installMcpConfig();
  installLaunchdWatchdog();

  console.log('\nConductor installed successfully!');
  console.log('  Hook: ~/.claude/settings.json updated');
  console.log('  MCP: ~/.claude/mcp.json updated');
  console.log('  Run `conductor mcp` to start the MCP server');
}

function ensureConductorDir(): void {
  const conductorDir = path.join(os.homedir(), '.conductor');
  fs.mkdirSync(conductorDir, { recursive: true });
  fs.mkdirSync(path.join(conductorDir, 'backups'), { recursive: true });
}

function installHook(): void {
  const settingsPath = path.join(CLAUDE_DIR, 'settings.json');
  let settings: ClaudeSettings = {};

  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as ClaudeSettings;
    } catch {
      settings = {};
    }
  }

  const hookCommand = path.join(PACKAGE_ROOT, 'hooks', 'prespawn.sh');
  const hookEntry = {
    matcher: 'mcp__dispatch__start_task|mcp__dispatch__start_code_task',
    hooks: [{ type: 'shell', command: hookCommand }],
  };

  if (!settings.hooks) settings.hooks = {};
  if (!settings.hooks.PreToolUse) settings.hooks.PreToolUse = [];

  const alreadyRegistered = settings.hooks.PreToolUse.some(
    (h) => h.hooks?.some((hh) => hh.command === hookCommand),
  );

  if (!alreadyRegistered) {
    settings.hooks.PreToolUse.push(hookEntry);
    fs.mkdirSync(CLAUDE_DIR, { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    console.log('  Registered pre-spawn hook in ~/.claude/settings.json');
  } else {
    console.log('  Hook already registered, skipping');
  }
}

function installMcpConfig(): void {
  const mcpPath = path.join(CLAUDE_DIR, 'mcp.json');
  let mcp: McpConfig = {};

  if (fs.existsSync(mcpPath)) {
    try {
      mcp = JSON.parse(fs.readFileSync(mcpPath, 'utf8')) as McpConfig;
    } catch {
      mcp = {};
    }
  }

  if (!mcp.mcpServers) mcp.mcpServers = {};

  if (!mcp.mcpServers['conductor']) {
    mcp.mcpServers['conductor'] = { command: 'conductor', args: ['mcp'] };
    fs.mkdirSync(CLAUDE_DIR, { recursive: true });
    fs.writeFileSync(mcpPath, JSON.stringify(mcp, null, 2));
    console.log('  Added conductor MCP entry to ~/.claude/mcp.json');
  } else {
    console.log('  Conductor MCP already configured, skipping');
  }
}

function installLaunchdWatchdog(): void {
  if (process.platform !== 'darwin') return;

  const plistPath = path.join(
    os.homedir(),
    'Library',
    'LaunchAgents',
    'com.conductor.mcp.plist',
  );

  const conductorBin = path.join(PACKAGE_ROOT, 'dist', 'cli', 'index.js');

  const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.conductor.mcp</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>${conductorBin}</string>
    <string>mcp</string>
  </array>
  <key>KeepAlive</key>
  <true/>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardErrorPath</key>
  <string>${os.homedir()}/.conductor/mcp.err.log</string>
  <key>StandardOutPath</key>
  <string>${os.homedir()}/.conductor/mcp.out.log</string>
</dict>
</plist>`;

  try {
    fs.mkdirSync(path.dirname(plistPath), { recursive: true });
    fs.writeFileSync(plistPath, plistContent);
    console.log(`  Launchd watchdog written to ${plistPath}`);
    console.log('  Run: launchctl load ' + plistPath);
  } catch {
    console.log('  Could not write launchd plist (skipping)');
  }
}

export async function installExecutorLaunchd(): Promise<void> {
  if (process.platform !== 'darwin') {
    console.error('❌ launchd is macOS-only');
    process.exit(1);
  }

  const logDir = path.join(os.homedir(), 'Documents', 'conductor-logs');
  fs.mkdirSync(logDir, { recursive: true });

  const conductorBin = path.join(PACKAGE_ROOT, 'dist', 'cli', 'index.js');
  const nodeBin = process.execPath;

  const plistPath = path.join(
    os.homedir(), 'Library', 'LaunchAgents', 'com.conductor.executor.plist',
  );

  const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.conductor.executor</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodeBin}</string>
    <string>${conductorBin}</string>
    <string>exec</string>
    <string>daemon</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>CONDUCTOR_API</key>
    <string>http://localhost:7776</string>
    <key>HOME</key>
    <string>${os.homedir()}</string>
  </dict>
  <key>KeepAlive</key>
  <true/>
  <key>RunAtLoad</key>
  <false/>
  <key>StandardOutPath</key>
  <string>${logDir}/executor.log</string>
  <key>StandardErrorPath</key>
  <string>${logDir}/executor.err.log</string>
  <key>ThrottleInterval</key>
  <integer>10</integer>
</dict>
</plist>`;

  fs.writeFileSync(plistPath, plistContent);
  console.log(`✅ Executor launchd plist written to ${plistPath}`);
  console.log('');
  console.log('To start the daemon:');
  console.log(`  launchctl load ${plistPath}`);
  console.log('');
  console.log('To stop it:');
  console.log(`  launchctl unload ${plistPath}`);
  console.log('');
  console.log('Logs:');
  console.log(`  ${logDir}/executor.log`);
  console.log(`  ${logDir}/executor.err.log`);
  console.log('');
  console.log('⚠️  Remember to enable the executor first: conductor exec start');
}

export async function installClaudeMd(targetDir: string): Promise<void> {
  const templatePath = path.join(PACKAGE_ROOT, 'templates', 'CLAUDE.md');
  const targetPath = path.join(targetDir, 'CONDUCTOR.md');

  if (!fs.existsSync(templatePath)) {
    console.error(`Template not found: ${templatePath}`);
    process.exit(1);
  }

  const content = fs.readFileSync(templatePath, 'utf8');

  const claudeMdPath = path.join(targetDir, 'CLAUDE.md');
  if (fs.existsSync(claudeMdPath)) {
    const existing = fs.readFileSync(claudeMdPath, 'utf8');
    if (existing.includes('Conductor')) {
      console.log('CLAUDE.md already contains Conductor rules, skipping');
      return;
    }
    fs.appendFileSync(claudeMdPath, '\n\n---\n\n' + content);
    console.log(`Appended Conductor rules to ${claudeMdPath}`);
  } else {
    fs.writeFileSync(targetPath, content);
    console.log(`Created ${targetPath}`);
  }
}
