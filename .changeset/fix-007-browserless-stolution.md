---
"caia": patch
---

infra(browserless): deploy self-hosted Browserless on stolution (FIX-007)

Adds the `infra/browserless/` package — `docker-compose.yml`, `nginx.conf`,
`prometheus-scrape.yaml`, `healthcheck.sh`, `scripts/deploy-browserless.sh`,
and an operator runbook in `infra/browserless/README.md`.

The container exposes a Playwright-compatible WebSocket endpoint on
stolution at `127.0.0.1:13000` (with nginx upstream at
`browserless.stolution.local:13080`). Sized for 30 concurrent sessions
on the 256 GB / 32-core box. Token-authenticated; the token is rendered
from Vault at deploy time.

Phase B (FIX-007). Companion track to FIX-001..006 (Fix-It Agent).
Consumed by FIX-011 once the agent's "ci"/"batch" mode landed.

Note: deviates from the original spec in one place — host port is 13000
not 3001, because 3001 is held by stolution-grafana. See the runbook
for context.
