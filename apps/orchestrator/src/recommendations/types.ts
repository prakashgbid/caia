export interface RecAlternative {
  name: string;
  reason: string;
}

export interface Recommendation {
  id: string;
  title: string;
  chosen: string;
  rationale: string;
  alternatives: RecAlternative[];
  context: string;
  taskId?: string | null;
  requirementId?: string | null;
  projectId?: string | null;
  scope: string;
  createdAt: string;
}

export interface CreateRecommendationParams {
  title: string;
  chosen: string;
  rationale: string;
  alternatives?: RecAlternative[];
  context?: string;
  taskId?: string;
  requirementId?: string;
  projectId?: string;
  scope?: string;
}

export interface ListRecommendationsFilter {
  taskId?: string;
  requirementId?: string;
  projectId?: string;
  scope?: string;
  limit?: number;
}
