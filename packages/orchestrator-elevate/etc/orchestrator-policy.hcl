# Orchestrator AppRole policy
# Read-only access to a dedicated operational secret namespace.
# Master credentials (unseal keys, root token, other AppRoles' policies) explicitly excluded.

path "secret/data/orchestrator/*" {
  capabilities = ["read", "list"]
}

path "secret/metadata/orchestrator/*" {
  capabilities = ["read", "list"]
}

# Explicit denies (defense in depth)
path "sys/*" {
  capabilities = ["deny"]
}

path "auth/*" {
  capabilities = ["deny"]
}

path "secret/data/master/*" {
  capabilities = ["deny"]
}
