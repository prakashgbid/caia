import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { Conductor } from '../index';
import { startApiServer } from '../api/start';
import type { AddParams, TaskStatus } from '../core/types';
import { RequirementsManager } from '../requirements/manager';
import { NotificationQueue, getNotificationQueue } from '../notifications/index';
import { PumpEngine } from '../pump/index';
import type { ListRequirementsFilter, RequirementState } from '../requirements/types';
import { BlockersManager } from '../blockers/manager';
import type { BlockerState, CreateBlockerParams } from '../blockers/types';
import { QuestionsManager } from '../questions/manager';
import type { CreateQuestionParams, QuestionAnswer, QuestionState } from '../questions/types';
import { seedData } from './seed';
import { getDb } from '../db/connection';
import { adrs, businessFeatures, proactiveSuggestions, timelineEvents, auditLog, projects, tasks as dbTasks, blockers as dbBlockers, requirements as dbRequirements, domains, entityDomains } from '../db/schema';
import { desc, eq, and, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';

const HTTP_PORT = parseInt(process.env['CONDUCTOR_HTTP_PORT'] ?? '7776', 10);

function toolResult(data: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  };
}

function toolError(message: string): { content: Array<{ type: 'text'; text: string }>; isError: true } {
  return {
    content: [{ type: 'text', text: `Error: ${message}` }],
    isError: true,
  };
}

export async function startMcpServer(conductorDir?: string): Promise<void> {
  const conductor = new Conductor(conductorDir);
  await conductor.init();

  const reqManager = new RequirementsManager(conductorDir);
  await reqManager.init();

  const blockersManager = new BlockersManager(conductorDir);
  await blockersManager.init();

  const questionsManager = new QuestionsManager(conductorDir);
  await questionsManager.init();

  // Seed historical data on first run (idempotent by title check)
  await seedData(blockersManager, questionsManager);

  const notifications: NotificationQueue = getNotificationQueue(conductorDir);
  const pump = new PumpEngine(reqManager, notifications);

  // Start Hono API + WebSocket server
  await startApiServer(conductorDir);

  const server = new Server(
    { name: 'conductor', version: '0.2.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      // ─── Existing task tools ───────────────────────────────────────────────
      {
        name: 'conductor_check',
        description: 'Check if files are locked by running tasks',
        inputSchema: {
          type: 'object',
          properties: {
            files: { type: 'array', items: { type: 'string' }, description: 'File paths to check' },
          },
          required: ['files'],
        },
      },
      {
        name: 'conductor_add',
        description: 'Register a new task with file declarations',
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            cwd: { type: 'string' },
            files: { type: 'array', items: { type: 'string' } },
            dependsOn: { type: 'array', items: { type: 'string' } },
            notes: { type: 'string' },
          },
          required: ['title', 'cwd', 'files'],
        },
      },
      {
        name: 'conductor_start',
        description: 'Start a queued task',
        inputSchema: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
      },
      {
        name: 'conductor_complete',
        description: 'Mark a task as completed',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            actualFiles: { type: 'array', items: { type: 'string' } },
          },
          required: ['id'],
        },
      },
      {
        name: 'conductor_fail',
        description: 'Mark a task as failed',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            reason: { type: 'string' },
          },
          required: ['id'],
        },
      },
      {
        name: 'conductor_status',
        description: 'Get full conductor state',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'conductor_dag',
        description: 'Get task dependency graph',
        inputSchema: {
          type: 'object',
          properties: { rootId: { type: 'string' } },
        },
      },
      {
        name: 'conductor_list',
        description: 'List tasks with optional filters',
        inputSchema: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            owner: { type: 'string' },
          },
        },
      },
      {
        name: 'conductor_query',
        description: 'Natural language query about conductor state',
        inputSchema: {
          type: 'object',
          properties: { question: { type: 'string' } },
          required: ['question'],
        },
      },
      // ─── Requirements tools ────────────────────────────────────────────────
      {
        name: 'requirement_capture',
        description: 'Capture a new requirement from a casual description',
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Short human label' },
            description: { type: 'string', description: 'Free-form requirement description' },
            targetProject: { type: 'string', description: 'Path to target project, e.g. ~/Documents/projects/poker-zeno' },
            labels: { type: 'array', items: { type: 'string' } },
            priority: { type: 'number', description: '1 (top) to 5 (low), default 3' },
          },
          required: ['title', 'description'],
        },
      },
      {
        name: 'requirement_refine',
        description: 'Update requirement description, spec, notes, estimatedFiles, labels, or priority',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            patch: {
              type: 'object',
              properties: {
                description: { type: 'string' },
                estimatedFiles: { type: 'array', items: { type: 'string' } },
                labels: { type: 'array', items: { type: 'string' } },
                priority: { type: 'number' },
                targetProject: { type: 'string' },
                spec: {
                  type: 'object',
                  properties: {
                    goals: { type: 'array', items: { type: 'string' } },
                    nonGoals: { type: 'array', items: { type: 'string' } },
                    acceptanceCriteria: { type: 'array', items: { type: 'string' } },
                    notes: { type: 'string' },
                  },
                },
              },
            },
          },
          required: ['id', 'patch'],
        },
      },
      {
        name: 'requirement_set_state',
        description: 'Set requirement state (enforces valid transitions)',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            state: { type: 'string', description: 'captured|refining|specced|ready|executing|verifying|done|blocked|cancelled' },
          },
          required: ['id', 'state'],
        },
      },
      {
        name: 'requirement_add_dependency',
        description: 'Add a dependency between requirements (cycle-checked)',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            dependsOnId: { type: 'string' },
          },
          required: ['id', 'dependsOnId'],
        },
      },
      {
        name: 'requirement_list',
        description: 'List requirements with optional filters',
        inputSchema: {
          type: 'object',
          properties: {
            state: { type: 'string' },
            priority: { type: 'number' },
            labels: { type: 'array', items: { type: 'string' } },
          },
        },
      },
      {
        name: 'requirement_show',
        description: 'Show full detail of a single requirement',
        inputSchema: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
      },
      {
        name: 'requirement_pickup_next',
        description: 'Return highest-priority ready requirement (all deps done) and claim it as executing',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'requirement_mark_done',
        description: 'Mark a requirement as done (moves through verifying if needed)',
        inputSchema: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
      },
      {
        name: 'notification_enqueue',
        description: 'Enqueue a notification for a requirement (chat + native)',
        inputSchema: {
          type: 'object',
          properties: {
            requirementId: { type: 'string' },
            kind: { type: 'string', description: 'started|progress|completed|blocked' },
            message: { type: 'string' },
            channel: { type: 'string', description: 'chat|native|both (default both)' },
          },
          required: ['requirementId', 'kind', 'message'],
        },
      },
      {
        name: 'notification_drain',
        description: 'Return and clear all pending notifications (call on each heartbeat)',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'conductor_pump_tick',
        description: 'Run one pump cycle: pick next ready requirement, return spawn prompt + cwd',
        inputSchema: { type: 'object', properties: {} },
      },
      // ─── Blocker tools ─────────────────────────────────────────────────────
      {
        name: 'blocker_create',
        description: 'Create a new blocker that requires user action before work can continue. Fires a macOS notification.',
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Short human label' },
            severity: { type: 'string', description: 'critical|high|normal|low' },
            kind: { type: 'string', description: 'approval|credentials|dns|external-setup|info|decision' },
            description: { type: 'string', description: 'Why it is blocking' },
            resolutionSteps: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  order: { type: 'number' },
                  instruction: { type: 'string' },
                  verification: { type: 'string' },
                },
                required: ['order', 'instruction'],
              },
            },
            approvalButton: {
              type: 'object',
              properties: {
                label: { type: 'string' },
                payload: {},
              },
            },
            links: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  label: { type: 'string' },
                  url: { type: 'string' },
                },
                required: ['label', 'url'],
              },
            },
            requirementId: { type: 'string' },
            taskId: { type: 'string' },
          },
          required: ['title', 'severity', 'kind', 'description', 'resolutionSteps'],
        },
      },
      {
        name: 'blocker_list',
        description: 'List blockers, optionally filtered by state (open|resolved|cancelled)',
        inputSchema: {
          type: 'object',
          properties: { state: { type: 'string', description: 'open|resolved|cancelled' } },
        },
      },
      {
        name: 'blocker_resolve',
        description: 'Mark a blocker as resolved (called by dashboard button or orchestrator)',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            note: { type: 'string', description: 'Optional resolution note' },
          },
          required: ['id'],
        },
      },
      {
        name: 'blocker_drain',
        description: 'Return and clear newly-resolved blockers since last drain. Call on each heartbeat to surface approval payloads.',
        inputSchema: { type: 'object', properties: {} },
      },
      // ─── Question tools ────────────────────────────────────────────────────
      {
        name: 'question_create',
        description: 'Create a question that needs user input before proceeding. Fires a macOS notification.',
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            priority: { type: 'string', description: 'urgent|normal|nice-to-have' },
            context: { type: 'string', description: 'Background and why you are asking' },
            recommendations: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string', description: 'e.g. rec_A, rec_B' },
                  label: { type: 'string' },
                  rationale: { type: 'string' },
                  isDefault: { type: 'boolean' },
                },
                required: ['id', 'label', 'rationale'],
              },
            },
            customAnswerPlaceholder: { type: 'string' },
            requirementId: { type: 'string' },
            taskId: { type: 'string' },
          },
          required: ['title', 'priority', 'context', 'recommendations'],
        },
      },
      {
        name: 'question_list',
        description: 'List questions, optionally filtered by state (open|answered|cancelled)',
        inputSchema: {
          type: 'object',
          properties: { state: { type: 'string', description: 'open|answered|cancelled' } },
        },
      },
      {
        name: 'question_answer',
        description: 'Submit an answer to a question (called by dashboard submit or orchestrator)',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            answer: {
              type: 'object',
              properties: {
                kind: { type: 'string', description: 'accepted-recommendation|custom' },
                recommendationId: { type: 'string' },
                customText: { type: 'string' },
              },
              required: ['kind'],
            },
          },
          required: ['id', 'answer'],
        },
      },
      {
        name: 'question_drain',
        description: 'Return and clear newly-answered questions since last drain. Call on each heartbeat.',
        inputSchema: { type: 'object', properties: {} },
      },
      // ─── ADR tools ─────────────────────────────────────────────────────────
      {
        name: 'adr_create',
        description: 'Create a new Architecture Decision Record',
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            context: { type: 'string' },
            decision: { type: 'string' },
            consequences: { type: 'string' },
            status: { type: 'string' },
            alternatives: { type: 'array', items: { type: 'string' } },
            projectId: { type: 'string' },
            scope: { type: 'string' },
          },
          required: ['title', 'context', 'decision'],
        },
      },
      {
        name: 'adr_list',
        description: 'List ADRs with optional filters',
        inputSchema: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            projectId: { type: 'string' },
          },
        },
      },
      {
        name: 'adr_update',
        description: 'Update an ADR',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            status: { type: 'string' },
            decision: { type: 'string' },
            consequences: { type: 'string' },
          },
          required: ['id'],
        },
      },
      // ─── Feature tools ─────────────────────────────────────────────────────
      {
        name: 'feature_create',
        description: 'Create a business feature',
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            description: { type: 'string' },
            phase: { type: 'string', description: '1|2|3|icebox' },
            status: { type: 'string' },
            projectId: { type: 'string' },
            linkedRequirements: { type: 'array', items: { type: 'string' } },
            targetDate: { type: 'string' },
          },
          required: ['title'],
        },
      },
      {
        name: 'feature_list',
        description: 'List business features',
        inputSchema: {
          type: 'object',
          properties: {
            phase: { type: 'string' },
            status: { type: 'string' },
            projectId: { type: 'string' },
          },
        },
      },
      {
        name: 'feature_update',
        description: 'Update a business feature',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            status: { type: 'string' },
            phase: { type: 'string' },
            title: { type: 'string' },
          },
          required: ['id'],
        },
      },
      // ─── Suggestion tools ───────────────────────────────────────────────────
      {
        name: 'suggestion_create',
        description: 'AI creates a proactive suggestion for user review',
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            rationale: { type: 'string' },
            options: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  label: { type: 'string' },
                  description: { type: 'string' },
                },
              },
            },
            projectId: { type: 'string' },
          },
          required: ['title', 'rationale'],
        },
      },
      {
        name: 'suggestion_list',
        description: 'List proactive suggestions',
        inputSchema: {
          type: 'object',
          properties: {
            state: { type: 'string', description: 'pending|accepted|dismissed|custom' },
            projectId: { type: 'string' },
          },
        },
      },
      {
        name: 'suggestion_drain',
        description: 'Return all pending suggestions (non-destructive)',
        inputSchema: { type: 'object', properties: {} },
      },
      // ─── Timeline tools ─────────────────────────────────────────────────────
      {
        name: 'timeline_append',
        description: 'Append an event to the timeline activity log',
        inputSchema: {
          type: 'object',
          properties: {
            kind: { type: 'string', description: 'e.g. requirement.state_changed' },
            subjectId: { type: 'string' },
            subjectKind: { type: 'string', description: 'requirement|task|blocker|question|adr|feature' },
            payload: {},
            projectId: { type: 'string' },
          },
          required: ['kind', 'subjectId', 'subjectKind'],
        },
      },
      {
        name: 'timeline_query',
        description: 'Query timeline events',
        inputSchema: {
          type: 'object',
          properties: {
            since: { type: 'string', description: 'ISO datetime filter' },
            limit: { type: 'number' },
            kind: { type: 'string' },
            projectId: { type: 'string' },
          },
        },
      },
      // ─── Audit tools ────────────────────────────────────────────────────────
      {
        name: 'audit_query',
        description: 'Query the audit log',
        inputSchema: {
          type: 'object',
          properties: {
            entityKind: { type: 'string' },
            entityId: { type: 'string' },
            projectId: { type: 'string' },
            limit: { type: 'number' },
          },
        },
      },
      // ─── Metrics ────────────────────────────────────────────────────────────
      {
        name: 'metrics_snapshot',
        description: 'Get a metrics snapshot for a project or globally',
        inputSchema: {
          type: 'object',
          properties: {
            projectId: { type: 'string' },
          },
        },
      },
      // ─── Project tools ───────────────────────────────────────────────────────
      {
        name: 'project_list',
        description: 'List all projects',
        inputSchema: {
          type: 'object',
          properties: {
            status: { type: 'string', description: 'active|archived|planned' },
            kind: { type: 'string', description: 'site|plugin|framework|internal' },
          },
        },
      },
      {
        name: 'project_create',
        description: 'Create a new project',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            slug: { type: 'string' },
            kind: { type: 'string' },
            repoUrl: { type: 'string' },
            liveUrl: { type: 'string' },
            localPath: { type: 'string' },
            color: { type: 'string' },
            icon: { type: 'string' },
          },
          required: ['name', 'slug', 'kind'],
        },
      },
      // ─── Domain tools ────────────────────────────────────────────────────────
      {
        name: 'domain_list',
        description: 'List all domains with entity counts per type',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'domain_get',
        description: 'Get a domain with all its entities, optionally scoped to a project',
        inputSchema: {
          type: 'object',
          properties: {
            slug: { type: 'string', description: 'Domain slug' },
            projectId: { type: 'string' },
          },
          required: ['slug'],
        },
      },
      {
        name: 'domain_create',
        description: 'Create a new domain',
        inputSchema: {
          type: 'object',
          properties: {
            slug: { type: 'string' },
            name: { type: 'string' },
            description: { type: 'string' },
            color: { type: 'string' },
            icon: { type: 'string' },
            parentSlug: { type: 'string' },
          },
          required: ['slug', 'name'],
        },
      },
      {
        name: 'domain_update',
        description: 'Update domain metadata (name, description, color, icon)',
        inputSchema: {
          type: 'object',
          properties: {
            slug: { type: 'string' },
            name: { type: 'string' },
            description: { type: 'string' },
            color: { type: 'string' },
            icon: { type: 'string' },
          },
          required: ['slug'],
        },
      },
      {
        name: 'entity_tag_domain',
        description: 'Attach one or more domains to an entity (requirement|blocker|question|adr|feature|suggestion|timeline)',
        inputSchema: {
          type: 'object',
          properties: {
            entityType: { type: 'string', description: 'requirement|blocker|question|adr|feature|suggestion|timeline' },
            entityId: { type: 'string' },
            domains: { type: 'array', items: { type: 'string' }, description: 'Domain slugs to attach' },
          },
          required: ['entityType', 'entityId', 'domains'],
        },
      },
      {
        name: 'entity_untag_domain',
        description: 'Remove a domain tag from an entity',
        inputSchema: {
          type: 'object',
          properties: {
            entityType: { type: 'string' },
            entityId: { type: 'string' },
            domainSlug: { type: 'string' },
          },
          required: ['entityType', 'entityId', 'domainSlug'],
        },
      },
      {
        name: 'entity_list_by_domain',
        description: 'List all entities tagged with a given domain, optionally filtered by project or entity type',
        inputSchema: {
          type: 'object',
          properties: {
            domainSlug: { type: 'string' },
            entityType: { type: 'string', description: 'requirement|blocker|question|adr|feature|suggestion|timeline (omit for all)' },
            projectId: { type: 'string' },
            limit: { type: 'number' },
          },
          required: ['domainSlug'],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const a = (args ?? {}) as Record<string, unknown>;

    try {
      switch (name) {
        // ─── Existing task tools ─────────────────────────────────────────────
        case 'conductor_check': {
          const files = a['files'] as string[];
          return toolResult(conductor.check(files));
        }

        case 'conductor_add': {
          const params: AddParams = {
            title: a['title'] as string,
            cwd: a['cwd'] as string,
            files: a['files'] as string[],
            dependsOn: a['dependsOn'] as string[] | undefined,
            notes: a['notes'] as string | undefined,
          };
          return toolResult(await conductor.add(params));
        }

        case 'conductor_start':
          return toolResult(await conductor.start(a['id'] as string));

        case 'conductor_complete':
          return toolResult(
            await conductor.complete(
              a['id'] as string,
              a['actualFiles'] as string[] | undefined,
            ),
          );

        case 'conductor_fail':
          return toolResult(
            await conductor.fail(a['id'] as string, a['reason'] as string | undefined),
          );

        case 'conductor_status':
          return toolResult(conductor.status());

        case 'conductor_dag':
          return toolResult(conductor.dag(a['rootId'] as string | undefined));

        case 'conductor_list': {
          const filter: { status?: TaskStatus } = {};
          if (a['status']) filter.status = a['status'] as TaskStatus;
          return toolResult(conductor.list(filter));
        }

        case 'conductor_query': {
          const question = String(a['question']).toLowerCase();
          if (question.includes('running') || question.includes('active')) {
            return toolResult(conductor.list({ status: 'running' }));
          }
          if (question.includes('blocked')) {
            return toolResult(conductor.list({ status: 'blocked' }));
          }
          if (question.includes('complete') || question.includes('done')) {
            return toolResult(conductor.list({ status: 'completed' }));
          }
          return toolResult(conductor.status());
        }

        // ─── Requirements tools ──────────────────────────────────────────────
        case 'requirement_capture': {
          const req = await reqManager.capture({
            title: a['title'] as string,
            description: a['description'] as string,
            targetProject: a['targetProject'] as string | undefined,
            labels: a['labels'] as string[] | undefined,
            priority: a['priority'] as 1 | 2 | 3 | 4 | 5 | undefined,
          });
          return toolResult(req);
        }

        case 'requirement_refine': {
          const patch = a['patch'] as Record<string, unknown>;
          const req = await reqManager.refine(a['id'] as string, patch as Parameters<typeof reqManager.refine>[1]);
          return toolResult(req);
        }

        case 'requirement_set_state': {
          const req = await reqManager.setState(a['id'] as string, a['state'] as RequirementState);
          return toolResult(req);
        }

        case 'requirement_add_dependency': {
          const req = await reqManager.addDependency(a['id'] as string, a['dependsOnId'] as string);
          return toolResult(req);
        }

        case 'requirement_list': {
          const filter: ListRequirementsFilter = {};
          if (a['state']) filter.state = a['state'] as RequirementState;
          if (a['priority']) filter.priority = a['priority'] as 1 | 2 | 3 | 4 | 5;
          if (a['labels']) filter.labels = a['labels'] as string[];
          return toolResult(reqManager.list(filter));
        }

        case 'requirement_show': {
          const req = reqManager.get(a['id'] as string);
          if (!req) return toolError(`Requirement not found: ${String(a['id'])}`);
          return toolResult(req);
        }

        case 'requirement_pickup_next': {
          const result = await pump.tick();
          if (!result.picked) {
            return toolResult({ picked: null, message: 'No eligible requirements ready' });
          }
          return toolResult(result);
        }

        case 'requirement_mark_done': {
          const req = await reqManager.markDone(a['id'] as string);
          notifications.enqueue(req.id, 'completed', `Requirement "${req.title}" marked done`, 'both');
          return toolResult(req);
        }

        case 'notification_enqueue': {
          const notif = notifications.enqueue(
            a['requirementId'] as string,
            a['kind'] as 'started' | 'progress' | 'completed' | 'blocked',
            a['message'] as string,
            (a['channel'] as 'chat' | 'native' | 'both' | undefined) ?? 'both',
          );
          return toolResult(notif);
        }

        case 'notification_drain': {
          const pending = notifications.drain();
          return toolResult({ drained: pending.length, notifications: pending });
        }

        case 'conductor_pump_tick': {
          const result = await pump.tick();
          return toolResult(result);
        }

        // ─── Blocker tools ───────────────────────────────────────────────────
        case 'blocker_create': {
          const params: CreateBlockerParams = {
            title: a['title'] as string,
            severity: a['severity'] as CreateBlockerParams['severity'],
            kind: a['kind'] as CreateBlockerParams['kind'],
            description: a['description'] as string,
            resolutionSteps: a['resolutionSteps'] as CreateBlockerParams['resolutionSteps'],
            approvalButton: a['approvalButton'] as CreateBlockerParams['approvalButton'],
            links: a['links'] as CreateBlockerParams['links'],
            requirementId: a['requirementId'] as string | undefined,
            taskId: a['taskId'] as string | undefined,
          };
          const blocker = await blockersManager.create(params);
          return toolResult(blocker);
        }

        case 'blocker_list': {
          const state = a['state'] as BlockerState | undefined;
          return toolResult(blockersManager.list(state));
        }

        case 'blocker_resolve': {
          const blocker = await blockersManager.resolve(
            a['id'] as string,
            a['note'] as string | undefined,
          );
          return toolResult(blocker);
        }

        case 'blocker_drain': {
          const result = blockersManager.drain();
          return toolResult(result);
        }

        // ─── Question tools ──────────────────────────────────────────────────
        case 'question_create': {
          const params: CreateQuestionParams = {
            title: a['title'] as string,
            priority: a['priority'] as CreateQuestionParams['priority'],
            context: a['context'] as string,
            recommendations: a['recommendations'] as CreateQuestionParams['recommendations'],
            customAnswerPlaceholder: a['customAnswerPlaceholder'] as string | undefined,
            requirementId: a['requirementId'] as string | undefined,
            taskId: a['taskId'] as string | undefined,
          };
          const question = await questionsManager.create(params);
          return toolResult(question);
        }

        case 'question_list': {
          const state = a['state'] as QuestionState | undefined;
          return toolResult(questionsManager.list(state));
        }

        case 'question_answer': {
          const answer = a['answer'] as QuestionAnswer;
          const question = await questionsManager.answer(a['id'] as string, answer);
          return toolResult(question);
        }

        case 'question_drain': {
          const result = questionsManager.drain();
          return toolResult(result);
        }

        // ─── ADR tools ───────────────────────────────────────────────────────
        case 'adr_create': {
          const db = getDb();
          const now = new Date().toISOString();
          const id = 'adr_' + nanoid(8);
          const maxRow = db.select({ n: adrs.number }).from(adrs).orderBy(desc(adrs.number)).limit(1).all()[0];
          const number = (maxRow?.n ?? 0) + 1;
          const row = {
            id,
            number,
            title: a['title'] as string,
            status: (a['status'] as string) ?? 'proposed',
            context: (a['context'] as string) ?? '',
            decision: (a['decision'] as string) ?? '',
            consequences: (a['consequences'] as string) ?? '',
            alternatives: JSON.stringify(a['alternatives'] ?? []),
            supersedes: a['supersedes'] as string | undefined,
            projectId: a['projectId'] as string | undefined,
            scope: (a['scope'] as string) ?? 'global',
            createdAt: now,
            updatedAt: now,
          };
          db.insert(adrs).values(row).run();
          return toolResult(row);
        }

        case 'adr_list': {
          const db = getDb();
          let rows = db.select().from(adrs).orderBy(desc(adrs.number)).all();
          if (a['status']) rows = rows.filter(r => r.status === a['status']);
          if (a['projectId']) rows = rows.filter(r => r.projectId === a['projectId']);
          return toolResult(rows);
        }

        case 'adr_update': {
          const db = getDb();
          const now = new Date().toISOString();
          const id = a['id'] as string;
          const updateFields: Record<string, unknown> = { updatedAt: now };
          if (a['status'] !== undefined) updateFields['status'] = a['status'];
          if (a['decision'] !== undefined) updateFields['decision'] = a['decision'];
          if (a['consequences'] !== undefined) updateFields['consequences'] = a['consequences'];
          db.update(adrs).set(updateFields as Parameters<ReturnType<typeof db.update>['set']>[0]).where(eq(adrs.id, id)).run();
          const row = db.select().from(adrs).where(eq(adrs.id, id)).all()[0];
          if (!row) return toolError(`ADR not found: ${id}`);
          return toolResult(row);
        }

        // ─── Feature tools ───────────────────────────────────────────────────
        case 'feature_create': {
          const db = getDb();
          const now = new Date().toISOString();
          const id = 'feat_' + nanoid(8);
          const row = {
            id,
            title: a['title'] as string,
            description: (a['description'] as string) ?? '',
            phase: (a['phase'] as string) ?? '1',
            status: (a['status'] as string) ?? 'planned',
            linkedRequirements: JSON.stringify(a['linkedRequirements'] ?? []),
            targetDate: a['targetDate'] as string | undefined,
            projectId: a['projectId'] as string | undefined,
            scope: (a['scope'] as string) ?? 'global',
            createdAt: now,
            updatedAt: now,
          };
          db.insert(businessFeatures).values(row).run();
          return toolResult(row);
        }

        case 'feature_list': {
          const db = getDb();
          let rows = db.select().from(businessFeatures).all();
          if (a['phase']) rows = rows.filter(r => r.phase === a['phase']);
          if (a['status']) rows = rows.filter(r => r.status === a['status']);
          if (a['projectId']) rows = rows.filter(r => r.projectId === a['projectId']);
          return toolResult(rows);
        }

        case 'feature_update': {
          const db = getDb();
          const now = new Date().toISOString();
          const id = a['id'] as string;
          const updateFields: Record<string, unknown> = { updatedAt: now };
          if (a['status'] !== undefined) updateFields['status'] = a['status'];
          if (a['phase'] !== undefined) updateFields['phase'] = a['phase'];
          if (a['title'] !== undefined) updateFields['title'] = a['title'];
          db.update(businessFeatures).set(updateFields as Parameters<ReturnType<typeof db.update>['set']>[0]).where(eq(businessFeatures.id, id)).run();
          const row = db.select().from(businessFeatures).where(eq(businessFeatures.id, id)).all()[0];
          if (!row) return toolError(`Feature not found: ${id}`);
          return toolResult(row);
        }

        // ─── Suggestion tools ────────────────────────────────────────────────
        case 'suggestion_create': {
          const db = getDb();
          const now = new Date().toISOString();
          const id = 'sug_' + nanoid(8);
          const row = {
            id,
            title: a['title'] as string,
            rationale: (a['rationale'] as string) ?? '',
            options: JSON.stringify(a['options'] ?? []),
            state: 'pending',
            projectId: a['projectId'] as string | undefined,
            scope: (a['scope'] as string) ?? 'global',
            createdAt: now,
          };
          db.insert(proactiveSuggestions).values(row).run();
          return toolResult(row);
        }

        case 'suggestion_list': {
          const db = getDb();
          let rows = db.select().from(proactiveSuggestions).orderBy(desc(proactiveSuggestions.createdAt)).all();
          if (a['state']) rows = rows.filter(r => r.state === a['state']);
          if (a['projectId']) rows = rows.filter(r => r.projectId === a['projectId']);
          return toolResult(rows);
        }

        case 'suggestion_drain': {
          const db = getDb();
          const rows = db.select().from(proactiveSuggestions)
            .orderBy(desc(proactiveSuggestions.createdAt))
            .all()
            .filter(r => r.state === 'pending');
          return toolResult({ count: rows.length, suggestions: rows });
        }

        // ─── Timeline tools ──────────────────────────────────────────────────
        case 'timeline_append': {
          const db = getDb();
          const now = new Date().toISOString();
          const id = 'tl_' + nanoid(8);
          const row = {
            id,
            kind: a['kind'] as string,
            subjectId: a['subjectId'] as string,
            subjectKind: a['subjectKind'] as string,
            payload: JSON.stringify(a['payload'] ?? {}),
            projectId: a['projectId'] as string | undefined,
            createdAt: now,
          };
          db.insert(timelineEvents).values(row).run();
          return toolResult(row);
        }

        case 'timeline_query': {
          const db = getDb();
          const limitN = Math.min(parseInt(String(a['limit'] ?? '50'), 10), 200);
          let rows = db.select().from(timelineEvents).orderBy(desc(timelineEvents.createdAt)).limit(limitN).all();
          if (a['since']) rows = rows.filter(r => r.createdAt >= String(a['since']));
          if (a['kind']) rows = rows.filter(r => r.kind === a['kind']);
          if (a['projectId']) rows = rows.filter(r => r.projectId === a['projectId']);
          return toolResult(rows);
        }

        // ─── Audit tools ─────────────────────────────────────────────────────
        case 'audit_query': {
          const db = getDb();
          const limitN = Math.min(parseInt(String(a['limit'] ?? '100'), 10), 500);
          let rows = db.select().from(auditLog).orderBy(desc(auditLog.createdAt)).limit(limitN).all();
          if (a['entityKind']) rows = rows.filter(r => r.entityKind === a['entityKind']);
          if (a['entityId']) rows = rows.filter(r => r.entityId === a['entityId']);
          if (a['projectId']) rows = rows.filter(r => r.projectId === a['projectId']);
          return toolResult(rows);
        }

        // ─── Metrics ─────────────────────────────────────────────────────────
        case 'metrics_snapshot': {
          const db = getDb();
          const pId = a['projectId'] as string | undefined;

          const allTaskRows = db.select().from(dbTasks).all();
          const allBlockerRows = db.select().from(dbBlockers).all();
          const allReqRows = db.select().from(dbRequirements).all();

          const ft = pId ? allTaskRows.filter((t: { projectId: string | null }) => t.projectId === pId) : allTaskRows;
          const fb = pId ? allBlockerRows.filter((b: { projectId: string | null }) => b.projectId === pId) : allBlockerRows;
          const fr = pId ? allReqRows.filter((r: { projectId: string | null }) => r.projectId === pId) : allReqRows;

          return toolResult({
            totalTasks: ft.length,
            completedTasks: ft.filter((t: { status: string }) => t.status === 'completed').length,
            openBlockers: fb.filter((b: { state: string }) => b.state === 'open').length,
            totalRequirements: fr.length,
            doneRequirements: fr.filter((r: { state: string }) => r.state === 'done').length,
          });
        }

        // ─── Project tools ────────────────────────────────────────────────────
        case 'project_list': {
          const db = getDb();
          let rows = db.select().from(projects).all();
          if (a['status']) rows = rows.filter(p => p.status === a['status']);
          if (a['kind']) rows = rows.filter(p => p.kind === a['kind']);
          return toolResult(rows);
        }

        case 'project_create': {
          const db = getDb();
          const now = new Date().toISOString();
          const id = 'proj_' + nanoid(8);
          const row = {
            id,
            name: a['name'] as string,
            slug: a['slug'] as string,
            kind: a['kind'] as string,
            repoUrl: a['repoUrl'] as string | undefined,
            liveUrl: a['liveUrl'] as string | undefined,
            localPath: a['localPath'] as string | undefined,
            status: (a['status'] as string) ?? 'active',
            color: a['color'] as string | undefined,
            icon: a['icon'] as string | undefined,
            createdAt: now,
            updatedAt: now,
          };
          db.insert(projects).values(row).run();
          return toolResult(row);
        }

        // ─── Domain tools ────────────────────────────────────────────────────
        case 'domain_list': {
          const db = getDb();
          const allDomains = db.select().from(domains).all();
          const counts = db.select().from(entityDomains).all();
          const countMap: Record<string, Record<string, number>> = {};
          for (const row of counts) {
            if (!countMap[row.domainSlug]) countMap[row.domainSlug] = {};
            countMap[row.domainSlug][row.entityType] = (countMap[row.domainSlug][row.entityType] ?? 0) + 1;
          }
          return toolResult(allDomains.map(d => ({
            ...d,
            counts: countMap[d.slug] ?? {},
            totalEntities: Object.values(countMap[d.slug] ?? {}).reduce((s, v) => s + v, 0),
          })));
        }

        case 'domain_get': {
          const db = getDb();
          const slug = a['slug'] as string;
          const domain = db.select().from(domains).where(eq(domains.slug, slug)).all()[0];
          if (!domain) return toolError(`Domain not found: ${slug}`);
          const edRows = db.select().from(entityDomains).where(eq(entityDomains.domainSlug, slug)).all();
          const pId = a['projectId'] as string | undefined;
          const byType: Record<string, string[]> = {};
          for (const row of edRows) {
            if (!byType[row.entityType]) byType[row.entityType] = [];
            byType[row.entityType].push(row.entityId);
          }
          return toolResult({ domain, entityIdsByType: byType, filteredProject: pId });
        }

        case 'domain_create': {
          const db = getDb();
          const now = new Date().toISOString();
          const row = {
            slug: a['slug'] as string,
            name: a['name'] as string,
            description: (a['description'] as string) ?? '',
            color: (a['color'] as string) ?? '#718096',
            icon: (a['icon'] as string) ?? '📂',
            parentSlug: a['parentSlug'] as string | undefined,
            createdAt: now,
          };
          try {
            db.insert(domains).values(row).run();
          } catch (err) {
            return toolError(err instanceof Error ? err.message : String(err));
          }
          return toolResult(row);
        }

        case 'domain_update': {
          const db = getDb();
          const slug = a['slug'] as string;
          const allowed = ['name', 'description', 'color', 'icon', 'parentSlug'] as const;
          const update: Record<string, unknown> = {};
          for (const k of allowed) if (a[k] !== undefined) update[k] = a[k];
          if (Object.keys(update).length) {
            db.update(domains).set(update as Parameters<ReturnType<typeof db.update>['set']>[0]).where(eq(domains.slug, slug)).run();
          }
          const row = db.select().from(domains).where(eq(domains.slug, slug)).all()[0];
          if (!row) return toolError(`Domain not found: ${slug}`);
          return toolResult(row);
        }

        case 'entity_tag_domain': {
          const db = getDb();
          const entityType = a['entityType'] as string;
          const entityId = a['entityId'] as string;
          const slugs = a['domains'] as string[];
          const now = new Date().toISOString();
          const added: string[] = [];
          for (const domainSlug of slugs) {
            try {
              db.insert(entityDomains).values({ entityType, entityId, domainSlug, autoTagged: false, createdAt: now }).run();
              added.push(domainSlug);
            } catch { /* already tagged */ }
          }
          return toolResult({ entityType, entityId, added });
        }

        case 'entity_untag_domain': {
          const db = getDb();
          db.delete(entityDomains).where(
            and(
              eq(entityDomains.entityType, a['entityType'] as string),
              eq(entityDomains.entityId, a['entityId'] as string),
              eq(entityDomains.domainSlug, a['domainSlug'] as string),
            )
          ).run();
          return toolResult({ removed: a['domainSlug'] });
        }

        case 'entity_list_by_domain': {
          const db = getDb();
          const domainSlug = a['domainSlug'] as string;
          const filterType = a['entityType'] as string | undefined;
          const pId = a['projectId'] as string | undefined;
          const limitN = Math.min(parseInt(String(a['limit'] ?? '100'), 10), 500);

          let edRows = db.select().from(entityDomains).where(eq(entityDomains.domainSlug, domainSlug)).all();
          if (filterType) edRows = edRows.filter(r => r.entityType === filterType);

          const byType: Record<string, string[]> = {};
          for (const row of edRows) {
            if (!byType[row.entityType]) byType[row.entityType] = [];
            byType[row.entityType].push(row.entityId);
          }

          // Fetch actual entity data for each type
          const result: Record<string, unknown[]> = {};
          for (const [type, ids] of Object.entries(byType)) {
            if (!ids.length) continue;
            const idSet = ids.slice(0, limitN);
            let rows: Array<{ id: string; projectId?: string | null }> = [];
            if (type === 'requirement') rows = db.select().from(dbRequirements).all().filter(r => idSet.includes(r.id));
            else if (type === 'blocker') rows = db.select().from(dbBlockers).all().filter(r => idSet.includes(r.id));
            else if (type === 'adr') rows = db.select().from(adrs).all().filter(r => idSet.includes(r.id));
            else if (type === 'feature') rows = db.select().from(businessFeatures).all().filter(r => idSet.includes(r.id));
            else if (type === 'suggestion') rows = db.select().from(proactiveSuggestions).all().filter(r => idSet.includes(r.id));
            else if (type === 'timeline') rows = db.select().from(timelineEvents).all().filter(r => idSet.includes(r.id));
            if (pId) rows = rows.filter(r => r.projectId === pId);
            result[type] = rows;
          }
          return toolResult(result);
        }

        default:
          return toolError(`Unknown tool: ${name}`);
      }
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
