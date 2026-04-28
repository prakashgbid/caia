# stolution-mcp

**MCP server for remote stolution server management.**

Runs on the stolution remote server (`s903@162.251.161.17`) and exposes its
file system, shell, Docker, PM2, HashiCorp Vault, PostgreSQL, and git
capabilities to Claude Cowork on a local Mac — via the Model Context Protocol
over an SSH transport.

---

## Architecture

```
Local Mac (Cowork)                  Remote server (stolution)
┌─────────────────────┐    SSH     ┌────────────────────────────────┐
│  Claude Cowork      │◄──stdio──► │  node stolution-mcp/dist/index │
│  (MCP client)       │            │  (MCP server)                  │
│                     │            │         │                      │
│  mcp-config.json    │            │   ┌─────┴──────────────────┐   │
│  → ssh stolution    │            │   │  /home/s903/stolution  │   │
│    node dist/index  │            │   │  Docker / PM2          │   │
└─────────────────────┘            │   │  PostgreSQL            │   │
                                   │   │  HashiCorp Vault       │   │
                                   │   └────────────────────────┘   │
                                   └────────────────────────────────┘
```

**Transport**: `ssh stolution node /home/s903/stolution-mcp/dist/index.js`

MCP speaks JSON-RPC over stdio. SSH tunnels stdin/stdout transparently —
no HTTP tunnel or port forwarding needed for basic operation.

---

## Tools

### File System

| Tool | Description |
|------|-------------|
| `stolution_read_file(path)` | Read a file (allowed dirs only, ≤512KB) |
| `stolution_list_dir(path)` | `ls -lahF` on any directory |
| `stolution_write_file(path, content)` | Write a file (allowed dirs only) |
| `stolution_grep(pattern, path, options)` | Grep with `-i`/`-r` flags, up to 200 hits |

**Allowed read paths**: `/home/s903/stolution`, `/var/log`, `/etc/nginx`
**Allowed write paths**: `/home/s903/stolution/apps`, `/home/s903/stolution/config`, `/tmp`

### Shell

| Tool | Description |
|------|-------------|
| `stolution_bash(command, timeout)` | Run any bash command (safety blocked list, 2MB output cap, max 120s) |
| `stolution_git(args, repo_path)` | Run git in the stolution repo; force-push and hard-reset blocked |

### Docker

| Tool | Description |
|------|-------------|
| `stolution_docker_ps()` | Running + all containers with image, status, ports |
| `stolution_docker_logs(container, lines)` | Timestamped logs (max 500 lines) |

### PM2

| Tool | Description |
|------|-------------|
| `stolution_pm2_list()` | All PM2 processes with CPU/memory/uptime |
| `stolution_pm2_restart(name)` | Restart a named process |
| `stolution_pm2_logs(name, lines)` | Recent logs (max 500 lines) |

### HashiCorp Vault

| Tool | Description |
|------|-------------|
| `stolution_vault_get(secret_path, field)` | Read one field or all fields as JSON |
| `stolution_vault_list()` | List top-level secret paths |

Requires `VAULT_TOKEN` env var, or a running Docker container named `vault`.

### PostgreSQL

| Tool | Description |
|------|-------------|
| `stolution_db_query(sql, params)` | SELECT only — results as ASCII table |
| `stolution_db_schema(table_name?)` | Column + index info, or full table list |

Requires `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` env vars.

---

## Security Model

1. **Runs as `s903`** — no root, no sudo (unless explicitly granted per command)
2. **Blocked shell patterns**: `rm -rf`, `mkfs`, `dd if=`, `shutdown`, `reboot`,
   `passwd`, `curl|bash`, writes to `/etc` or `/boot`
3. **Blocked git**: `push --force`, `reset --hard`, `clean -fd`
4. **DB**: SELECT only — DDL and DML are pattern-rejected before hitting Postgres
5. **Filesystem reads**: restricted to an allowlist of directories
6. **Filesystem writes**: restricted to a tighter allowlist
7. **All errors are returned as MCP `isError` responses** — never crash the server

---

## Deployment

### Prerequisites (local Mac)

```bash
# SSH alias configured in ~/.ssh/config:
Host stolution
  HostName 162.251.161.17
  User s903
  IdentityFile ~/.ssh/id_ed25519  # or your key
```

### Prerequisites (remote)

```bash
# Node 20+ and npm
node --version  # must be >= 20
# PM2 (optional — only needed for persistent other processes)
npm install -g pm2
```

### Deploy

```bash
# From the conductor project root:
./scripts/deploy-stolution-mcp.sh
```

The script:
1. Builds TypeScript locally
2. `rsync`s built files to `~/stolution-mcp/` on the remote
3. `npm install --omit=dev` on the remote
4. Creates a `.env` template if one doesn't exist
5. Runs a quick smoke test to confirm the server starts
6. Prints the exact Cowork MCP config block to add

### Restart only

```bash
./scripts/deploy-stolution-mcp.sh --restart-only
```

---

## Cowork Integration

Add this to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "stolution-remote": {
      "command": "ssh",
      "args": [
        "-tt",
        "-o", "StrictHostKeyChecking=accept-new",
        "-o", "ConnectTimeout=15",
        "stolution",
        "node /home/s903/stolution-mcp/dist/index.js"
      ],
      "description": "stolution remote server — files, Docker, PM2, Vault, DB, bash, git"
    }
  }
}
```

Restart Cowork. The `stolution-remote` MCP server will appear in the tool palette.

---

## Alternative Transport: Cloudflare Tunnel (HTTP/SSE)

If you need persistent HTTP access (e.g. multiple clients, no SSH):

```bash
# On the remote server:
cloudflared tunnel create stolution-mcp
cloudflared tunnel route dns stolution-mcp mcp.stolution.example.com

# Run the MCP server with HTTP transport (requires modifying src/index.ts
# to use StreamableHTTPServerTransport instead of StdioServerTransport)
cloudflared tunnel run stolution-mcp
```

Then in Cowork config use `url` instead of `command`:

```json
{
  "mcpServers": {
    "stolution-remote": {
      "url": "https://mcp.stolution.example.com/mcp",
      "description": "stolution remote (HTTP/SSE via Cloudflare Tunnel)"
    }
  }
}
```

---

## Local Development

```bash
cd apps/stolution-mcp

# Install
npm install

# Type-check
npm run typecheck

# Build
npm run build

# Run locally (will fail on actual remote commands but useful for testing MCP wire protocol)
npm run dev
```

---

## Project Structure

```
apps/stolution-mcp/
├── package.json          # Dependencies: @modelcontextprotocol/sdk, pg
├── tsconfig.json         # ES2022, NodeNext modules
├── mcp-config.json       # Paste into Claude Cowork config
├── src/
│   ├── index.ts          # MCP server entry — wires all tools to MCP
│   └── tools/
│       ├── filesystem.ts # read_file, list_dir, write_file, grep
│       ├── shell.ts      # bash, git
│       ├── docker.ts     # docker_ps, docker_logs
│       ├── pm2.ts        # pm2_list, pm2_restart, pm2_logs
│       ├── vault.ts      # vault_get, vault_list
│       └── database.ts   # db_query (SELECT only), db_schema
└── dist/                 # Compiled output (generated by npm run build)

scripts/
└── deploy-stolution-mcp.sh  # rsync + install + smoke test
```
