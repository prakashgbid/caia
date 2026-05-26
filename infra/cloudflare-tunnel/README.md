# Cloudflare Tunnel — chiefaia.com routing

Public access for the chiefaia.com surface is served via the existing
Cloudflare Tunnel that already fronts `*.stolution.com`. There is **no
new tunnel** — same tunnel ID, same connectors, same edge.

## Tunnel identity

- Tunnel ID: `3cf7eece-1e16-4dbe-8460-a127b8e9d238`
- Account: `69a2349105940fcf773c3c2943c7d3cf`
- Edge hostname (CNAME target): `3cf7eece-1e16-4dbe-8460-a127b8e9d238.cfargotunnel.com`

## Hostnames served (this PR)

| Host                       | Backend                                | Auth                  |
| -------------------------- | -------------------------------------- | --------------------- |
| `chiefaia.com`             | `chiefaia-web` Service (port 80)       | public                |
| `dashboard.chiefaia.com`   | `chiefaia-dashboard` (placeholder)     | Cloudflare Access[^1] |
| `api.chiefaia.com`         | `chiefaia-api` Service (80 → 8080)     | public                |
| `infisical.chiefaia.com`   | `chiefaia-infisical` Service (port 80) | Cloudflare Access[^2] |
| `atlas.chiefaia.com`       | `chiefaia-atlas` (placeholder)         | public                |

[^1]: Access app `cb6d1de5-2ab6-4860-af9e-7395ca0a8381`, allowlists
      `prakash.stolution@gmail.com`. Created out-of-band before this PR.
[^2]: Pre-existing Access policy on infisical (inherited from earlier setup).

`dashboard.chiefaia.com` and `atlas.chiefaia.com` return `HTTP 503
no healthy upstream` until their respective Deployments land. The
placeholder Services in `infra/istio/chiefaia/10-placeholder-services.yaml`
keep the routing surface admissible without backing pods.

## Traffic path

```
client ──▶ Cloudflare edge (TLS terminated, Access enforced)
            │
            ▼
        cloudflared connector
            │  HTTP plain
            ▼
        istio-ingressgateway  (Istio LoadBalancer; in-cluster DNS or NodePort 31346)
            │
            ▼
        VirtualService (this PR) → backing Service → Pod
```

## What this PR changes

1. **Istio** (`infra/istio/chiefaia/`)
   - `00-gateway-stolution.yaml` — adds `*.chiefaia.com` and `chiefaia.com`
     hosts to the existing `istio-system/stolution-gateway` HTTP server.
     The HTTPS PASSTHROUGH server for stolution remains untouched.
     A re-apply with the stolution host list preserved verbatim avoids
     regressing the 20+ stolution.com routes.
   - `10-placeholder-services.yaml` — empty-endpoint Services for
     `chiefaia-dashboard` and `chiefaia-atlas`.
   - `20-..-24-` — five `VirtualService`s, one per host, all attached to
     `istio-system/stolution-gateway`.

2. **Cloudflare Tunnel ingress**
   - The K8s `cloudflared` Deployment in `stolution-infra` runs with
     `--token` (remote-managed config). Its routing rules live in
     **Cloudflare's tunnel config API**, not in any K8s ConfigMap.
     The five `chiefaia.com` hosts have been added to the remote config
     pointing at `http://localhost:31346` (the istio-ingressgateway
     NodePort — host-process compatible so the legacy connector keeps
     working unchanged).
   - The `default/cloudflared-config` ConfigMap is the **desired-state**
     manifest for the future when the K8s Deployment is reverted to
     `--config` mode mounting this file. Its chiefaia entries use the
     in-cluster DNS form
     `istio-ingressgateway.istio-system.svc.cluster.local:80`. Until the
     deployment is reverted, this ConfigMap is documentation only.

3. **Cloudflare DNS** (`chiefaia.com` zone `be281681b04d86c4bd293e551313a1c4`)
   - `dashboard.chiefaia.com` CNAME created via API
     (id `0bbae4b14ceb01859d2d0b17122234d1`).
   - `chiefaia.com`, `api.chiefaia.com`, `atlas.chiefaia.com`,
     `infisical.chiefaia.com` CNAMEs already existed pointing at the
     same tunnel hostname; no changes required.
   - All proxied (orange-cloud) so they go through Cloudflare's edge.

4. **`cloudflared` Deployment scale**
   - Scaled `stolution-infra/cloudflared` from 0 → 1.
   - Patched container args from `--metrics 0.0.0.0:2000` to
     `--metrics 0.0.0.0:2001` (and probes to match) because the legacy
     host-level `cloudflared` process already binds port 2000 on the
     node and the K8s pod runs with `hostNetwork: true`. Two metrics
     servers, two connectors, one tunnel.

## Known dual-source-of-truth (separate cleanup)

There are two competing artifacts named `cloudflared-config`:

- `default/cloudflared-config` — **keeper**; uses cluster-DNS service
  references; matches the desired in-cluster routing model.
- `stolution-infra/cloudflared-config` — **legacy**; uses plain host IP
  references. Left intact by this PR for a separate reconciliation pass.

Neither is currently mounted into the running Deployment (which uses
`--token`). The remote-managed Cloudflare-side config is the de facto
source of truth at runtime. A future change will revert the Deployment
to `--config` mode mounting `default/cloudflared-config`, at which
point that ConfigMap becomes the active source of truth and the legacy
copy can be deleted.

## Verification (run from a host that can reach the tunnel)

```bash
# DNS resolves to a cloudflared origin
dig +short chiefaia.com api.chiefaia.com dashboard.chiefaia.com \
           infisical.chiefaia.com atlas.chiefaia.com

# Edge → tunnel → Istio
for h in chiefaia.com api.chiefaia.com infisical.chiefaia.com \
         atlas.chiefaia.com dashboard.chiefaia.com; do
  curl -s -o /dev/null -w "%{http_code} $h\n" "https://$h/"
done

# Direct via Istio (proves cluster routing, bypasses CF edge)
for h in chiefaia.com api.chiefaia.com atlas.chiefaia.com \
         dashboard.chiefaia.com infisical.chiefaia.com; do
  curl -s -o /dev/null -w "%{http_code} $h\n" \
       -H "Host: $h" http://localhost:31346/
done
```

Expected via Istio directly:
```
200 chiefaia.com           # nginx-placeholder default page
404 api.chiefaia.com       # nginx default catch-all on /
503 atlas.chiefaia.com     # placeholder Service, no endpoints
503 dashboard.chiefaia.com # placeholder Service, no endpoints
200 infisical.chiefaia.com # placeholder backend on port 80
```

Expected via Cloudflare edge: same status codes for everything that
does not have a Cloudflare Pages project or Access policy intercepting
at the edge; `dashboard.chiefaia.com` and `infisical.chiefaia.com`
return `302` redirects to `stolution.cloudflareaccess.com` for login.
