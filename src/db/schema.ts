import { sqliteTable, text, integer, index, primaryKey } from 'drizzle-orm/sqlite-core';

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
}, (t) => [
  index('req_project_idx').on(t.projectId),
  index('req_state_idx').on(t.state),
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
}, (t) => [
  index('task_project_idx').on(t.projectId),
  index('task_status_idx').on(t.status),
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
}, (t) => [
  index('blocker_project_idx').on(t.projectId),
  index('blocker_state_idx').on(t.state),
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
}, (t) => [
  index('question_project_idx').on(t.projectId),
  index('question_state_idx').on(t.state),
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
}, (t) => [
  index('tr_status_idx').on(t.status),
  index('tr_started_idx').on(t.startedAt),
  index('tr_project_idx').on(t.projectSlug),
  index('tr_respawn_idx').on(t.respawnOfSessionId),
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
