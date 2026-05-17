"""
Local Letta bootstrap. SQLite backing for M0; Postgres backing arrives in M4.
"""
from __future__ import annotations

import os
import subprocess
from dataclasses import dataclass
from pathlib import Path


DEFAULT_LETTA_PORT = 8283  # Letta default
DEFAULT_DATA_DIR = Path.home() / ".chiefaia" / "letta-runtime"


@dataclass
class MemoryBlock:
    """Placeholder for the M4 shared-block primitive.

    Per §3 M4: "Mentor pre-spawn injection becomes a Letta memory block named
    `mentor-injection-<context_id>`, shared with every A2A agent spawned under
    that context_id via Letta's shared-block primitive."

    Right now this is a marker type; the M4 implementation will replace it
    with a thin wrapper over letta.client.MemoryBlock.
    """
    name: str
    content: str
    context_id: str


def get_letta_url() -> str:
    """The URL where Letta is reachable. Tries env first, falls back to default."""
    return os.environ.get("LETTA_URL", f"http://127.0.0.1:{DEFAULT_LETTA_PORT}")


def bootstrap_local(data_dir: Path | None = None, port: int = DEFAULT_LETTA_PORT) -> None:
    """Start a local Letta server with SQLite backing.

    For M0 this is a thin shim — we just print the launch command. The
    actual long-running server should be supervised by launchd (M0.8) per
    the operator's 24x7 plan. This function is here so smoke tests can
    sanity-check the layout without actually spawning a process.
    """
    data_dir = data_dir or DEFAULT_DATA_DIR
    data_dir.mkdir(parents=True, exist_ok=True)
    sqlite_path = data_dir / "letta.db"
    cmd = ["letta", "server", "--port", str(port), "--sqlite", str(sqlite_path)]
    print("Letta launch command (run separately, do not block here):")
    print("  " + " ".join(cmd))
    print(f"Letta URL after launch: http://127.0.0.1:{port}")
    # Intentionally NOT subprocess.Popen — M0 scaffold only.


if __name__ == "__main__":
    bootstrap_local()
