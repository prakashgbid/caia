"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.install = install;
exports.installClaudeMd = installClaudeMd;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const TEMPLATE_DIR = path.resolve(__dirname, '../templates');
async function install() {
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
function ensureConductorDir() {
    const conductorDir = path.join(os.homedir(), '.conductor');
    fs.mkdirSync(conductorDir, { recursive: true });
    fs.mkdirSync(path.join(conductorDir, 'backups'), { recursive: true });
}
function installHook() {
    const settingsPath = path.join(CLAUDE_DIR, 'settings.json');
    let settings = {};
    if (fs.existsSync(settingsPath)) {
        try {
            settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        }
        catch {
            settings = {};
        }
    }
    const hookCommand = path.resolve(__dirname, '../hooks/prespawn.sh');
    const hookEntry = {
        matcher: 'mcp__dispatch__start_task|mcp__dispatch__start_code_task',
        hooks: [{ type: 'shell', command: hookCommand }],
    };
    if (!settings.hooks)
        settings.hooks = {};
    if (!settings.hooks.PreToolUse)
        settings.hooks.PreToolUse = [];
    const alreadyRegistered = settings.hooks.PreToolUse.some((h) => h.hooks?.some((hh) => hh.command === hookCommand));
    if (!alreadyRegistered) {
        settings.hooks.PreToolUse.push(hookEntry);
        fs.mkdirSync(CLAUDE_DIR, { recursive: true });
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
        console.log('  Registered pre-spawn hook in ~/.claude/settings.json');
    }
    else {
        console.log('  Hook already registered, skipping');
    }
}
function installMcpConfig() {
    const mcpPath = path.join(CLAUDE_DIR, 'mcp.json');
    let mcp = {};
    if (fs.existsSync(mcpPath)) {
        try {
            mcp = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
        }
        catch {
            mcp = {};
        }
    }
    if (!mcp.mcpServers)
        mcp.mcpServers = {};
    if (!mcp.mcpServers['conductor']) {
        mcp.mcpServers['conductor'] = { command: 'conductor', args: ['mcp'] };
        fs.mkdirSync(CLAUDE_DIR, { recursive: true });
        fs.writeFileSync(mcpPath, JSON.stringify(mcp, null, 2));
        console.log('  Added conductor MCP entry to ~/.claude/mcp.json');
    }
    else {
        console.log('  Conductor MCP already configured, skipping');
    }
}
function installLaunchdWatchdog() {
    if (process.platform !== 'darwin')
        return;
    const plistPath = path.join(os.homedir(), 'Library', 'LaunchAgents', 'com.conductor.mcp.plist');
    const conductorBin = path.resolve(__dirname, '../dist/cli/index.js');
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
    }
    catch {
        console.log('  Could not write launchd plist (skipping)');
    }
}
async function installClaudeMd(targetDir) {
    const templatePath = path.join(TEMPLATE_DIR, 'CLAUDE.md');
    const targetPath = path.join(targetDir, 'CONDUCTOR.md');
    if (!fs.existsSync(templatePath)) {
        console.error(`Template not found: ${templatePath}`);
        process.exit(1);
    }
    const content = fs.readFileSync(templatePath, 'utf8');
    // Check if CLAUDE.md exists and append instead
    const claudeMdPath = path.join(targetDir, 'CLAUDE.md');
    if (fs.existsSync(claudeMdPath)) {
        const existing = fs.readFileSync(claudeMdPath, 'utf8');
        if (existing.includes('Conductor')) {
            console.log('CLAUDE.md already contains Conductor rules, skipping');
            return;
        }
        fs.appendFileSync(claudeMdPath, '\n\n---\n\n' + content);
        console.log(`Appended Conductor rules to ${claudeMdPath}`);
    }
    else {
        fs.writeFileSync(targetPath, content);
        console.log(`Created ${targetPath}`);
    }
}
//# sourceMappingURL=install.js.map