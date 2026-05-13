"""B15.C fixture test — verify that:
  1. The v2 template renders all four contract sections (AC, file_scope,
     tests, DoD) from a UDP-shaped task_spec.
  2. A "tiny fixture task" (add a comment to file X) flowing through the
     loader produces a prompt containing the expected directive + file scope.
  3. A simulated spawn final-JSON output validates against the strict v2
     schema (positive case + multiple negative cases).
  4. SPAWN_PROMPT_VERSION env override actually selects the v1 prompt for
     rollback (no AC block, no schema block).

Pure stdlib (unittest). No pytest, no jsonschema. Run with:
    python3 -m unittest tests/test_spawn_prompt_v2.py -v
or
    python3 tests/test_spawn_prompt_v2.py
"""
from __future__ import annotations

import json
import os
import pathlib
import sys
import unittest

# Allow `python3 tests/test_spawn_prompt_v2.py` from package root.
_PKG_ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_PKG_ROOT / "src"))

from spawn_prompt_loader import (  # noqa: E402
    build_prompt,
    build_prompt_v1,
    build_prompt_v2,
    load_output_schema,
    load_template,
    resolve_version,
    validate_spawn_output,
)


TINY_FIXTURE_TASK = {
    "id": "B15.C.fixture.001",
    "title": "Add a license-header comment to packages/foo/src/index.ts",
    "item_code": "FIX-1",
    "scope_tag": "[scope:1]",
    "target_bucket": "stolution-claude",
    "prompt_material": {
        "work_directive": "Insert `// SPDX-License-Identifier: MIT` as the first line of the file.",
        "parent_context": {"title": "License hygiene sweep", "scope": "2"},
        "acceptance_criteria": [
            "Given the repo at HEAD When the file is opened Then line 1 is the SPDX header.",
            "Given the build is run When tsc compiles the file Then it emits zero errors.",
        ],
        "file_scope": ["packages/foo/src/index.ts"],
        "package_scope_negative": ["packages/foo/src/internal/**"],
        "tests_required": [
            {"name": "license-header.spec.ts", "kind": "unit"},
        ],
        "tech_context": ["TypeScript 5.5, ESM, vitest"],
        "architectural_constraints": ["No new dependencies"],
        "dod_required_stages": ["Implement", "Unit-test"],
        "must_read_first": [],
        "tests_filter_expr": "packages/foo",
    },
}


def _valid_output_for(task_id: str, spawn_id: str) -> dict:
    """A minimal v2-schema-conformant spawn-output blob."""
    return {
        "ok": True,
        "task_id": task_id,
        "spawn_id": spawn_id,
        "files_touched": [
            {"path": "packages/foo/src/index.ts", "additions": 1, "deletions": 0}
        ],
        "extra_files_touched": [],
        "commits_made": [
            {"sha": "abc1234", "message_subject": "feat(foo): add SPDX header"}
        ],
        "commit_hashes": ["abc1234"],
        "acceptance_criteria_self_cert": [
            {
                "ac": "Given the repo at HEAD When the file is opened Then line 1 is the SPDX header.",
                "self_status": "met",
                "evidence": "packages/foo/src/index.ts:1",
            },
            {
                "ac": "Given the build is run When tsc compiles the file Then it emits zero errors.",
                "self_status": "met",
                "evidence": "tsc output: 0 errors",
            },
        ],
        "acceptance_criteria_met": [True, True],
        "file_scope_honored": True,
        "tests_added": [],
        "tests_passing": True,
        "tests_required_self_cert": [
            {
                "test": "license-header.spec.ts",
                "self_status": "passing",
                "evidence": "vitest: 1 passed",
            }
        ],
        "dod_self_cert": [
            {"stage": "Implement", "self_status": "done", "evidence": "abc1234"},
            {
                "stage": "Unit-test",
                "self_status": "done",
                "evidence": "vitest: 1 passed",
            },
        ],
        "definition_of_done": {"Implement": "done", "Unit-test": "done"},
        "ready_for_verifier": True,
        "reason_class": None,
        "reason_evidence": "",
        "summary": "Added SPDX header; 1 test passing.",
    }


class TestTemplateLoading(unittest.TestCase):
    def test_v2_template_loads_with_frontmatter_stripped(self) -> None:
        body = load_template("v2")
        self.assertFalse(body.startswith("---"), "frontmatter should be stripped")
        self.assertIn("ACCEPTANCE CRITERIA", body)
        self.assertIn("FILE SCOPE", body)
        self.assertIn("TESTS REQUIRED", body)
        self.assertIn("DOD STAGES REQUIRED", body)
        self.assertIn("REQUIRED FINAL OUTPUT", body)
        # No leftover placeholders that v2-only template should keep
        self.assertIn("{acceptance_criteria_block}", body)
        self.assertIn("{json_schema_block}", body)

    def test_v1_archived_template_loads(self) -> None:
        body = load_template("v1")
        # v1 had the title-as-directive shape; sanity-check the headers
        self.assertIn("REAL-EDIT mode", body)
        self.assertIn("Must-read-first refs", body)

    def test_unsupported_version_raises(self) -> None:
        with self.assertRaises(ValueError):
            load_template("v99")


class TestPromptRendering(unittest.TestCase):
    def test_v2_renders_all_four_contract_sections(self) -> None:
        out = build_prompt_v2(
            TINY_FIXTURE_TASK,
            spawn_id="spawn-test-001",
            permission_mode="bypassPermissions",
            cwd="/tmp/wt",
            branch="auto/b15c-fixture-spawn-test",
            risk_tier="low",
            spawned_by_trailer="Spawned-By: claude-spawner-agent",
        )
        # AC section populated from prompt_material.acceptance_criteria[]
        self.assertIn("ACCEPTANCE CRITERIA", out)
        self.assertIn("1. Given the repo at HEAD", out)
        self.assertIn("2. Given the build is run", out)
        # File scope binding
        self.assertIn("FILE SCOPE", out)
        self.assertIn("packages/foo/src/index.ts", out)
        # Negative scope
        self.assertIn("packages/foo/src/internal/**", out)
        # Tests required
        self.assertIn("TESTS REQUIRED", out)
        self.assertIn("license-header.spec.ts", out)
        # DoD stages
        self.assertIn("DOD STAGES REQUIRED", out)
        self.assertIn("Implement", out)
        self.assertIn("Unit-test", out)
        # JSON schema is inlined verbatim
        self.assertIn("REQUIRED FINAL OUTPUT", out)
        self.assertIn("\"acceptance_criteria_self_cert\"", out)
        self.assertIn("\"dod_self_cert\"", out)
        # No must_read_first leak (the fixture has none — verify the
        # "DO NOT load any file" guard rendered, not a stale ref list)
        self.assertIn("DO NOT load any file unless the AC explicitly says so", out)
        # No unsubstituted placeholders left
        for ph in (
            "{spawn_id}",
            "{node_id}",
            "{acceptance_criteria_block}",
            "{file_scope_block}",
            "{tests_required_block}",
            "{dod_required_stages_block}",
            "{json_schema_block}",
        ):
            self.assertNotIn(ph, out, f"placeholder {ph} not substituted")

    def test_v1_rendering_path_is_legacy(self) -> None:
        out = build_prompt_v1(
            TINY_FIXTURE_TASK,
            spawn_id="spawn-test-001",
            permission_mode="bypassPermissions",
            cwd="/tmp/wt",
            branch="auto/b15c-fixture",
            risk_tier="low",
            spawned_by_trailer="Spawned-By: claude-spawner-agent",
        )
        # v1 lacks the structured headers
        self.assertNotIn("ACCEPTANCE CRITERIA", out)
        self.assertNotIn("DOD STAGES REQUIRED", out)
        # v1 has the one-line JSON ack instead of the full schema
        self.assertIn("ONE final compact line of JSON", out)
        self.assertNotIn("acceptance_criteria_self_cert", out)

    def test_dispatcher_honours_env_override(self) -> None:
        old = os.environ.get("SPAWN_PROMPT_VERSION")
        try:
            os.environ["SPAWN_PROMPT_VERSION"] = "v1"
            self.assertEqual(resolve_version(), "v1")
            out = build_prompt(
                None,  # honors env
                TINY_FIXTURE_TASK,
                spawn_id="s",
                permission_mode="bypassPermissions",
                cwd="/tmp/wt",
                branch="auto/b15c-fixture",
                risk_tier="low",
                spawned_by_trailer="t",
            )
            self.assertNotIn("ACCEPTANCE CRITERIA", out, "v1 path should not emit AC header")

            os.environ["SPAWN_PROMPT_VERSION"] = "v2"
            self.assertEqual(resolve_version(), "v2")
            out = build_prompt(
                None,
                TINY_FIXTURE_TASK,
                spawn_id="s",
                permission_mode="bypassPermissions",
                cwd="/tmp/wt",
                branch="auto/b15c-fixture",
                risk_tier="low",
                spawned_by_trailer="t",
            )
            self.assertIn("ACCEPTANCE CRITERIA", out, "v2 path must emit AC header")
        finally:
            if old is None:
                os.environ.pop("SPAWN_PROMPT_VERSION", None)
            else:
                os.environ["SPAWN_PROMPT_VERSION"] = old

    def test_garbage_version_falls_back_to_v2(self) -> None:
        old = os.environ.get("SPAWN_PROMPT_VERSION")
        try:
            os.environ["SPAWN_PROMPT_VERSION"] = "vBogus"
            self.assertEqual(resolve_version(), "v2")
        finally:
            if old is None:
                os.environ.pop("SPAWN_PROMPT_VERSION", None)
            else:
                os.environ["SPAWN_PROMPT_VERSION"] = old


class TestOutputSchemaValidation(unittest.TestCase):
    def test_minimal_valid_output_passes(self) -> None:
        out = _valid_output_for("B15.C.fixture.001", "spawn-test-001")
        ok, errs = validate_spawn_output(out)
        self.assertTrue(ok, msg=f"unexpected errors: {errs}")
        self.assertEqual(errs, [])

    def test_missing_required_field_rejected(self) -> None:
        out = _valid_output_for("B15.C.fixture.001", "spawn-test-001")
        del out["dod_self_cert"]
        ok, errs = validate_spawn_output(out)
        self.assertFalse(ok)
        self.assertTrue(any("dod_self_cert" in e and "missing" in e for e in errs), errs)

    def test_unknown_top_level_field_rejected(self) -> None:
        out = _valid_output_for("B15.C.fixture.001", "spawn-test-001")
        out["i_just_made_this_up"] = "lol"
        ok, errs = validate_spawn_output(out)
        self.assertFalse(ok)
        self.assertTrue(
            any("additionalProperties not allowed" in e for e in errs), errs
        )

    def test_bad_enum_value_rejected(self) -> None:
        out = _valid_output_for("B15.C.fixture.001", "spawn-test-001")
        out["acceptance_criteria_self_cert"][0]["self_status"] = "ish"
        ok, errs = validate_spawn_output(out)
        self.assertFalse(ok)
        self.assertTrue(any("enum" in e for e in errs), errs)

    def test_bad_commit_sha_pattern_rejected(self) -> None:
        out = _valid_output_for("B15.C.fixture.001", "spawn-test-001")
        out["commits_made"][0]["sha"] = "NOT-A-SHA"
        ok, errs = validate_spawn_output(out)
        self.assertFalse(ok)
        self.assertTrue(any("pattern" in e for e in errs), errs)

    def test_bool_for_integer_rejected(self) -> None:
        out = _valid_output_for("B15.C.fixture.001", "spawn-test-001")
        out["files_touched"][0]["additions"] = True  # bool, not int
        ok, errs = validate_spawn_output(out)
        self.assertFalse(ok)
        self.assertTrue(any("expected type=integer" in e for e in errs), errs)

    def test_dod_stage_enum_rejected(self) -> None:
        out = _valid_output_for("B15.C.fixture.001", "spawn-test-001")
        out["dod_self_cert"][0]["stage"] = "Vibes"
        ok, errs = validate_spawn_output(out)
        self.assertFalse(ok)
        self.assertTrue(any("enum" in e for e in errs), errs)

    def test_reason_class_null_accepted(self) -> None:
        out = _valid_output_for("B15.C.fixture.001", "spawn-test-001")
        out["reason_class"] = None
        ok, errs = validate_spawn_output(out)
        self.assertTrue(ok, errs)

    def test_reason_class_typed_accepted(self) -> None:
        out = _valid_output_for("B15.C.fixture.001", "spawn-test-001")
        out["ok"] = False
        out["reason_class"] = "code/uncompletable"
        out["reason_evidence"] = "directive ambiguous: no AC for stage X"
        ok, errs = validate_spawn_output(out)
        self.assertTrue(ok, errs)


class TestFixtureTaskFullCycle(unittest.TestCase):
    """End-to-end: tiny fixture task → render prompt → simulate spawn
    output → assert schema conformance. This is the deliverable test
    called out in the B15.C task: "spawn a tiny fixture task (e.g. 'add
    a comment to file X') and assert the spawn output validates against
    the strict JSON schema." We simulate the spawn (don't shell out to
    `claude --print`) so the test is hermetic and fast.
    """

    def test_full_cycle(self) -> None:
        rendered = build_prompt_v2(
            TINY_FIXTURE_TASK,
            spawn_id="spawn-fixture-b15c",
            permission_mode="bypassPermissions",
            cwd="/tmp/wt",
            branch="auto/b15c-fixture",
            risk_tier="low",
            spawned_by_trailer="Spawned-By: claude-spawner-agent",
        )
        # Render check (prompt is well-formed)
        self.assertGreater(len(rendered), 1000)
        self.assertIn("\"acceptance_criteria_self_cert\"", rendered)

        # Simulated spawn output — a well-behaved implementor would emit
        # exactly this as its final stdout line.
        simulated = _valid_output_for("B15.C.fixture.001", "spawn-fixture-b15c")
        as_line = json.dumps(simulated, separators=(",", ":"))
        # Spawner-side: tail-parse the JSON line, validate, decide outcome.
        parsed = json.loads(as_line)
        ok, errs = validate_spawn_output(parsed)
        self.assertTrue(ok, msg=f"validator errors on fixture: {errs}")

        # And the gate logic the spawner will apply:
        self.assertTrue(parsed["ok"])
        self.assertTrue(parsed["ready_for_verifier"])
        self.assertTrue(parsed["commits_made"], "implementor must report commits")
        # → outcome would be 'implementor-claimed' per spawner_patch_v3.diff


class TestSchemaLoadable(unittest.TestCase):
    def test_schema_is_valid_json(self) -> None:
        s = load_output_schema()
        self.assertEqual(s.get("$schema"), "https://json-schema.org/draft/2020-12/schema")
        self.assertIn("acceptance_criteria_self_cert", s["properties"])
        self.assertIn("dod_self_cert", s["properties"])
        self.assertIn("commit_hashes", s["properties"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
