'use client';

/**
 * usePromptContext — derives the prompt-from-anywhere context payload
 * from the current URL + filter state. Used by the floating prompt
 * button (DASH-011) and any inline `+` button to send a prompt to
 * /api/prompts with metadata.context attached.
 *
 * Spec: caia/docs/dashboard-ui-conventions.md §5.
 */

import { useMemo } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

const SECTION_LABELS: Record<string, string> = {
  work: 'Work',
  pipeline: 'Pipeline',
  catalog: 'Catalog',
  quality: 'Quality',
  operations: 'Operations',
  settings: 'Settings',
};

const KNOWN_SEGMENTS: Record<string, string> = {
  prompts: 'Prompts',
  stories: 'Stories',
  tasks: 'Tasks',
  blockers: 'Blockers',
  requirements: 'Requirements',
  questions: 'Questions',
  suggestions: 'Suggestions',
  queue: 'Queue',
  buckets: 'Buckets',
  submit: 'Submit',
  journey: 'Journey',
  pipeline: 'Pipeline',
  agents: 'Agents',
  architecture: 'Architecture',
  contracts: 'Contracts',
  features: 'Features',
  domains: 'Domains',
  projects: 'Projects',
  registry: 'Registry',
  gates: 'Gates',
  tests: 'Tests',
  completeness: 'Completeness',
  health: 'Health',
  observability: 'Observability',
  metrics: 'Metrics',
  builds: 'Builds',
  audit: 'Audit',
  standards: 'Standards',
  adrs: 'ADRs',
  reports: 'Reports',
  timeline: 'Timeline',
  events: 'Events',
  'task-runs': 'Task runs',
  dag: 'DAG',
};

export interface PromptScopeHint {
  projectSlug?: string;
  promptId?: string;
  storyId?: string;
  taskId?: string;
  agentId?: string;
  blockerId?: string;
  requirementId?: string;
  questionId?: string;
}

export interface PromptContext {
  currentRoute: string;
  breadcrumb: string[];
  scope_hint: PromptScopeHint;
  submittedFrom: string;
  filterState: Record<string, string>;
}

function deriveBreadcrumb(segments: string[]): string[] {
  return segments.map((seg) => {
    if (SECTION_LABELS[seg]) return SECTION_LABELS[seg];
    if (KNOWN_SEGMENTS[seg]) return KNOWN_SEGMENTS[seg];
    // Dynamic segment — render as "<KindFromPrev> <id>" if previous segment
    // was a known kind; else just the raw value.
    return seg;
  });
}

function deriveScopeHint(segments: string[], filterState: Record<string, string>): PromptScopeHint {
  const hint: PromptScopeHint = {};
  if (filterState['project']) hint.projectSlug = filterState['project'];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const next = segments[i + 1];
    if (!next || KNOWN_SEGMENTS[next]) continue;
    // The next segment is a dynamic id under this collection.
    if (seg === 'prompts') hint.promptId = next;
    else if (seg === 'stories') hint.storyId = next;
    else if (seg === 'tasks') hint.taskId = next;
    else if (seg === 'agents') hint.agentId = next;
    else if (seg === 'blockers') hint.blockerId = next;
    else if (seg === 'requirements') hint.requirementId = next;
    else if (seg === 'questions') hint.questionId = next;
    else if (seg === 'projects' && !hint.projectSlug) hint.projectSlug = next;
  }
  return hint;
}

function deriveSubmittedFrom(segments: string[]): string {
  if (segments.length === 0) return 'home';
  // Prefer the most specific known label.
  const known = segments
    .filter((s) => SECTION_LABELS[s] || KNOWN_SEGMENTS[s])
    .map((s) => SECTION_LABELS[s] ?? KNOWN_SEGMENTS[s]);
  if (known.length === 0) return segments.join('/');
  return known.join(' > ');
}

export function usePromptContext(extraFilterState?: Record<string, string>): PromptContext {
  const pathname = usePathname() || '/';
  const searchParams = useSearchParams();

  return useMemo(() => {
    const segments = pathname.split('/').filter(Boolean);

    // Materialise query-string filters.
    const filterState: Record<string, string> = {};
    if (searchParams) {
      searchParams.forEach((v, k) => {
        filterState[k] = v;
      });
    }
    if (extraFilterState) {
      Object.assign(filterState, extraFilterState);
    }

    return {
      currentRoute: pathname,
      breadcrumb: deriveBreadcrumb(segments),
      scope_hint: deriveScopeHint(segments, filterState),
      submittedFrom: deriveSubmittedFrom(segments),
      filterState,
    };
  }, [pathname, searchParams, extraFilterState]);
}
