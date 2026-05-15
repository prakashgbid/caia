# >>> caia-plist-health-check-shim (phase A2)
case "${1:-}" in
  --health-check)
    # `date` is referenced by absolute path because the shim runs BEFORE
    # the host script's own PATH export — and the launchd-spawned env
    # inherits a minimal PATH that may not include /bin.
    printf '{"ok":true,"label":"%s","script":"%s","git_sha":"%s","pid":%d,"timestamp":"%s"}\n' \
      "${CAIA_PLIST_LABEL:-unknown}" "$0" "${CAIA_GIT_SHA:-unknown}" "$$" "$(/bin/date -u +%Y-%m-%dT%H:%M:%SZ)"
    exit 0
    ;;
esac
# <<< caia-plist-health-check-shim
