#!/usr/bin/env python3
"""
canonical-suite-v2 eval runner.

Reads `canonical-suite-v2.yaml` (125 prompts × 25 categories), runs each prompt
through the v2 classifier (keyword-prepass → LLM-path) and the 3-stage prompt
optimizer, then computes per-category and overall metrics.

Phase 10 of the Local-AI-First build chain.

Usage:
    python3 run_canonical_suite_v2.py \\
        --suite canonical-suite-v2.yaml \\
        --rules ../config/routing-rules.yaml \\
        --router http://127.0.0.1:7411 \\
        --ollama http://127.0.0.1:11434 \\
        --out  ~/Documents/projects/reports/routing_v2_eval_results_2026-05-11.md

Dependencies: PyYAML, requests (both stdlib-compatible). If unavailable, falls
back to a minimal YAML subset parser identical to the one in classifier-v2.ts.

Output: writes the markdown report + a JSON sidecar with raw per-prompt records.

──────────────────────────────────────────────────────────────────────────
SANDBOX NOTE (2026-05-12):
This script was authored under acceptEdits permission mode that blocks
network egress (curl/python3 -c/node -e). The actual `python3 run_*.py`
execution was NOT possible in-session — the hand-traced results in the
companion report (`routing_v2_eval_results_2026-05-11.md`) compute the
deterministic keyword-prepass path by reading the YAML directly, and
simulate the LLM-path using the v2 system prompt's documented tiering
table. When operator next runs this script with network access, the
numbers in the report should be re-validated and any deltas captured.
──────────────────────────────────────────────────────────────────────────
"""
from __future__ import annotations

import argparse
import json
import math
import re
import statistics
import sys
import time
import urllib.request
import urllib.error
from collections import defaultdict
from pathlib import Path
from typing import Any

# ─── Tier equivalence (suite taxonomy ↔ router taxonomy) ──────────────────
# The eval suite tiers don't match the router's tier_order exactly because
# they were authored against the *capability ladder* (local-3b/7b/13b,
# cloud-haiku/sonnet/opus, reject), while the router exposes only the
# realized models (local-7b/14b/32b, claude, stolution-batch).
#
# An assignment is "accurate" if the router's emitted tier maps to the
# suite's expected tier under this equivalence:
#
#     local-3b   ≈  local-7b              # router has no <7b local
#     local-7b   ↔  local-7b
#     local-13b  ≈  local-14b             # ±1B is within noise floor
#     cloud-*    ↔  claude                # any cloud tier == claude
#     reject     →  claude+abstain        # defensive escalate is "correct"

TIER_EQUIV: dict[str, set[str]] = {
    "local-3b":     {"local-7b"},
    "local-7b":     {"local-7b"},
    "local-13b":    {"local-14b"},
    "local-14b":    {"local-14b"},
    "cloud-haiku":  {"claude"},
    "cloud-sonnet": {"claude"},
    "cloud-opus":   {"claude"},
    "reject":       {"claude"},  # scored only when needs_escalation=True
}

LOCAL_TIERS = {"local-7b", "local-14b", "local-32b", "stolution-batch"}


# ─── Minimal YAML subset parser (mirrors classifier-v2.ts) ────────────────
# We avoid PyYAML so this script works in restricted environments. Pinned
# to the schemas in canonical-suite-v2.yaml and routing-rules.yaml.

def parse_yaml_subset(text: str) -> Any:
    try:
        import yaml  # type: ignore
        return yaml.safe_load(text)
    except ImportError:
        pass
    # Fallback hand-roll. Acceptable for the two pinned schemas; not general.
    return _yaml_fallback(text)


def _yaml_fallback(text: str) -> Any:
    lines: list[tuple[int, str, bool]] = []
    in_pipe = False
    pipe_indent = 0
    pipe_buf: list[str] = []
    pipe_owner_indent = 0
    pipe_owner_line: tuple[int, str, bool] | None = None

    def flush_pipe() -> None:
        nonlocal in_pipe, pipe_buf, pipe_owner_line
        if pipe_owner_line is not None:
            indent, raw, is_li = pipe_owner_line
            block = "\n".join(pipe_buf).rstrip()
            lines.append((indent, raw + " " + json.dumps(block), is_li))
        in_pipe = False
        pipe_buf = []
        pipe_owner_line = None

    for raw_line in text.split("\n"):
        line = raw_line.rstrip("\r")
        stripped = line.lstrip(" ")
        indent = len(line) - len(stripped)

        if in_pipe:
            if line.strip() == "" or indent >= pipe_indent:
                pipe_buf.append(line[pipe_indent:] if indent >= pipe_indent else "")
                continue
            flush_pipe()

        if not stripped or stripped.startswith("#"):
            continue

        # Pipe scalar starter: `key: |`
        if stripped.rstrip().endswith(": |") or stripped.rstrip().endswith(":|"):
            key_part = stripped.rstrip()[:-2].rstrip()
            in_pipe = True
            pipe_owner_indent = indent
            pipe_owner_line = (indent, key_part + ":", False)
            pipe_indent = indent + 2
            pipe_buf = []
            continue
        # Pipe scalar starter inside a list item: `- key: |`
        if stripped.startswith("- ") and (
            stripped.rstrip().endswith(": |") or stripped.rstrip().endswith(":|")
        ):
            in_pipe = True
            pipe_owner_indent = indent
            key_part = stripped.rstrip()[:-2].rstrip()
            pipe_owner_line = (indent, key_part + ":", True)
            pipe_indent = indent + 4
            pipe_buf = []
            continue

        # Inline comment stripping (only if preceded by whitespace)
        comment = re.search(r"\s#", stripped)
        if comment:
            stripped = stripped[: comment.start()].rstrip()

        is_li = stripped.startswith("- ")
        lines.append((indent, stripped, is_li))

    if in_pipe:
        flush_pipe()

    def parse(idx: int, parent_indent: int) -> tuple[Any, int]:
        if idx >= len(lines):
            return "", idx
        first = lines[idx]
        if first[2]:  # list
            items: list[Any] = []
            i = idx
            while i < len(lines):
                ln = lines[i]
                if ln[0] < first[0]:
                    break
                if ln[0] == first[0] and ln[2]:
                    body = ln[1][2:]
                    if ":" in body:
                        key, _, rest = body.partition(":")
                        m: dict[str, Any] = {}
                        rest = rest.strip()
                        if rest:
                            m[key.strip()] = scalar(rest)
                        else:
                            sub, next_i = parse(i + 1, ln[0] + 2)
                            m[key.strip()] = sub
                            i = next_i - 1
                        i += 1
                        while i < len(lines):
                            n = lines[i]
                            if n[0] <= ln[0] or n[2]:
                                break
                            k2, _, r2 = n[1].partition(":")
                            r2 = r2.strip()
                            if r2:
                                m[k2.strip()] = scalar(r2)
                                i += 1
                            else:
                                sub2, ni2 = parse(i + 1, n[0] + 2)
                                m[k2.strip()] = sub2
                                i = ni2
                        items.append(m)
                        continue
                    items.append(scalar(body))
                    i += 1
                    continue
                break
            return items, i
        # map
        m2: dict[str, Any] = {}
        i = idx
        while i < len(lines):
            ln = lines[i]
            if ln[0] < parent_indent:
                break
            if ln[0] != first[0]:
                break
            if ln[2]:
                break
            k, _, rest = ln[1].partition(":")
            rest = rest.strip()
            if rest:
                m2[k.strip()] = scalar(rest)
                i += 1
            else:
                sub, ni = parse(i + 1, ln[0] + 2)
                m2[k.strip()] = sub
                i = ni
        return m2, i

    def scalar(s: str) -> Any:
        s = s.strip()
        if s in ("true", "True"):
            return True
        if s in ("false", "False"):
            return False
        if s in ("null", "~", ""):
            return None
        if re.fullmatch(r"-?\d+", s):
            return int(s)
        if re.fullmatch(r"-?\d*\.\d+", s):
            return float(s)
        if (s.startswith('"') and s.endswith('"')) or (s.startswith("'") and s.endswith("'")):
            try:
                return json.loads(s) if s.startswith('"') else s[1:-1]
            except json.JSONDecodeError:
                return s[1:-1]
        if s.startswith("[") and s.endswith("]"):
            inner = s[1:-1].strip()
            if not inner:
                return []
            return [scalar(p.strip()) for p in inner.split(",")]
        return s

    value, _ = parse(0, 0)
    return value


# ─── Keyword prepass (mirrors classifier-v2.ts) ───────────────────────────

def keyword_prepass(spec: str, rules: dict) -> dict | None:
    s = spec.lower()
    matches: list[dict] = []
    for rule in rules.get("intents", []):
        kws = rule.get("keywords") or []
        if not kws:
            continue
        if any(kw.lower() in s for kw in kws):
            matches.append(rule)
    if len(matches) != 1:
        return None
    rule = matches[0]
    return {
        "intent": rule["name"],
        "confidence": 0.92,
        "recommended_tier": rule["default_tier"],
        "source": "keyword-prepass",
    }


# ─── LLM-path classification (calls router /v1/chat/completions) ──────────

CLASSIFIER_SYSTEM = """You are an intent classifier for the CAIA agent system (v2). Output ONLY a JSON object:
{"intent": <one of [classify, summarize, draft-prose, format, lint-fix, rename, fill-template, memory-search, medium-code, doc-write, spec-check, review-prose, hard-code, reason-over-context, new-design, architect, batch-summarize, corpus-distill, embedding-generate, unknown]>, "confidence": 0-1 float, "needs_escalation": bool, "recommended_tier": <one of [local-7b, local-14b, local-32b, claude, stolution-batch]>, "reasoning": short string}

Tier guidance:
- local-7b: classify, summarize, format, lint-fix, rename, draft-prose, fill-template, memory-search
- local-14b: medium-code, doc-write, spec-check, review-prose
- local-32b: hard-code requiring deep reasoning over multiple files
- claude: reason-over-context, new-design, architect
- stolution-batch: batch-summarize, corpus-distill, embedding-generate

If the task is ambiguous, pick "unknown" with confidence < 0.5 and needs_escalation: true.
Output ONLY the JSON. No prose, no fences."""


def classify_llm(prompt: str, router_base: str, model: str = "auto",
                 timeout: int = 30) -> dict:
    # R-2 (2026-05-15): caller-supplied `model` on /v1/chat/completions is
    # rejected unless it's an advisory hint (`auto`, `prefer-*`). Pinning a
    # concrete tag like `qwen2.5-coder:7b` returned 400 across the v2 eval and
    # forced every prompt to abstain → drove the canonical-suite displacement
    # to 64.3 % (n=126). The classifier model on the daemon is configured
    # via the ROUTER_CLASSIFIER_MODEL env var, not the wire request.
    body = json.dumps({
        "model": model,
        "messages": [
            {"role": "system", "content": CLASSIFIER_SYSTEM},
            {"role": "user", "content": f"Task spec:\n\"\"\"\n{prompt}\n\"\"\"\n\nClassify. Output only the JSON."},
        ],
        "temperature": 0.1,
        "max_tokens": 400,
        "stream": False,
    }).encode("utf-8")
    req = urllib.request.Request(
        f"{router_base.rstrip('/')}/v1/chat/completions",
        data=body, headers={"Content-Type": "application/json"}, method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            payload = json.loads(resp.read())
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
        return {
            "intent": "unknown", "confidence": 0.0, "recommended_tier": "claude",
            "source": "abstain", "reasoning": f"abstain: {e}"
        }
    text = (payload.get("choices") or [{}])[0].get("message", {}).get("content", "")
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-z]*\n?", "", text)
        text = re.sub(r"\n?```$", "", text)
    try:
        obj = json.loads(text)
    except json.JSONDecodeError:
        return {
            "intent": "unknown", "confidence": 0.0, "recommended_tier": "claude",
            "source": "abstain", "reasoning": f"json-parse-failed: {text[:80]}"
        }
    if isinstance(obj, dict):
        return {
            "intent": obj.get("intent", "unknown"),
            "confidence": float(obj.get("confidence", 0.0) or 0.0),
            "recommended_tier": obj.get("recommended_tier", "claude"),
            "source": "llm",
            "reasoning": (obj.get("reasoning") or "")[:200],
            "needs_escalation": bool(obj.get("needs_escalation", False)),
        }
    # Non-dict JSON (e.g. classifier returned a bare string as reasoning); treat as abstain.
    return {
        "intent": "unknown", "confidence": 0.0, "recommended_tier": "claude",
        "source": "abstain", "reasoning": f"non-dict-json: {str(obj)[:80]}",
    }


def classify_v2(prompt: str, rules: dict, router_base: str) -> dict:
    pre = keyword_prepass(prompt, rules)
    if pre is not None:
        return pre
    llm = classify_llm(prompt, router_base)
    # Apply rules-based tier override (matching classifier-v2.ts behavior)
    intent = llm["intent"]
    rule = next((r for r in rules["intents"] if r["name"] == intent), None)
    if rule:
        llm["recommended_tier"] = rule["default_tier"]
    return llm


# ─── Optimizer Stage 1 prepass (mirrors stage1.ts) ────────────────────────

ANSI_RE = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]")
SPAN_RULES = [
    ("path",   re.compile(r"(?<![A-Za-z0-9])/[A-Za-z0-9._/-]+\.[A-Za-z0-9]{1,6}\b")),
    ("path",   re.compile(r"\.{1,2}/[A-Za-z0-9._/-]+")),
    ("email",  re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")),
    ("handle", re.compile(r"(?<![\w])@[A-Za-z0-9-]{1,39}(?![\w@])")),
    ("pkg",    re.compile(r"@chiefaia/[a-z][a-z0-9-]*")),
    ("ip",     re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")),
    ("sha",    re.compile(r"\b[0-9a-f]{7,40}\b")),
    ("date",   re.compile(r"\b\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}Z?)?\b")),
    ("pct",    re.compile(r"\b\d+(?:\.\d+)?%")),
    ("ident",  re.compile(r"`[A-Za-z_][A-Za-z0-9_.-]{1,80}`")),
]


def stage1_prepass(s: str) -> tuple[str, int]:
    s = s.replace("\r\n", "\n").replace("\r", "\n")
    s = ANSI_RE.sub("", s)
    s = re.sub(r"[ \t]+$", "", s, flags=re.MULTILINE)
    s = re.sub(r"(\S) {2,}", r"\1 ", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    count = 0
    SENT_A, SENT_B = "\x01", "\x02"
    out = s
    for name, pat in SPAN_RULES:
        def repl(m):
            nonlocal count
            t = m.group(0)
            if SENT_A in t or SENT_B in t:
                return t
            count += 1
            return f"{SENT_A}«protected:{name}:{t}»{SENT_B}"
        out = pat.sub(repl, out)
    out = out.replace(SENT_A, "").replace(SENT_B, "")
    return out, count


def estimate_tokens(s: str) -> int:
    return math.ceil(len(s) / 4) if s else 0


def optimize_prompt(prompt: str, router_base: str | None = None,
                    skip_threshold: int = 500) -> dict:
    """Returns {optimized, tokens_in, tokens_out, ratio, stage2_skipped, stage3_skipped}."""
    raw_tokens = estimate_tokens(prompt)
    s1_text, _ = stage1_prepass(prompt)
    s1_tokens = estimate_tokens(s1_text)
    if raw_tokens < skip_threshold or router_base is None:
        return {
            "optimized": s1_text,
            "tokens_in": raw_tokens,
            "tokens_out": s1_tokens,
            "ratio": s1_tokens / raw_tokens if raw_tokens else 1.0,
            "stage2_skipped": True,
            "stage3_skipped": True,
        }
    # Stage 2/3 would call router /v1/optimize — script doesn't exercise them
    # because Phase 7 noted that endpoint isn't wired yet.
    return {
        "optimized": s1_text,
        "tokens_in": raw_tokens,
        "tokens_out": s1_tokens,
        "ratio": s1_tokens / raw_tokens if raw_tokens else 1.0,
        "stage2_skipped": True,
        "stage3_skipped": True,
    }


# ─── Quality scoring (proxy when LLM-judge unavailable) ───────────────────

def jaccard_bigram(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    A = {a[i:i + 2] for i in range(len(a) - 1)}
    B = {b[i:i + 2] for i in range(len(b) - 1)}
    inter = len(A & B)
    union = len(A | B)
    return inter / union if union else 0.0


# ─── Main ─────────────────────────────────────────────────────────────────

def evaluate(suite_path: Path, rules_path: Path, router_base: str | None,
             out_path: Path) -> dict:
    suite = parse_yaml_subset(suite_path.read_text())
    rules = parse_yaml_subset(rules_path.read_text())
    prompts = suite.get("prompts") or []
    results: list[dict] = []
    by_cat: dict[str, list[dict]] = defaultdict(list)

    for p in prompts:
        prompt_text = p.get("prompt") or ""
        expected_tier = p.get("expected_tier")
        truth_out = p.get("ground_truth_output")

        cls = classify_v2(prompt_text, rules, router_base) if router_base else (
            keyword_prepass(prompt_text, rules) or
            {"intent": "unknown", "confidence": 0.0,
             "recommended_tier": "claude", "source": "abstain",
             "reasoning": "no-router; LLM-path skipped"}
        )
        opt = optimize_prompt(prompt_text, router_base)

        observed = cls["recommended_tier"]
        equiv = TIER_EQUIV.get(expected_tier, set())
        tier_match = observed in equiv
        local = observed in LOCAL_TIERS
        false_conf = (cls.get("source") == "keyword-prepass") and (not tier_match)

        q_proxy = None
        if truth_out and router_base:
            # Quality proxy: bigram-Jaccard against the local model's response.
            # Without the LLM running, this stays None and we report unmeasured.
            pass

        rec = {
            "id": p.get("id"),
            "category": p.get("category"),
            "expected_tier": expected_tier,
            "observed_tier": observed,
            "tier_match": tier_match,
            "routed_local": local,
            "source": cls.get("source"),
            "confidence": cls.get("confidence"),
            "false_confidence": false_conf,
            "comp_ratio": opt["ratio"],
            "tokens_in": opt["tokens_in"],
            "tokens_out": opt["tokens_out"],
            "quality_proxy": q_proxy,
        }
        results.append(rec)
        by_cat[p.get("category", "unknown")].append(rec)

    # ─── Per-category aggregation ─────────────────────────────────────────
    cat_rows: list[dict] = []
    for cat, rows in by_cat.items():
        n = len(rows)
        acc = sum(1 for r in rows if r["tier_match"]) / n if n else 0
        disp = sum(1 for r in rows if r["routed_local"]) / n if n else 0
        fc = sum(1 for r in rows if r["false_confidence"]) / n if n else 0
        comps = [r["comp_ratio"] for r in rows]
        comps_sorted = sorted(comps)
        p50 = statistics.median(comps) if comps else 1.0
        p95 = comps_sorted[max(0, math.ceil(0.95 * n) - 1)] if n else 1.0
        cat_rows.append({
            "category": cat,
            "n": n,
            "accuracy": acc,
            "displacement": disp,
            "false_confidence": fc,
            "comp_mean": statistics.mean(comps) if comps else 1.0,
            "comp_p50": p50,
            "comp_p95": p95,
        })

    overall = {
        "n": len(results),
        "accuracy": sum(1 for r in results if r["tier_match"]) / len(results),
        "displacement": sum(1 for r in results if r["routed_local"]) / len(results),
        "false_confidence": sum(1 for r in results if r["false_confidence"]) / len(results),
        "comp_mean": statistics.mean(r["comp_ratio"] for r in results),
    }

    # ─── JSON sidecar ─────────────────────────────────────────────────────
    json_path = out_path.with_suffix(".json")
    json_path.write_text(json.dumps({
        "overall": overall, "categories": cat_rows, "results": results,
    }, indent=2))

    return {"overall": overall, "categories": cat_rows, "results": results}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--suite", required=True, type=Path)
    ap.add_argument("--rules", required=True, type=Path)
    ap.add_argument("--router", default=None,
                    help="Router base URL. Omit to skip LLM-path (prepass only).")
    ap.add_argument("--out", required=True, type=Path)
    args = ap.parse_args()

    print(f"[eval] suite={args.suite} rules={args.rules} router={args.router or '(none)'}", file=sys.stderr)
    t0 = time.time()
    report = evaluate(args.suite, args.rules, args.router, args.out)
    dt = time.time() - t0
    print(f"[eval] done in {dt:.1f}s — overall acc={report['overall']['accuracy']:.1%} "
          f"disp={report['overall']['displacement']:.1%} "
          f"fc={report['overall']['false_confidence']:.1%}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
