"""Unit tests for ``spawner_argv.build_claude_argv``.

The helper builds the subprocess argv that the spawner agent feeds to
``subprocess.Popen``. SPS-Prompting phase α (2026-05-14) wires two
substrate-level optimizations through it (A.9.3 headroom-wrap and A.9.6
KV-cache prefix stabilization); these tests pin the decision tree so the
wrap/stabilize state can't silently regress.
"""

import os
import sys
import unittest
from typing import Mapping, Sequence

# The src/ layout mirrors the on-disk layout of the deployed spawner
# (spawner_argv.py is vendored next to local_llm_router_client.py). The
# helper has zero non-stdlib deps so importing it here costs nothing.
_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(_HERE, "..", "src"))

from spawner_argv import build_claude_argv  # noqa: E402


# Sane defaults that mirror the production plist; individual tests
# override what they're exercising.
DEFAULT_KW = dict(
    claude_binary="/opt/homebrew/bin/claude",
    permission_mode_max_turns={"plan": 1},
    headroom_binary="/opt/homebrew/bin/headroom",
    binary_exists=lambda p: True,  # pretend everything exists
)


class BuildClaudeArgvTest(unittest.TestCase):
    # ── A.9.3 wrap behaviour ─────────────────────────────────────────────
    def test_wraps_with_headroom_when_binary_present(self) -> None:
        argv, wrapped, stab = build_claude_argv(
            "HELLO",
            permission_mode="plan",
            allow_list=[],
            **DEFAULT_KW,
        )
        self.assertTrue(wrapped)
        self.assertTrue(stab)
        self.assertEqual(argv[0], "/opt/homebrew/bin/headroom")
        self.assertEqual(argv[1:3], ["wrap", "claude"])
        self.assertIn("--no-mcp", argv)
        self.assertIn("--no-serena", argv)
        self.assertIn("--no-context-tool", argv)
        self.assertIn("--", argv)
        # the prompt + claude flags sit after ``--``
        sep = argv.index("--")
        self.assertEqual(argv[sep + 1], "--print")
        self.assertEqual(argv[sep + 2], "HELLO")

    def test_kill_switch_bypasses_wrap(self) -> None:
        argv, wrapped, stab = build_claude_argv(
            "X",
            permission_mode="plan",
            allow_list=[],
            headroom_wrap_disable=True,
            **{k: v for k, v in DEFAULT_KW.items()
               if k not in {"headroom_binary"}},
            headroom_binary="/opt/homebrew/bin/headroom",
        )
        self.assertFalse(wrapped)
        # direct claude invocation, NOT through headroom
        self.assertEqual(argv[0], "/opt/homebrew/bin/claude")
        self.assertNotIn("headroom", " ".join(argv))

    def test_missing_headroom_binary_fails_open(self) -> None:
        # stolution today: HEADROOM_BINARY set but doesn't exist on disk
        argv, wrapped, _ = build_claude_argv(
            "X",
            permission_mode="plan",
            allow_list=[],
            **{k: v for k, v in DEFAULT_KW.items()
               if k not in {"headroom_binary", "binary_exists"}},
            headroom_binary="/opt/homebrew/bin/headroom",
            binary_exists=lambda p: False,
        )
        self.assertFalse(wrapped)
        self.assertEqual(argv[0], "/opt/homebrew/bin/claude")

    def test_empty_headroom_binary_fails_open(self) -> None:
        argv, wrapped, _ = build_claude_argv(
            "X",
            permission_mode="plan",
            allow_list=[],
            **{k: v for k, v in DEFAULT_KW.items()
               if k not in {"headroom_binary"}},
            headroom_binary="",
        )
        self.assertFalse(wrapped)

    def test_proxy_port_offset_applied(self) -> None:
        argv, wrapped, _ = build_claude_argv(
            "X",
            permission_mode="plan",
            allow_list=[],
            headroom_proxy_port=8800,
            headroom_proxy_offset=4,
            **DEFAULT_KW,
        )
        self.assertTrue(wrapped)
        port_ix = argv.index("--port")
        self.assertEqual(argv[port_ix + 1], "8804")

    def test_reuse_proxy_adds_no_proxy_flag(self) -> None:
        argv, wrapped, _ = build_claude_argv(
            "X",
            permission_mode="plan",
            allow_list=[],
            headroom_reuse_proxy=True,
            **DEFAULT_KW,
        )
        self.assertTrue(wrapped)
        self.assertIn("--no-proxy", argv[: argv.index("--")])

    # ── A.9.6 KV-cache prefix stabilization ─────────────────────────────
    def test_stabilize_flag_added_by_default(self) -> None:
        argv, _, stab = build_claude_argv(
            "X",
            permission_mode="plan",
            allow_list=[],
            **DEFAULT_KW,
        )
        self.assertTrue(stab)
        self.assertIn("--exclude-dynamic-system-prompt-sections", argv)

    def test_stabilize_disabled(self) -> None:
        argv, _, stab = build_claude_argv(
            "X",
            permission_mode="plan",
            allow_list=[],
            stabilize_prefix_disable=True,
            **DEFAULT_KW,
        )
        self.assertFalse(stab)
        self.assertNotIn("--exclude-dynamic-system-prompt-sections", argv)

    # ── orthogonal: existing claude flags still appear correctly ────────
    def test_permission_mode_threaded_through(self) -> None:
        argv, _, _ = build_claude_argv(
            "X",
            permission_mode="acceptEdits",
            allow_list=[],
            **DEFAULT_KW,
        )
        pm_ix = argv.index("--permission-mode")
        self.assertEqual(argv[pm_ix + 1], "acceptEdits")

    def test_max_turns_only_for_plan_default(self) -> None:
        argv, _, _ = build_claude_argv(
            "X",
            permission_mode="plan",
            allow_list=[],
            **DEFAULT_KW,
        )
        self.assertIn("--max-turns", argv)
        mt_ix = argv.index("--max-turns")
        self.assertEqual(argv[mt_ix + 1], "1")
        # acceptEdits is not in the max_turns mapping → flag absent
        argv2, _, _ = build_claude_argv(
            "X",
            permission_mode="acceptEdits",
            allow_list=[],
            **DEFAULT_KW,
        )
        self.assertNotIn("--max-turns", argv2)

    def test_allow_list_emits_add_dir_per_path(self) -> None:
        argv, _, _ = build_claude_argv(
            "X",
            permission_mode="acceptEdits",
            allow_list=["/a", "/b", "/c"],
            **DEFAULT_KW,
        )
        # --add-dir appears exactly three times
        self.assertEqual(argv.count("--add-dir"), 3)
        for p in ("/a", "/b", "/c"):
            self.assertIn(p, argv)

    def test_print_flag_uses_long_form_not_short_p(self) -> None:
        # Avoids the headroom-wrap option collision: `headroom wrap claude`
        # interprets `-p` as `--port`, which would corrupt the proxy port.
        argv, wrapped, _ = build_claude_argv(
            "X",
            permission_mode="plan",
            allow_list=[],
            **DEFAULT_KW,
        )
        self.assertTrue(wrapped)
        # `-p` must NOT appear among the claude flags (after ``--``)
        sep = argv.index("--")
        self.assertNotIn("-p", argv[sep + 1:])
        self.assertIn("--print", argv[sep + 1:])


if __name__ == "__main__":
    unittest.main()
