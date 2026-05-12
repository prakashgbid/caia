#!/usr/bin/env python3
"""
Phase 12 of 13 — Local-AI-First integration test runner.

Exercises five end-to-end flows × 5 runs each:

  1. Cowork → MCP local_classify → router → ollama
     (calls /v1/intent which dispatches the classifier-v2 keyword prepass /
     classifier-v1 LLM path)
  2. Cowork → MCP local_optimize_prompt → router
     (calls /v1/optimize → @chiefaia/prompt-optimizer 3-stage pipeline)
  3. Spawner POST /spawn — local path  (5 task specs that classify local)
  4. Spawner POST /spawn — escalation path  (5 task specs that escalate)
  5. Router /v1/route end-to-end with metrics  (5 different intents)

Outputs a markdown report at
  ~/Documents/projects/reports/routing_v2_integration_tests_2026-05-11.md
with 25 rows (input / output snippet / latency_ms / tokens_in / tokens_out
/ model_used / pass-fail) plus a summary section.

Usage:
  python3 run_integration_tests.py \
    --router http://127.0.0.1:7411 \
    --spawner http://127.0.0.1:8410 \
    --report ~/Documents/projects/reports/routing_v2_integration_tests_2026-05-11.md

If --spawner is omitted, flows 3 & 4 are reported as "skipped (no spawner
endpoint provided)" — useful when running on M3 without a live spawner.
"""
from __future__ import annotations

import argparse
import dataclasses
import json
import os
import statistics
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[3]
DEFAULT_ROUTER = "http://127.0.0.1:7411"
DEFAULT_REPORT = (
    Path.home() / "Documents/projects/reports/routing_v2_integration_tests_2026-05-11.md"
)


@dataclasses.dataclass
class RunRow:
    flow: str
    idx: int
    input_snippet: str
    output_snippet: str
    latency_ms: int
    tokens_in: int
    tokens_out: int
    model_used: str
    passed: bool
    note: str = ""


def http_json(url: str, body: dict, timeout: float = 60.0) -> tuple[int, dict, int]:
    """POST JSON, return (status, body_json, wall_ms)."""
    t0 = time.time()
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url, data=data, headers={"Content-Type": "application/json"}, method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            payload = json.loads(r.read().decode("utf-8"))
            return r.status, payload, int((time.time() - t0) * 1000)
    except urllib.error.HTTPError as e:
        try:
            payload = json.loads(e.read().decode("utf-8"))
        except Exception:
            payload = {"error": str(e)}
        return e.code, payload, int((time.time() - t0) * 1000)
    except Exception as e:
        return -1, {"error": str(e)}, int((time.time() - t0) * 1000)


def estimate_tokens(s: str) -> int:
    if not s:
        return 0
    return max(1, (len(s) + 3) // 4)


def snippet(s: str, n: int = 100) -> str:
    s = s.replace("\n", " ").strip()
    return s if len(s) <= n else s[: n - 1] + "…"


# ─── Flow 1 — Cowork → MCP local_classify → router → ollama ────────────

FLOW1_PROMPTS = [
    ("rename", "Rename the function getCwd to getCurrentWorkingDirectory across the project"),
    ("refactor", "Refactor the auth middleware to split JWT verify from session lookup (multi-file refactor)"),
    ("summarize", "Summarize this stack trace from the canonical eval runner so I can paste it in a bug report"),
    ("classify", "Classify this PR title into bugfix / feature / chore / refactor / docs"),
    ("doc-write", "Write docs explaining how /v1/intent/v2 differs from /v1/intent for the README"),
]


def run_flow1(router: str) -> list[RunRow]:
    rows: list[RunRow] = []
    for i, (intent_hint, prompt) in enumerate(FLOW1_PROMPTS, start=1):
        status, payload, wall = http_json(
            f"{router}/v1/intent", {"task_spec": prompt}, timeout=60.0
        )
        ok = status == 200 and "intent" in payload
        out = json.dumps(
            {
                "intent": payload.get("intent"),
                "tier": payload.get("recommended_tier"),
                "conf": payload.get("confidence"),
            }
        )
        rows.append(
            RunRow(
                flow="1-classify",
                idx=i,
                input_snippet=snippet(prompt),
                output_snippet=snippet(out, 90),
                latency_ms=wall,
                tokens_in=estimate_tokens(prompt),
                tokens_out=estimate_tokens(out),
                model_used=payload.get("classifier_model", "?"),
                passed=ok,
                note=f"expected-hint={intent_hint}",
            )
        )
    return rows


# ─── Flow 2 — Cowork → MCP local_optimize_prompt → router ──────────────

FLOW2_INPUTS = [
    ("xs", "Tidy this short prompt please.", []),
    ("s", "Reformat this JSON snippet:\n```json\n{ \"b\": 1, \"a\": null, \"c\": \"\" }\n```", []),
    ("m", "Summarize the routing rules YAML you have in memory for the team handoff. " * 6, []),
    (
        "l",
        "Explain the cascade-with-abstain ladder in our router design. " * 20,
        [
            {"id": "log-1", "content": "[2026-05-12T11:00:00Z] router up\n" * 60},
        ],
    ),
    (
        "xl",
        "Distill these tool outputs into a single page handover note. " * 40,
        [
            {"id": "shell-1", "content": "ls -la /home/s903/apps\n" + ("drwxr-xr-x 5 s903 s903 4096 May 12 11:00 .\n" * 200)},
            {"id": "json-1", "content": json.dumps({"k": "v"} | {f"f{i}": i for i in range(80)})},
        ],
    ),
]


def run_flow2(router: str) -> list[RunRow]:
    rows: list[RunRow] = []
    for i, (label, q, tool_outputs) in enumerate(FLOW2_INPUTS, start=1):
        body: dict[str, Any] = {"userQuestion": q}
        if tool_outputs:
            body["toolOutputs"] = tool_outputs
        status, payload, wall = http_json(f"{router}/v1/optimize", body, timeout=120.0)
        ok = status == 200 and "optimized_prompt" in payload
        metrics = payload.get("metrics", {}) if isinstance(payload, dict) else {}
        toks_in = metrics.get("promptTokensRaw") or estimate_tokens(q)
        toks_out = estimate_tokens(payload.get("optimized_prompt", "")) if ok else 0
        rows.append(
            RunRow(
                flow="2-optimize",
                idx=i,
                input_snippet=f"[{label}] " + snippet(q, 80),
                output_snippet=snippet(payload.get("optimized_prompt", str(payload)), 90),
                latency_ms=wall,
                tokens_in=toks_in,
                tokens_out=toks_out,
                model_used="qwen2.5-coder:7b (stage2/3 if ≥500 tokens)",
                passed=ok,
                note=f"protected_spans={payload.get('protected_span_count')}, stage2_skipped={metrics.get('stage2', {}).get('skipped')}",
            )
        )
    return rows


# ─── Flow 3 — Spawner POST /spawn — local path ─────────────────────────

FLOW3_TASKS = [
    "Rename helper foo to helperFoo across packages/local-llm-router/src/",
    "Reformat this README paragraph into bullet points",
    "Classify the following PR description into bug | feature | chore | refactor",
    "Summarize the last 200 lines of this build log into one paragraph",
    "Fill template: changelog entry for PR #1234 with feat scope",
]


def run_flow3(spawner: str | None) -> list[RunRow]:
    rows: list[RunRow] = []
    for i, task in enumerate(FLOW3_TASKS, start=1):
        if spawner is None:
            rows.append(
                RunRow(
                    "3-spawn-local",
                    i,
                    snippet(task),
                    "(skipped — no spawner endpoint)",
                    0,
                    estimate_tokens(task),
                    0,
                    "n/a",
                    False,
                    "spawner-url-missing",
                )
            )
            continue
        body = {
            "spawn_id": f"phase12-local-{i}-{int(time.time())}",
            "task_id": f"phase12-local-{i}",
            "task_spec": {"id": f"phase12-local-{i}", "prompt": task},
            "require_subscription": True,
            "permission_mode": "default",
            "timeout_sec": 60,
        }
        status, payload, wall = http_json(f"{spawner}/spawn", body, timeout=120.0)
        ok = status == 200 and not payload.get("claude_invoked", True)
        rows.append(
            RunRow(
                "3-spawn-local",
                i,
                snippet(task),
                snippet(json.dumps(payload), 100),
                wall,
                estimate_tokens(task),
                estimate_tokens(payload.get("output", "")),
                payload.get("model_used") or payload.get("model") or "?",
                ok,
                f"tier={payload.get('tier')}",
            )
        )
    return rows


# ─── Flow 4 — Spawner POST /spawn — escalation path ────────────────────

FLOW4_TASKS = [
    "Design a zero-downtime rolling migration strategy for our 50M-row users table on PostgreSQL 16. Cover rollback, replica lag, observability. Produce a 1500-word plan with diagrams.",
    "Propose an architecture for splitting the Stolution monolith into bounded contexts with eventual consistency guarantees. ~1200 words.",
    "Reason over the attached incident transcript and decide which of three competing root-cause hypotheses is supported by the evidence; justify with quotes.",
    "Architect the next quarter's eval infra so we can A/B local-7b vs claude on 10k prompts per week with quality-gap CIs.",
    "Conduct a deep code review of this 2000-line refactor PR and surface architecture risks the team should debate before merging.",
]


def run_flow4(spawner: str | None) -> list[RunRow]:
    rows: list[RunRow] = []
    for i, task in enumerate(FLOW4_TASKS, start=1):
        if spawner is None:
            rows.append(
                RunRow(
                    "4-spawn-escalate",
                    i,
                    snippet(task),
                    "(skipped — no spawner endpoint)",
                    0,
                    estimate_tokens(task),
                    0,
                    "n/a",
                    False,
                    "spawner-url-missing",
                )
            )
            continue
        body = {
            "spawn_id": f"phase12-escal-{i}-{int(time.time())}",
            "task_id": f"phase12-escal-{i}",
            "task_spec": {"id": f"phase12-escal-{i}", "prompt": task},
            "require_subscription": True,
            "permission_mode": "default",
            "timeout_sec": 60,
        }
        status, payload, wall = http_json(f"{spawner}/spawn", body, timeout=120.0)
        # Pass criterion: claude was invoked AND optimizer ran with a non-noop backend.
        opt_backend = payload.get("optimizer_backend", "")
        ok = (
            status == 200
            and payload.get("claude_invoked") is True
            and opt_backend in ("router-v1-optimize", "inline-stage1")
        )
        rows.append(
            RunRow(
                "4-spawn-escalate",
                i,
                snippet(task),
                snippet(json.dumps(payload), 110),
                wall,
                payload.get("optimizer_pre_tokens") or estimate_tokens(task),
                payload.get("optimizer_post_tokens") or 0,
                payload.get("model_used") or "claude",
                ok,
                f"opt_backend={opt_backend} ratio={payload.get('optimizer_compression')}",
            )
        )
    return rows


# ─── Flow 5 — Router /v1/route end-to-end with metrics ────────────────

FLOW5_REQS = [
    ("commit-message", "feat(local-llm-router): add classifier v2 + 3-stage optimizer"),
    ("domain-classification", "Auth middleware refactor — JWT verify path"),
    ("formal-reasoning", "Prove that the cascade fallback preserves abstain semantics"),
    ("architecture-decision", "Should we split the monolith into 3 services or keep it monolithic"),
    ("po-decomposer-scope-detection", "Build a real-time analytics dashboard for the Stolution MSMB tier"),
]


def run_flow5(router: str) -> list[RunRow]:
    rows: list[RunRow] = []
    for i, (task_type, prompt) in enumerate(FLOW5_REQS, start=1):
        status, payload, wall = http_json(
            f"{router}/v1/route", {"task_type": task_type, "prompt": prompt}, timeout=30.0
        )
        ok = status == 200 and "task_type" in payload
        rows.append(
            RunRow(
                "5-route",
                i,
                f"[{task_type}] " + snippet(prompt, 70),
                snippet(json.dumps(payload), 110),
                wall,
                estimate_tokens(prompt),
                estimate_tokens(json.dumps(payload)),
                payload.get("local_model") or payload.get("intent") or "?",
                ok,
                f"has_rule={payload.get('has_routing_rule')} use_local={payload.get('use_local')}",
            )
        )
    return rows


# ─── Report writer ────────────────────────────────────────────────────

def _percentile(xs: list[int], p: float) -> int:
    if not xs:
        return 0
    xs = sorted(xs)
    k = max(0, min(len(xs) - 1, int(round((len(xs) - 1) * p))))
    return xs[k]


def write_report(
    rows_by_flow: dict[str, list[RunRow]],
    report_path: Path,
    router: str,
    spawner: str | None,
) -> None:
    flow_titles = {
        "1-classify": "Flow 1 — Cowork → MCP local_classify → router → ollama",
        "2-optimize": "Flow 2 — Cowork → MCP local_optimize_prompt → router /v1/optimize",
        "3-spawn-local": "Flow 3 — Spawner POST /spawn (local path)",
        "4-spawn-escalate": "Flow 4 — Spawner POST /spawn (escalation path)",
        "5-route": "Flow 5 — Router /v1/route end-to-end with metrics",
    }
    md: list[str] = []
    md.append("# Routing v2 — Integration Tests (Phase 12 of 13)")
    md.append("")
    md.append(f"Generated by `run_integration_tests.py`.")
    md.append(f"Router: `{router}`. Spawner: `{spawner or '(skipped)'}`.")
    md.append(f"Date: 2026-05-11.")
    md.append("")
    total_rows = sum(len(r) for r in rows_by_flow.values())
    md.append(f"Total runs executed: **{total_rows}** across **{len(rows_by_flow)}** flows.")
    md.append("")
    # Per-flow tables
    for flow_key, title in flow_titles.items():
        rows = rows_by_flow.get(flow_key, [])
        md.append(f"## {title}")
        md.append("")
        md.append("| # | input | output (snip) | latency_ms | tok_in | tok_out | model | pass | note |")
        md.append("|---|-------|---------------|-----------:|-------:|--------:|-------|------|------|")
        for r in rows:
            md.append(
                f"| {r.idx} "
                f"| {r.input_snippet} "
                f"| {r.output_snippet} "
                f"| {r.latency_ms} "
                f"| {r.tokens_in} "
                f"| {r.tokens_out} "
                f"| `{r.model_used}` "
                f"| {'✅' if r.passed else '❌'} "
                f"| {r.note} |"
            )
        md.append("")
    # Summary
    md.append("## Summary")
    md.append("")
    md.append("| flow | runs | pass | success_rate | p50_ms | p95_ms | tok_in_sum | tok_out_sum | displaced_tok |")
    md.append("|------|-----:|-----:|-------------:|-------:|-------:|-----------:|------------:|--------------:|")
    total_in = 0
    total_out = 0
    total_displaced = 0
    for flow_key in flow_titles:
        rows = rows_by_flow.get(flow_key, [])
        if not rows:
            continue
        latencies = [r.latency_ms for r in rows if r.latency_ms > 0]
        p50 = _percentile(latencies, 0.50)
        p95 = _percentile(latencies, 0.95)
        passes = sum(1 for r in rows if r.passed)
        tin = sum(r.tokens_in for r in rows)
        tout = sum(r.tokens_out for r in rows)
        # "Displaced" = local handled this prompt → those tokens would have gone to claude
        if flow_key in ("1-classify", "2-optimize", "3-spawn-local", "5-route"):
            displaced = sum(r.tokens_in for r in rows if r.passed)
        else:
            # Flow 4 escalates to claude; displacement only counts the optimizer savings.
            displaced = sum(max(0, r.tokens_in - r.tokens_out) for r in rows if r.passed)
        total_in += tin
        total_out += tout
        total_displaced += displaced
        md.append(
            f"| {flow_key} | {len(rows)} | {passes} "
            f"| {(100 * passes / len(rows)):.0f}% | {p50} | {p95} | {tin} | {tout} | {displaced} |"
        )
    md.append("")
    md.append(
        f"**Total prompt tokens displaced from claude: {total_displaced}** "
        f"(Flows 1/2/3/5: tokens that stayed local; Flow 4: optimizer savings before claude)."
    )
    md.append("")
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text("\n".join(md) + "\n")
    print(f"report written: {report_path} ({report_path.stat().st_size} bytes)")


# ─── Main ─────────────────────────────────────────────────────────────

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--router", default=DEFAULT_ROUTER)
    ap.add_argument("--spawner", default=None, help="e.g. http://127.0.0.1:8410 (omit to skip flows 3/4)")
    ap.add_argument("--report", default=str(DEFAULT_REPORT))
    args = ap.parse_args()

    rows_by_flow: dict[str, list[RunRow]] = {}
    for flow_name, runner in [
        ("1-classify", lambda: run_flow1(args.router)),
        ("2-optimize", lambda: run_flow2(args.router)),
        ("3-spawn-local", lambda: run_flow3(args.spawner)),
        ("4-spawn-escalate", lambda: run_flow4(args.spawner)),
        ("5-route", lambda: run_flow5(args.router)),
    ]:
        print(f"running {flow_name} …", file=sys.stderr)
        rows_by_flow[flow_name] = runner()

    write_report(rows_by_flow, Path(os.path.expanduser(args.report)), args.router, args.spawner)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
