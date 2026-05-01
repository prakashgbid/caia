/**
 * Thin HTTP server that exposes Prometheus metrics at GET /metrics.
 *
 * Binds to METRICS_PORT (default 9091) so Prometheus can scrape
 * coding-worker instances independently of the orchestrator's /metrics.
 */
import * as http from 'http';
import { registry } from './coding-metrics';

export interface MetricsServerHandle {
  readonly port: number;
  close(): void;
}

export function startMetricsServer(port = 9091): MetricsServerHandle {
  const server = http.createServer((req, res) => {
    if (req.method !== 'GET' || req.url !== '/metrics') {
      res.writeHead(404).end();
      return;
    }
    registry.metrics().then((text) => {
      res.writeHead(200, { 'Content-Type': registry.contentType });
      res.end(text);
    }).catch(() => {
      res.writeHead(500).end();
    });
  });

  server.listen(port);

  return {
    port,
    close: () => { server.close(); },
  };
}
