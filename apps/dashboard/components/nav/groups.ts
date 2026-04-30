/**
 * NAV_GROUPS — single source of truth for the dashboard's left-nav
 * accordion structure. Each group is a top-level section with its own icon
 * and a list of leaf links.
 *
 * In PR1 (`feat/dash-001-nav-restructure`) we restructure the nav into
 * groups but keep the existing flat URLs. Routes are migrated to the
 * canonical `/section/resource[/...]` schema in PR2
 * (`feat/dash-002-url-schema-redirect`) — once that lands the `path` values
 * here will be updated and the old paths become redirects.
 *
 * Reference: caia/docs/dashboard-url-schema.md (canonical IA spec, ships in
 * PR10).
 */

export interface NavLeaf {
  /** Active leaf link path (current — pre-PR2). */
  path: string;
  /** Display label in the nav. */
  label: string;
  /** Emoji icon. */
  icon: string;
  /** Tab key used by useUnseenBadges. */
  tabKey: string;
}

export interface NavGroup {
  /** Stable id, used for localStorage expanded-state and aria. */
  id: string;
  /** Section label. */
  label: string;
  /** Section emoji icon. */
  icon: string;
  /** Whether this group expands by default (multi-open). */
  defaultExpanded: boolean;
  /** Leaf links inside this section. */
  leaves: NavLeaf[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'work',
    label: 'Work',
    icon: '📋',
    defaultExpanded: true,
    leaves: [
      { path: '/prompts', label: 'Prompts', icon: '💬', tabKey: 'prompts' },
      { path: '/submit', label: 'Submit', icon: '➕', tabKey: 'submit' },
      { path: '/playground', label: 'Playground', icon: '🧪', tabKey: 'playground' },
      { path: '/queue', label: 'Queue', icon: '🎯', tabKey: 'queue' },
      { path: '/buckets', label: 'Buckets', icon: '🗂️', tabKey: 'buckets' },
      { path: '/stories', label: 'Stories', icon: '🌳', tabKey: 'stories' },
      { path: '/tasks', label: 'Tasks', icon: '📋', tabKey: 'tasks' },
      { path: '/requirements', label: 'Requirements', icon: '📝', tabKey: 'requirements' },
      { path: '/blockers', label: 'Blockers', icon: '🚨', tabKey: 'blockers' },
      { path: '/questions', label: 'Questions', icon: '❓', tabKey: 'questions' },
      { path: '/suggestions', label: 'Suggestions', icon: '💡', tabKey: 'suggestions' },
    ],
  },
  {
    id: 'pipeline',
    label: 'Pipeline',
    icon: '🔀',
    defaultExpanded: true,
    leaves: [
      { path: '/timeline', label: 'Timeline', icon: '🕒', tabKey: 'timeline' },
      { path: '/pipeline', label: 'Pipeline', icon: '🔀', tabKey: 'pipeline' },
      { path: '/events', label: 'Events', icon: '⚡', tabKey: 'events' },
      { path: '/task-runs', label: 'Task runs', icon: '📡', tabKey: 'task_runs' },
      { path: '/dag', label: 'Dependency graph', icon: '🕸️', tabKey: 'dag' },
    ],
  },
  {
    id: 'catalog',
    label: 'Catalog',
    icon: '📚',
    defaultExpanded: false,
    leaves: [
      { path: '/projects', label: 'Projects', icon: '📁', tabKey: 'projects' },
      { path: '/domains', label: 'Domains', icon: '🏷️', tabKey: 'domains' },
      { path: '/architecture', label: 'Architecture', icon: '🏛️', tabKey: 'architecture' },
      { path: '/contracts', label: 'Contracts', icon: '📃', tabKey: 'contracts' },
      { path: '/features', label: 'Features', icon: '🎯', tabKey: 'features' },
      { path: '/agents', label: 'Agents', icon: '🤖', tabKey: 'agents' },
      { path: '/registry', label: 'Registry', icon: '🗂️', tabKey: 'registry' },
    ],
  },
  {
    id: 'quality',
    label: 'Quality',
    icon: '✅',
    defaultExpanded: false,
    leaves: [
      { path: '/quality', label: 'Quality', icon: '📊', tabKey: 'quality' },
      { path: '/gates', label: 'Gates', icon: '🚪', tabKey: 'gates' },
      { path: '/tests', label: 'Tests', icon: '🧪', tabKey: 'tests' },
      { path: '/completeness', label: 'Completeness', icon: '✅', tabKey: 'completeness' },
    ],
  },
  {
    id: 'operations',
    label: 'Operations',
    icon: '🛠️',
    defaultExpanded: false,
    leaves: [
      { path: '/platform-status', label: 'Platform status', icon: '📊', tabKey: 'platform_status' },
      { path: '/health/pulse', label: 'Pulse', icon: '💚', tabKey: 'pulse' },
      { path: '/observability/health', label: 'Observability', icon: '👁', tabKey: 'obs_health' },
      { path: '/metrics', label: 'Metrics', icon: '📊', tabKey: 'metrics' },
      { path: '/builds', label: 'Builds', icon: '🔨', tabKey: 'builds' },
      { path: '/audit', label: 'Audit', icon: '🔍', tabKey: 'audit' },
    ],
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: '⚙️',
    defaultExpanded: false,
    leaves: [
      { path: '/settings', label: 'Settings', icon: '⚙️', tabKey: 'settings' },
      { path: '/standards', label: 'Standards', icon: '📋', tabKey: 'standards' },
      { path: '/adrs', label: 'ADRs', icon: '📜', tabKey: 'adrs' },
    ],
  },
];

/**
 * Flat list of every leaf — kept for backward-compatible code paths
 * (e.g. `currentTab` lookup). Generated from NAV_GROUPS.
 */
export const NAV_LEAVES: NavLeaf[] = NAV_GROUPS.flatMap((g) => g.leaves);

/**
 * Map a WS event kind prefix → tabKey for unseen-badge attribution.
 * Moved out of layout.tsx so the Sidebar component can own it.
 */
export function kindToTab(kind: string): string {
  if (kind.startsWith('task_run.')) return 'task_runs';
  if (kind.startsWith('behavior_test.')) return 'tests';
  if (kind.startsWith('priority.')) return 'queue';
  if (kind.startsWith('task-scheduler.') || kind.startsWith('ticket.')) return 'buckets';
  if (kind.startsWith('task.') || kind.startsWith('task_')) return 'tasks';
  if (kind.startsWith('requirement.')) return 'requirements';
  if (kind.startsWith('blocker.')) return 'blockers';
  if (kind.startsWith('question.')) return 'questions';
  if (kind.startsWith('adr.')) return 'adrs';
  if (kind.startsWith('feature.')) return 'features';
  if (kind.startsWith('suggestion.')) return 'suggestions';
  if (kind.startsWith('project.')) return 'projects';
  if (kind.startsWith('timeline.')) return 'timeline';
  if (kind.startsWith('audit.')) return 'audit';
  if (kind.startsWith('domain.') || kind.startsWith('entity.tagged') || kind.startsWith('entity.untagged')) return 'domains';
  if (kind.startsWith('story.')) return 'stories';
  if (kind.startsWith('completeness.')) return 'completeness';
  if (kind.startsWith('lock_contract.')) return 'standards';
  if (kind.startsWith('prompt.')) return 'prompts';
  if (kind.startsWith('agent.')) return 'agents';
  if (kind.startsWith('build.')) return 'builds';
  if (kind.startsWith('pipeline.')) return 'pipeline';
  return 'timeline';
}

/**
 * Roll up unseen counts by section group.
 */
export function groupUnseenCount(group: NavGroup, unseen: Record<string, number>): number {
  return group.leaves.reduce((sum, leaf) => sum + (unseen[leaf.tabKey] ?? 0), 0);
}
