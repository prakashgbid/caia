/**
 * Tiny synchronous-ish UDS client used by the hook subprocess.
 *
 * Claude Code's hook protocol expects the hook command to read a single
 * JSON frame from stdin and write a single JSON frame to stdout. The
 * subprocess implementation forwards that frame to the broker server
 * and returns its decision verbatim.
 *
 * We give the request a short deadline (default 5 s); on any failure we
 * default-deny so a broken / down broker fails closed rather than open.
 */

import * as net from 'node:net';
import type { BrokerWireFrame } from './socket-server.js';

export interface BrokerSocketClientOptions {
  socketPath: string;
  /** Default 5000 ms. */
  timeoutMs?: number;
}

export interface BrokerSocketClientFailure {
  decision: 'deny';
  reason: string;
  details?: { code: 'broker_unreachable' | 'broker_timeout' | 'broker_parse_error' };
}

export async function callBrokerSocket<TOut>(
  frame: BrokerWireFrame,
  opts: BrokerSocketClientOptions,
): Promise<TOut | BrokerSocketClientFailure> {
  const timeoutMs = opts.timeoutMs ?? 5000;
  return new Promise<TOut | BrokerSocketClientFailure>((resolve) => {
    const sock = net.createConnection(opts.socketPath);
    let buf = '';
    let settled = false;
    const settle = (val: TOut | BrokerSocketClientFailure): void => {
      if (settled) return;
      settled = true;
      try { sock.end(); } catch { /* ignore */ }
      resolve(val);
    };
    const deadline = setTimeout(() => {
      settle({
        decision: 'deny',
        reason: `broker-socket-client: timed out after ${timeoutMs}ms`,
        details: { code: 'broker_timeout' },
      });
    }, timeoutMs);
    sock.on('connect', () => {
      sock.write(JSON.stringify(frame) + '\n');
    });
    sock.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf8');
      const nl = buf.indexOf('\n');
      if (nl === -1) return;
      const line = buf.slice(0, nl);
      clearTimeout(deadline);
      try {
        const out = JSON.parse(line) as TOut;
        settle(out);
      } catch (err) {
        settle({
          decision: 'deny',
          reason: `broker-socket-client: parse error: ${err instanceof Error ? err.message : String(err)}`,
          details: { code: 'broker_parse_error' },
        });
      }
    });
    sock.on('error', (err) => {
      clearTimeout(deadline);
      settle({
        decision: 'deny',
        reason: `broker-socket-client: ${err.message}`,
        details: { code: 'broker_unreachable' },
      });
    });
    sock.on('close', () => {
      clearTimeout(deadline);
      if (!settled) {
        settle({
          decision: 'deny',
          reason: 'broker-socket-client: closed without response',
          details: { code: 'broker_unreachable' },
        });
      }
    });
  });
}
