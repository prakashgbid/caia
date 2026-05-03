# Architectural Detail Rubric — per-scope content expectations for EA instructions

*Status: normative. Authored 2026-04-30 as PR13 of the EA Expansion release.*
*References: `ea-multi-domain-architecture-proposal-2026-04-29.md`, `ARCH-006`,
`@chiefaia/ticket-template` `ArchitecturalInstructionV2Schema`.*

---

## 1. Why this rubric exists

The EA Agent now decomposes a single ticket into per-domain instructions
across six macro-categories. The same code path runs at every scope —
initiative, epic, module, story, task, subtask — and a recurring failure
mode is **content-level mis-scoping**: a story-scope instruction that
either (a) repeats the parent module's strategic narrative or (b) drops
to character-level code edits that belong on a subtask.

This document is the canonical answer to *"what content belongs in an
architectural instruction at this scope, and what does not."* It is the
content-level counterpart to the structural shape enforced by
`ArchitecturalInstructionV2Schema` and the validation rubric driven by
`agent-contract-registry`.

The rubric is enforced two ways:

1. **Specialist preambles** (PR14) — every domain specialist's system
   prompt embeds the scope-specific row of the table below plus three
   examples and three counter-examples.
2. **Coverage Judge** (PR1, §6.G) — given the parent's instructions
   alongside the child's, the judge enforces the no-overlap rule from
   PR15: the child must **elaborate** at lower abstraction, not
   recapitulate.

A child that recapitulates the parent's content is judge-rejected
with a structured `overlap` violation; a child that emits content
above its own scope band is judge-rejected with `scope_too_high`.

---

## 2. The rubric

| Scope          | Time          | Touchpoints | What architectural content belongs                                                                                                                                                                  | What does NOT belong                                              |
| -------------- | ------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **Initiative** | weeks-months  | 80-150      | Vision; strategic arch decisions; foundational tech stack; high-level module decomposition; corporate-risk register; success metrics                                                                | File paths, function signatures, CSS variables, API field names, individual props |
| **Epic**       | weeks         | 50-100      | Module-to-module integration patterns; shared contracts; data flow between modules; cross-module observability + security boundaries                                                                | Individual component implementations, specific CSS tokens         |
| **Module**     | days-weeks    | 30-60       | Bounded-context architecture; module-internal API design; module data model; module-internal observability; component composition pattern                                                           | Line-level code, individual prop names                            |
| **Story**      | hours-days    | 10-25       | File paths to create/modify; TypeScript interfaces; React component structure; API endpoint spec; DB schema additions; specific test cases                                                          | Individual lines of code, character-level changes                 |
| **Task**       | hours         | 3-8         | Concrete code changes; specific UI elements; specific API field additions; specific test assertions                                                                                                 | High-level reasoning about why                                    |
| **Subtask**    | minutes-hours | 1-3         | Single atomic change                                                                                                                                                                                | Anything requiring more than a few lines                          |

Touchpoint counts are **operational hints** (the EA decomposer's
expected target for `architecturalInstructions[].length` aggregated
across all six macros), not hard caps. The Coverage Judge tolerates a
plus-or-minus 50% deviation; outside that band it surfaces a
`scope_drift` warning.

---

## 3. Reference-don't-duplicate convention

The rubric introduces a **referencing discipline** so children can
cite parents without copying them:

- A story-scope instruction MAY include the field
  `referencedAncestorInstructionIds: string[]` populated with the
  parent module's instruction `id`s where the parent already
  established a pattern. The child then writes only the *delta* that
  story-scope work adds.
- The `details` field of a child instruction MUST NOT repeat a
  paragraph that already exists verbatim in any
  `referencedAncestorInstructionIds[*].details`. The Coverage Judge
  computes a normalized cosine similarity between the child's
  `details` and the union of the parent details, and any block
  scoring at or above 0.85 cosine is flagged `overlap`.
- The child MUST add at least one of: (a) lower-scope artifact spec
  (file path, schema, prop, etc.); (b) a refinement to a parent
  pattern; (c) a story-specific test hook. A child that adds none of
  these is judge-rejected with `no_elaboration`.

This is the same convention the C4 model uses between its Container
and Component layers — each zoom level adds detail, never repeats the
prior layer's narrative. The implementation lives in
`apps/orchestrator/src/agents/coverage-judge.ts` (PR1), specifically
the `assertScopeFit` and `assertNoOverlap` helpers wired into the
Stage-3 loop.

---

## 4. Mapping rubric rows onto V2 instruction fields

Each rubric row corresponds to a **content density profile** on
`ArchitecturalInstructionV2Schema`. The shape stays the same; the
expected fill rate of each field changes.

| Field on `ArchitecturalInstructionV2`          | Initiative | Epic | Module | Story | Task | Subtask |
| ---------------------------------------------- | :--------: | :--: | :----: | :---: | :--: | :-----: |
| `summary`                                      | always     | always | always | always | always | always |
| `details`                                      | strategic  | integration | bounded-context | file-level | code-level | atomic |
| `existingArtifactReferences[]`                 | rare       | sometimes | often  | often | often | sometimes |
| `newArtifactSpecs[]`                           | empty      | rare | sometimes | often | often | rare    |
| `newArtifactSpecs[*].proposedPath`             | empty      | empty | rare   | required-when-create | required-when-create | required-when-create |
| `newArtifactSpecs[*].proposedSignature`        | empty      | rare | sometimes | required-when-create | required-when-create | required-when-create |
| `integrationPoints[]`                          | rare       | often | often | often | sometimes | rare |
| `risks[]`                                      | strategic  | strategic | tactical | tactical | tactical | rare |
| `testHooks[]`                                  | rare       | rare | sometimes | required | required | sometimes |
| `crossCuttingConcerns[]`                       | meta-level | meta-level | always | always | always | rare |
| `candidateAdr`                                 | strategic  | strategic | sometimes | rare | rare | never |
| `referencedAncestorInstructionIds[]` (PR13/15) | n/a        | n/a  | empty  | required-when-elaborating | required | required |

Legend: `rare` = expected on under 10% of instructions; `sometimes` = 10-50%;
`often` = 50-90%; `always` = 100%; `required-when-create` = required when
`action` is one of `{create, enhance}`.

The Coverage Judge's per-instruction actionability score (1-5) folds
this density profile into rubric (b): an instruction whose scope is
`story` but whose `newArtifactSpecs[*].proposedPath` is empty scores at
most 2/5 with a `missing_path_at_story_scope` reason.

---

## 5. Worked examples per scope

These are reference instructions used to seed the specialist preambles
in PR14. Each shows the same conceptual change (adding a "remember
me" checkbox to the sign-in flow) at one scope, illustrating what
content is in-scope and what would be out-of-scope.

### 5.1 Initiative (out of band — EA does not run at initiative)

EA does not produce instructions at the initiative scope. The
initiative's strategic narrative is captured by the PO Agent in the
prompt envelope; EA enters at the module scope and below.

### 5.2 Module — "auth module — session persistence"

```jsonc
{
  "techSubDomain": "auth",
  "action": "enhance",
  "summary": "Auth module gains optional persistent-session capability",
  "details": "Add a session persistence sub-capability to the auth module. The capability is opt-in per session via a flag returned by sign-in. Persistent sessions have a 30-day TTL with a 7-day rolling refresh; non-persistent retain the existing 24h hard expiry. The capability is implemented in the existing auth module bounded context; no cross-module surface is added. Observability: emit auth.session.persistent_issued and auth.session.persistent_refreshed metrics.",
  "newArtifactSpecs": [],
  "integrationPoints": [
    { "direction": "outbound", "protocol": "sql", "contract": "sessions table gains is_persistent + expires_at columns; see Data specialist instruction" }
  ],
  "crossCuttingConcerns": ["auth", "audit_log", "observability_metric"]
}
```
*In scope*: bounded-context level intent, integration to the data
plane, observability hook count.
*Out of scope at module*: file paths, the new column types, the React
checkbox prop name.

### 5.3 Story — "sign-in form: 'remember me' checkbox"

```jsonc
{
  "techSubDomain": "frontend",
  "action": "enhance",
  "summary": "Add 'remember me' checkbox to SignInForm; wire to is_persistent",
  "details": "Add a controlled checkbox to apps/dashboard/components/auth/SignInForm.tsx. The checkbox label is 'Keep me signed in for 30 days' (i18n key auth.remember_me). On submit, include is_persistent: boolean in the POST /api/auth/sign-in body per the contract added by the Backend specialist's matching instruction. The default state is false. Persist the user's last-used value in localStorage under caia.auth.remember_me_default.",
  "referencedAncestorInstructionIds": ["arch_inst_auth_session_persistence_v1"],
  "newArtifactSpecs": [
    { "proposedKind": "component", "proposedName": "RememberMeCheckbox",
      "proposedPath": "apps/dashboard/components/auth/RememberMeCheckbox.tsx",
      "proposedSignature": "(props: { value: boolean; onChange: (v: boolean) => void }) => JSX.Element" }
  ],
  "integrationPoints": [
    { "direction": "outbound", "protocol": "http", "contract": "POST /api/auth/sign-in body adds is_persistent: boolean" }
  ],
  "testHooks": [
    { "kind": "unit", "target": "RememberMeCheckbox renders label + invokes onChange",
      "rationale": "controlled component contract" },
    { "kind": "integration", "target": "SignInForm submits is_persistent matching checkbox state",
      "rationale": "wire-up regression" },
    { "kind": "a11y", "target": "checkbox has visible label + keyboard-toggleable",
      "rationale": "WCAG 2.2 4.1.2" }
  ],
  "crossCuttingConcerns": ["a11y", "i18n"]
}
```
*In scope*: file path, component signature, props shape, label key,
integration delta, three test hooks.
*Out of scope*: the JSX implementation, the colors of the checkbox
focus ring (those belong on a task), the SQL column type (Data
specialist owns it).

### 5.4 Task — "wire RememberMeCheckbox into SignInForm"

```jsonc
{
  "techSubDomain": "frontend",
  "action": "enhance",
  "summary": "SignInForm: render RememberMeCheckbox and include is_persistent in submit payload",
  "details": "In SignInForm.tsx, add a useState<boolean>(false) for rememberMe initialised from localStorage; render <RememberMeCheckbox value={rememberMe} onChange={setRememberMe} /> below the password field; include is_persistent: rememberMe in the POST body; on success, write rememberMe to localStorage caia.auth.remember_me_default.",
  "referencedAncestorInstructionIds": ["arch_inst_remember_me_story"],
  "newArtifactSpecs": [],
  "integrationPoints": [],
  "testHooks": [
    { "kind": "integration", "target": "SignInForm: checkbox state appears in is_persistent on submit",
      "rationale": "exact-edit regression" }
  ]
}
```
*In scope*: the exact change to make in the existing file.
*Out of scope*: the strategic 'why', the bounded-context narrative.

### 5.5 Subtask — "default the rememberMe state from localStorage"

```jsonc
{
  "techSubDomain": "frontend",
  "action": "enhance",
  "summary": "Initialise rememberMe state from localStorage on mount",
  "details": "Replace `const [rememberMe, setRememberMe] = useState(false)` with `const [rememberMe, setRememberMe] = useState(() => localStorage.getItem('caia.auth.remember_me_default') === 'true')`.",
  "referencedAncestorInstructionIds": ["arch_inst_signin_wire_remember_me_task"]
}
```
*In scope*: a one-line edit.
*Out of scope*: anything else.

---

## 6. Counter-examples (anti-patterns)

The Coverage Judge rejects each of these; PR14 specialist preambles
embed them as "do not do this" exemplars.

### 6.1 Anti: story-scope instruction with module-scope content

```jsonc
{
  "techSubDomain": "auth",
  "action": "enhance",
  "summary": "Add 'remember me' checkbox to SignInForm",
  "details": "Auth module gains an optional persistent-session capability. The capability is opt-in per session via a flag returned by sign-in. Persistent sessions have a 30-day TTL with a 7-day rolling refresh ..."
}
```
**Rejected**: `details` is the module-scope strategic narrative, not
the story-scope file-path-level work. Judge code: `scope_too_high`.

### 6.2 Anti: module-scope instruction with task-scope content

```jsonc
{
  "techSubDomain": "auth",
  "action": "enhance",
  "summary": "Persistent sessions",
  "details": "Edit line 47 of SignInForm.tsx: replace `useState(false)` with `useState(() => localStorage.getItem('caia.auth.remember_me_default') === 'true')`."
}
```
**Rejected**: `details` is character-level code; module scope must
talk in bounded-context terms. Judge code: `scope_too_low`.

### 6.3 Anti: child duplicates parent verbatim

```jsonc
// Parent (module scope):
{ "id": "p", "details": "Auth module gains persistent-session capability ..." }
// Child (story scope):
{ "id": "c", "referencedAncestorInstructionIds": ["p"],
  "details": "Auth module gains persistent-session capability ... (the same paragraph)" }
```
**Rejected**: cosine similarity at or above 0.85 between child and
parent `details`. Judge code: `overlap`.

---

## 7. How the rubric gets enforced

The rubric is wired into the EA mesh via three coordinated PRs:

- **PR1** (`feat/ea-p1-001-coverage-judge`) ships `coverage-judge.ts`,
  which scores each instruction against the per-scope row of section 2
  and enforces the section 3 referencing convention.
- **PR14** (`feat/ea-scope-014-specialist-preambles`) embeds the
  section 5 worked examples and section 6 counter-examples directly
  into each domain specialist's system prompt template, so the
  specialist is steered toward the right content density before the
  judge sees its output.
- **PR15** (`feat/ea-scope-015-no-overlap-judge-rule`) extends the
  judge with parent-context awareness: the judge is given the parent
  scope's instructions as context and applies the section 3 cosine
  check.

The rubric is also referenced by the Story Validator (`VAL-###` track)
via the `agent-contract-registry` rubric source — a story whose EA
instructions don't satisfy the section 4 fill-rate matrix at the
story's declared scope is failed back to EA for re-decomposition
(capped at two retries per the Coverage Judge's existing budget).

---

## 8. Change log

- 2026-04-30 (PR13) — initial publication. The section 2 table and the
  section 4 density matrix are normative; section 5 / section 6 worked
  examples are illustrative and may be updated as the specialist
  preambles evolve in PR14.
