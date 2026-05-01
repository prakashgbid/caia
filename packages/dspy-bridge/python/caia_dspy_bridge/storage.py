"""
On-disk storage for compiled DSPy programs.

Layout under ~/.caia/dspy/compiled/:

    <program-name>/
        <program-name>-v1.pkl
        <program-name>-v2.pkl
        ...
        CURRENT          ← text file containing the active version, e.g. "v3"

The CURRENT file is the runtime pointer the bridge follows when it gets
`version: 'latest'`. Promote/rollback is just rewriting CURRENT.
"""

from __future__ import annotations

import os
import re
import pickle
from pathlib import Path
from typing import Any

DEFAULT_ROOT = Path(os.environ.get("CAIA_DSPY_ROOT", str(Path.home() / ".caia" / "dspy" / "compiled")))


def program_dir(program: str, root: Path | None = None) -> Path:
    return (root or DEFAULT_ROOT) / program


def list_versions(program: str, root: Path | None = None) -> list[str]:
    d = program_dir(program, root)
    if not d.exists():
        return []
    versions = []
    for f in d.iterdir():
        m = re.match(rf"^{re.escape(program)}-(v\d+)\.pkl$", f.name)
        if m:
            versions.append(m.group(1))
    return sorted(versions, key=lambda v: int(v[1:]))


def current_version(program: str, root: Path | None = None) -> str | None:
    cur = program_dir(program, root) / "CURRENT"
    if not cur.exists():
        return None
    text = cur.read_text(encoding="utf-8").strip()
    return text or None


def set_current(program: str, version: str, root: Path | None = None) -> None:
    d = program_dir(program, root)
    d.mkdir(parents=True, exist_ok=True)
    (d / "CURRENT").write_text(version + "\n", encoding="utf-8")


def pickle_path(program: str, version: str, root: Path | None = None) -> Path:
    return program_dir(program, root) / f"{program}-{version}.pkl"


def next_version(program: str, root: Path | None = None) -> str:
    versions = list_versions(program, root)
    if not versions:
        return "v1"
    last = versions[-1]
    return f"v{int(last[1:]) + 1}"


def save_program(program: str, version: str, payload: Any, root: Path | None = None) -> Path:
    d = program_dir(program, root)
    d.mkdir(parents=True, exist_ok=True)
    p = pickle_path(program, version, root)
    with p.open("wb") as fh:
        pickle.dump(payload, fh)
    return p


def load_program(program: str, version: str, root: Path | None = None) -> Any:
    p = pickle_path(program, version, root)
    if not p.exists():
        raise FileNotFoundError(f"compiled program not found: {p}")
    with p.open("rb") as fh:
        return pickle.load(fh)


def resolve_version(program: str, version: str, root: Path | None = None) -> str:
    """Resolve 'latest' (or empty) to the CURRENT pointer; passthrough otherwise."""
    if version in ("latest", "", None):
        cur = current_version(program, root)
        if cur is None:
            raise FileNotFoundError(
                f"no CURRENT pointer for program '{program}'. "
                f"Run a compile first so a v1 lands."
            )
        return cur
    return version
