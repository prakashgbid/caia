"""
PO scope detector — DSPy wrap of packages/decomposer-recursive's
adaptive scope detector.

Mirrors the TypeScript signature in
`packages/decomposer-recursive/src/scope-detector.ts`:

  Input  : prompt_text (+ optional vision_doc_summary)
  Output : target_scope ∈ {initiative, epic, module, story, task, subtask}
           confidence   ∈ [0, 1]
           rationale    : one sentence

The DSPy module is a `dspy.ChainOfThought` over a typed Signature so the
optimizer (MIPROv2) has a clear surface to bootstrap demos and tune
the instruction over.

Score function:
  - +1.0 if target_scope is in the prompt's tolerance set
  - exact-match on target_scope when no tolerance set is given
  - confidence in [0, 1] adds a tie-break (capped 0.1 weight)

The tolerance set comes from the PHASE2E-002 fixtures —
SCOPE_DETECTION_TOLERANCE — which the trainset/eval files emit per row
under the `tolerance` label key.
"""

from __future__ import annotations

import re
from typing import Any

import dspy


SCOPE_VOCAB = ("initiative", "epic", "module", "story", "task", "subtask")


class PoScopeDetectorSignature(dspy.Signature):
    """Classify the natural scope of a user product/engineering prompt.

    The canonical scopes, from largest to smallest:
      - initiative — multi-quarter strategic bet, multi-team, multi-feature
      - epic       — single program-increment chunk, one elevator-pitch theme
      - module     — coherent bounded context, owns its data, 2-8 stories
      - story      — INVEST-compliant single-PR slice of user-visible value
      - task       — single concern, ≤ 1 day, single tech sub-domain
      - subtask    — single mechanical step (one file edit, one config tweak)

    Heuristic anchors:
      - one verb / one object / one deliverable → story
      - one verb / vague object → task
      - multi-paragraph but single feature → epic
      - "build [system]" / vision document → initiative
      - one-line, mechanical, no scope question → subtask
    """

    prompt_text: str = dspy.InputField(
        desc="the user prompt to classify, verbatim"
    )
    vision_doc_summary: str = dspy.InputField(
        desc=(
            "optional pre-extracted theme summary used for vision-doc input. "
            "empty string when not present."
        ),
        default="",
    )
    target_scope: str = dspy.OutputField(
        desc=(
            "exactly one of: initiative | epic | module | story | task | subtask. "
            "no other strings allowed."
        )
    )
    confidence: float = dspy.OutputField(
        desc="float in [0, 1] expressing how confident the answer is"
    )
    rationale: str = dspy.OutputField(
        desc="one sentence explaining why this scope was chosen"
    )


SIGNATURE = PoScopeDetectorSignature


def build_module() -> dspy.Module:
    """Return an uncompiled `dspy.ChainOfThought` module.

    ChainOfThought (vs. plain Predict) gives the optimizer a reasoning
    surface to demonstrate against. PR1 used Predict; PR2 upgrades to
    ChainOfThought because MIPROv2 produces meaningfully better demos
    when the program has an intermediate `rationale` field already.
    """
    return dspy.ChainOfThought(PoScopeDetectorSignature)


def to_input_args(input_dict: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {"prompt_text": str(input_dict["promptText"])}
    out["vision_doc_summary"] = str(input_dict.get("visionDocSummary", "") or "")
    return out


def from_prediction(pred: Any) -> dict[str, Any]:
    raw_scope = getattr(pred, "target_scope", "") or ""
    scope = _normalise_scope(raw_scope)
    raw_conf = getattr(pred, "confidence", 0.5)
    confidence = _coerce_confidence(raw_conf)
    rationale = str(getattr(pred, "rationale", "")).strip() or "(no rationale provided)"
    return {
        "targetScope": scope,
        "confidence": confidence,
        "rationale": rationale,
    }


def score(pred: Any, label: Any) -> float:
    """Score a prediction against a gold label.

    The `label` is a dspy.Example built from a JSONL row. The trainset/
    eval rows carry:

        label.target_scope   — the expected scope (string)
        label.tolerance      — optional list[str] of tolerated scopes
                               (PHASE2E-002 ambiguity model)
    """
    raw = getattr(pred, "target_scope", "") or ""
    actual = _normalise_scope(raw)
    if not actual:
        return 0.0

    tolerance = getattr(label, "tolerance", None)
    expected = getattr(label, "target_scope", None)

    matched = False
    if tolerance and isinstance(tolerance, (list, tuple)):
        matched = actual in tolerance
    elif expected is not None:
        matched = actual == expected

    base = 1.0 if matched else 0.0

    # Confidence tie-breaker: rewards calibration up to +/- 0.1 of the
    # base score, but never lets a wrong answer beat a right one.
    confidence = _coerce_confidence(getattr(pred, "confidence", 0.5))
    tie = 0.0
    if matched:
        tie = max(0.0, min(0.1, (confidence - 0.5) * 0.2))
    else:
        tie = max(-0.1, min(0.0, (0.5 - confidence) * 0.2))

    return float(base + tie)


# ─── Helpers ─────────────────────────────────────────────────────────────


def _normalise_scope(raw: str) -> str:
    """Coerce model output into one of SCOPE_VOCAB. Returns '' on miss."""
    if not raw:
        return ""
    text = raw.strip().lower()
    # Strip surrounding punctuation, JSON braces, quotes.
    text = re.sub(r"^[\W_]+|[\W_]+$", "", text)
    for s in SCOPE_VOCAB:
        if text == s or text.startswith(s):
            return s
    # Sometimes the model wraps the scope inside a longer phrase.
    for s in SCOPE_VOCAB:
        if re.search(rf"\b{s}\b", text):
            return s
    return ""


def _coerce_confidence(raw: Any) -> float:
    try:
        c = float(raw)
    except (TypeError, ValueError):
        return 0.5
    if c != c:  # NaN
        return 0.5
    return max(0.0, min(1.0, c))
