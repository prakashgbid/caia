import { sqliteTable, text, integer, real, index, primaryKey } from 'drizzle-orm/sqlite-core';

// projects
export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  kind: text('kind').notNull(),
  repoUrl: text('repo_url'),
  liveUrl: text('live_url'),
  localPath: text('local_path'),
  status: text('status').notNull().default('active'),
  color: text('color'),
  icon: text('icon'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// requirements
export const requirements = sqliteTable('requirements', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  state: text('state').notNull().default('captured'),
  priority: integer('priority').notNull().default(3),
  labels: text('labels').notNull().default('[]'),
  targetProject: text('target_project'),
  estimatedFiles: text('estimated_files').notNull().default('[]'),
  dependsOn: text('depends_on').notNull().default('[]'),
  linkedTaskIds: text('linked_task_ids').notNull().default('[]'),
  spec: text('spec'),
  projectId: text('project_id').references(() => projects.id),
  scope: text('scope').notNull().default('global'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  rootPromptId: text('root_prompt_id'),
  parentEntityType: text('parent_entity_type'),
  parentEntityId: text('parent_entity_id'),
}, (t) => [
  index('req_project_idx').on(t.projectId),
  index('req_state_idx').on(t.state),
  index('req_root_prompt_idx').on(t.rootPromptId),
  index('req_parent_entity_idx').on(t.parentEntityId),
]);

// tasks
export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  sessionId: text('session_id'),
  status: text('status').notNull().default('queued'),
  cwd: text('cwd').notNull().default('/'),
  declaredFiles: text('declared_files').notNull().default('[]'),
  actualFiles: text('actual_files'),
  dependsOn: text('depends_on').notNull().default('[]'),
  spawnedBy: text('spawned_by').notNull().default('user'),
  bypassUsed: integer('bypass_used', { mode: 'boolean' }).notNull().default(false),
  notes: text('notes'),
  projectId: text('project_id').references(() => projects.id),
  scope: text('scope').notNull().default('global'),
  createdAt: text('created_at').notNull(),
  startedAt: text('started_at'),
  completedAt: text('completed_at'),
  attemptCount: integer('attempt_count').notNull().default(0),
  paused: integer('paused', { mode: 'boolean' }).notNull().default(false),
  pauseReason: text('pause_reason'),
  domainSlug: text('domain_slug'),
  rootPromptId: text('root_prompt_id').default('untraced'),
  parentEntityType: text('parent_entity_type'),
  parentEntityId: text('parent_entity_id'),
  priorityScore: integer('priority_score').notNull().default(50),
  priorityBucket: text('priority_bucket').notNull().default('P2'),
  positionOrdinal: integer('position_ordinal').notNull().default(0),
  priorityRationaleJson: text('priority_rationale_json'),
  lastPrioritizedAt: text('last_prioritized_at'),
}, (t) => [
  index('task_project_idx').on(t.projectId),
  index('task_status_idx').on(t.status),
  index('task_paused_idx').on(t.paused, t.status),
  index('task_root_prompt_idx').on(t.rootPromptId),
  index('task_parent_entity_idx').on(t.parentEntityId),
  index('task_priority_idx').on(t.priorityBucket, t.positionOrdinal),
]);

// blockers
export const blockers = sqliteTable('blockers', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  severity: text('severity').notNull().default('normal'),
  kind: text('kind').notNull().default('info'),
  description: text('description').notNull().default(''),
  resolutionSteps: text('resolution_steps').notNull().default('[]'),
  approvalButton: text('approval_button'),
  links: text('links').notNull().default('[]'),
  state: text('state').notNull().default('open'),
  requirementId: text('requirement_id'),
  taskId: text('task_id'),
  resolvedAt: text('resolved_at'),
  resolvedBy: text('resolved_by'),
  resolutionNote: text('resolution_note'),
  projectId: text('project_id').references(() => projects.id),
  scope: text('scope').notNull().default('global'),
  createdAt: text('created_at').notNull(),
  rootPromptId: text('root_prompt_id'),
  parentEntityType: text('parent_entity_type'),
  parentEntityId: text('parent_entity_id'),
}, (t) => [
  index('blocker_project_idx').on(t.projectId),
  index('blocker_state_idx').on(t.state),
  index('blocker_root_prompt_idx').on(t.rootPromptId),
  index('blocker_parent_entity_idx').on(t.parentEntityId),
]);

// questions
export const questions = sqliteTable('questions', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  priority: text('priority').notNull().default('normal'),
  context: text('context').notNull().default(''),
  recommendations: text('recommendations').notNull().default('[]'),
  customAnswerPlaceholder: text('custom_answer_placeholder'),
  state: text('state').notNull().default('open'),
  requirementId: text('requirement_id'),
  taskId: text('task_id'),
  answer: text('answer'),
  answeredAt: text('answered_at'),
  projectId: text('project_id').references(() => projects.id),
  scope: text('scope').notNull().default('global'),
  createdAt: text('created_at').notNull(),
  rootPromptId: text('root_prompt_id'),
  parentEntityType: text('parent_entity_type'),
  parentEntityId: text('parent_entity_id'),
}, (t) => [
  index('question_project_idx').on(t.projectId),
  index('question_state_idx').on(t.state),
  index('question_root_prompt_idx').on(t.rootPromptId),
  index('question_parent_entity_idx').on(t.parentEntityId),
]);

// adrs
export const adrs = sqliteTable('adrs', {
  id: text('id').primaryKey(),
  number: integer('number').notNull(),
  title: text('title').notNull(),
  status: text('status').notNull().default('proposed'),
  context: text('context').notNull().default(''),
  decision: text('decision').notNull().default(''),
  consequences: text('consequences').notNull().default(''),
  alternatives: text('alternatives').notNull().default('[]'),
  supersedes: text('supersedes'),
  projectId: text('project_id').references(() => projects.id),
  scope: text('scope').notNull().default('global'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (t) => [
  index('adr_project_idx').on(t.projectId),
  index('adr_number_idx').on(t.number),
]);

// business_features
export const businessFeatures = sqliteTable('business_features', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  phase: text('phase').notNull().default('1'),
  status: text('status').notNull().default('planned'),
  linkedRequirements: text('linked_requirements').notNull().default('[]'),
  targetDate: text('target_date'),
  projectId: text('project_id').references(() => projects.id),
  scope: text('scope').notNull().default('global'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (t) => [
  index('bf_project_idx').on(t.projectId),
  index('bf_phase_idx').on(t.phase),
]);

// proactive_suggestions
export const proactiveSuggestions = sqliteTable('proactive_suggestions', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  rationale: text('rationale').notNull().default(''),
  options: text('options').notNull().default('[]'),
  state: text('state').notNull().default('pending'),
  acceptedOption: text('accepted_option'),
  customAnswer: text('custom_answer'),
  projectId: text('project_id').references(() => projects.id),
  scope: text('scope').notNull().default('global'),
  createdAt: text('created_at').notNull(),
  resolvedAt: text('resolved_at'),
}, (t) => [
  index('sugg_project_idx').on(t.projectId),
  index('sugg_state_idx').on(t.state),
]);

// timeline_events
export const timelineEvents = sqliteTable('timeline_events', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(),
  actor: text('actor').notNull().default('system'),  // 'ai'|'user'|'system'|'hook'|'watchdog'|'pump'
  summary: text('summary').notNull().default(''),    // pre-rendered human-readable one-liner
  subjectId: text('subject_id').notNull(),
  subjectKind: text('subject_kind').notNull(),
  payload: text('payload').notNull().default('{}'),
  projectId: text('project_id').references(() => projects.id),
  createdAt: text('created_at').notNull(),
}, (t) => [
  index('tl_project_idx').on(t.projectId),
  index('tl_kind_idx').on(t.kind),
  index('tl_created_idx').on(t.createdAt),
  index('tl_actor_idx').on(t.actor, t.createdAt),
  index('tl_subject_idx').on(t.subjectKind, t.subjectId, t.createdAt),
]);

// domains
export const domains = sqliteTable('domains', {
  slug: text('slug').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  color: text('color').notNull().default('#718096'),
  icon: text('icon').notNull().default('📂'),
  parentSlug: text('parent_slug'),
  createdAt: text('created_at').notNull(),
});

// entity_domains — many-to-many join: one entity can belong to multiple domains
export const entityDomains = sqliteTable('entity_domains', {
  entityType: text('entity_type').notNull(), // requirement|blocker|question|adr|feature|suggestion|timeline
  entityId: text('entity_id').notNull(),
  domainSlug: text('domain_slug').notNull(),
  autoTagged: integer('auto_tagged', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
}, (t) => [
  primaryKey({ columns: [t.entityType, t.entityId, t.domainSlug] }),
  index('ed_domain_idx').on(t.domainSlug, t.entityType),
  index('ed_entity_idx').on(t.entityType, t.entityId),
]);

// audit_log
export const auditLog = sqliteTable('audit_log', {
  id: text('id').primaryKey(),
  actor: text('actor').notNull().default('ai'),
  action: text('action').notNull(),
  entityKind: text('entity_kind').notNull(),
  entityId: text('entity_id').notNull(),
  before: text('before'),
  after: text('after'),
  projectId: text('project_id').references(() => projects.id),
  createdAt: text('created_at').notNull(),
}, (t) => [
  index('audit_entity_idx').on(t.entityKind, t.entityId),
  index('audit_project_idx').on(t.projectId),
]);

// task_runs — records every orchestrator-spawned agent session
export const taskRuns = sqliteTable('task_runs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sessionId: text('session_id').notNull().unique(),
  title: text('title').notNull(),
  kind: text('kind').notNull().default('task'), // 'code-task' | 'task'
  cwd: text('cwd'),
  prompt: text('prompt'),
  status: text('status').notNull().default('pending'), // 'pending'|'running'|'idle'|'completed'|'stalled'|'aborted'|'failed'
  projectSlug: text('project_slug'),
  domainSlugs: text('domain_slugs').notNull().default('[]'), // JSON array
  parentSessionId: text('parent_session_id'),
  respawnOfSessionId: text('respawn_of_session_id'),
  startedAt: text('started_at').notNull(),
  lastActivityAt: text('last_activity_at').notNull(),
  endedAt: text('ended_at'),
  turnCount: integer('turn_count').notNull().default(0),
  completionSummary: text('completion_summary'),
  resultOk: integer('result_ok', { mode: 'boolean' }),
  rootPromptId: text('root_prompt_id'),
  parentEntityType: text('parent_entity_type'),
  parentEntityId: text('parent_entity_id'),
  executorPid: integer('executor_pid'),
  worktreePath: text('worktree_path'),
  toolCallCount: integer('tool_call_count').default(0),
  inputTokens: integer('input_tokens').default(0),
  outputTokens: integer('output_tokens').default(0),
  filesChanged: text('files_changed').default('[]'),
  durationMs: integer('duration_ms'),
  rawClaudeOutput: text('raw_claude_output'),
}, (t) => [
  index('tr_status_idx').on(t.status),
  index('tr_started_idx').on(t.startedAt),
  index('tr_project_idx').on(t.projectSlug),
  index('tr_respawn_idx').on(t.respawnOfSessionId),
  index('tr_root_prompt_idx').on(t.rootPromptId),
  index('tr_parent_entity_idx').on(t.parentEntityId),
]);

// task_subtasks — individual work items within a task run
export const taskSubtasks = sqliteTable('task_subtasks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  taskRunId: integer('task_run_id').notNull().references(() => taskRuns.id, { onDelete: 'cascade' }),
  ordinal: integer('ordinal'),
  title: text('title').notNull(),
  status: text('status').notNull().default('pending'), // 'pending'|'in_progress'|'done'|'failed'
  source: text('source').default('manual'), // 'todo'|'sub_agent'|'commit'|'manual'
  evidenceKind: text('evidence_kind'), // 'commit_sha'|'file_path'|'test_result'|'url'|'none'
  evidenceValue: text('evidence_value'),
  startedAt: text('started_at'),
  completedAt: text('completed_at'),
  detail: text('detail'), // JSON blob
}, (t) => [
  index('ts_task_run_idx').on(t.taskRunId),
]);

// behavior_tests — stable registry of behavioral/functional/layout test specs
export const behaviorTests = sqliteTable('behavior_tests', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  feature: text('feature').notNull(),
  scope: text('scope').notNull(),
  projectSlug: text('project_slug'),
  domainSlugs: text('domain_slugs').notNull().default('[]'),
  sourcePath: text('source_path'),
  firstSeenAt: text('first_seen_at').notNull(),
  lastSeenAt: text('last_seen_at').notNull(),
  expectedBehavior: text('expected_behavior').notNull().default(''),
  layoutContract: text('layout_contract'),  // JSON
  notes: text('notes'),
}, (t) => [
  index('bt_project_idx').on(t.projectSlug),
  index('bt_feature_idx').on(t.feature),
]);

// behavior_test_runs — history of individual test executions
export const behaviorTestRuns = sqliteTable('behavior_test_runs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  testId: text('test_id').notNull().references(() => behaviorTests.id, { onDelete: 'cascade' }),
  runAt: text('run_at').notNull(),
  durationMs: integer('duration_ms'),
  status: text('status').notNull().default('skip'),  // pass|fail|skip|flaky
  evidenceUrl: text('evidence_url'),
  failureExcerpt: text('failure_excerpt'),
  gitSha: text('git_sha'),
  ci: integer('ci', { mode: 'boolean' }).notNull().default(false),
}, (t) => [
  index('btr_test_idx').on(t.testId),
  index('btr_run_at_idx').on(t.runAt),
  index('btr_status_idx').on(t.status),
]);

// behavior_test_failures — structured failure records linked to runs
export const behaviorTestFailures = sqliteTable('behavior_test_failures', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  testRunId: integer('test_run_id').notNull().references(() => behaviorTestRuns.id, { onDelete: 'cascade' }),
  conductorBlockerId: text('conductor_blocker_id'),
  kind: text('kind').notNull().default('regression'),  // regression|new-bug|flake
  message: text('message').notNull().default(''),
  stackExcerpt: text('stack_excerpt'),
}, (t) => [
  index('btf_run_idx').on(t.testRunId),
]);

// task_run_events — timeline of significant events within a run
export const taskRunEvents = sqliteTable('task_run_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  taskRunId: integer('task_run_id').notNull().references(() => taskRuns.id, { onDelete: 'cascade' }),
  at: text('at').notNull(),
  turnCount: integer('turn_count'),
  eventKind: text('event_kind').notNull(), // 'poll_snapshot'|'subtask_started'|'subtask_done'|'respawn'|'abort'|'stall_detected'
  excerpt: text('excerpt'),
  payload: text('payload').notNull().default('{}'),
}, (t) => [
  index('tre_task_run_idx').on(t.taskRunId),
  index('tre_at_idx').on(t.at),
]);

// stories — decomposition tree nodes
export const stories = sqliteTable('stories', {
  id: text('id').primaryKey(),
  parentId: text('parent_id'),
  prevSiblingId: text('prev_sibling_id'),
  nextSiblingId: text('next_sibling_id'),
  ordinal: integer('ordinal').notNull().default(0),
  kind: text('kind').notNull().default('task'), // epic|story|sub_story|task|sub_task|todo
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  expectedBehavior: text('expected_behavior').notNull().default(''),
  acceptanceCriteriaJson: text('acceptance_criteria_json').notNull().default('[]'),
  verificationPlanJson: text('verification_plan_json').notNull().default('[]'),
  behaviorTestPath: text('behavior_test_path'),
  dependsOnJson: text('depends_on_json').notNull().default('[]'),
  projectSlug: text('project_slug'),
  domainSlugsJson: text('domain_slugs_json').notNull().default('[]'),
  status: text('status').notNull().default('pending'), // pending|verified|failed|partial
  createdAt: text('created_at').notNull(),
  lastDecomposedAt: text('last_decomposed_at'),
  behaviorTestSkeleton: text('behavior_test_skeleton'),
  rootPromptId: text('root_prompt_id'),
  parentEntityType: text('parent_entity_type'),
  parentEntityId: text('parent_entity_id'),
  // BA Agent enrichment columns (migration 0018)
  implementationNotes: text('implementation_notes'),
  updatedAt: integer('updated_at'),
  enrichedAt: integer('enriched_at'),
  // Phase-1 ticket-template + bucket linkage (migration 0021)
  agentContributionsJson: text('agent_contributions_json').notNull().default('{}'),
  bucketId: text('bucket_id'),
  templateVersion: text('template_version').notNull().default('v1'),
  templateValidationStatus: text('template_validation_status').notNull().default('pending'), // 'pending'|'valid'|'invalid'
  templateValidationErrors: text('template_validation_errors'),
  // BUCKET-001 — 9-axis taxonomy (migration 0023). Nullable on this
  // migration; required after BUCKET-007 backfill (migration 0025).
  businessSubDomainsJson: text('business_sub_domains_json').notNull().default('[]'),
  techSubDomainsJson: text('tech_sub_domains_json').notNull().default('[]'),
  techSubDomainPrimary: text('tech_sub_domain_primary'),  // TECH_SUB_DOMAINS
  lifecycle: text('lifecycle'),                            // LIFECYCLE_VALUES
  qualityTagsJson: text('quality_tags_json').notNull().default('[]'),
  risk: text('risk'),                                      // RISK_VALUES
  effort: text('effort'),                                  // EFFORT_VALUES
  priorityBucket: text('priority_bucket'),                 // PRIORITY_VALUES
  blockedByJson: text('blocked_by_json').notNull().default('[]'),
  softDependsOnJson: text('soft_depends_on_json').notNull().default('[]'),
  conflictsWithJson: text('conflicts_with_json').notNull().default('[]'),
  claimsJson: text('claims_json').notNull().default('{}'),
  // Migration 0025 — declarative input dependencies. Distinct from
  // `blockedByJson` (story-to-story ordering): this column lists inputs
  // the story needs to start, with `satisfiedBy` filled in by EA/BA once
  // a producing story exists. See `InputDependency` in @chiefaia/ticket-template.
  inputDependenciesJson: text('input_dependencies_json').notNull().default('[]'),
  // TEST-001 — story-driven testing framework (migration 0026)
  testCasesJson: text('test_cases_json').notNull().default('[]'),
  testDesignedAt: integer('test_designed_at'),
  testDesignStatus: text('test_design_status').notNull().default('pending'), // 'pending'|'designed'|'skipped'|'error'
  // VAL-003 — Story Validator agent (migration 0027)
  /** Structured ValidationReport (JSON-serialised) — see @chiefaia/ticket-template. */
  validationReport: text('validation_report'),
  /** Headline outcome: 'pending' | 'in_progress' | 'passed' | 'failed' | 'escalated' */
  validationStatus: text('validation_status').notNull().default('pending'),
  /** Number of Validator → BA round-trips. Capped at VERDICT_THRESHOLDS.maxAttempts. */
  validationAttempts: integer('validation_attempts').notNull().default(0),
  /** Epoch ms when the last validation run completed (pass or fail). */
  lastValidatedAt: integer('last_validated_at'),
  // FREG-006 (migration 0029): PO Agent's feature_registry classification.
  // links_to_json holds an array of feature_registry.id strings for the
  // matched features. featureClassification reflects the verdict.
  linksToJson: text('links_to_json').notNull().default('[]'),
  featureClassification: text('feature_classification'),               // 'enhance'|'ambiguous'|'new'|null
  featureClassificationScore: real('feature_classification_score'),    // cosine sim of top match
  featureClassificationAt: integer('feature_classification_at'),       // epoch ms
}, (t) => [
  index('story_parent_idx').on(t.parentId),
  index('story_project_idx').on(t.projectSlug),
  index('story_kind_idx').on(t.kind),
  index('story_root_prompt_idx').on(t.rootPromptId),
  index('story_parent_entity_idx').on(t.parentEntityId),
  index('story_bucket_idx').on(t.bucketId),
  index('story_template_status_idx').on(t.templateValidationStatus),
  // BUCKET-001 indexes (migration 0023)
  index('story_project_tech_idx').on(t.projectSlug, t.techSubDomainPrimary),
  index('story_lifecycle_idx').on(t.lifecycle),
  index('story_risk_idx').on(t.risk),
  index('story_priority_bucket_idx').on(t.priorityBucket),
  // 0025: bundle endpoint reads input_dependencies on every load; scheduler
  // scans for `satisfied_by IS NULL` to gate routing.
  index('story_input_deps_idx').on(t.status, t.parentEntityId),
  // TEST-001 index (migration 0026)
  index('story_test_design_status_idx').on(t.testDesignStatus),
  // VAL-003 indexes (migration 0027)
  index('story_validation_status_idx').on(t.validationStatus),
  index('story_validation_attempts_idx').on(t.validationAttempts),
  // FREG-006 index (migration 0029)
  index('story_feature_classification_idx').on(t.featureClassification),
]);

// story_revisions — append-only history of every story-tree edit
export const storyRevisions = sqliteTable('story_revisions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  storyId: text('story_id').notNull(),
  version: integer('version').notNull().default(1),
  snapshotJson: text('snapshot_json').notNull().default('{}'),
  changedAt: text('changed_at').notNull(),
  changedBy: text('changed_by').notNull().default('system'),
}, (t) => [
  index('sr_story_idx').on(t.storyId, t.version),
]);

// lock_contracts — canonical policy/standard documents; source of truth is DB not .md files
export const lockContracts = sqliteTable('lock_contracts', {
  id: text('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  kind: text('kind').notNull().default('standard'), // brand|a11y|domain|policy|protocol|standard
  title: text('title').notNull(),
  bodyMd: text('body_md').notNull().default(''),
  version: integer('version').notNull().default(1),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  checksum: text('checksum').notNull().default(''),
}, (t) => [
  index('lc_slug_idx').on(t.slug),
  index('lc_kind_idx').on(t.kind),
]);

// lock_contract_revisions — append-only version history
export const lockContractRevisions = sqliteTable('lock_contract_revisions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  contractId: text('contract_id').notNull(),
  version: integer('version').notNull(),
  bodyMd: text('body_md').notNull().default(''),
  changedAt: text('changed_at').notNull(),
  changedBy: text('changed_by').notNull().default('system'),
}, (t) => [
  index('lcr_contract_idx').on(t.contractId, t.version),
]);

// memory_anchors — maps .md file paths to their canonical DB rows
export const memoryAnchors = sqliteTable('memory_anchors', {
  path: text('path').primaryKey(),
  kind: text('kind').notNull().default('lock_contract'),
  refId: text('ref_id').notNull(),
  refTable: text('ref_table').notNull(),
  lastSyncedAt: text('last_synced_at').notNull(),
  checksumAtSync: text('checksum_at_sync').notNull().default(''),
}, (t) => [
  index('ma_ref_idx').on(t.refTable, t.refId),
]);

// db_backups — catalog of every SQLite backup taken
export const dbBackups = sqliteTable('db_backups', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  takenAt: text('taken_at').notNull(),
  path: text('path').notNull(),
  sizeBytes: integer('size_bytes').notNull().default(0),
  rowCountsJson: text('row_counts_json').notNull().default('{}'),
  checksum: text('checksum').notNull().default(''),
}, (t) => [
  index('dbb_taken_idx').on(t.takenAt),
]);

// completeness_runs — one row per entity per verification sweep
export const completenessRuns = sqliteTable('completeness_runs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  runAt: text('run_at').notNull(),
  entityKind: text('entity_kind').notNull(),
  entityId: text('entity_id').notNull(),
  checksTotal: integer('checks_total').notNull().default(0),
  checksPassed: integer('checks_passed').notNull().default(0),
  scorePct: integer('score_pct').notNull().default(0),
  status: text('status').notNull().default('pending'), // pending|pass|fail|error
  findingsJson: text('findings_json').notNull().default('[]'),
  durationMs: integer('duration_ms'),
}, (t) => [
  index('cr_entity_idx').on(t.entityKind, t.entityId),
  index('cr_run_at_idx').on(t.runAt),
  index('cr_status_idx').on(t.status),
]);

// completeness_findings — individual check failures within a run
export const completenessFindings = sqliteTable('completeness_findings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  runId: integer('run_id').notNull().references(() => completenessRuns.id, { onDelete: 'cascade' }),
  entityKind: text('entity_kind').notNull(),
  entityId: text('entity_id').notNull(),
  checkKind: text('check_kind').notNull(), // file_exists|url_200|test_pass|ui_region|behavior_test|commit_sha
  expected: text('expected').notNull().default(''),
  actual: text('actual').notNull().default(''),
  severity: text('severity').notNull().default('warning'), // critical|warning|info
  message: text('message').notNull().default(''),
  evidenceUrl: text('evidence_url'),
}, (t) => [
  index('cf_run_idx').on(t.runId),
  index('cf_entity_idx').on(t.entityKind, t.entityId),
]);

// completeness_schedule — singleton config for the cron daemon
export const completenessSchedule = sqliteTable('completeness_schedule', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  scheduleCron: text('schedule_cron').notNull().default('0 */2 * * *'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  lastRunAt: text('last_run_at'),
  nextRunAt: text('next_run_at'),
});

// executor_runs — one row per dispatched claude -p session
export const executorRuns = sqliteTable('executor_runs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  taskId: text('task_id').notNull(),
  attemptN: integer('attempt_n').notNull().default(1),
  sessionId: text('session_id'),
  pid: integer('pid'),
  workerKind: text('worker_kind').notNull().default('claude-p'),
  worktreePath: text('worktree_path'),
  startedAt: text('started_at').notNull(),
  endedAt: text('ended_at'),
  status: text('status').notNull().default('running'),
  turnCountAtEnd: integer('turn_count_at_end'),
  resultSummary: text('result_summary'),
  failureReason: text('failure_reason'),
  costUsd: real('cost_usd'),
}, (t) => [
  index('er_task_idx').on(t.taskId),
  index('er_status_idx').on(t.status),
  index('er_started_idx').on(t.startedAt),
]);

// executor_config — singleton row controlling the daemon
export const executorConfig = sqliteTable('executor_config', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
  maxConcurrent: integer('max_concurrent').notNull().default(3),
  maxPerDomainConcurrent: integer('max_per_domain_concurrent').notNull().default(1),
  circuitBreakerThreshold: integer('circuit_breaker_threshold').notNull().default(3),
  pollIntervalMs: integer('poll_interval_ms').notNull().default(10000),
  monitorIntervalMs: integer('monitor_interval_ms').notNull().default(30000),
  maxTurns: integer('max_turns').notNull().default(40),
  permissionMode: text('permission_mode').notNull().default('bypassPermissions'),
  updatedAt: text('updated_at').notNull(),
});

// task_attempts — audit trail of every execution attempt per task
export const taskAttempts = sqliteTable('task_attempts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  taskId: text('task_id').notNull(),
  attemptN: integer('attempt_n').notNull(),
  executorRunId: integer('executor_run_id'),
  status: text('status').notNull().default('running'),
  startedAt: text('started_at').notNull(),
  endedAt: text('ended_at'),
  failureReason: text('failure_reason'),
}, (t) => [
  index('ta_task_idx').on(t.taskId),
  index('ta_status_idx').on(t.status),
]);

// events — canonical event store (migration 0008)
export const events = sqliteTable('events', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  occurredAt: text('occurred_at').notNull(),
  actor: text('actor').notNull(),
  correlationId: text('correlation_id'),
  causationId: text('causation_id'),
  traceId: text('trace_id'),
  spanId: text('span_id'),
  entityType: text('entity_type'),
  entityId: text('entity_id'),
  projectSlug: text('project_slug'),
  domainSlugsJson: text('domain_slugs_json').notNull().default('[]'),
  payloadJson: text('payload_json').notNull().default('{}'),
  metadataJson: text('metadata_json').notNull().default('{}'),
  severity: text('severity').notNull().default('info'),
}, (t) => [
  index('ev_type_idx').on(t.type),
  index('ev_correlation_idx').on(t.correlationId),
  index('ev_entity_idx').on(t.entityId),
  index('ev_occurred_idx').on(t.occurredAt),
  index('ev_actor_idx').on(t.actor),
  index('ev_project_idx').on(t.projectSlug),
]);

// build_runs — one row per build-runner invocation (migration 0009)
export const buildRuns = sqliteTable('build_runs', {
  id: text('id').primaryKey(),
  trigger: text('trigger').notNull().default('user'),
  gitSha: text('git_sha'),
  branch: text('branch'),
  changedFilesJson: text('changed_files_json').notNull().default('[]'),
  status: text('status').notNull().default('running'),
  outcome: text('outcome'),
  startedAt: text('started_at').notNull(),
  endedAt: text('ended_at'),
  durationMs: integer('duration_ms'),
  stepsTotal: integer('steps_total').notNull().default(0),
  stepsFailed: integer('steps_failed').notNull().default(0),
  errorSignature: text('error_signature'),
  metadataJson: text('metadata_json').notNull().default('{}'),
}, (t) => [
  index('br_status_idx').on(t.status),
  index('br_started_idx').on(t.startedAt),
  index('br_git_sha_idx').on(t.gitSha),
]);

// build_steps — per-step detail within a build run
export const buildSteps = sqliteTable('build_steps', {
  id: text('id').primaryKey(),
  buildRunId: text('build_run_id').notNull().references(() => buildRuns.id),
  stepName: text('step_name').notNull(),
  command: text('command').notNull(),
  stepOrder: integer('step_order').notNull().default(0),
  status: text('status').notNull().default('running'),
  exitCode: integer('exit_code'),
  startedAt: text('started_at').notNull(),
  endedAt: text('ended_at'),
  durationMs: integer('duration_ms'),
  stdoutTail: text('stdout_tail'),
  stderrTail: text('stderr_tail'),
  errorSignature: text('error_signature'),
  maxRssBytes: integer('max_rss_bytes'),
}, (t) => [
  index('bs_run_idx').on(t.buildRunId),
  index('bs_status_idx').on(t.status),
]);

// build_retries — per-step retry audit
export const buildRetries = sqliteTable('build_retries', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  buildRunId: text('build_run_id').notNull().references(() => buildRuns.id),
  buildStepId: text('build_step_id').notNull().references(() => buildSteps.id),
  attemptN: integer('attempt_n').notNull().default(1),
  exitCode: integer('exit_code'),
  startedAt: text('started_at').notNull(),
  endedAt: text('ended_at'),
  errorSignature: text('error_signature'),
}, (t) => [
  index('bret_run_idx').on(t.buildRunId),
]);

// prompts — root entity capturing every user prompt for lineage tracing (migration 0010)
export const prompts = sqliteTable('prompts', {
  id: text('id').primaryKey(),
  body: text('body').notNull(),
  receivedAt: text('received_at').notNull(),
  receivedVia: text('received_via').notNull().default('chat'), // chat|api|cli|scheduled-task
  userId: text('user_id'),
  sessionId: text('session_id'),
  correlationId: text('correlation_id').notNull(),
  hash: text('hash').notNull(), // sha256 of body for dedup
  tokensIn: integer('tokens_in'),
  metadataJson: text('metadata_json').notNull().default('{}'),
  status: text('status').notNull().default('received'), // received|analyzing|decomposed|answered|failed
  completedAt: text('completed_at'),
  elapsedMs: integer('elapsed_ms'),
}, (t) => [
  index('prm_received_idx').on(t.receivedAt),
  index('prm_user_idx').on(t.userId, t.receivedAt),
  index('prm_status_idx').on(t.status),
  index('prm_hash_idx').on(t.hash),
]);

// prompt_responses — responses attached to a prompt (migration 0010)
export const promptResponses = sqliteTable('prompt_responses', {
  id: text('id').primaryKey(),
  promptId: text('prompt_id').notNull().references(() => prompts.id),
  responseBody: text('response_body').notNull().default(''),
  respondedAt: text('responded_at').notNull(),
  responseKind: text('response_kind').notNull().default('chat'), // decomposition|chat|clarification|error
  tokensOut: integer('tokens_out'),
  decompositionTreeJson: text('decomposition_tree_json'),
}, (t) => [
  index('pr_prompt_idx').on(t.promptId),
]);

// task_status_transitions — append-only audit of every task state machine transition (migration 0010)
export const taskStatusTransitions = sqliteTable('task_status_transitions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  taskId: text('task_id').notNull().references(() => tasks.id),
  fromStatus: text('from_status'),
  toStatus: text('to_status').notNull(),
  transitionedAt: text('transitioned_at').notNull(),
  actor: text('actor').notNull().default('system'), // user|executor|sentinel|worker|scheduler|breaker
  triggerEventId: text('trigger_event_id'),
  notes: text('notes'),
  rootPromptId: text('root_prompt_id'),
}, (t) => [
  index('tst_task_idx').on(t.taskId),
  index('tst_prompt_idx').on(t.rootPromptId),
  index('tst_at_idx').on(t.transitionedAt),
]);

// priority_audit — append-only log of every priority change (migration 0012)
export const priorityAudit = sqliteTable('priority_audit', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  taskId: text('task_id').notNull(),
  oldScore: integer('old_score'),
  newScore: integer('new_score').notNull(),
  oldBucket: text('old_bucket'),
  newBucket: text('new_bucket').notNull(),
  reason: text('reason').notNull().default(''),
  actor: text('actor').notNull().default('system'),
  changedAt: text('changed_at').notNull(),
}, (t) => [
  index('pa_task_idx').on(t.taskId),
  index('pa_changed_idx').on(t.changedAt),
]);

// pulse_runs — one row per `conductor pulse` health-check invocation (migration 0013)
export const pulseRuns = sqliteTable('pulse_runs', {
  id: text('id').primaryKey(),
  ranAt: text('ran_at').notNull(),
  outcome: text('outcome').notNull(), // PASSING | DEGRADED | CRITICAL | AUTO-HEALED
  canaryId: text('canary_id'),
  canaryElapsedMs: integer('canary_elapsed_ms'),
  checksJson: text('checks_json').notNull().default('[]'),
  invariantsJson: text('invariants_json').notNull().default('[]'),
  healsJson: text('heals_json').notNull().default('[]'),
  durationMs: integer('duration_ms').notNull().default(0),
}, (t) => [
  index('pulse_runs_ran_at_idx').on(t.ranAt),
  index('pulse_runs_outcome_idx').on(t.outcome),
]);

// agent_registry — canonical registry of all CAIA agents (migration 0017)
export const agentRegistry = sqliteTable('agent_registry', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  displayName: text('display_name').notNull(),
  tier: text('tier').notNull(), // 'strategic'|'planning'|'engineering'|'quality'|'growth'|'maintenance'
  description: text('description').notNull(),
  version: text('version').notNull().default('0.1.0'),
  status: text('status').notNull().default('registered'), // 'registered'|'active'|'disabled'|'error'
  endpointUrl: text('endpoint_url'),
  modelRecommendation: text('model_recommendation').notNull(), // 'opus'|'sonnet'|'haiku'|'local'
  capabilities: text('capabilities').notNull().default('[]'), // JSON array
  toolManifest: text('tool_manifest').notNull().default('[]'), // JSON array
  triggerEvents: text('trigger_events').notNull().default('[]'), // JSON array
  inputSchema: text('input_schema'),
  outputSchema: text('output_schema'),
  systemPromptId: text('system_prompt_id'),
  lastHeartbeat: integer('last_heartbeat'),
  metadata: text('metadata'), // JSON
  createdAt: integer('created_at').notNull().$defaultFn(() => Date.now()),
  updatedAt: integer('updated_at').notNull().$defaultFn(() => Date.now()),
}, (t) => [
  index('ar_tier_idx').on(t.tier),
  index('ar_status_idx').on(t.status),
]);

// agent_system_prompts — versioned system prompts for each agent (migration 0017)
export const agentSystemPrompts = sqliteTable('agent_system_prompts', {
  id: text('id').primaryKey(),
  agentName: text('agent_name').notNull(),
  version: text('version').notNull(),
  promptText: text('prompt_text').notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at').notNull().$defaultFn(() => Date.now()),
}, (t) => [
  index('asp_agent_idx').on(t.agentName, t.isActive),
]);

// agent_artifacts — outputs produced by agents (migration 0017)
export const agentArtifacts = sqliteTable('agent_artifacts', {
  id: text('id').primaryKey(),
  agentName: text('agent_name').notNull(),
  artifactType: text('artifact_type').notNull(), // 'architecture-plan'|'api-spec'|'db-schema'|'wireframe'|'test-plan'|'deployment-config'
  promptId: text('prompt_id').references(() => prompts.id),
  requirementId: text('requirement_id'),
  content: text('content').notNull(), // JSON or markdown
  contentType: text('content_type').notNull().default('application/json'),
  status: text('status').notNull().default('draft'), // 'draft'|'approved'|'superseded'
  createdAt: integer('created_at').notNull().$defaultFn(() => Date.now()),
}, (t) => [
  index('aa_agent_idx').on(t.agentName),
  index('aa_prompt_idx').on(t.promptId),
  index('aa_type_idx').on(t.artifactType),
]);

// agent_messages — inter-agent communication log (migration 0017)
export const agentMessages = sqliteTable('agent_messages', {
  id: text('id').primaryKey(),
  fromAgent: text('from_agent').notNull(),
  toAgent: text('to_agent').notNull(),
  // 'context-broadcast' | 'task-delegation' | 'result' | 'escalation'
  // | 'input-requested' | 'input-received' (migration 0022 — BA collab protocol)
  messageType: text('message_type').notNull(),
  correlationId: text('correlation_id').notNull(),
  payload: text('payload').notNull(), // JSON
  // 'pending' | 'delivered' | 'processed' | 'failed' | 'replied' | 'timed_out'
  status: text('status').notNull().default('pending'),
  createdAt: integer('created_at').notNull().$defaultFn(() => Date.now()),
  processedAt: integer('processed_at'),
  // Migration 0022 — request/response columns (nullable, backwards-compatible)
  expectedReplyBy: integer('expected_reply_by'),  // epoch ms deadline for the responder
  repliedAt: integer('replied_at'),                // epoch ms when reply landed
  parentMessageId: text('parent_message_id'),      // links a reply row back to its request
}, (t) => [
  index('am_from_idx').on(t.fromAgent),
  index('am_to_idx').on(t.toAgent),
  index('am_correlation_idx').on(t.correlationId),
  index('am_status_idx').on(t.status),
  index('am_parent_idx').on(t.parentMessageId),
  index('am_deadline_idx').on(t.expectedReplyBy),
]);

// prompt_pipeline_stages — tracks stage advancement for each prompt through the pipeline (migration 0015)
export const promptPipelineStages = sqliteTable('prompt_pipeline_stages', {
  id: text('id').primaryKey(),
  promptId: text('prompt_id').notNull().references(() => prompts.id),
  stage: text('stage').notNull(), // ingested|requirement_created|story_decomposed|task_queued|task_running|task_completed|verified
  entityKind: text('entity_kind'),
  entityId: text('entity_id'),
  enteredAt: integer('entered_at').notNull(),
  durationMs: integer('duration_ms'),
  metadata: text('metadata'), // JSON
}, (t) => [
  index('pps_prompt_idx').on(t.promptId),
  index('pps_stage_idx').on(t.stage),
]);

// entity_labels — domain taxonomy labels applied to any entity (migration 0019)
export const entityLabels = sqliteTable('entity_labels', {
  id: text('id').primaryKey().notNull(),
  entityKind: text('entity_kind').notNull(), // 'prompt'|'requirement'|'story'|'task'
  entityId: text('entity_id').notNull(),
  labelSlug: text('label_slug').notNull(),   // e.g. 'auth', 'ui-frontend', 'feature', 'medium'
  labelType: text('label_type').notNull(),   // 'domain'|'nature'|'complexity'|'layer'|'lifecycle'
  confidence: real('confidence').notNull().default(1.0),
  source: text('source').notNull().default('classifier'), // 'classifier'|'human'|'ai'
  createdAt: integer('created_at').notNull(),
}, (t) => [
  index('idx_el_entity').on(t.entityKind, t.entityId),
  index('idx_el_label').on(t.labelSlug),
  index('idx_el_type').on(t.labelType),
]);

// dedup_results — deduplication check results (migration 0019)
export const dedupResults = sqliteTable('dedup_results', {
  id: text('id').primaryKey().notNull(),
  entityKind: text('entity_kind').notNull(),
  entityId: text('entity_id').notNull(),
  checkedAt: integer('checked_at').notNull(),
  decision: text('decision').notNull(), // 'new'|'similar_concept'|'related'|'overlap'|'likely_duplicate'|'duplicate'
  similarityScore: real('similarity_score').notNull().default(0),
  similarEntities: text('similar_entities').notNull().default('[]'), // JSON array of {id, score, title}
  recommendations: text('recommendations').notNull().default('[]'),  // JSON array of recommendation strings
  resolvedAction: text('resolved_action'),  // 'proceed'|'merge'|'enhancement_of'|'override'
  resolvedAt: integer('resolved_at'),
  createdAt: integer('created_at').notNull(),
}, (t) => [
  index('idx_dr_entity').on(t.entityKind, t.entityId),
  index('idx_dr_decision').on(t.decision),
]);

// task_buckets — Phase-1 scheduling buckets (migration 0021 + 0024)
// Sequential buckets are partitioned by (project_slug, tech_sub_domain) per
// prompt (BUCKET-001/0024); one parallel bucket per prompt holds tickets
// that have no cross-bucket upstream deps. domain_slug is retained for
// backwards compatibility with pre-BUCKET-001 rows.
export const taskBuckets = sqliteTable('task_buckets', {
  id: text('id').primaryKey().notNull(),
  kind: text('kind').notNull(),                 // 'sequential' | 'parallel'
  domainSlug: text('domain_slug'),              // legacy — pre-BUCKET-001 rows
  /** BUCKET-001 (migration 0024): bucket-placement key dimension 1. */
  projectSlug: text('project_slug'),
  /** BUCKET-001 (migration 0024): bucket-placement key dimension 2. */
  techSubDomain: text('tech_sub_domain'),
  promptId: text('prompt_id').notNull().references(() => prompts.id),
  createdAt: integer('created_at').notNull(),   // epoch ms
  sequenceIndex: integer('sequence_index'),     // 0,1,2... for sequential, null for parallel
  status: text('status').notNull().default('open'), // 'open'|'in_progress'|'drained'
  metadata: text('metadata'),                   // JSON: bucket_label, predicted_concurrency, etc.
  /** BUCKET-008 (migration 0024): per-WCC level batches; persisted so the
   *  dashboard can render Kanban level-coloring without recomputing. */
  levelsJson: text('levels_json').notNull().default('[]'),
}, (t) => [
  index('idx_tb_prompt').on(t.promptId),
  index('idx_tb_kind_domain').on(t.kind, t.domainSlug),
  index('idx_tb_status').on(t.status),
  // BUCKET-001 indexes (migration 0024)
  index('idx_tb_prompt_project_tech').on(t.promptId, t.projectSlug, t.techSubDomain),
  index('idx_tb_project_tech').on(t.projectSlug, t.techSubDomain),
]);

// ─────────────────────────────────────────────────────────────────────────────
// feature_registry — FREG-001 (migration 0028)
//
// Catalog of every shipped feature/route/component/agent. Powers the PO
// Agent's new-vs-enhance lifecycle classification by way of a hybrid
// sqlite-vec + FTS5 search. See @chiefaia/feature-registry for the Zod
// schema, dedup-key helper, and search/write API.
//
// Embeddings live in a sibling vec0 virtual table (`feature_registry_vec`)
// declared in the SQL migration; drizzle doesn't model virtual tables so
// FREG-002 wires it via raw SQL on top of better-sqlite3.
// ─────────────────────────────────────────────────────────────────────────────
export const featureRegistry = sqliteTable('feature_registry', {
  id: text('id').primaryKey(),
  project: text('project').notNull(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  routePath: text('route_path'),
  filePathsJson: text('file_paths_json').notNull().default('[]'),
  componentName: text('component_name'),
  apiEndpoint: text('api_endpoint'),
  dbTablesJson: text('db_tables_json').notNull().default('[]'),
  agentName: text('agent_name'),
  shippedAt: integer('shipped_at').notNull(),
  storyId: text('story_id'),
  tagsJson: text('tags_json').notNull().default('[]'),
  embeddingModel: text('embedding_model').notNull().default('nomic-embed-text'),
  embeddingDim: integer('embedding_dim').notNull().default(768),
  embeddingVersion: text('embedding_version').notNull().default('v1.5'),
  source: text('source').notNull(),                       // FEATURE_REGISTRY_SOURCES
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  dedupKey: text('dedup_key').notNull().unique(),         // sha256 of (project,name,locator)
}, (t) => [
  index('freg_project_idx').on(t.project),
  index('freg_shipped_idx').on(t.shippedAt),
  index('freg_story_idx').on(t.storyId),
  index('freg_source_idx').on(t.source),
]);

// feature_registry_search_log — FREG-001 (migration 0028)
//
// One row per `registry.search` invocation. Powers FREG-007's "top match
// queries" + latency dashboards. Cleared on a 30-day TTL by a background
// sweep (added when the dashboard ships).
export const featureRegistrySearchLog = sqliteTable('feature_registry_search_log', {
  id: text('id').primaryKey(),
  query: text('query').notNull(),
  project: text('project'),                                // optional restriction
  classification: text('classification').notNull(),         // 'enhance'|'ambiguous'|'new'
  topMatchId: text('top_match_id'),                         // feature_registry.id when present
  topScore: real('top_score'),                              // cosine sim in [0,1]
  thresholdUsed: real('threshold_used').notNull(),
  latencyMs: integer('latency_ms').notNull(),
  embedderTokens: integer('embedder_tokens').notNull().default(0),
  hitCount: integer('hit_count').notNull().default(0),
  caller: text('caller').notNull().default('po-agent'),     // 'po-agent'|'manual'|'validator'|...
  createdAt: integer('created_at').notNull(),
}, (t) => [
  index('freg_log_created_idx').on(t.createdAt),
  index('freg_log_classification_idx').on(t.classification),
  index('freg_log_caller_idx').on(t.caller),
]);
