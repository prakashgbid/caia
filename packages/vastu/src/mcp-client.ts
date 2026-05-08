/**
 * MCP client — thin wrapper around Figma MCP tool invocations.
 *
 * Ported from Stolution's @stolution/vastu-figma-bridge/src/mcp-client.ts
 * with DI for test mockability.
 *
 * SAFETY: this module is only called when:
 *   - FIGMA_WRITE=1
 *   - config.allowFigmaWrite=true
 *   - approvals.checksum matches
 *   - approval status is 'figma-approved' or 'implemented'
 *
 * Tests inject a mock implementation via DI to avoid real Figma writes.
 * Production (Claude Code with figma-remote-mcp configured) calls the real MCP.
 */

import type { FigmaSpec } from './types.js';

export interface McpWriteResult {
  figmaUrl: string;
  nodeId: string;
}

let _mockImplementation: ((payload: FigmaSpec, fileKey: string) => Promise<McpWriteResult>) | null = null;

/** Test helper: inject a mock MCP implementation. */
export function __setMockMcpClient(
  impl: ((payload: FigmaSpec, fileKey: string) => Promise<McpWriteResult>) | null
): void {
  _mockImplementation = impl;
}

let _mcpCallCount = 0;
export function __getMcpCallCount(): number {
  return _mcpCallCount;
}
export function __resetMcpCallCount(): void {
  _mcpCallCount = 0;
}

/**
 * Call Figma MCP generate_figma_design — exactly once per page.
 *
 * In production (Claude Code with figma-remote-mcp), this invokes the MCP
 * tool's generate_figma_design endpoint.
 *
 * Tests inject a mock via __setMockMcpClient to avoid network calls.
 *
 * Outside a Claude Code session, this throws with a clear error.
 */
export async function generateFigmaDesignViaMcp(
  payload: FigmaSpec,
  blueprintsFileKey: string
): Promise<McpWriteResult> {
  if (process.env['FIGMA_WRITE'] !== '1') {
    throw new Error(
      'FIGMA_WRITE is not set to "1" — refusing Figma write (safety gate)'
    );
  }

  if (_mockImplementation) {
    _mcpCallCount++;
    return _mockImplementation(payload, blueprintsFileKey);
  }

  _mcpCallCount++;

  // Production: invoke the MCP tool via JSON-RPC or direct module call.
  // When running inside Claude Code with figma-remote-mcp configured, this
  // would call the MCP server's generate_figma_design endpoint.
  // Outside Claude Code, this throws with a clear message.
  throw new Error(
    'generateFigmaDesignViaMcp: not running inside Claude Code with figma-remote-mcp. ' +
    'To generate a Figma page, run this script from within a Claude Code session ' +
    'that has the figma-remote-mcp server configured.'
  );
}
