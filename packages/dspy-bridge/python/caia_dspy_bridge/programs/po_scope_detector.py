"""
PO scope detector — DSPy stub.

This file is a TYPE-VALID PLACEHOLDER for PR1. The real signature,
input/output marshalling, and metric land in PR2 (feat/dspy-002).
The placeholder exists so:

  * the program registry resolves and `list_programs` succeeds;
  * the bridge's smoke test runs end-to-end without the PR2 wrap;
  * `predict` against an unbuilt program works (build_module() returns
    a one-shot dspy.Predict over the placeholder signature).

PR2 replaces SIGNATURE, build_module(), and score() with the real
classifier per packages/decomposer-recursive/src/scope-detector.ts.
"""

from __future__ import annotations

from typing import Any

import dspy


class PoScopeDetectorSignature(dspy.Signature):
    """PR1 placeholder — wraps a single field round-trip."""

    prompt_text: str = dspy.InputField(desc="the user prompt to classify")
    targetScope: str = dspy.OutputField(  # noqa: N815 — JS-friendly naming
        desc="one of: initiative | epic | module | story | task | subtask"
    )


SIGNATURE = PoScopeDetectorSignature


def build_module() -> dspy.Module:
    return dspy.Predict(PoScopeDetectorSignature)


def to_input_args(input_dict: dict[str, Any]) -> dict[str, Any]:
    return {"prompt_text": input_dict["promptText"]}


def from_prediction(pred: Any) -> dict[str, Any]:
    return {"targetScope": getattr(pred, "targetScope", "")}


def score(pred: Any, label: Any) -> float:
    """PR1 placeholder metric: exact-match on targetScope."""
    expected = getattr(label, "targetScope", None)
    actual = getattr(pred, "targetScope", None)
    return 1.0 if (expected is not None and expected == actual) else 0.0
