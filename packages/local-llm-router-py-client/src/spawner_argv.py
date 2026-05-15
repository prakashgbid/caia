"""Build the subprocess argv for invoking the claude binary.

Standalone module (zero non-stdlib deps) so the unit-test suite under
`packages/local-llm-router-py-client/tests/` can exercise the argv logic
without dragging in fastapi / sqlite / the rest of the spawner agent.

SPS-Prompting phase α (2026-05-14) wires two substrate-level optimizations
onto every spawn:

  * A.9.3  headroom wrap → routes Anthropic API calls through a local
           compression proxy when ``HEADROOM_BINARY`` exists on disk.
           Bypassed (fail-open) if ``HEADROOM_WRAP_DISABLE=1`` is set or
           the binary is missing — keeps stolution (no headroom yet)
           working without a code-divergence between the two boxes.

  * A.9.6  KV-cache prefix stabilization → adds
           ``--exclude-dynamic-system-prompt-sections`` to the claude
           argv so per-machine sections (cwd, env, memory paths, git
           status) move out of the cached system prefix into the first
           user message. Required for Anthropic's 90% prompt-cache
           discount to apply across spawns. Bypassed if
           ``STABILIZE_PREFIX_DISABLE=1``.
"""

from __future__ import annotations

import os
from typing import Mapping, Sequence


def build_claude_argv(
    prompt: str,
    *,
    permission_mode: str,
    allow_list: Sequence[str],
    claude_binary: str,
    permission_mode_max_turns: Mapping[str, int],
    headroom_binary: str = "",
    headroom_wrap_disable: bool = False,
    headroom_proxy_port: int = 8787,
    headroom_proxy_offset: int = 0,
    headroom_reuse_proxy: bool = False,
    stabilize_prefix_disable: bool = False,
    binary_exists: "callable" = os.path.exists,
) -> tuple[list[str], bool, bool]:
    """Return ``(argv, headroom_wrapped, prefix_stabilized)``.

    All knobs are passed as parameters so the unit tests can drive the
    decision tree deterministically; ``binary_exists`` is injectable so
    the headroom-present check is testable without touching the
    filesystem.
    """
    base_args: list[str] = [
        "--print",
        prompt,
        "--output-format", "json",
        "--permission-mode", permission_mode,
    ]
    max_turns = permission_mode_max_turns.get(permission_mode)
    if max_turns is not None:
        base_args += ["--max-turns", str(max_turns)]
    for p in allow_list:
        base_args += ["--add-dir", p]

    prefix_stabilized = not stabilize_prefix_disable
    if prefix_stabilized:
        base_args.append("--exclude-dynamic-system-prompt-sections")

    use_wrap = (
        not headroom_wrap_disable
        and bool(headroom_binary)
        and binary_exists(headroom_binary)
    )
    if use_wrap:
        port = headroom_proxy_port + headroom_proxy_offset
        wrap_args = [
            headroom_binary, "wrap", "claude",
            "--port", str(port),
            "--no-mcp",
            "--no-serena",
            "--no-context-tool",
        ]
        if headroom_reuse_proxy:
            wrap_args.append("--no-proxy")
        return [*wrap_args, "--", *base_args], True, prefix_stabilized

    return [claude_binary, *base_args], False, prefix_stabilized
