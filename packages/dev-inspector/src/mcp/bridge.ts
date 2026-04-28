/**
 * Posts panel state to the local MCP server every 2 seconds.
 * Only runs in development. No-ops if server is unreachable.
 */

export interface PanelState {
  open: boolean;
  activeTab: string;
  violations: unknown[];
  consoleEntries: unknown[];
  networkEntries: unknown[];
  vitals: unknown;
}

let intervalId: ReturnType<typeof setInterval> | null = null;

export function startBridge(getState: () => PanelState): void {
  if (typeof window === 'undefined') return;
  if (process.env.NODE_ENV !== 'development') return;

  stopBridge();

  intervalId = setInterval(() => {
    const state = getState();
    fetch('http://localhost:4040/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state),
    }).catch(() => {
      // MCP server not running — silently ignore
    });
  }, 2000);
}

export function stopBridge(): void {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
