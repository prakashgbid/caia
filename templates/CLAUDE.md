# Conductor — Task Orchestration Rules

These rules govern how I (Claude) spawn and track parallel code tasks to prevent file-conflict races and cross-conversation state loss.

## Task-Spawn Protocol

Before calling `start_task` or `start_code_task`, I MUST:
1. Identify the file globs the task will touch (e.g., `src/auth/**`, `migrations/*.sql`)
2. Include a conductor declaration in the task prompt:
   ```
   <conductor files="src/auth/**,migrations/*.sql" depends_on="tsk_A1B2"/>
   ```
3. The pre-spawn hook enforces this — missing tag = spawn blocked.

## Status Queries

When the user asks "what's running?", "is X done?", or "what tasks are active?":
- Call `conductor_status()` or `conductor_list()` first
- Never narrate from memory — always query current state

## Completion Ritual

When a task reports completion:
1. Call `conductor_complete(id, actualFiles)` with the actual files touched
2. THEN tell the user it's done
This keeps file locks accurate and enables drift detection.

## Fail-Safe Mode

If conductor MCP is unreachable:
- Fall back to `list_sessions` for visibility
- Warn the user: "Conductor offline — running in degraded mode, serializing spawns"
- Prefer sequential spawning until conductor is restored

## Dependency Declaration

If task B depends on files from task A, declare:
```
<conductor files="src/..." depends_on="tsk_A1B2"/>
```
Conductor will automatically block B until A completes.

---

## Requirements Management (Autonomous Pipeline)

### On Every Turn + Every Heartbeat

At the start of EVERY user interaction and on every heartbeat notification, the orchestrator MUST:

```typescript
// 1. Surface pending notifications to the user
const pending = await conductor_mcp.notification_drain();
if (pending.notifications.length > 0) {
  // Tell the user: "Conductor update: {notification.message}" for each
}

// 2. Drain resolved blockers — surfaces user approvals back to orchestrator
const blockerDrain = await conductor_mcp.blocker_drain();
for (const { blocker, approvalPayload } of blockerDrain.resolvedBlockers) {
  // Tell the user: "Blocker resolved: {blocker.title}"
  // If approvalPayload is present, continue the paused work that was waiting
  console.log(`Blocker resolved: ${blocker.title}`, approvalPayload);
}

// 3. Drain answered questions — surfaces user answers back to orchestrator
const questionDrain = await conductor_mcp.question_drain();
for (const { question } of questionDrain.answeredQuestions) {
  // Tell the user: "Question answered: {question.title} — {answer summary}"
  // Use question.answer to continue the paused decision path
  console.log(`Question answered: ${question.title}`, question.answer);
}

// 4. Attempt to pick up next ready requirement
const next = await conductor_mcp.requirement_pickup_next();
if (next.picked) {
  // Spawn a code task with next.prompt in next.cwd
  const taskId = await start_code_task({ prompt: next.prompt, cwd: next.cwd });
  // Link it back
  await conductor_mcp.requirement_refine(next.picked.id, {});
  // The pump already set state to 'executing'
}
```

### Capturing Requirements

When the user describes something to build (casual or formal):
1. `requirement_capture(title, description, targetProject?, labels?, priority?)`
2. Tell the user: "Captured as {id} — I'll refine and queue it"
3. Immediately refine: add estimatedFiles, spec.goals, spec.acceptanceCriteria
4. Set state to 'specced' then 'ready' when spec is complete
5. The pump will pick it up on the next tick — NO further user input needed

### Never Block on Approvals

- Requirements move through the pipeline autonomously once in 'ready' state
- The user is notified when work starts (native + chat) and when it completes
- Do NOT ask "should I proceed?" for 'ready' requirements
- Only pause for 'blocked' state (explicit dependency not met)

### Requirement States Reference

```
captured → refining → specced → ready → executing → verifying → done
                                   ↓                      ↑
                                blocked ──────────────────┘
         (any state) → cancelled
```

### Quick Reference: Requirement MCP Tools

| Tool | When to call |
|------|-------------|
| `requirement_capture` | User describes something to build |
| `requirement_refine` | Adding spec, files, or updating description |
| `requirement_set_state` | Manually advancing state |
| `requirement_add_dependency` | R-B needs R-A to finish first |
| `requirement_list` | Checking pipeline status |
| `requirement_show` | Getting detail on one requirement |
| `requirement_pickup_next` | Heartbeat: claim next eligible work |
| `requirement_mark_done` | After verifying task output |
| `notification_drain` | Every turn: surface pending notifications |
| `conductor_pump_tick` | Alias for pickup_next + spawn |

---

## Blockers & Questions (User-Action Loop)

### When to create a Blocker

Create a blocker when work **cannot continue** until the user takes an external action:
- Manual setup in a third-party dashboard (DNS, OAuth, storage)
- Approval required (payment, legal, infra provisioning)
- Credentials or secrets that must be obtained by the user
- External dependencies outside the codebase

```typescript
await conductor_mcp.blocker_create({
  title: 'Enable Cloudflare R2 in dashboard',
  severity: 'high',          // critical|high|normal|low
  kind: 'external-setup',    // approval|credentials|dns|external-setup|info|decision
  description: 'R2 storage cannot be used until manually enabled in the Cloudflare dashboard.',
  resolutionSteps: [
    { order: 1, instruction: 'Go to dash.cloudflare.com → R2 → Enable', verification: 'R2 dashboard shows Create Bucket button' },
  ],
  links: [{ label: 'Cloudflare Dashboard', url: 'https://dash.cloudflare.com' }],
});
// → blocker ID returned; macOS notification fired; dashboard badge incremented
```

### When to create a Question

Create a question when there are **multiple valid approaches** and you need the user's preference before writing code:

```typescript
await conductor_mcp.question_create({
  title: 'Image storage: R2 or S3?',
  priority: 'urgent',        // urgent|normal|nice-to-have
  context: 'We need to store ~50 GB of user-uploaded images. Both R2 and S3 work technically.',
  recommendations: [
    { id: 'rec_A', label: 'Cloudflare R2 (no egress fees)', rationale: 'Free egress; already in our CF account', isDefault: true },
    { id: 'rec_B', label: 'AWS S3', rationale: 'More mature tooling; familiar to the team' },
  ],
  customAnswerPlaceholder: 'Different provider or hybrid setup...',
});
// → question ID returned; macOS notification fired
```

### Quick Reference: Blocker & Question MCP Tools

| Tool | When to call |
|------|-------------|
| `blocker_create` | Work is blocked on a user action |
| `blocker_list` | Check open blockers |
| `blocker_resolve` | Programmatically resolve a blocker |
| `blocker_drain` | **Every heartbeat** — get newly-resolved blockers + approval payloads |
| `question_create` | Need user input before deciding approach |
| `question_list` | Check open questions |
| `question_answer` | Programmatically submit an answer |
| `question_drain` | **Every heartbeat** — get newly-answered questions |
