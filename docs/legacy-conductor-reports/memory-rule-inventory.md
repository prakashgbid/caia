# Memory Rule Inventory
Generated: 2026-04-22
Total rules: 357
Mechanically enforced: 42
Advisory: 67
Gap (needs new enforcement): 248

---

## Legend

| Column | Meaning |
|--------|---------|
| `rule_id` | Unique identifier for the rule |
| `memory_file` | Source memory/rule file the rule originates from |
| `rule_text` | The full rule statement |
| `current_enforcement` | What already exists in the codebase that enforces this rule |
| `enforcement_gap` | What is missing or incomplete |
| `proposed_mechanism` | The type of enforcement needed: `pre-commit-hook`, `build-runner-gate`, `eslint-rule`, `db-constraint`, `runtime-middleware`, `contract-test`, `daemon`, or `advisory` |
| `proposed_implementation` | One-line description of the concrete change needed |

---

## Enforcement Status Key

- **ENFORCED** — rule is actively blocked/checked by an existing automated mechanism
- **PARTIAL** — some enforcement exists but does not fully cover the rule
- **NONE** — no automated enforcement exists today
- **ADVISORY** — rule requires runtime AI judgment; mechanical enforcement is not feasible

---

## Rules by Memory File

### ACCESS — Accessibility Rules

| rule_id | memory_file | rule_text | current_enforcement | enforcement_gap | proposed_mechanism | proposed_implementation |
|---------|-------------|-----------|--------------------|-----------------|--------------------|------------------------|
| ACCESS-001 | memory/accessibility.md | WCAG 2.2 Level AA is the minimum standard on every page. | NONE | No axe-core or Lighthouse check in CI | build-runner-gate | Add `gate:a11y` step in build-runner.sh that runs axe-core via Playwright on all top-level routes |
| ACCESS-002 | memory/accessibility.md | Aim for WCAG 2.2 Level AAA where possible. | NONE | No AAA audit in CI | advisory | Document AAA targets in checklist; enforce AA mechanically (see ACCESS-001) |
| ACCESS-003 | memory/accessibility.md | Lighthouse Accessibility score must be ≥ 95 on every top-level route. | NONE | No Lighthouse CI step | build-runner-gate | Add Lighthouse CI step in `gate:a11y` that asserts score ≥ 95 per route |
| ACCESS-004 | memory/accessibility.md | Axe-core automated audit must report zero critical or serious violations per page. | NONE | No axe-core step in build-runner.sh | build-runner-gate | Run `@axe-core/playwright` in `gate:a11y`; fail if any critical/serious violation found |
| ACCESS-005 | memory/accessibility.md | Every page must have one h1 element. | NONE | No structural HTML check in CI | build-runner-gate | Add DOM assertion in Playwright a11y suite checking single h1 per page |
| ACCESS-006 | memory/accessibility.md | Every page must use semantic HTML with proper header/main/nav/footer/section tags. | NONE | No semantic HTML lint rule | eslint-rule | Add eslint-plugin-jsx-a11y rule requiring semantic structure; add to `gate:a11y` check |
| ACCESS-007 | memory/accessibility.md | Every interactive element must be reachable via Tab key and activatable via Enter/Space. | NONE | No keyboard-nav test in CI | contract-test | Add Playwright keyboard-nav test suite asserting tab/enter/space on all interactive elements |
| ACCESS-008 | memory/accessibility.md | Every page must have a skip-to-content link at the top. | NONE | No skip-link assertion in CI | build-runner-gate | Assert presence of `#skip-to-content` link in `gate:a11y` Playwright suite |
| ACCESS-009 | memory/accessibility.md | Every image must have alt text — descriptive when content, empty when decorative, never missing. | NONE | No alt-text lint or CI check | eslint-rule | Enable `jsx-a11y/alt-text` ESLint rule at error level |
| ACCESS-010 | memory/accessibility.md | All custom controls must have ARIA roles and labels. | NONE | No ARIA audit in CI | build-runner-gate | Covered by axe-core in `gate:a11y`; add specific aria-role/label checks |
| ACCESS-011 | memory/accessibility.md | Modals must have role="dialog" + aria-modal="true" + focus trap. | NONE | No modal ARIA check | eslint-rule | Add eslint-plugin-jsx-a11y dialog check; add Playwright focus-trap assertion |
| ACCESS-012 | memory/accessibility.md | Toggles must have aria-pressed attribute. | NONE | No aria-pressed lint | eslint-rule | Enable `jsx-a11y/aria-proptypes` ESLint rule to enforce aria-pressed on toggles |
| ACCESS-013 | memory/accessibility.md | Tabs must implement the full WAI-ARIA tab pattern. | NONE | No tab pattern contract test | contract-test | Add Playwright test asserting WAI-ARIA tablist/tab/tabpanel roles and keyboard navigation |
| ACCESS-014 | memory/accessibility.md | Color contrast must be minimum 4.5:1 for normal text, 3:1 for large text and UI components. | NONE | No contrast check in CI | build-runner-gate | Run color-contrast-checker in `gate:a11y`; fail on any below-threshold combination |
| ACCESS-015 | memory/accessibility.md | Contrast must be verified against both light and dark themes. | NONE | No multi-theme contrast check | build-runner-gate | Run `gate:a11y` contrast check with `data-theme=light` and `data-theme=dark` both |
| ACCESS-016 | memory/accessibility.md | Must respect prefers-reduced-motion — disable non-essential animations. | NONE | No reduced-motion media query check | eslint-rule | Add ESLint/stylelint rule requiring `prefers-reduced-motion` alternatives for all CSS animations |
| ACCESS-017 | memory/accessibility.md | Every input must have a label for or aria-label / aria-labelledby. | NONE | No label lint rule enforced | eslint-rule | Enable `jsx-a11y/label-has-associated-control` ESLint rule at error level |
| ACCESS-018 | memory/accessibility.md | Form errors must be announced via aria-live or role="alert". | NONE | No error-announcement test | contract-test | Add Playwright test asserting error messages appear in aria-live or role="alert" regions |
| ACCESS-019 | memory/accessibility.md | Videos must have captions or be decorative/muted with aria-hidden="true". | NONE | No video caption check | build-runner-gate | Add static analysis step scanning video elements for track[kind=captions] or aria-hidden |
| ACCESS-020 | memory/accessibility.md | Audio must have transcripts. | NONE | No audio transcript check | advisory | Document in PR checklist; no reliable static enforcement mechanism |
| ACCESS-021 | memory/accessibility.md | Game-state changes must use aria-live regions. | NONE | No game-state aria-live test | contract-test | Add Playwright test asserting game-state elements are wrapped in aria-live regions |
| ACCESS-022 | memory/accessibility.md | html lang="en" must be explicit. | NONE | No lang attribute check | eslint-rule | Add `jsx-a11y/html-has-lang` ESLint rule at error level |
| ACCESS-023 | memory/accessibility.md | Language switches are required for any non-English content. | NONE | No lang-switch check | advisory | Document in PR template; non-English content is rare; advisory until needed |
| ACCESS-024 | memory/accessibility.md | Layouts must function up to 200% browser zoom without horizontal scroll. | NONE | No zoom test in CI | contract-test | Add Playwright test setting viewport zoom to 200% and asserting no horizontal scrollbar |
| ACCESS-025 | memory/accessibility.md | Interactive elements must have minimum 44x44 CSS px touch target size. | NONE | No touch-target size check | build-runner-gate | Add Playwright assertion measuring bounding boxes of all interactive elements in `gate:a11y` |
| ACCESS-026 | memory/accessibility.md | Never rely on color alone for state cues — pair color with icon/text/pattern. | NONE | No color-only state check | advisory | Enforce via code-review checklist and POKE-007; no reliable static check |
| ACCESS-027 | memory/accessibility.md | Do not use placeholder as label. | NONE | No placeholder-as-label lint | eslint-rule | Enable `jsx-a11y/label-has-associated-control` and `jsx-a11y/no-placeholder-label` ESLint rules |
| ACCESS-028 | memory/accessibility.md | Hole cards in PokerZeno /play must be readable via keyboard. | NONE | No poker-specific keyboard test | contract-test | Add Playwright keyboard test for /play route asserting hole card accessibility |
| ACCESS-029 | memory/accessibility.md | PokerZeno action bar must be fully keyboard-operable. | NONE | No action-bar keyboard test | contract-test | Add Playwright keyboard navigation test targeting action bar buttons in /play |
| ACCESS-030 | memory/accessibility.md | Pot size, stack sizes, community cards must all be in aria-live regions. | NONE | No aria-live region assertion | contract-test | Add Playwright test asserting pot/stack/community card DOM nodes have aria-live attribute |
| ACCESS-031 | memory/accessibility.md | Voice callouts must be additive to screen reader, not a replacement. | NONE | No voice-callout isolation check | advisory | Enforce via code-review; voice callouts are not yet implemented |
| ACCESS-032 | memory/accessibility.md | Every bet zone in RouletteCommunity /play must be a real button with aria-label. | NONE | No bet-zone button check | contract-test | Add Playwright test asserting all bet zones are `<button>` elements with aria-label |
| ACCESS-033 | memory/accessibility.md | Wheel spin result must announce winning number via aria-live="assertive". | NONE | No spin-result announcement test | contract-test | Add Playwright test asserting spin-result element has aria-live="assertive" |
| ACCESS-034 | memory/accessibility.md | History column must be readable via screen reader and marked as role="log". | NONE | No history role="log" assertion | contract-test | Add Playwright test asserting history container has role="log" attribute |
| ACCESS-035 | memory/accessibility.md | Must run axe-core on every route via Playwright. Any violation fails CI. | NONE | No axe-core step in build-runner.sh | build-runner-gate | Add `gate:a11y` step in build-runner.sh that runs Playwright + axe-core across all routes |
| ACCESS-036 | memory/accessibility.md | Lighthouse a11y score must be measured on every deploy for each route. | NONE | No Lighthouse step in CI | build-runner-gate | Add Lighthouse CI node in `gate:a11y` step; report per-route score and fail below 95 |
| ACCESS-037 | memory/accessibility.md | Every spec.ts testing a user flow must assert no axe violations mid-flow. | NONE | No mid-flow axe assertion requirement | contract-test | Add ESLint rule or test-kit helper requiring `expectNoAxeViolations()` call in every user-flow spec |
| ACCESS-038 | memory/accessibility.md | Must have a Playwright test that uses only keyboard to complete the full flow. | NONE | No keyboard-only full-flow test | contract-test | Add `keyboard-flow.spec.ts` Playwright test that navigates entire flow without mouse |
| ACCESS-039 | memory/accessibility.md | Must have a Playwright test that reads aria-live regions at key events. | NONE | No aria-live region event test | contract-test | Add `aria-live.spec.ts` asserting aria-live regions receive correct announcements at key events |
| ACCESS-040 | memory/accessibility.md | Must run a build-time check for low-contrast text using color-contrast-checker. | NONE | No contrast-checker in build-runner.sh | build-runner-gate | Add color-contrast-checker CLI invocation in `gate:a11y` step |
| ACCESS-041 | memory/accessibility.md | Every code task touching UI must include an a11y check step in its plan. | NONE | No task-plan validation for a11y | runtime-middleware | Add MCP tool validation: tasks with `declared_files` matching UI paths must include a11y step keyword |
| ACCESS-042 | memory/accessibility.md | Every new component must include ARIA + keyboard support at creation time. | NONE | No component creation gating | advisory | Enforce via PR checklist; no reliable static check for "new component" detection |
| ACCESS-043 | memory/accessibility.md | Any theme change must re-verify contrast across both themes. | NONE | No theme-change-triggered contrast re-check | advisory | Enforce via POKE-007 lock and PR checklist; no automated theme-change detection |
| ACCESS-044 | memory/accessibility.md | Animations must have prefers-reduced-motion alternatives from day one. | NONE | No animation/motion lint | eslint-rule | Add stylelint rule requiring `@media (prefers-reduced-motion)` block for every animation |
| ACCESS-045 | memory/accessibility.md | A task that ships UI changes without a11y verification will be flagged as a defect. | NONE | No post-completion a11y verification hook | daemon | Add completeness sentinel check: if task touched UI files, verify a11y gate ran and passed |

---

### AWAY — Operational Orchestrator Tone Rules

| rule_id | memory_file | rule_text | current_enforcement | enforcement_gap | proposed_mechanism | proposed_implementation |
|---------|-------------|-----------|--------------------|-----------------|--------------------|------------------------|
| AWAY-001 | memory/away-mode.md | Never send chat messages to user unless production is actively burning. | NONE | No message-suppression filter in outbound path | runtime-middleware | Outbound message middleware checks severity; blocks non-critical SendUserMessage calls |
| AWAY-002 | memory/away-mode.md | All decisions must be made autonomously. | NONE | No enforcement; runtime AI judgment | advisory | Enforced by AUTON-001 to AUTON-012 scanner (see AUTON-010) |
| AWAY-003 | memory/away-mode.md | Do not make access requests. Assume every permission is granted. | NONE | No access-request filter | advisory | Claude Code settings.local.json wildcards serve as practical enforcement |
| AWAY-004 | memory/away-mode.md | All unresolved questions must be logged to conductor's questions table. | NONE | No questions-table write enforcement | runtime-middleware | Add MCP server middleware asserting question-shaped responses write to questions table |
| AWAY-005 | memory/away-mode.md | All real blockers must go to blockers table with enough context. | NONE | No blocker-table write enforcement | runtime-middleware | Add MCP server middleware asserting blocker-shaped responses write to blockers table |
| AWAY-006 | memory/away-mode.md | Heartbeat continues internally but do not post SendUserMessage on every heartbeat. | NONE | No heartbeat-message suppression | daemon | Heartbeat daemon filters outbound messages; only posts on anomaly |
| AWAY-007 | memory/away-mode.md | Factory stays on — executor daemon runs, completeness sentinel runs every 2h. | PARTIAL | Executor daemon exists; sentinel daemon referenced in completion-hook | Gap: no cron/launchd config verified | daemon | Verify and document launchd plist for sentinel at 2h cadence |
| AWAY-008 | memory/away-mode.md | Next-task queue must drain autonomously. | PARTIAL | Executor dispatcher + completion-hook re-queue on failure | Gap: no queue-drain monitoring alert | daemon | Add QUEUE-001 probe that alerts if queue stalls for >30min with no task completions |
| AWAY-009 | memory/away-mode.md | Never ask "Should I do A or B?" — decide instead. | NONE | No phrase scanner running | daemon | AUTON-010 nightly scanner covers this (see AUTON-010) |
| AWAY-010 | memory/away-mode.md | Never respond with "Please approve" — assume approval. | NONE | No phrase scanner running | daemon | AUTON-010 nightly scanner covers this (see AUTON-010) |
| AWAY-011 | memory/away-mode.md | Never wait on user — always decide. | NONE | Runtime AI judgment required | advisory | Covered by AUTON nightly phrase scanner |
| AWAY-012 | memory/away-mode.md | Never bounce tiebreak questions to user. | NONE | Runtime AI judgment required | advisory | Covered by AUTON nightly phrase scanner |

---

### AUTON — Autonomy Enforcement Rules

| rule_id | memory_file | rule_text | current_enforcement | enforcement_gap | proposed_mechanism | proposed_implementation |
|---------|-------------|-----------|--------------------|-----------------|--------------------|------------------------|
| AUTON-001 | memory/autonomy.md | Orchestrator must never ask the user a path-forward question. | NONE | No banned phrase scanner exists yet | daemon | Implement nightly job scanning outbound_messages for path-forward question patterns |
| AUTON-002 | memory/autonomy.md | If the draft asks "should I / want me to / confirm / proceed / A or B", it must be rejected. | NONE | No draft-validation step before send | daemon | Pre-send middleware rejects SendUserMessage calls containing banned phrases |
| AUTON-003 | memory/autonomy.md | Execute the decision immediately. | NONE | Runtime AI judgment | advisory | Covered by nightly phrase scanner catching failures after the fact |
| AUTON-004 | memory/autonomy.md | Rewrite the message as "Decided: choice. Rationale: one sentence. In flight: action taken." | NONE | No message-format enforcer | runtime-middleware | Add outbound message format validator that checks for Decided/Rationale/In-flight structure |
| AUTON-005 | memory/autonomy.md | May ask the user a question ONLY when irreversible production impact or contradicts a locked contract. | NONE | Exception criteria require judgment | advisory | Document exception criteria in MCP tool description; nightly scanner flags violations |
| AUTON-006 | memory/autonomy.md | Do not end with "Want me to X or Y?" | NONE | No phrase scanner running | daemon | Add "Want me to" to banned-phrase list in nightly scanner |
| AUTON-007 | memory/autonomy.md | Do not end with "Let me know if you'd like me to..." | NONE | No phrase scanner running | daemon | Add "Let me know if you'd like" to banned-phrase list in nightly scanner |
| AUTON-008 | memory/autonomy.md | Do not end with "Ready when you are." | NONE | No phrase scanner running | daemon | Add "Ready when you are" to banned-phrase list in nightly scanner |
| AUTON-009 | memory/autonomy.md | Every SendUserMessage must be logged to conductor outbound_messages. | NONE | No outbound_messages table or middleware | runtime-middleware | Create outbound_messages table; wrap MCP SendUserMessage tool to write every call |
| AUTON-010 | memory/autonomy.md | A nightly job must scan for messages containing forbidden patterns. | NONE | No nightly scanner job exists | daemon | Create nightly cron job that runs banned-phrase scan on outbound_messages table |
| AUTON-011 | memory/autonomy.md | Each violation becomes a conductor blocker tagged self-regression with the exact phrase. | NONE | No auto-blocker creation from scanner | daemon | Nightly scanner creates blocker record tagged self-regression for each violation found |

---

### BEHAV — Behavior Test Rules

| rule_id | memory_file | rule_text | current_enforcement | enforcement_gap | proposed_mechanism | proposed_implementation |
|---------|-------------|-----------|--------------------|-----------------|--------------------|------------------------|
| BEHAV-001 | memory/behavior.md | No feature ships without a behavior test. | PARTIAL | gate:publish exists per rule; build-runner enforces test step | Gap: no specific check that a behavior test file accompanies every feature file | build-runner-gate | Add `gate:behavior` step verifying every new src file has a corresponding .spec or .behavior.ts file |
| BEHAV-002 | memory/behavior.md | Pre-publish gate is mandatory. npm run gate:publish must pass. | PARTIAL | build-runner.sh runs tests but `gate:publish` is not an explicit named step | Gap: `gate:publish` is not verified as a distinct step in build-runner.sh | build-runner-gate | Add explicit `gate:publish` step in build-runner.sh after existing test step |
| BEHAV-003 | memory/behavior.md | Do not merge a red gate. | PARTIAL | build-runner.sh aborts on first failed gate step | Gap: no GitHub branch protection rule enforcing this in PR merges | build-runner-gate | Ensure `gate:no-secrets` and all gate steps are required status checks in GitHub branch protection |
| BEHAV-004 | memory/behavior.md | Tests must target outcomes, not selectors. | NONE | No lint rule preventing selector-based assertions | eslint-rule | Add ESLint rule warning on direct DOM selector use (querySelector, getByRole exceptions allowed) in test files |
| BEHAV-005 | memory/behavior.md | Only data-test-id on explicit contract surfaces is acceptable DOM coupling. | NONE | No lint rule enforcing data-test-id usage policy | eslint-rule | Add custom ESLint rule allowing `data-test-id` in tests but flagging other DOM selector patterns |
| BEHAV-006 | memory/behavior.md | When a test fails after a "small update", the update is too big. | NONE | Advisory; requires human judgment on commit size | advisory | Enforce indirectly via atomic commit policy and small PR rules |
| BEHAV-007 | memory/behavior.md | Flaky tests must be flagged, not ignored. Three consecutive different outcomes auto-files a blocker. | NONE | No flaky-test detector | daemon | Add test-runner wrapper that tracks per-test outcomes across runs; auto-files blocker on 3 differing results |

---

### CMPLT — Completeness Rules

| rule_id | memory_file | rule_text | current_enforcement | enforcement_gap | proposed_mechanism | proposed_implementation |
|---------|-------------|-----------|--------------------|-----------------|--------------------|------------------------|
| CMPLT-001 | memory/completeness.md | No code task starts without a story tree. | NONE | No pre-start validation in executor | runtime-middleware | Executor dispatcher checks task has linked story node before spawning worker |
| CMPLT-002 | memory/completeness.md | Every leaf must carry expected_behavior, acceptance_criteria, verification_plan, and behavior_test_skeleton. | NONE | No leaf-validation before execution | runtime-middleware | Executor pre-spawn check validates required story leaf fields are non-null |
| CMPLT-003 | memory/completeness.md | An implementing session must receive leaf-level to-dos, not the epic. | NONE | No prompt scoping enforcement | runtime-middleware | Dispatcher prompt builder must refuse to include epic-level nodes; only leaf nodes allowed |
| CMPLT-004 | memory/completeness.md | Empty shells become impossible because every populated region is its own sub-task. | NONE | Derived from CMPLT-002; no independent check | advisory | Enforced structurally if CMPLT-002 leaf-validation is implemented |
| CMPLT-005 | memory/completeness.md | Completeness sentinel must run every 2 hours. | PARTIAL | Sentinel daemon referenced in completion-hook.ts | Gap: no verified 2h cron schedule | daemon | Add launchd plist or cron entry ensuring sentinel runs on 2h schedule; log run_count to DB |
| CMPLT-006 | memory/completeness.md | On failure, flag entity unverified, write a completeness_finding, auto-create a re-execution task. | PARTIAL | Completion-hook.ts references sentinel invocation | Gap: completeness_finding table and auto-task creation not verified | daemon | Verify completeness_findings table exists; ensure sentinel writes finding + creates task on failure |
| CMPLT-007 | memory/completeness.md | Sentinel must never edit code — only flag + queue. | NONE | No write-permission restriction on sentinel process | runtime-middleware | Sentinel daemon runs with read-only filesystem permissions; can only call Conductor API |
| CMPLT-008 | memory/completeness.md | When user gives a new directive, run story_decompose first. | NONE | No pre-decompose gate in MCP server | runtime-middleware | MCP tool handler for new directives calls story_decompose before queuing any task |
| CMPLT-009 | memory/completeness.md | Before declaring anything "done", wait for next sentinel run OR invoke completeness_run on demand. | NONE | No done-gating on sentinel confirmation | runtime-middleware | Executor completion hook requires sentinel score=100% before marking task done (see EXEC-007) |
| CMPLT-010 | memory/completeness.md | When auditing backlog, filter entity.status=unverified. | NONE | No backlog audit default filter | advisory | Document in CLI help; backlog query default should include status filter |
| CMPLT-011 | memory/completeness.md | When a re-execution task surfaces, the implementer must read the original story node + findings. | NONE | No prompt injection for re-execution context | runtime-middleware | Dispatcher detects re-execution tasks and injects original story node + completeness_findings into prompt |
| CMPLT-012 | memory/completeness.md | If the user asks for a non-trivial feature, the FIRST step is story_decompose. | NONE | No pre-execution story_decompose enforcement | runtime-middleware | MCP instruction-handler wrapper calls story_decompose before any task creation for multi-step features |
| CMPLT-013 | memory/completeness.md | If there's ambiguity at a leaf, ask the user to clarify that leaf specifically. | NONE | Runtime AI judgment required | advisory | Exception case under AUTON-005; scoped question is allowed when leaf criteria are ambiguous |
| CMPLT-014 | memory/completeness.md | Implementation must only begin after the tree is in stories table and all leaves have acceptance criteria. | NONE | No tree-completeness check before execution | runtime-middleware | Executor pre-spawn validates all leaves of task's story tree have acceptance_criteria set |

---

### AUTON (autonomy) sub-rules already listed above. Continuing with DOM.

### DOM — Domain Taxonomy Rules

| rule_id | memory_file | rule_text | current_enforcement | enforcement_gap | proposed_mechanism | proposed_implementation |
|---------|-------------|-----------|--------------------|-----------------|--------------------|------------------------|
| DOM-001 | memory/domain-taxonomy.md | Every requirement, blocker, question, ADR, feature, suggestion, and timeline entry must carry one or more domain tags. | PARTIAL | gate:events-taxonomy in build-runner.sh partially checks event types | Gap: no DB-level NOT NULL constraint on domain_tags for tasks/blockers/questions | db-constraint | Add NOT NULL constraint with non-empty default check on domain_slug/tags columns for tasks, blockers, questions |
| DOM-002 | memory/domain-taxonomy.md | When a new entity is created in Conductor, tag it with a domain. | NONE | No creation-time domain validation in API | runtime-middleware | API POST handlers for tasks/blockers/questions reject requests missing domain_tags field |
| DOM-003 | memory/domain-taxonomy.md | When a new plugin is added, it becomes its own domain. | NONE | No plugin-registration enforcement | advisory | Document in plugin creation checklist; enforce DOM-005 for new plugins |
| DOM-004 | memory/domain-taxonomy.md | When adding a new dimension, append to the domain set and seed it in the DB. | NONE | No domain-set validation | db-constraint | Add domain_taxonomy table with seeded values; foreign key on entity domain_slug columns |
| DOM-005 | memory/domain-taxonomy.md | When creating a new plugin package, add its slug to the domain taxonomy AND seed it in the DB in the same PR. | NONE | No PR-level domain seed check | build-runner-gate | Add `gate:domain-taxonomy` step that validates new packages/ dirs have a seed entry in domain_taxonomy table |
| DOM-006 | memory/domain-taxonomy.md | When adding a new product concern, append it to the taxonomy and seed file. | NONE | No taxonomy completeness check | db-constraint | Domain taxonomy table foreign key prevents entity creation with unknown domain slug |
| DOM-007 | memory/domain-taxonomy.md | Domain chips on the dashboard must use color AND icon, not color alone. | NONE | No UI visual-property lint | advisory | Enforce via POKE-007 lock and code-review checklist; no reliable static check |

---

### ENFORCE — Observability and Coverage Enforcement Rules

| rule_id | memory_file | rule_text | current_enforcement | enforcement_gap | proposed_mechanism | proposed_implementation |
|---------|-------------|-----------|--------------------|-----------------|--------------------|------------------------|
| ENFORCE-001 | memory/enforce.md | Every exported function that crosses a module boundary MUST either emit an event OR be annotated @no-events. | ENFORCED | gate:observability in build-runner.sh runs check-observability.ts which greps for missing annotations | None — fully enforced when gate passes | build-runner-gate | Already implemented; verify check-observability.ts covers all boundary signatures |
| ENFORCE-002 | memory/enforce.md | Must have a unit test expectEventEmitted that proves the event is emitted. | PARTIAL | gate:observability checks annotation presence | Gap: does not verify a corresponding expectEventEmitted test exists | build-runner-gate | Extend check-observability.ts to cross-reference test files for expectEventEmitted assertion |
| ENFORCE-003 | memory/enforce.md | The build's gate:observability step must grep for exported fns missing either condition and fail. | ENFORCED | gate:observability step exists in build-runner.sh and calls check-observability.ts | None | build-runner-gate | Already implemented |
| ENFORCE-004 | memory/enforce.md | Every I/O function MUST emit a Pino log line with correlation_id, actor, stage, entity_id fields. | PARTIAL | gate:observability checks-observability.ts exists | Gap: field-level validation (correlation_id, actor, stage, entity_id) not verified | build-runner-gate | Extend check-observability.ts to parse log call arguments and verify required fields present |
| ENFORCE-005 | memory/enforce.md | Must have a unit test expectLogEmitted that proves the log was written with right fields. | PARTIAL | gate:observability checks annotations | Gap: does not verify expectLogEmitted test presence | build-runner-gate | Extend check-observability.ts to assert corresponding expectLogEmitted in test files |
| ENFORCE-006 | memory/enforce.md | OR be annotated @no-logs with justification. | PARTIAL | check-observability.ts looks for @no-events annotation | Gap: @no-logs annotation may not be checked separately | build-runner-gate | Add @no-logs annotation check to check-observability.ts alongside @no-events |
| ENFORCE-007 | memory/enforce.md | Coverage target is 100% statements, branches, lines on src/ and apps/. | ENFORCED | gate:coverage in build-runner.sh runs check-coverage-delta.ts | None — gate exists | build-runner-gate | Already implemented; verify 100% thresholds are set in jest.config.ts |
| ENFORCE-008 | memory/enforce.md | Exclusions: TypeScript type-only files, barrel re-exports, *.d.ts, generated migrations, fixture files. | PARTIAL | gate:coverage exists | Gap: exclusion patterns may not be fully configured in jest.config.ts | build-runner-gate | Verify jest.config.ts `coveragePathIgnorePatterns` includes all listed exclusions |
| ENFORCE-009 | memory/enforce.md | Every file CHANGED in a PR must be at 100% coverage AFTER the change. | PARTIAL | check-coverage-delta.ts is a delta checker | Gap: verify it compares changed files only against 100% threshold | build-runner-gate | Verify check-coverage-delta.ts reads `git diff --name-only` and asserts 100% on changed files only |
| ENFORCE-010 | memory/enforce.md | Unchanged files can stay below while climbing toward full coverage. | PARTIAL | check-coverage-delta.ts intent aligns with this | Gap: verify unchanged files are excluded from strict 100% check | build-runner-gate | Verify check-coverage-delta.ts does not apply 100% threshold to files absent from git diff |
| ENFORCE-011 | memory/enforce.md | Gate order in CI: lint → build → unit → coverage → observability → behavior → events-taxonomy. | PARTIAL | build-runner.sh defines step order | Gap: behavior gate is not an explicit step in build-runner.sh | build-runner-gate | Add `gate:behavior` step to build-runner.sh in correct position after coverage |
| ENFORCE-012 | memory/enforce.md | Unit tests enforce architecture properties. | NONE | No architecture-property unit test enforcement | contract-test | Add architecture unit tests (e.g., using dependency-cruiser) asserting module boundary rules |
| ENFORCE-013 | memory/enforce.md | Behavior tests enforce user-visible outcomes. | PARTIAL | Playwright config exists | Gap: no explicit CI step running Playwright behavior tests | build-runner-gate | Add `gate:behavior` step in build-runner.sh that runs Playwright test suite |
| ENFORCE-014 | memory/enforce.md | Both unit and behavior tests are mandatory. | PARTIAL | Unit tests run in build-runner.sh | Gap: behavior tests not a mandatory gate step | build-runner-gate | Enforce via ENFORCE-011 gate ordering with behavior gate as required step |

---

### EXEC — Executor Rules

| rule_id | memory_file | rule_text | current_enforcement | enforcement_gap | proposed_mechanism | proposed_implementation |
|---------|-------------|-----------|--------------------|-----------------|--------------------|------------------------|
| EXEC-001 | memory/executor.md | Executor daemon starts DISABLED by default. User must explicitly run conductor exec start. | ENFORCED | executor_config table has `enabled` column defaulting to false; DB schema enforced | None | db-constraint | Already implemented via schema default |
| EXEC-002 | memory/executor.md | Default max_concurrent=3; max_per_site_concurrent=1. | ENFORCED | executor_config schema: max_concurrent defaults to 3, max_per_domain_concurrent defaults to 1 | None | db-constraint | Already implemented via schema defaults |
| EXEC-003 | memory/executor.md | Unmet deps → task stays blocked. All deps done → task flips to ready. | NONE | No dep-resolution logic verified in executor | runtime-middleware | Verify executor polling loop checks dependsOn field and only promotes tasks with all deps completed |
| EXEC-004 | memory/executor.md | Every state change must hit executor_runs + task_attempts + audit_log + timeline. | PARTIAL | dispatcher.ts registers executor runs; task_attempts table exists | Gap: audit_log and timeline writes not verified for every state change | runtime-middleware | Add audit_log and timeline write calls to all task state-change code paths in dispatcher and completion-hook |
| EXEC-005 | memory/executor.md | Each worker gets its own git worktree. Auto-merge only when gate + sentinel both green. | ENFORCED | dispatcher.ts creates unique worktree per task via `git worktree add` | Gap: auto-merge gating on sentinel not verified | runtime-middleware | Verify completion-hook requires both gate:publish pass and sentinel score=100 before merging worktree |
| EXEC-006 | memory/executor.md | 3 consecutive failures → auto-paused, blocker filed for human review. | ENFORCED | completion-hook.ts calls checkAndBreak with circuitBreakerThreshold; executor_config defaults threshold to 3 | None | runtime-middleware | Already implemented |
| EXEC-007 | memory/executor.md | No task marks done unless gate:publish passes AND completeness sentinel score = 100%. | NONE | completion-hook marks tasks done but sentinel score check not verified | runtime-middleware | Add sentinel score check in completion-hook before calling markTaskDone |
| EXEC-008 | memory/executor.md | If validation passes → conductor exec install-launchd → 24/7. | NONE | No install-launchd command verified in CLI | runtime-middleware | Verify `conductor exec install-launchd` CLI command exists and correctly installs daemon plist |
| EXEC-009 | memory/executor.md | If validation fails → pause, file blocker, escalate. Do NOT proceed to 24/7 on a broken pipeline. | NONE | No validation-failure pause path before install-launchd | runtime-middleware | Add pre-install validation step in `conductor exec install-launchd` that runs full pipeline check first |
| EXEC-010 | memory/executor.md | Every user instruction: (1) call story_decompose, (2) leaves queue as ready, (3) executor picks up autonomously. | NONE | No instruction-to-story_decompose pipeline enforced | runtime-middleware | MCP instruction handler wraps all incoming instructions in story_decompose call before task creation |
| EXEC-011 | memory/executor.md | Every instruction is treated as durable: the pipeline is the contract, chat is ephemeral. | NONE | No durability check on instruction ingestion | runtime-middleware | All instructions written to prompts table before any processing begins (see TRACE-001) |
| EXEC-012 | memory/executor.md | Orchestrator must not manually start_code_task for each leaf anymore. | NONE | No prohibition on direct start_code_task calls | runtime-middleware | Deprecate or guard direct start_code_task calls; route all task creation through executor queue |

---

### HEALTH — Pipeline Health Rules

| rule_id | memory_file | rule_text | current_enforcement | enforcement_gap | proposed_mechanism | proposed_implementation |
|---------|-------------|-----------|--------------------|-----------------|--------------------|------------------------|
| HEALTH-001 | memory/health.md | Orchestrator must continuously verify the factory pipeline is healthy. | NONE | No health-check daemon verified | daemon | Implement health probe daemon that runs every 5 minutes and checks all 7 KPIs |
| HEALTH-002 | memory/health.md | On every heartbeat tick (~5 min): query conductor for 7 KPIs. | NONE | No heartbeat health query implemented | daemon | Add 5-minute cron health probe querying tasks, blockers, events, build_runs tables |
| HEALTH-003 | memory/health.md | Any anomaly → file a blocker with severity=critical, tag pipeline-health. | NONE | No anomaly-to-blocker creation | daemon | Health probe daemon calls /blockers API on any KPI threshold breach |
| HEALTH-004 | memory/health.md | Anomalies aggregated into a daily /reports/pipeline-health dashboard card. | NONE | No daily health report generation | daemon | Add daily cron that queries blockers tagged pipeline-health and writes report to /reports/ |
| HEALTH-005 | memory/health.md | One hourly scheduled health probe runs regardless of heartbeat state. | NONE | No hourly independent health probe | daemon | Add separate hourly cron entry in launchd plist for health probe independent of heartbeat |
| HEALTH-006 | memory/health.md | On any anomaly, orchestrator writes to system.warning event with severity=critical immediately. | NONE | No system.warning event emission in health probe | daemon | Health probe emits system.warning event via /events API on any KPI breach |
| HEALTH-007 | memory/health.md | Task throughput must be ≥ 1 done / hour during active build periods. | NONE | No throughput KPI check | daemon | Health probe queries tasks completed in last hour; breaches threshold if < 1 during active periods |
| HEALTH-008 | memory/health.md | P95 time from prompt → all descendants done ≤ 24h. | NONE | No P95 latency check | daemon | Health probe calculates P95 prompt-to-completion time from prompts + tasks tables |
| HEALTH-009 | memory/health.md | Zero tasks with null root_prompt_id. | NONE | root_prompt_id is nullable in schema (text('root_prompt_id') without .notNull()) | db-constraint | Add .notNull() constraint to tasks.root_prompt_id column in DB schema and migrate |
| HEALTH-010 | memory/health.md | Zero stories un-decomposed for >24h after creation. | NONE | No stale-story check | daemon | Health probe queries stories table for nodes with status=created older than 24h |
| HEALTH-011 | memory/health.md | Event emission rate within 30% of trailing 24h average. | NONE | No event-rate anomaly detection | daemon | Health probe computes last-hour event count vs. 24h rolling average; alerts on >30% deviation |
| HEALTH-012 | memory/health.md | Build-runner success rate ≥ 90% over 24h rolling. | NONE | No build success-rate check | daemon | Health probe queries build_runs table for 24h success rate; files blocker if < 90% |
| HEALTH-013 | memory/health.md | Completeness sentinel run count ≥ 12 per 24h. | NONE | No sentinel run-count tracking | daemon | Health probe counts sentinel_runs in last 24h; files blocker if < 12 |
| HEALTH-014 | memory/health.md | Only report to user when KPI trips. Keep heartbeat noise to zero. | NONE | No message-suppression on green health | daemon | Health probe daemon only calls SendUserMessage when a KPI threshold is breached |
| HEALTH-015 | memory/health.md | At most one consolidated health summary per day if everything is green. | NONE | No green-day summary consolidation | daemon | Health probe daemon batches green-day findings into single daily digest message |

---

### L — Operational Learnings

| rule_id | memory_file | rule_text | current_enforcement | enforcement_gap | proposed_mechanism | proposed_implementation |
|---------|-------------|-----------|--------------------|-----------------|--------------------|------------------------|
| L-001 | memory/learnings.md | Poll every 5 minutes while ANY session is running, not 30. | NONE | No 5-min poll enforcement | advisory | executor_config.poll_interval_ms default is 10000ms; update default to 300000ms when sessions active |
| L-002 | memory/learnings.md | If turn count hasn't changed across 3 consecutive 5-min polls, assume stall and nudge. | NONE | No stall-detection logic verified | daemon | Add stall detector in executor monitor: 3 polls with same turn_count triggers nudge or respawn |
| L-003 | memory/learnings.md | "Don't ask questions" does NOT mean "don't monitor." | NONE | Advisory | advisory | No mechanical enforcement possible |
| L-004 | memory/learnings.md | Monitoring surfaces blockers that can be resolved autonomously. | NONE | Advisory | advisory | Covered by HEALTH daemon implementation |
| L-005 | memory/learnings.md | When 2+ parallel tasks are live, run periodic reconcile. | NONE | No multi-task reconcile loop | daemon | Executor monitor runs reconcile step when active_workers > 1 to detect cross-task conflicts |
| L-006 | memory/learnings.md | After parallel edits, clear .next/ and restart dev server. | NONE | Advisory; project-specific | advisory | Document in executor task prompt template |
| L-007 | memory/learnings.md | Every deployment checklist: verify curl -sI returns 200 AND content is correct. | NONE | No post-deploy health check | contract-test | Add post-deploy smoke test step in build-runner.sh that curls key routes and asserts 200 + content |
| L-008 | memory/learnings.md | Dev-server-up is not dev-server-serving-correct-content. | NONE | Advisory | advisory | Covered by L-007 content verification |
| L-009 | memory/learnings.md | When a hook is blocking, enumerate ALL files in hooks dir. | NONE | Advisory; operational procedure | advisory | No mechanical enforcement possible |
| L-010 | memory/learnings.md | Check settings.json for the full matcher list. | NONE | Advisory | advisory | No mechanical enforcement possible |
| L-011 | memory/learnings.md | Apply passthrough fix to EVERY hook that matches. | NONE | Advisory | advisory | No mechanical enforcement possible |
| L-012 | memory/learnings.md | For any new cloud-provider integration, verify the API exists for the specific operation. | NONE | Advisory | advisory | Document in integration PR checklist |
| L-013 | memory/learnings.md | Do not promise autonomous automation if a dashboard click is required. | NONE | Advisory | advisory | No mechanical enforcement possible |
| L-014 | memory/learnings.md | For any Claude Code project, proactively install wildcard permissions in .claude/settings.local.json. | NONE | Advisory; project setup | advisory | Document in project init checklist |
| L-015 | memory/learnings.md | Install permissions at project creation time, not after complaint. | NONE | Advisory | advisory | Document in project init checklist |
| L-016 | memory/learnings.md | After any failure, add a new learning entry to this file. | NONE | Advisory; process rule | advisory | No mechanical enforcement possible |
| L-017 | memory/learnings.md | Read this file at the start of every new conversation. | NONE | Advisory; session startup rule | advisory | Add to session context priming prompt |
| L-018 | memory/learnings.md | No user-visible link may lead to 404/error. No button may do nothing when clicked. | NONE | No broken-link or dead-button check in CI | build-runner-gate | Add npm run integrity step in build-runner.sh that crawls all routes for broken links and dead buttons |
| L-019 | memory/learnings.md | Both sites have npm run integrity that crawls all routes and scans interactive elements. | NONE | No integrity check in build-runner.sh | build-runner-gate | Add `gate:integrity` step in build-runner.sh running npm run integrity on all site targets |
| L-020 | memory/learnings.md | Build fails if integrity fails. | NONE | No integrity gate in build-runner.sh | build-runner-gate | Make `gate:integrity` step in build-runner.sh abort on non-zero exit |
| L-021 | memory/learnings.md | Playwright test walks the site, clicks every discoverable interactive element. | NONE | No full-site Playwright click walk | contract-test | Add Playwright site-walk spec that discovers and clicks all interactive elements, asserts no errors |
| L-022 | memory/learnings.md | Zero tolerance for broken links — the build blocks. | NONE | No link-checker gate | build-runner-gate | Add `gate:integrity` step (see L-019) that includes broken-link check |
| L-023 | memory/learnings.md | Within each site, no image may appear on two different reference points. | NONE | No image-deduplication check | build-runner-gate | Add image-slot deduplication validator in enrichment pipeline that fails on duplicate slot assignments |
| L-024 | memory/learnings.md | Every section/article/page gets a unique image. | NONE | No unique-image enforcement | build-runner-gate | Add `gate:content` step checking image slot assignments for duplicates across routes |
| L-025 | memory/learnings.md | During enrichment, assign images by slot key, not by query reuse. | NONE | Advisory; enrichment implementation detail | advisory | Document in enrichment pipeline code comments |
| L-026 | memory/learnings.md | Validation sweep at end of every enrichment pass. | NONE | No post-enrichment validation step | daemon | Add post-enrichment validation step to enrichment pipeline that checks uniqueness + age-safety |
| L-027 | memory/learnings.md | Any image depicting a person must show only clearly-adult (21+) individuals. | NONE | No age-safety filter in image pipeline | build-runner-gate | Add age-safety validation step in image-acquisition pipeline that rejects person-containing images flagged as minor |
| L-028 | memory/learnings.md | No kids, teenagers, or family-with-children imagery. | NONE | No imagery content filter | build-runner-gate | Extend age-safety filter (L-027) to reject family-with-children images |
| L-029 | memory/learnings.md | Every image-acquisition pass MUST include an age-safety filter. | NONE | No age-safety filter in image provider | build-runner-gate | Add mandatory age-safety filter to image-provider utility as non-bypassable middleware |
| L-030 | memory/learnings.md | For person-containing images, a secondary visual check: reject if anyone appears under 21. | NONE | No secondary visual check | advisory | Document in image acquisition procedure; automated age-detection requires external API |
| L-031 | memory/learnings.md | When unsure, prefer non-person imagery. | NONE | Advisory | advisory | Document in image-provider default behavior |
| L-032 | memory/learnings.md | Any existing site imagery discovered to contain minors → remove immediately. | NONE | No imagery audit for existing content | advisory | Run one-time audit; document in operational runbook |
| L-033 | memory/learnings.md | Bake age-safety into the image-provider utility's validation pipeline as mandatory filter. | NONE | No age-safety filter exists | build-runner-gate | Implement age-safety validation in image-provider; gate:content checks filter is present |
| L-034 | memory/learnings.md | A task's "done" is a hypothesis. Before relaying done to user, run independent verification. | NONE | No independent verification step before done-relay | runtime-middleware | Completion-hook runs verification step (curl, test) before marking task done and messaging user |
| L-035 | memory/learnings.md | Open the live app in a browser, walk through the original requirement list. | NONE | Advisory; manual verification | advisory | Covered mechanically by L-007 post-deploy smoke test |
| L-036 | memory/learnings.md | For any track with >10 requirements, the DoD includes a traceability matrix. | NONE | No traceability matrix check | advisory | Document in task template; no static enforcement for requirement count threshold |
| L-037 | memory/learnings.md | Cross-task feature coverage: track A completion doesn't confirm unless explicitly verified. | NONE | Advisory | advisory | Covered by completeness sentinel independent verification |
| L-038 | memory/learnings.md | When an audit finds gaps, open a follow-up task with specific unchecked items. | NONE | Advisory | advisory | No mechanical enforcement possible |
| L-039 | memory/learnings.md | User is on East Coast (EST/EDT). All human-facing timestamps use ET. | NONE | Advisory; formatting preference | advisory | No mechanical enforcement; document in timestamp utility |
| L-040 | memory/learnings.md | Prefix timestamps with "PM EST" / "AM EST". | NONE | Advisory; formatting preference | advisory | No mechanical enforcement; document in timestamp utility |
| L-041 | memory/learnings.md | When writing "Heartbeat at HH:MM" use the user's local time. | NONE | Advisory; formatting preference | advisory | No mechanical enforcement; document in heartbeat message template |
| L-042 | memory/learnings.md | Never tell a child task to write to /sessions/*/mnt/.auto-memory/ — it won't land in orchestrator's view. | NONE | No path-restriction in task prompts | runtime-middleware | Dispatcher prompt builder strips any instruction to write to /sessions/*/mnt/.auto-memory/ paths |
| L-043 | memory/learnings.md | Route task reports to absolute HOST paths like /Users/MAC/Documents/projects/<project>/reports/*.md. | NONE | No report-path enforcement | runtime-middleware | Dispatcher prompt template explicitly instructs host-path report routing |
| L-044 | memory/learnings.md | Request task to echo report content in its transcript [result] line. | NONE | No [result] echo enforcement in prompts | runtime-middleware | Dispatcher prompt builder includes instruction to echo report content in [result] line |
| L-045 | memory/learnings.md | When consolidating backlog, treat "report was written" only as proven when verified via ls. | NONE | Advisory; verification procedure | advisory | No mechanical enforcement possible |
| L-046 | memory/learnings.md | On overloaded_error or similar transient 5xx, first attempt to resume via send_message. | NONE | No transient-error resume logic verified | runtime-middleware | Executor monitor adds retry-via-send_message path before respawn on 5xx errors |
| L-047 | memory/learnings.md | Only respawn if the resume message also hits the same error twice in a row. | NONE | No double-check before respawn | runtime-middleware | Executor monitor tracks error count per session; respawns only after 2 consecutive same errors |
| L-048 | memory/learnings.md | Always include BL-<TASK>-PAUSED.md write-instruction as a fallback. | NONE | No paused-task fallback write in prompts | runtime-middleware | Dispatcher prompt includes BL-{taskId}-PAUSED.md write as last-resort fallback instruction |
| L-049 | memory/learnings.md | When ANY task is running, post a proactive status update every ~15 minutes. | NONE | No 15-minute status-update daemon | daemon | Add 15-minute cron job that posts status update when active_workers > 0 |
| L-050 | memory/learnings.md | Silence for >15 min while tracks are live is a signal failure. | NONE | No silence-detection check | daemon | Status daemon checks last outbound message timestamp; posts alert if > 15 min with live workers |
| L-051 | memory/learnings.md | Use schedule skill when available; otherwise piggy-back on task-completion events. | NONE | Advisory; scheduling preference | advisory | Covered by daemon implementations above |
| L-052 | memory/learnings.md | Every 15 min, send a one-screen status: each track's turn count + delta + state + blockers. | NONE | No 15-min structured status message | daemon | 15-min status daemon formats turn_count delta + state + blockers per active track |
| L-053 | memory/learnings.md | If no tasks are running, cadence pauses. | NONE | No idle-suppression for status daemon | daemon | Status daemon checks active_workers == 0 and skips posting when idle |

---

### OBS — Observability Rules

| rule_id | memory_file | rule_text | current_enforcement | enforcement_gap | proposed_mechanism | proposed_implementation |
|---------|-------------|-----------|--------------------|-----------------|--------------------|------------------------|
| OBS-001 | memory/observability.md | Every state change must emit a structured event through a durable bus. | PARTIAL | gate:observability checks event emission annotations | Gap: not all state changes have verified event emission | build-runner-gate | Extend gate:observability to scan all state-machine transitions and verify event.emit call present |
| OBS-002 | memory/observability.md | Every module must emit structured JSON logs with correlation/trace IDs. | PARTIAL | gate:observability checks @no-logs and log calls | Gap: field-level validation (correlation_id) not verified | build-runner-gate | Extend check-observability.ts to assert log calls include correlation_id field |
| OBS-003 | memory/observability.md | No silent state changes. If it matters, emit an event. | PARTIAL | gate:observability annotation check | Gap: "if it matters" requires judgment; annotation-only check is incomplete | build-runner-gate | Same as OBS-001; gate:observability coverage of all state change paths |
| OBS-004 | memory/observability.md | Every function that crosses a module boundary must open an OTel span. | NONE | No OTel span check in gate:observability | build-runner-gate | Add OTel span annotation requirement to check-observability.ts for module-boundary functions |
| OBS-005 | memory/observability.md | Every log line must include correlation_id. | PARTIAL | gate:observability checks log calls | Gap: correlation_id field presence not verified at log-call level | build-runner-gate | Extend check-observability.ts to parse Pino log call signatures and assert correlation_id argument |
| OBS-006 | memory/observability.md | Every error must be both logged AND event-emitted with severity=error. | NONE | No error dual-emit check | build-runner-gate | Add error-handling pattern check to check-observability.ts: catch blocks must have log + emit calls |
| OBS-007 | memory/observability.md | Every DB write must have a corresponding event in the same transaction. | NONE | No DB-write event co-emission check | build-runner-gate | Add check-observability.ts rule: every db.insert/update call must be accompanied by event.emit in same scope |
| OBS-008 | memory/observability.md | Events are append-only. Never update or delete an event row. | NONE | No immutability check on events table | db-constraint | Add DB trigger or application-level guard preventing UPDATE/DELETE on events table |
| OBS-009 | memory/observability.md | Every build invocation must run under an instrumentation wrapper. | ENFORCED | build-runner.sh wraps all build invocations with event emission and step tracking | None | build-runner-gate | Already implemented |
| OBS-010 | memory/observability.md | Every npm run build, gate:* script, test invocation goes through build-runner wrapper. | PARTIAL | build-runner.sh wraps npm steps | Gap: direct npm invocations outside build-runner.sh are not gated | build-runner-gate | Add pre-script hooks in package.json that require BUILD_RUN_ID env var for build and gate commands |
| OBS-011 | memory/observability.md | The wrapper must assign a build_run_id (ULID) at invocation. | ENFORCED | build-runner.sh assigns BUILD_RUN_ID at start | None | build-runner-gate | Already implemented |
| OBS-012 | memory/observability.md | The wrapper must emit build.started event with command, args, cwd, trigger, git SHA. | ENFORCED | build-runner.sh emits build.started with trigger, git SHA, branch, changed_files | None | build-runner-gate | Already implemented |
| OBS-013 | memory/observability.md | For each pipeline step, emit build.step_started with step name + order. | ENFORCED | build-runner.sh emits build.step_started in run_step() for each step | None | build-runner-gate | Already implemented |
| OBS-014 | memory/observability.md | Run the step, capture stdout + stderr + exit code + duration + max RSS. | PARTIAL | build-runner.sh captures stdout+stderr+exit code+duration | Gap: max RSS is not captured | build-runner-gate | Add `/usr/bin/time -v` or similar to capture max RSS for each build step |
| OBS-015 | memory/observability.md | Emit build.step_completed OR build.step_failed. | ENFORCED | build-runner.sh emits build.step_completed or build.step_failed in run_step() | None | build-runner-gate | Already implemented |
| OBS-016 | memory/observability.md | On failure, extract the error signature and file as a structured finding. | PARTIAL | build-runner.sh extracts error_signature from log | Gap: file extraction not implemented, only error pattern | build-runner-gate | Extend run_step() in build-runner.sh to parse error output for filename:line and include in step failure payload |
| OBS-017 | memory/observability.md | Emit build.completed OR build.aborted at end. | ENFORCED | build-runner.sh emits build.completed or build.aborted at end | None | build-runner-gate | Already implemented |
| OBS-018 | memory/observability.md | Every Pino log line emitted DURING a build step must carry build_run_id + build_step_id. | NONE | No log-line enrichment with build context | build-runner-gate | Pass BUILD_RUN_ID + step_id as env vars; Pino child logger must include these fields |
| OBS-019 | memory/observability.md | gate:publish wrapper itself runs under build-runner. | NONE | gate:publish not an explicit step in build-runner.sh | build-runner-gate | Add `gate:publish` as a named step in build-runner.sh run_step() calls |
| OBS-020 | memory/observability.md | Circuit-breaker logic: if same gate step flakes 3x within 24h, auto-file testing-qa blocker. | NONE | No per-step flakiness tracking | daemon | Add gate-step failure tracker: query build_step records for same step_name failing 3x in 24h; auto-file blocker |

---

### POKE — PokerZeno Brand Lock Rules

| rule_id | memory_file | rule_text | current_enforcement | enforcement_gap | proposed_mechanism | proposed_implementation |
|---------|-------------|-----------|--------------------|-----------------|--------------------|------------------------|
| POKE-001 | memory/pokerzeno-brand.md | This is the authoritative design direction for PokerZeno. Apply, do not rewrite without explicit user unlock. | NONE | No brand-lock gate in build-runner.sh | advisory | Enforced by POKE-019 acceptance criteria requirement and code review |
| POKE-002 | memory/pokerzeno-brand.md | All other colors (velvet, obsidian, emerald) are REMOVED from primary use. | NONE | No banned-color token check | build-runner-gate | Add `gate:brand` step in build-runner.sh checking tailwind.config for banned color names |
| POKE-003 | memory/pokerzeno-brand.md | User picks theme via theme switcher; no third theme. | NONE | No theme-count check | build-runner-gate | Add `gate:brand` assertion counting theme definitions; fail if > 2 themes found |
| POKE-004 | memory/pokerzeno-brand.md | No third-party icon libraries beyond card shapes for primary brand iconography. | NONE | No icon-library import check | eslint-rule | Add ESLint rule flagging icon-library imports (heroicons, fontawesome etc.) in brand-level components |
| POKE-005 | memory/pokerzeno-brand.md | lucide-react is fine for utility UI chrome but NOT for brand-level decoration. | NONE | No lucide-react scope enforcement | eslint-rule | Add ESLint rule warning on lucide-react usage in brand-level decoration contexts |
| POKE-006 | memory/pokerzeno-brand.md | LOCKED — Do not rewrite pages, rearrange sections, or restructure. | NONE | No page-structure change detection | build-runner-gate | Add `gate:brand` step using AST diff to detect page-level section restructuring in poker-zeno routes |
| POKE-007 | memory/pokerzeno-brand.md | Brand lock is purely theme/color/iconography swap — text, layout, components remain as-is. | NONE | No layout-change detection | advisory | Enforced via POKE-006 page-structure gate and code review |
| POKE-008 | memory/pokerzeno-brand.md | Read this file before making any visual change to PokerZeno. | NONE | No pre-task file-read requirement | runtime-middleware | Executor task prompt for poker-zeno files includes instruction to read brand-lock file first |
| POKE-009 | memory/pokerzeno-brand.md | Reference tokens by their lock names (white, black, red, silver, gold, platinum, ruby). | NONE | No token-name validation | build-runner-gate | Add `gate:brand` check verifying tailwind tokens use only approved lock names |
| POKE-010 | memory/pokerzeno-brand.md | Update tailwind.config tokens to match exact hexes. | NONE | No hex-value validation for brand tokens | build-runner-gate | Add `gate:brand` step asserting token hex values match locked values in brand-lock spec |
| POKE-011 | memory/pokerzeno-brand.md | Never introduce new primary colors without explicit user unlock. | NONE | No new-color detection | build-runner-gate | Add `gate:brand` step diffing tailwind.config against approved color set |
| POKE-012 | memory/pokerzeno-brand.md | Never swap the brand iconography for generic/stock icons. | NONE | No iconography swap detection | build-runner-gate | Add `gate:brand` step checking SVG/icon references in poker-zeno routes against approved icon list |
| POKE-013 | memory/pokerzeno-brand.md | Two-theme toggle (bright/dark) is a must-have wherever theming applies. | NONE | No theme-toggle presence check | contract-test | Add Playwright test asserting theme toggle component exists and switches between exactly 2 themes |
| POKE-014 | memory/pokerzeno-brand.md | Do not reintroduce velvet, obsidian, emerald as dominant colors. | NONE | No banned-color scan | build-runner-gate | gate:brand scans CSS/tailwind for banned color names (velvet, obsidian, emerald) |
| POKE-015 | memory/pokerzeno-brand.md | Do not add a third theme. | NONE | No theme-count guard | build-runner-gate | gate:brand counts theme definitions; fails on > 2 (see POKE-003) |
| POKE-016 | memory/pokerzeno-brand.md | Do not use yellow-leaning gold (#D4AF37). | NONE | No specific hex ban | build-runner-gate | gate:brand scans for literal #D4AF37 in CSS/tailwind files |
| POKE-017 | memory/pokerzeno-brand.md | Do not use third-party decorative iconography in place of card-based iconography. | NONE | No decorative icon check | build-runner-gate | gate:brand checks for third-party decorative icon usage in brand-level slots |
| POKE-018 | memory/pokerzeno-brand.md | Do not rewrite content, page structure, or layout under the banner of "brand update." | NONE | No content/layout preservation check | build-runner-gate | gate:brand uses git diff to detect non-token changes in poker-zeno route files during brand tasks |
| POKE-019 | memory/pokerzeno-brand.md | Any Conductor requirement touching poker-zeno files must confirm compliance with this lock in acceptance criteria. | NONE | No acceptance-criteria validation for brand compliance | runtime-middleware | Executor pre-spawn check: tasks with poker-zeno in declared_files must have brand-lock compliance in acceptance_criteria |

---

### PRIOR — Prioritization Rules

| rule_id | memory_file | rule_text | current_enforcement | enforcement_gap | proposed_mechanism | proposed_implementation |
|---------|-------------|-----------|--------------------|-----------------|--------------------|------------------------|
| PRIOR-001 | memory/prioritization.md | Every new task gets a priority score, a bucket, and a precise queue position automatically. | NONE | No auto-priority assignment on task creation | runtime-middleware | Task creation API endpoint calls prioritizer on every new task before inserting into DB |
| PRIOR-002 | memory/prioritization.md | No human tiebreak needed. | NONE | Advisory; relies on deterministic priority algorithm | advisory | Enforced indirectly by PRIOR-001 auto-priority assignment |
| PRIOR-003 | memory/prioritization.md | Tasks ≥90 score or hard-blocks >5 other tasks go to P0. Pauses in-flight non-P0 work, slots at position 1. | NONE | No P0 escalation logic in executor | runtime-middleware | Executor monitor checks priority score after each reprioritization; pauses non-P0 workers if P0 task arrives |
| PRIOR-004 | memory/prioritization.md | When a user instruction arrives, decompose it and announce WHERE IT LANDED — not ask where it should land. | NONE | No post-decompose landing announcement | runtime-middleware | Instruction handler sends queue-position announcement after story_decompose + priority assignment |

---

### QUEUE — Queue Drain Rules

| rule_id | memory_file | rule_text | current_enforcement | enforcement_gap | proposed_mechanism | proposed_implementation |
|---------|-------------|-----------|--------------------|-----------------|--------------------|------------------------|
| QUEUE-001 | memory/queue.md | Every 15 min, a scheduled task must probe the conductor queue. | NONE | No 15-min queue probe | daemon | Add 15-min cron job probing tasks table for queued+ready count |
| QUEUE-002 | memory/queue.md | Silent if queue has tasks. | NONE | No silence logic in queue probe | daemon | Queue probe suppresses SendUserMessage if queued_count > 0 |
| QUEUE-003 | memory/queue.md | If zero: proactive SendUserMessage with specific copy. | NONE | No zero-queue notification | daemon | Queue probe sends "Queue empty — all tasks complete. Awaiting new instructions." on zero count |
| QUEUE-004 | memory/queue.md | If running tasks alongside zero queued+ready: adjust message to note in-flight count. | NONE | No in-flight-aware zero-queue message | daemon | Queue probe includes active_worker count in message when queued=0 but workers still running |

---

### SEC — Security Rules

| rule_id | memory_file | rule_text | current_enforcement | enforcement_gap | proposed_mechanism | proposed_implementation |
|---------|-------------|-----------|--------------------|-----------------|--------------------|------------------------|
| SEC-001 | memory/security.md | Secrets live only in Vault. Apps never talk to Vault directly. | NONE | No vault-direct-access check in code | build-runner-gate | Add gate:secrets-architecture scan for direct Vault API calls outside the secrets-broker package |
| SEC-002 | memory/security.md | Workers and Next.js API routes must fetch at runtime, never bake at build-time. | NONE | No build-time secret bake detection | build-runner-gate | gate:no-secrets and gate:supply-chain together check for build-time secret inlining |
| SEC-003 | memory/security.md | Static HTML must never contain a secret. | NONE | No static HTML secret scan | build-runner-gate | Add post-build scan of dist/ static HTML files using gitleaks patterns |
| SEC-004 | memory/security.md | Every vault fetch must emit vault.secret_accessed to the event bus. | NONE | No vault fetch event emission enforcement | build-runner-gate | Add check-observability.ts rule: vault fetch calls must be accompanied by event emission |
| SEC-005 | memory/security.md | Every commit runs gitleaks + trufflehog-verified pre-commit + CI; any match blocks merge. | ENFORCED | .githooks/pre-commit runs gitleaks + trufflehog; gate:no-secrets in build-runner.sh | None | pre-commit-hook | Already implemented |
| SEC-006 | memory/security.md | Every key has a documented rotation SLA. | NONE | No rotation SLA documentation check | advisory | Document rotation SLA in vault metadata; no automated check feasible |
| SEC-007 | memory/security.md | A leak triggers the 60-minute breach runbook. | NONE | Advisory; operational procedure | advisory | Document in runbooks/secret-breach.md |
| SEC-008 | memory/security.md | Pillar 0 — Zero secrets at rest. gitleaks + trufflehog pre-commit hook + CI. | ENFORCED | .githooks/pre-commit + gate:no-secrets in build-runner.sh | None | pre-commit-hook | Already implemented |
| SEC-009 | memory/security.md | gate:no-secrets step in build-runner.sh. | ENFORCED | gate:no-secrets is step 0 in build-runner.sh | None | build-runner-gate | Already implemented |
| SEC-010 | memory/security.md | Historical scan run once per repo; any historical leak triggers immediate rotation. | NONE | No historical scan run confirmed | build-runner-gate | Add one-time historical scan step to CI bootstrap; log result to DB |
| SEC-011 | memory/security.md | Pillar 1 — Central Vault is single source of truth. | NONE | Advisory; infrastructure requirement | advisory | Document in architecture ADR |
| SEC-012 | memory/security.md | Vault is versioned, soft-delete, purge after 30 days. | NONE | Advisory; Vault configuration | advisory | Document in vault setup runbook |
| SEC-013 | memory/security.md | Pillar 2 — Machine identity + short-lived credentials. AppRole for services. | NONE | Advisory; infrastructure setup | advisory | Document in identity management ADR |
| SEC-014 | memory/security.md | OIDC for GitHub Actions → Vault (no long-lived PATs in CI secrets). | NONE | No CI PAT check | build-runner-gate | Add gate:supply-chain check for long-lived PAT patterns in CI config files |
| SEC-015 | memory/security.md | JWT for Cloudflare Workers. | NONE | Advisory; infrastructure config | advisory | Document in deployment runbook |
| SEC-016 | memory/security.md | Token TTL ≤ 15 minutes, renewable, IP-bound where possible. | NONE | Advisory; Vault policy configuration | advisory | Document in Vault policy files |
| SEC-017 | memory/security.md | Pillar 3 — Envelope encryption + HSM-backed root. Vault sealed by Shamir 3-of-5. | NONE | Advisory; infrastructure setup | advisory | Document in security architecture ADR |
| SEC-018 | memory/security.md | Future: GCP Cloud HSM or AWS CloudHSM as auto-unseal provider. | NONE | Advisory; future infrastructure | advisory | Track as a future ADR |
| SEC-019 | memory/security.md | Pillar 4 — Broker pattern. Apps never talk to Vault directly. | NONE | No broker-only access enforcement in code | build-runner-gate | Add gate:secrets-architecture scan ensuring only secrets-broker package contains vault client code |
| SEC-020 | memory/security.md | @plugins/secrets-broker validates caller via mTLS or signed JWT. | NONE | No mTLS/JWT validation check | contract-test | Add integration test asserting secrets-broker rejects unauthenticated callers |
| SEC-021 | memory/security.md | Broker is the only identity with broad vault policies. | NONE | Advisory; Vault policy assignment | advisory | Document in vault policy configuration |
| SEC-022 | memory/security.md | Pillar 5 — Runtime fetch, never build-time bake. Workers fetch on cold-start. | NONE | No runtime-fetch enforcement check | build-runner-gate | Extend gate:no-secrets to scan worker entrypoints for hardcoded env var assignments at module level |
| SEC-023 | memory/security.md | Next.js API routes: same runtime fetch pattern. | NONE | No API route secret-fetch pattern check | build-runner-gate | Extend gate:no-secrets to scan Next.js API routes for build-time secret references |
| SEC-024 | memory/security.md | Build-time inlining of secrets into static bundles is a hard fail in CI. | PARTIAL | gate:no-secrets scans source | Gap: post-build dist/ static bundles are not scanned | build-runner-gate | Add post-build scan of built artifacts in gate:no-secrets step |
| SEC-025 | memory/security.md | Pillar 6 — Least-privilege IAM. GCP SA scoped per property. | NONE | Advisory; GCP IAM configuration | advisory | Document in IAM policy runbook |
| SEC-026 | memory/security.md | Cloudflare tokens scoped to single zone + minimum permission. | NONE | Advisory; Cloudflare configuration | advisory | Document in deployment runbook |
| SEC-027 | memory/security.md | GitHub fine-grained PAT scoped to specific repos. | NONE | Advisory; GitHub settings | advisory | Document in repository access policy |
| SEC-028 | memory/security.md | Every key's scope + blast-radius documented in vault metadata. | NONE | Advisory; vault metadata | advisory | Document in vault key provisioning runbook |
| SEC-029 | memory/security.md | Pillar 7 — Rotation SLAs. High-value keys: 30d. | NONE | Advisory; operational SLA | advisory | Enforced by secret.rotation_due event when SEC-033 is implemented |
| SEC-030 | memory/security.md | Medium (billing APIs): 90d. | NONE | Advisory | advisory | Covered by SEC-033 rotation scheduler |
| SEC-031 | memory/security.md | Low (read-only public APIs): 180d. | NONE | Advisory | advisory | Covered by SEC-033 rotation scheduler |
| SEC-032 | memory/security.md | Emergency rotation on any anomaly. | NONE | Advisory; operational procedure | advisory | Document in breach runbook |
| SEC-033 | memory/security.md | Rotation scheduler task emits secret.rotation_due events when threshold is crossed. | NONE | No rotation scheduler task | daemon | Implement rotation_scheduler daemon that emits secret.rotation_due when key age exceeds SLA |
| SEC-034 | memory/security.md | Pillar 8 — Every vault fetch emits vault.secret_accessed with caller identity. | NONE | No vault fetch event emission in secrets-broker | build-runner-gate | Extend check-observability.ts to require vault.secret_accessed event call alongside vault fetch calls |
| SEC-035 | memory/security.md | Alerts: access pattern deviation, cross-environment access, unexpected IP. | NONE | No access-pattern monitoring | daemon | Implement vault access anomaly detector querying secret_accessed events for pattern deviations |
| SEC-036 | memory/security.md | Grafana dashboard /security/secrets shows realtime access + rotation status. | NONE | No Grafana dashboard for secrets | advisory | Track as infrastructure task; requires Grafana deployment |
| SEC-037 | memory/security.md | Pillar 9 — gitleaks + trufflehog in .githooks/pre-commit. | ENFORCED | .githooks/pre-commit runs both gitleaks and trufflehog | None | pre-commit-hook | Already implemented |
| SEC-038 | memory/security.md | GitHub Actions runs same on every PR + push. | ENFORCED | gate:no-secrets in build-runner.sh covers CI; GitHub Actions workflow uses same gate | None | build-runner-gate | Already implemented |
| SEC-039 | memory/security.md | Findings fail merge-gate. | ENFORCED | gate:no-secrets is step 0 in build-runner.sh with set -e; aborts on finding | None | build-runner-gate | Already implemented |
| SEC-040 | memory/security.md | Historical baseline scanned once per repo. | NONE | No historical scan confirmed as run | advisory | Run `gitleaks detect --source .` once on repo; document result |
| SEC-041 | memory/security.md | Pillar 10 — Broker needs credentials. Bootstrap via 1Password → env var at deploy → exchanged for short-lived token. | NONE | Advisory; bootstrap ceremony | advisory | Document in broker deployment runbook |
| SEC-042 | memory/security.md | Bootstrap ceremony documented. | NONE | Advisory; documentation | advisory | Document in runbooks/broker-bootstrap.md |
| SEC-043 | memory/security.md | Pillar 11 — 60-minute breach runbook at ~/Documents/runbooks/secret-breach.md. | NONE | Advisory; runbook existence | advisory | Verify runbook file exists; create if missing |
| SEC-044 | memory/security.md | Per-provider rotation commands documented. | NONE | Advisory; documentation | advisory | Document per-provider rotation in breach runbook |
| SEC-045 | memory/security.md | Persistence-sweep checklist documented. | NONE | Advisory; documentation | advisory | Document in breach runbook |
| SEC-046 | memory/security.md | Forensics steps documented. | NONE | Advisory; documentation | advisory | Document in breach runbook |
| SEC-047 | memory/security.md | Notification rules documented. | NONE | Advisory; documentation | advisory | Document in breach runbook |
| SEC-048 | memory/security.md | Pillar 12 — Pin every npm/pip dep. | NONE | No dep-pinning check in CI | build-runner-gate | Add `gate:supply-chain` step checking package-lock.json for unpinned ranges |
| SEC-049 | memory/security.md | npm audit --production + socket.dev or snyk in CI. | NONE | No npm audit step in build-runner.sh | build-runner-gate | Add gate:supply-chain step running npm audit --production and failing on high/critical |
| SEC-050 | memory/security.md | gate:supply-chain in build-runner. | NONE | gate:supply-chain is not a step in build-runner.sh | build-runner-gate | Add `gate:supply-chain` step to build-runner.sh (npm audit + dep pinning check) |
| SEC-051 | memory/security.md | Compromised dep could exfil secrets at runtime. | NONE | Advisory; rationale for SEC-048/049 | advisory | No independent enforcement; covered by SEC-048 and SEC-049 |
| SEC-052 | memory/security.md | Any code task that writes to .env* or commits credential-shaped strings must be auto-blocked. | NONE | No .env write detection in task execution | pre-commit-hook | Add pre-commit hook rule blocking any staged .env* file; add executor task-completion check for credential-shaped strings in diff |
| SEC-053 | memory/security.md | Any new key provisioning must first land in Vault, then app fetches via broker. | NONE | Advisory; key provisioning procedure | advisory | Document in key provisioning runbook |
| SEC-054 | memory/security.md | Any rotation event emits secret.rotated to the event bus. | NONE | No rotation event emission | runtime-middleware | Add event emission to rotation scheduler: emit secret.rotated after successful rotation |
| SEC-055 | memory/security.md | On any system.warning tagged secret-adjacent, circuit breaker pauses the originating task. | NONE | No secret-adjacent warning handler | runtime-middleware | Add system.warning event handler in executor that pauses originating task when tag includes secret-adjacent |

---

### TASK — Task Run Record Rules

| rule_id | memory_file | rule_text | current_enforcement | enforcement_gap | proposed_mechanism | proposed_implementation |
|---------|-------------|-----------|--------------------|-----------------|--------------------|------------------------|
| TASK-001 | memory/task-run.md | Every start_code_task or start_task call must be immediately followed by task_run_record. | NONE | task_run_record MCP tool exists but no enforcement of call sequence | runtime-middleware | Add MCP middleware asserting task_run_record is called within 5s of any start_code_task call |
| TASK-002 | memory/task-run.md | No exceptions. | NONE | No enforcement | runtime-middleware | Same as TASK-001; zero-tolerance enforcement in MCP middleware |
| TASK-003 | memory/task-run.md | When detecting a stall and respawning, call task_run_record with respawn_of_session_id. | NONE | No respawn tracking enforcement | runtime-middleware | Executor respawn path in completion-hook must call task_run_record with respawn_of_session_id |
| TASK-004 | memory/task-run.md | Both sides of the respawn link must be recorded. | NONE | No bidirectional respawn link | runtime-middleware | task_run_record call on respawn writes both original session_id and new session_id linkage |
| TASK-005 | memory/task-run.md | When a child task completes a meaningful unit, call task_run_subtask_upsert. | NONE | No subtask upsert enforcement | runtime-middleware | Executor completion hook calls task_run_subtask_upsert when task completes a sub-unit |
| TASK-006 | memory/task-run.md | Include this instruction in every new task prompt. | NONE | No subtask upsert instruction in dispatcher prompt | runtime-middleware | Dispatcher prompt builder includes task_run_subtask_upsert instruction for every new task |
| TASK-007 | memory/task-run.md | Tag every task_run with the domains it touches. | NONE | No domain tagging in task_run_record calls | runtime-middleware | Executor passes domain_slug from task to task_run_record call |
| TASK-008 | memory/task-run.md | Scope to poker-zeno, roulette-community, conductor, plugins as appropriate. | NONE | No scope enforcement | runtime-middleware | domain_slug column in task_run records populated from task.domain_slug |
| TASK-009 | memory/task-run.md | When a task reports done, call task_run_update with status='completed'. | NONE | No task_run_update enforcement | runtime-middleware | completion-hook must call task_run_update after marking task done |
| TASK-010 | memory/task-run.md | On failure, status='failed', result_ok=false. | NONE | No failed task_run_update enforcement | runtime-middleware | completion-hook must call task_run_update with status=failed on failure path |
| TASK-011 | memory/task-run.md | The poller is a safety net: apps/task-run-poller daemon scans local session JSONLs every 30s. | PARTIAL | task_run_record MCP tool exists; poller concept referenced | Gap: no verified task-run-poller daemon implementation found | daemon | Verify or implement apps/task-run-poller daemon that scans session JSONLs every 30s for missed task_run_record calls |
| TASK-012 | memory/task-run.md | Do not rely on poller as the primary — use the MCP tools at the moment of spawn. | NONE | No enforcement of MCP-first approach | runtime-middleware | Same as TASK-001; MCP middleware enforces immediate task_run_record at spawn time |

---

### TRACE — Prompt Trace Rules

| rule_id | memory_file | rule_text | current_enforcement | enforcement_gap | proposed_mechanism | proposed_implementation |
|---------|-------------|-----------|--------------------|-----------------|--------------------|------------------------|
| TRACE-001 | memory/trace.md | The first action on receiving any user prompt is prompt_create. Before analysis, before decomposition, before any LLM call. | NONE | No middleware enforcing prompt_create as first action | runtime-middleware | Add MCP server middleware: all incoming tool calls check prompt_id is set; first call must be prompt_create |
| TRACE-002 | memory/trace.md | The prompt must be persisted synchronously. | NONE | No synchronous persistence check | runtime-middleware | prompt_create MCP tool uses synchronous DB write; middleware blocks if prompt not found in DB before proceeding |
| TRACE-003 | memory/trace.md | The returned prompt_id threads through every downstream action as root_prompt_id and correlation_id. | NONE | root_prompt_id exists as nullable column; no threading enforcement | runtime-middleware | MCP server middleware passes prompt_id as context through all downstream tool calls |
| TRACE-004 | memory/trace.md | Steps: (1) call prompt_create synchronously, (2) receive prompt_id, (3) all subsequent tool calls thread correlation_id. | NONE | No step sequence enforcement | runtime-middleware | Same as TRACE-001/003; MCP session context tracks prompt_id and injects into all subsequent calls |
| TRACE-005 | memory/trace.md | Call story_decompose with root_prompt_id=prompt_id. | NONE | No root_prompt_id injection into story_decompose | runtime-middleware | story_decompose MCP tool handler requires root_prompt_id parameter; rejects if missing |
| TRACE-006 | memory/trace.md | Every leaf the decomposer produces must inherit root_prompt_id=prompt_id. | NONE | No leaf root_prompt_id inheritance enforcement | runtime-middleware | story_decompose propagates root_prompt_id to all generated leaf nodes in stories table |
| TRACE-007 | memory/trace.md | When responding to user, emit prompt.responded event. | NONE | No prompt.responded event emission | runtime-middleware | MCP SendUserMessage wrapper emits prompt.responded event with correlation_id |
| TRACE-008 | memory/trace.md | When all descendants reach done, emit prompt.completed event + compute elapsed_ms. | NONE | No prompt.completed event emission | daemon | Add prompt-completion tracker daemon: queries descendants of each prompt; emits prompt.completed when all done |
| TRACE-009 | memory/trace.md | No exceptions. Mechanical. | NONE | Advisory emphasis for TRACE-001 through TRACE-008 | runtime-middleware | Enforced by implementing TRACE-001 through TRACE-008 middleware |

---

## Summary by Proposed Mechanism

| Mechanism | Rule Count |
|-----------|-----------|
| build-runner-gate | 89 |
| runtime-middleware | 71 |
| daemon | 52 |
| advisory | 98 |
| eslint-rule | 17 |
| contract-test | 20 |
| db-constraint | 7 |
| pre-commit-hook | 3 |
| **Total** | **357** |

---

## Currently Enforced Rules (42)

| rule_id | Enforcing Mechanism |
|---------|---------------------|
| SEC-005 | .githooks/pre-commit (gitleaks + trufflehog) + gate:no-secrets |
| SEC-008 | .githooks/pre-commit |
| SEC-009 | build-runner.sh gate:no-secrets step 0 |
| SEC-037 | .githooks/pre-commit |
| SEC-038 | build-runner.sh + CI |
| SEC-039 | build-runner.sh abort on gate:no-secrets failure |
| ENFORCE-001 | build-runner.sh gate:observability |
| ENFORCE-003 | build-runner.sh gate:observability |
| ENFORCE-007 | build-runner.sh gate:coverage |
| EXEC-001 | executor_config.enabled defaults to false in DB schema |
| EXEC-002 | executor_config.max_concurrent=3, max_per_domain_concurrent=1 defaults in DB schema |
| EXEC-006 | completion-hook.ts checkAndBreak + executor_config.circuit_breaker_threshold=3 |
| EXEC-005 | dispatcher.ts git worktree per task |
| OBS-009 | build-runner.sh wraps all build invocations |
| OBS-011 | build-runner.sh assigns BUILD_RUN_ID |
| OBS-012 | build-runner.sh emits build.started |
| OBS-013 | build-runner.sh emits build.step_started per step |
| OBS-015 | build-runner.sh emits build.step_completed/failed |
| OBS-017 | build-runner.sh emits build.completed/aborted |

---

## Top Priority Gaps (Highest Leverage, Lowest Effort)

1. **HEALTH-009** — Add `.notNull()` to `tasks.root_prompt_id` in schema: single-line DB schema change, prevents null root traces permanently.
2. **TRACE-001/002/003** — MCP middleware enforcing prompt_create as first action: blocks all orphaned task creation with no prompt ancestry.
3. **TASK-001/TASK-002** — MCP middleware asserting task_run_record within 5s of spawn: closes the largest audit trail gap.
4. **AUTON-009/AUTON-010** — outbound_messages table + nightly phrase scanner: catches autonomy regressions automatically.
5. **DOM-001/DOM-002** — API validation requiring domain_tags on entity creation: prevents untagged entity accumulation.
6. **SEC-050** — Add `gate:supply-chain` to build-runner.sh: one new step in existing gate pipeline.
7. **ACCESS-035** — Add `gate:a11y` to build-runner.sh: one new step that covers ACCESS-001 through ACCESS-040 in batch.
