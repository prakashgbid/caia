"""Spawn prompt v2 loader + output schema validator.

B15.C (A.3 reliability chain phase 2). Design authority:
  ~/Documents/projects/agent-memory/reliability_99pct_design_2026-05-11.md
  (§6.2.2 — v2 prompt template + strict JSON output schema).

This module is intentionally pure-stdlib: it is vendored into
claude_spawner_agent.py at deploy time alongside local_llm_router_client.py.
No pip deps; no jsonschema; the validator is a hand-rolled walk against
the schema constants below. Matches the package's stated convention
('Pure stdlib (no pip deps); HTTP via urllib.' — README/package.json).

PUBLIC API:
  - build_prompt_v2(task_spec, *, spawn_id, permission_mode, cwd, branch,
                    risk_tier, spawned_by_trailer) -> str
  - build_prompt_v1(task_spec, ...) -> str   # rollback path; mirrors v1
  - build_prompt(version, task_spec, ...)    # dispatcher honoring
                                             # SPAWN_PROMPT_VERSION env var
  - validate_spawn_output(parsed) -> tuple[bool, list[str]]
  - load_template(version: str) -> str

ENV:
  SPAWN_PROMPT_VERSION   "v2" (default) | "v1" (rollback)
  SPAWN_PROMPT_TEMPLATE_DIR  path to override the templates dir (test only)
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any

DEFAULT_VERSION = "v2"
SUPPORTED_VERSIONS = ("v1", "v2")

_FRONTMATTER_RE = re.compile(r"\A---\n.*?\n---\n", re.DOTALL)


def _templates_dir() -> Path:
    override = os.environ.get("SPAWN_PROMPT_TEMPLATE_DIR")
    if override:
        return Path(override).expanduser().resolve()
    return Path(__file__).resolve().parent.parent / "templates"


def load_template(version: str) -> str:
    """Return the template body for `version`, with the YAML frontmatter stripped."""
    if version not in SUPPORTED_VERSIONS:
        raise ValueError(
            f"unsupported spawn prompt version {version!r}; "
            f"want one of {SUPPORTED_VERSIONS}"
        )
    name = "spawn_prompt_v2.md" if version == "v2" else "spawn_prompt_v1.md.archived"
    body = (_templates_dir() / name).read_text(encoding="utf-8")
    return _FRONTMATTER_RE.sub("", body, count=1)


def load_output_schema() -> dict[str, Any]:
    p = _templates_dir() / "spawn_output_schema.v2.json"
    return json.loads(p.read_text(encoding="utf-8"))


def resolve_version() -> str:
    v = os.environ.get("SPAWN_PROMPT_VERSION", DEFAULT_VERSION).strip().lower()
    return v if v in SUPPORTED_VERSIONS else DEFAULT_VERSION


def _block(items: list[str], *, empty: str = "(none)") -> str:
    if not items:
        return f"  {empty}"
    return "\n".join(f"  - {x}" for x in items)


def _format_ac_block(acs: list[Any]) -> str:
    if not acs:
        return "  (none — verifier will fail-spec)"
    lines: list[str] = []
    for i, ac in enumerate(acs, start=1):
        if isinstance(ac, dict):
            text = ac.get("text") or ac.get("ac") or json.dumps(ac, sort_keys=True)
        else:
            text = str(ac)
        lines.append(f"  {i}. {text}")
    return "\n".join(lines)


def _format_files_block(files: list[Any]) -> str:
    if not files:
        return "  (none — implementor may produce zero-diff and self-cert ok=false)"
    return "\n".join(f"  - {f}" for f in files)


def _format_tests_block(tests: list[Any]) -> str:
    if not tests:
        return "  (none required by spec)"
    lines: list[str] = []
    for t in tests:
        if isinstance(t, dict):
            name = t.get("name") or t.get("path") or json.dumps(t, sort_keys=True)
            kind = t.get("kind") or t.get("type") or "test"
            lines.append(f"  - [{kind}] {name}")
        else:
            lines.append(f"  - {t}")
    return "\n".join(lines)


def _format_dod_block(stages: list[Any]) -> str:
    if not stages:
        return "  (none — falls back to [Implement, Unit-test])"
    return "\n".join(f"  - {s}" for s in stages)


def _format_must_read(refs: list[Any]) -> str:
    if not refs:
        return "  (none — DO NOT load any file unless the AC explicitly says so)"
    return "\n".join(f"  - {r}" for r in refs)


def _schema_block() -> str:
    schema = load_output_schema()
    pretty = json.dumps(schema, indent=2, sort_keys=False)
    return pretty


def build_prompt_v2(
    task_spec: dict[str, Any],
    *,
    spawn_id: str,
    permission_mode: str,
    cwd: str,
    branch: str,
    risk_tier: str | None,
    spawned_by_trailer: str,
) -> str:
    """Fill the v2 template from a UDP-enriched task_spec.

    task_spec is the node payload the slot-manager hands to the spawner;
    its `prompt_material` substructure is what B14.A-K / UDP populate.
    Reads (with safe fallbacks; never raises on missing fields):
      task_spec.id | title | item_code | scope_tag | target_bucket
      task_spec.prompt_material.{acceptance_criteria, file_scope,
                                 package_scope_negative, tests_required,
                                 tech_context, architectural_constraints,
                                 dod_required_stages, must_read_first,
                                 work_directive, parent_context}
    """
    tmpl = load_template("v2")
    pm = task_spec.get("prompt_material", {}) or {}

    title = task_spec.get("title", "<no title>")
    work_directive = (
        pm.get("work_directive")
        or task_spec.get("work_directive")
        or pm.get("description")
        or task_spec.get("description")
        or title
    )
    parent = pm.get("parent_context") or {}
    if not isinstance(parent, dict):
        parent = {}

    acs = pm.get("acceptance_criteria") or task_spec.get("acceptance_criteria") or []
    file_scope = pm.get("file_scope") or task_spec.get("file_scope") or []
    pkg_neg = pm.get("package_scope_negative") or []
    tests = pm.get("tests_required") or task_spec.get("tests_required") or []
    tech = pm.get("tech_context") or task_spec.get("tech_context") or []
    constraints = pm.get("architectural_constraints") or []
    stages = pm.get("dod_required_stages") or task_spec.get("dod_required_stages") or []
    must_read = pm.get("must_read_first") or []

    tests_filter_expr = pm.get("tests_filter_expr") or task_spec.get(
        "tests_filter_expr"
    ) or "<scope/path glob>"

    subs = {
        "{spawn_id}": spawn_id,
        "{permission_mode}": permission_mode,
        "{risk_tier}": risk_tier or "low",
        "{cwd}": cwd,
        "{branch}": branch,
        "{node_id}": str(task_spec.get("id", "<unknown>")),
        "{item_code}": str(pm.get("item_code") or task_spec.get("item_code") or "?"),
        "{scope_tag}": str(pm.get("scope_tag") or task_spec.get("scope_tag") or "?"),
        "{target_bucket}": str(
            task_spec.get("target_bucket")
            or task_spec.get("resolved_bucket")
            or "<no bucket>"
        ),
        "{title}": title,
        "{parent_context_title}": str(parent.get("title") or "(root)"),
        "{parent_context_scope}": str(parent.get("scope") or "?"),
        "{work_directive}": work_directive,
        "{acceptance_criteria_block}": _format_ac_block(acs),
        "{file_scope_block}": _format_files_block(file_scope),
        "{package_scope_negative_list}": ", ".join(str(x) for x in pkg_neg) or "(none)",
        "{tests_required_block}": _format_tests_block(tests),
        "{tests_filter_expr}": tests_filter_expr,
        "{tech_context_block}": _block(
            [str(x) for x in tech], empty="(no EA tech_context resolved)"
        ),
        "{architectural_constraints_block}": _block(
            [str(x) for x in constraints], empty="(none declared)"
        ),
        "{dod_required_stages_block}": _format_dod_block(stages),
        "{must_read_first_block}": _format_must_read(must_read),
        "{SPAWNED_BY_TRAILER}": spawned_by_trailer,
        "{json_schema_block}": _schema_block(),
    }

    out = tmpl
    for k, v in subs.items():
        out = out.replace(k, v)
    return out


def build_prompt_v1(
    task_spec: dict[str, Any],
    *,
    spawn_id: str,
    permission_mode: str,
    cwd: str,
    branch: str,
    risk_tier: str | None,
    spawned_by_trailer: str,
) -> str:
    """Rollback path. Reproduces the v1 prompt byte-for-byte (modulo whitespace)
    from claude_spawner_agent.py:build_prompt_real_edit. Kept here so the
    loader-based wiring works in both versions and rollback is a single env flip.
    """
    pm = task_spec.get("prompt_material", {}) or {}
    nid = task_spec.get("id", "<unknown>")
    title = task_spec.get("title", "<no title>")
    bucket = (
        task_spec.get("target_bucket")
        or task_spec.get("resolved_bucket")
        or "<no bucket>"
    )
    refs = pm.get("must_read_first") or []
    work = (
        pm.get("work_directive")
        or task_spec.get("work_directive")
        or pm.get("description")
        or task_spec.get("description")
        or title
    )
    scope = pm.get("scope_tag") or task_spec.get("scope_tag") or "?"
    item = pm.get("item_code") or task_spec.get("item_code") or "?"
    files = pm.get("file_scope") or task_spec.get("file_scope")

    refs_block = "\n".join(f"- {r}" for r in refs) if refs else "(none provided)"
    files_block = (
        f"\nFile scope (only edit these unless absolutely necessary):\n  {files}\n"
        if files
        else ""
    )
    return (
        "You are spawned by the slot-manager autonomous loop in REAL-EDIT mode.\n"
        f"  permission_mode : {permission_mode}\n"
        f"  risk_tier       : {risk_tier or 'low'}\n"
        f"  spawn_id        : {spawn_id}\n"
        f"  working dir     : {cwd}\n"
        f"  branch          : {branch} (already checked out for you)\n"
        "\n"
        "TASK:\n"
        f"  id        : {nid}\n"
        f"  item_code : {item}\n"
        f"  scope_tag : {scope}\n"
        f"  bucket    : {bucket}\n"
        f"  title     : {title}\n"
        f"  directive : {work}\n"
        f"{files_block}"
        "\n"
        "Must-read-first refs:\n"
        f"{refs_block}\n"
        "\n"
        "RULES:\n"
        f"1. Stay inside {cwd}. Do not edit files outside this tree.\n"
        f"2. Commit in small, focused chunks. Every commit message MUST include the footer\n"
        f"   `{spawned_by_trailer}` (it can be the only line if needed). The spawner appends\n"
        f"   it for you if you forget, but your messages are clearer if you include it.\n"
        "3. Do NOT push, do NOT open PRs, do NOT touch git remotes. The spawner handles\n"
        "   push + PR + auto-merge after you exit.\n"
        "4. If the directive is impossible or already done, leave the branch unchanged\n"
        "   and exit with a brief explanation. Empty branches will not produce a PR.\n"
        "5. When done, output ONE final compact line of JSON to summarise:\n"
        '   {"ok": true, "task_id": "<id>", "files_touched": <int>, "commits_made": <int>, "summary": "<one-line>"}\n'
        "\n"
        "Begin."
    )


def build_prompt(version: str | None, task_spec: dict[str, Any], **kwargs: Any) -> str:
    """Dispatch entry point. `version=None` honors SPAWN_PROMPT_VERSION env."""
    v = (version or resolve_version()).strip().lower()
    if v == "v1":
        return build_prompt_v1(task_spec, **kwargs)
    return build_prompt_v2(task_spec, **kwargs)


# ─────────────────────────────────────────────────────────────────────────
# Schema validator — stdlib-only walk against load_output_schema().
# Covers: required keys, additionalProperties=false, type matching, enum,
# pattern, minLength/maxLength, minimum/maximum, items, anyOf.
# This is intentionally narrow to the v2 schema's shape; not a general
# JSON-Schema implementation.
# ─────────────────────────────────────────────────────────────────────────


def _type_ok(value: Any, t: str) -> bool:
    return (
        (t == "object" and isinstance(value, dict))
        or (t == "array" and isinstance(value, list))
        or (t == "string" and isinstance(value, str))
        or (t == "integer" and isinstance(value, int) and not isinstance(value, bool))
        or (
            t == "number"
            and isinstance(value, (int, float))
            and not isinstance(value, bool)
        )
        or (t == "boolean" and isinstance(value, bool))
        or (t == "null" and value is None)
    )


def _validate_node(value: Any, schema: dict[str, Any], path: str, errs: list[str]) -> None:
    if "anyOf" in schema:
        for sub in schema["anyOf"]:
            sub_errs: list[str] = []
            _validate_node(value, sub, path, sub_errs)
            if not sub_errs:
                return
        errs.append(f"{path}: did not match any of anyOf")
        return

    if "enum" in schema:
        if value not in schema["enum"]:
            errs.append(f"{path}: value {value!r} not in enum {schema['enum']}")
        return

    if "type" in schema:
        t = schema["type"]
        if not _type_ok(value, t):
            errs.append(f"{path}: expected type={t}, got {type(value).__name__}")
            return

        if t == "string":
            if "minLength" in schema and len(value) < schema["minLength"]:
                errs.append(f"{path}: minLength {schema['minLength']} violated")
            if "maxLength" in schema and len(value) > schema["maxLength"]:
                errs.append(f"{path}: maxLength {schema['maxLength']} violated")
            if "pattern" in schema and not re.search(schema["pattern"], value):
                errs.append(f"{path}: pattern {schema['pattern']} violated")

        elif t == "integer" or t == "number":
            if "minimum" in schema and value < schema["minimum"]:
                errs.append(f"{path}: minimum {schema['minimum']} violated")
            if "maximum" in schema and value > schema["maximum"]:
                errs.append(f"{path}: maximum {schema['maximum']} violated")

        elif t == "array":
            item_schema = schema.get("items")
            if item_schema is not None:
                for i, v in enumerate(value):
                    _validate_node(v, item_schema, f"{path}[{i}]", errs)

        elif t == "object":
            required = schema.get("required") or []
            for r in required:
                if r not in value:
                    errs.append(f"{path}.{r}: missing required field")
            props = schema.get("properties") or {}
            extra_allowed = schema.get("additionalProperties", True)
            for k, v in value.items():
                if k in props:
                    _validate_node(v, props[k], f"{path}.{k}", errs)
                else:
                    if extra_allowed is False:
                        errs.append(f"{path}.{k}: additionalProperties not allowed")
                    elif isinstance(extra_allowed, dict):
                        _validate_node(v, extra_allowed, f"{path}.{k}", errs)


def validate_spawn_output(parsed: Any) -> tuple[bool, list[str]]:
    """Validate a parsed spawn-output dict against the v2 schema.

    Returns (is_valid, error_list). The spawner uses this to decide between
    outcome='implementor-claimed' (schema-conformant + ok=true) and
    outcome='spawner_error' (schema violation).
    """
    schema = load_output_schema()
    errs: list[str] = []
    _validate_node(parsed, schema, "$", errs)
    return (len(errs) == 0, errs)
