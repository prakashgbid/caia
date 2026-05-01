"""
Smoke test for the bridge's Python side. Run with:

    pnpm --filter @chiefaia/dspy-bridge run py:smoke

Boots dspy + the OllamaLM, exercises a one-shot Predict on
po-scope-detector, and prints the verdict. Requires Ollama running
locally with qwen2.5-coder:7b pulled.
"""

from __future__ import annotations

import sys

from caia_dspy_bridge.lm import OllamaLM, OllamaUnreachable
from caia_dspy_bridge.programs import get_program


def main() -> int:
    lm = OllamaLM()
    print(f"→ smoke: dialing {lm.host} (model={lm.model})", file=sys.stderr)
    try:
        out = lm("ping")
    except OllamaUnreachable as exc:
        print(f"✗ ollama unreachable: {exc}", file=sys.stderr)
        print("  start it with `ollama serve` then `ollama pull qwen2.5-coder:7b`", file=sys.stderr)
        return 2
    print(f"✓ ollama replied {len(out[0])} chars", file=sys.stderr)

    import dspy

    dspy.configure(lm=lm)
    prog = get_program("po-scope-detector")
    module = prog.build_module()
    pred = module(prompt_text="add a logout button to the user-menu dropdown")
    print("→ predict result:")
    print(prog.from_prediction(pred))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
