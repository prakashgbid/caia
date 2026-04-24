# @chiefaia/metrics

Prometheus-compatible metrics for CAIA applications.

## Install

```bash
pnpm add @chiefaia/metrics
```

## Usage

```ts
import { createRegistry } from '@chiefaia/metrics';

const reg = createRegistry();

const requestsTotal = reg.counter('requests_total', 'Total HTTP requests');
const activeConns = reg.gauge('active_connections', 'Active connections');
const latency = reg.histogram('request_duration_seconds', 'Request latency');

requestsTotal.inc({ method: 'GET', route: '/api/users' });
latency.observe(0.042);

// Expose at /metrics
app.get('/metrics', (req, res) => res.send(reg.render()));
```
