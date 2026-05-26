# Tempo — chiefaia namespace

Tempo runs in the `chiefaia` namespace alongside `chiefaia-api`,
`chiefaia-web`, and the NATS StatefulSet. No new namespace is created.

Why chiefaia (not a dedicated `observability` namespace):

- All traffic is east-west inside the cluster. No Ingress.
- Aligns with the $0-new-services discipline: shipping one Tempo pod
  next to the workloads it traces is the lowest-overhead deploy.
- Tempo's storage backend is `local/` for V1. When trace volume
  warrants moving to object storage (Wasabi / R2 / etc.), the
  ConfigMap is the only thing that changes.

Apply order:

```bash
kubectl -n chiefaia apply -f infra/tempo/10-configmap.yaml
kubectl -n chiefaia apply -f infra/tempo/20-service.yaml
kubectl -n chiefaia apply -f infra/tempo/30-deployment.yaml
```

See `README.md` in this directory for verification steps.
