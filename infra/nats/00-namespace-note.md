# NATS JetStream on stolution K3s

Target namespace: `chiefaia` (already exists, see `kubectl get ns chiefaia`).

These manifests stand up a 3-replica NATS JetStream cluster as the
inter-agent communication broker per `research/inter_agent_communication_protocol_2026.md` §4.7.

## Apply order

```bash
kubectl apply -n chiefaia -f 10-configmap.yaml
kubectl apply -n chiefaia -f 20-secret-template.yaml   # operator generates real keys offline
kubectl apply -n chiefaia -f 30-service-headless.yaml
kubectl apply -n chiefaia -f 31-service-client.yaml
kubectl apply -n chiefaia -f 40-statefulset.yaml
kubectl apply -n chiefaia -f 50-networkpolicy.yaml
```

## Pre-flight: NKeys

NATS NKeys must be generated **offline** by the operator and loaded
as a Secret named `nats-nkeys`. Procedure:

```bash
# On a trusted machine with nats CLI installed:
nk -gen operator -pubout > nats-operator.nk        # operator seed (private)
nk -gen account -pubout > nats-account.nk          # account seed
nk -gen user    -pubout > nats-user.nk             # user seed
# Build the resolver.conf entries; see operator-runbook.md.
kubectl create secret generic nats-nkeys -n chiefaia \
  --from-file=operator.nk=nats-operator.nk \
  --from-file=account.nk=nats-account.nk \
  --from-file=user.nk=nats-user.nk
```

V1 ships with token-fallback auth disabled and NKey auth required.
The `20-secret-template.yaml` file is a placeholder showing the
expected shape; the operator overrides it with the real secret.

## Pre-flight: TLS

TLS uses cert-manager (already deployed in `cert-manager` namespace).
A `Certificate` resource is included that issues a server cert from
a self-signed cluster issuer scoped to `nats.chiefaia.svc.cluster.local`.
For external access, add a public issuer later.
