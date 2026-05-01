"""
Registry of DSPy programs the bridge can load.

A "program" is a Python module exposing:

  - SIGNATURE      : the dspy.Signature class (or a `make_signature(...)`)
  - build_module() : returns an uncompiled dspy.Module (e.g. dspy.Predict)
  - to_input_args(input_dict)  : convert RPC input dict → kwargs for the module
  - from_prediction(pred)      : convert dspy.Prediction → RPC output dict
  - score(pred, label)         : float in [0, 1] used by the optimizer / eval

`po_scope_detector` is the first wrap. Future programs (judges,
atomicity classifier, …) get one file each.
"""

from __future__ import annotations

from importlib import import_module
from typing import Any

# Stable mapping: program-name (kebab) → python module path
_REGISTRY: dict[str, str] = {
    "po-scope-detector": "caia_dspy_bridge.programs.po_scope_detector",
}


def get_program(name: str) -> Any:
    if name not in _REGISTRY:
        raise KeyError(
            f"unknown program: {name!r}. Registered: {sorted(_REGISTRY)}"
        )
    return import_module(_REGISTRY[name])  # nosemgrep: python.lang.security.audit.non-literal-import.non-literal-import


def known_programs() -> list[str]:
    return sorted(_REGISTRY)
