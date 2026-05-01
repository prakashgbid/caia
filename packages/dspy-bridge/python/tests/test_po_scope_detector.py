"""
Pure-Python unit tests for the po-scope-detector helpers — score(),
_normalise_scope(), _coerce_confidence(). Run via:

    cd packages/dspy-bridge/python && uv run pytest -q

These tests exercise the deterministic helpers; live LM behaviour is
covered by the bridge integration tests landed with the cron (PR4).
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from caia_dspy_bridge.programs.po_scope_detector import (
    SCOPE_VOCAB,
    _coerce_confidence,
    _normalise_scope,
    from_prediction,
    score,
    to_input_args,
)


# ─── _normalise_scope ────────────────────────────────────────────────────


@pytest.mark.parametrize("raw,expected", [
    ("story", "story"),
    ("STORY", "story"),
    ("  Epic ", "epic"),
    ("'task'", "task"),
    ("the natural scope is module here", "module"),
    ("subtask: rename foo", "subtask"),
    ("initiative.", "initiative"),
])
def test_normalise_scope_accepts_known_scope_in_various_shapes(raw, expected):
    assert _normalise_scope(raw) == expected


@pytest.mark.parametrize("raw", ["", "feature", "blob", "{}", "stori"])
def test_normalise_scope_returns_empty_on_unknown(raw):
    assert _normalise_scope(raw) == ""


def test_scope_vocab_is_size_ordered():
    assert SCOPE_VOCAB == ("initiative", "epic", "module", "story", "task", "subtask")


# ─── _coerce_confidence ──────────────────────────────────────────────────


@pytest.mark.parametrize("raw,expected", [
    (0.5, 0.5),
    ("0.7", 0.7),
    (-0.2, 0.0),
    (1.7, 1.0),
    ("not a float", 0.5),
    (None, 0.5),
    (float("nan"), 0.5),
])
def test_coerce_confidence(raw, expected):
    assert _coerce_confidence(raw) == pytest.approx(expected)


# ─── score ───────────────────────────────────────────────────────────────


def _pred(scope: str, conf: float = 0.7):
    return SimpleNamespace(target_scope=scope, confidence=conf)


def _label(scope: str, tolerance=None):
    ns = SimpleNamespace(target_scope=scope)
    if tolerance is not None:
        ns.tolerance = tolerance
    return ns


def test_score_exact_match_no_tolerance():
    s = score(_pred("story", 0.9), _label("story"))
    assert s > 1.0  # base 1.0 + small tie bonus
    assert s <= 1.1


def test_score_miss_no_tolerance():
    s = score(_pred("epic", 0.9), _label("story"))
    assert s <= 0.0  # base 0 + negative tie penalty


def test_score_in_tolerance_set():
    label = _label("story", tolerance=["story", "epic"])
    s = score(_pred("epic", 0.6), label)
    assert s >= 1.0


def test_score_out_of_tolerance_set():
    label = _label("story", tolerance=["story", "task"])
    s = score(_pred("initiative", 0.9), label)
    assert s <= 0.0


def test_score_invalid_scope_returns_zero():
    s = score(_pred("feature", 0.9), _label("story"))
    assert s == 0.0


# ─── marshalling ─────────────────────────────────────────────────────────


def test_to_input_args_default_summary_to_empty():
    out = to_input_args({"promptText": "add a logout button"})
    assert out == {"prompt_text": "add a logout button", "vision_doc_summary": ""}


def test_to_input_args_passes_through_summary():
    out = to_input_args({
        "promptText": "Re-vamp checkout",
        "visionDocSummary": "Theme: cart abandonment",
    })
    assert out["vision_doc_summary"] == "Theme: cart abandonment"


def test_from_prediction_normalises_and_clamps():
    out = from_prediction(SimpleNamespace(
        target_scope="STORY ",
        confidence=1.7,
        rationale=" one verb ",
    ))
    assert out == {"targetScope": "story", "confidence": 1.0, "rationale": "one verb"}


def test_from_prediction_invalid_scope_falls_back_to_empty():
    out = from_prediction(SimpleNamespace(
        target_scope="banana",
        confidence=0.4,
        rationale="",
    ))
    assert out["targetScope"] == ""
    assert out["rationale"] == "(no rationale provided)"
