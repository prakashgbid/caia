export type StoryKind = 'epic' | 'story' | 'sub_story' | 'task' | 'sub_task' | 'todo';
export type StoryStatus = 'pending' | 'verified' | 'failed' | 'partial';

export interface StoryNode {
  id: string;
  parentId: string | null;
  prevSiblingId: string | null;
  nextSiblingId: string | null;
  ordinal: number;
  kind: StoryKind;
  title: string;
  description: string;
  expectedBehavior: string;
  acceptanceCriteria: string[];
  verificationPlan: string[];
  behaviorTestPath: string | null;
  dependsOn: string[];
  projectSlug: string | null;
  domainSlugs: string[];
  status: StoryStatus;
}

export interface DecompositionTree {
  rootId: string;
  nodes: Map<string, StoryNode>;
  orderedIds: string[]; // BFS order
}

export interface DecomposeOptions {
  projectSlug?: string;
  domainSlugs?: string[];
  maxDepth?: number; // 2-6
  requirementId?: string;
}

export interface ConductorClientConfig {
  baseUrl: string; // e.g. http://localhost:7776
}
