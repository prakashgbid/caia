#!/usr/bin/env node
/* eslint-disable */
/**
 * Boot stub for the launchd-managed orchestrator daemon.
 *
 * The launchd plist (~/Library/LaunchAgents/com.caia.orchestrator.plist)
 * references this file. It spawns tsx → src/api/start.ts and inherits
 * stdio so launchd's StandardOutPath / StandardErrorPath capture the
 * orchestrator's logs.
 *
 * Created 2026-04-30 as part of the LAI-001 / PO-DECOMP daily release —
 * the original boot stub was missing, leaving the daemon plist broken
 * and the orchestrator only kept alive by a long-running tsx process
 * from before the missing-file was introduced. This stub restores the
 * launchd path.
 */
'use strict';

const path = require('path');
const { spawn } = require('child_process');

const tsxCli = '/Users/MAC/Documents/projects/caia/node_modules/.pnpm/tsx@4.21.0/node_modules/tsx/dist/cli.mjs';
const startTs = path.join(__dirname, '..', 'src', 'api', 'start.ts');

const child = spawn(process.execPath, [tsxCli, startTs], {
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code) => process.exit(code ?? 1));
process.on('SIGTERM', () => child.kill('SIGTERM'));
process.on('SIGINT', () => child.kill('SIGINT'));
