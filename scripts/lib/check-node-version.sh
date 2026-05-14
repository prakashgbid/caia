#!/usr/bin/env bash
# scripts/lib/check-node-version.sh
#
# Shared LaunchAgent install guard: refuse to install if the resolved
# node binary doesn't match the expected major version. Prevents the
# 2026-05-13 mentor-event-bus failure mode (better-sqlite3 native
# binary compiled for node@22, but launchd invoked node@26 → silent
# crash; event bus dark for 3 days).
#
# Usage:
#   # shellcheck source=/dev/null
#   source "$(dirname "${BASH_SOURCE[0]}")/../../scripts/lib/check-node-version.sh"
#   NODE_BIN="$(check_node_version)"   # exits 4 on mismatch
#
# Or call directly with an explicit binary:
#   check_node_version /opt/homebrew/opt/node@22/bin/node
#
# Resolution order (when no arg given):
#   1. $CAIA_NODE_BIN (explicit operator override)
#   2. /opt/homebrew/opt/node@22/bin/node (the pinned default)
#   3. $(command -v node) (fall-back; will likely be rejected)
#
# Expected major version: 22 (CAIA_EXPECTED_NODE_MAJOR overrides).
#
# Exit codes:
#   0  node binary resolved and matches expected major
#   4  refused: missing binary or major version mismatch

CAIA_EXPECTED_NODE_MAJOR="${CAIA_EXPECTED_NODE_MAJOR:-22}"

check_node_version() {
    local node_bin="${1:-}"

    if [[ -z "$node_bin" ]]; then
        if [[ -n "${CAIA_NODE_BIN:-}" ]]; then
            node_bin="$CAIA_NODE_BIN"
        elif [[ -x /opt/homebrew/opt/node@22/bin/node ]]; then
            node_bin="/opt/homebrew/opt/node@22/bin/node"
        else
            node_bin="$(command -v node || true)"
        fi
    fi

    if [[ -z "$node_bin" || ! -x "$node_bin" ]]; then
        echo "ERROR: node binary not found / not executable: '${node_bin}'" >&2
        echo "  Install node@22 (brew install node@22) or set CAIA_NODE_BIN." >&2
        exit 4
    fi

    local raw
    if ! raw="$("$node_bin" --version 2>/dev/null)"; then
        echo "ERROR: failed to run '$node_bin --version'" >&2
        exit 4
    fi

    # raw is e.g. "v22.22.2"
    local major="${raw#v}"
    major="${major%%.*}"

    if [[ -z "$major" || ! "$major" =~ ^[0-9]+$ ]]; then
        echo "ERROR: could not parse major version from '$raw' (binary=$node_bin)" >&2
        exit 4
    fi

    if (( major != CAIA_EXPECTED_NODE_MAJOR )); then
        echo "ERROR: node major version mismatch — refusing to install LaunchAgent." >&2
        echo "  binary:   $node_bin" >&2
        echo "  version:  $raw (major=$major)" >&2
        echo "  expected: major=$CAIA_EXPECTED_NODE_MAJOR" >&2
        echo "" >&2
        echo "  Why: native modules in this repo's pnpm store (e.g. better-sqlite3)" >&2
        echo "  are compiled for Node ${CAIA_EXPECTED_NODE_MAJOR}. Loading them under" >&2
        echo "  a different major silently crashes the daemon at require() time." >&2
        echo "  See ~/Documents/projects/reports/apprentice_gap_fix_2026-05-13.md." >&2
        echo "" >&2
        echo "  Fix one of:" >&2
        echo "    - export CAIA_NODE_BIN=/opt/homebrew/opt/node@${CAIA_EXPECTED_NODE_MAJOR}/bin/node" >&2
        echo "    - brew install node@${CAIA_EXPECTED_NODE_MAJOR}" >&2
        exit 4
    fi

    echo "$node_bin"
}
