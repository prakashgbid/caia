# SF-104 Defect Triage Factory

Small LLM-classifier factory (~150 LOC). Takes any Failure artifact from
upstream factories and outputs a `DefectClassification` with severity,
owning factory, and required remediation. Emits
`caia.factory.requires_rework` so the executor daemon (STOL-906) can loop.

## Contract
- **Input:** `FailureArtifact { source_factory, failure_type, payload }`
- **Output:** `DefectClassification { severity, owning_factory, required_remediation, rationale, confidence }`
- **Event:** `caia.factory.requires_rework` with routing metadata

## Reuse
- LLM via **LiteLLM proxy** (Kernel-5) — model `deepseek-r1-free` on OpenRouter
- $0 recurring per [[ci-cost-elimination-direction]]
- Event bus: Kafka (Kernel-2)

## Env
- `LITELLM_URL` (default `http://litellm:4000`)
- `LITELLM_KEY` (proxy auth)
- `CAIA_TRIAGE_MODEL` (default `deepseek-r1-free`)
- `CAIA_REWORK_TOPIC` (default `caia.factory.requires_rework`)

## Safe defaults
When the LLM returns unparseable output, classification defaults to:
- severity=`major`, owner=`human_review`, remediation=`escalate`, confidence=`0.0`.
Never silently drops a failure.
