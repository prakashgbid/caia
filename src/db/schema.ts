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
