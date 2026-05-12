#!/usr/bin/env node
// MCP stdio entrypoint for the local-llm-router daemon.
//
// The actual tool registration + handler logic lives in ../server.ts
// (so unit tests and embedders can import buildMcpServer directly). This
// file is the thin stdio binding only.

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildMcpServer, DEFAULT_ROUTER_BASE_URL } from '../server.js';

const routerBaseUrl = process.env['ROUTER_BASE_URL'] ?? DEFAULT_ROUTER_BASE_URL;
const server = buildMcpServer({ routerBaseUrl });

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('caia-local-llm-router-mcp ready (stdio); routing to', routerBaseUrl);
