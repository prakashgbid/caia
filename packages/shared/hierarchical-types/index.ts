/**
 * Shared Type Definitions for Hierarchical Agent System
 * Used across all streams to ensure consistency
 */

export interface Idea {
  id: string;
  title: string;
  description: string;
  context?: string;
  marketAnalysis?: MarketAnalysis;
  feasibility?: FeasibilityAnalysis;
  risks?: Risk[];
  timestamp: Date;
}

export interface Initiative {
  id: string;
  ideaId: string;
  title: string;
  description: string;
  objectives: string[];
  timeline: Timeline;
  successMetrics: Metric[];
  dependencies: string[];
  resources: ResourceRequirement[];
  priority: Priority;
}

export interface Feature {
  id: string;
  initiativeId: string;
  title: string;
  description: string;
  userStories: string[];
  acceptanceCriteria: string[];
  technicalRequirements: string[];
  platformRequirements: string[];
  integrationPoints: string[];
}

export interface EnhancedEpic {
  id: string;
  featureId: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  labels: string[];
  priority: Priority;
  estimatedStories: number;
  businessValue: number;
  qualityScore?: number;
}

export interface QualityGate {
  tier: string;
  sourceTier: string;
  targetTier: string;
  confidence: number;
  threshold: number;
  validations: ValidationResult[];
  passed: boolean;
  issues: QualityIssue[];
  recommendations: string[];
  timestamp: Date;
}

export interface ValidationResult {
  rule: string;
  passed: boolean;
  score: number;
  details: string;
}

export interface QualityIssue {
  severity: 'critical' | 'high' | 'medium' | 'low';
  type: string;
  description: string;
  suggestion: string;
}

export interface MarketAnalysis {
  marketSize: number;
  competitors: string[];
  opportunities: string[];
  threats: string[];
  positioning: string;
}

export interface FeasibilityAnalysis {
  technical: number;
  business: number;
  resource: number;
  overall: number;
  constraints: string[];
}

export interface Risk {
  type: string;
  probability: number;
  impact: number;
  mitigation: string;
}

export interface Timeline {
  startDate: Date;
  endDate: Date;
  milestones: Milestone[];
}

export interface Milestone {
  name: string;
  date: Date;
  deliverables: string[];
}

export interface Metric {
  name: string;
  target: number;
  unit: string;
  measurementMethod: string;
}

export interface ResourceRequirement {
  type: string;
  quantity: number;
  skills: string[];
  availability: string;
}

export type Priority = 'critical' | 'high' | 'medium' | 'low';

export interface HierarchicalBreakdown {
  idea: Idea;
  initiatives: Initiative[];
  features: Feature[];
  epics: EnhancedEpic[];
  stories: any[]; // Use existing Story type
  tasks: any[];   // Use existing Task type
  subtasks: any[]; // Use existing SubTask type
  qualityGates: QualityGate[];
  traceability: TraceabilityMatrix;
}

export interface TraceabilityMatrix {
  links: TraceabilityLink[];
  impactAnalysis: Map<string, string[]>;
}

export interface TraceabilityLink {
  sourceId: string;
  sourceType: string;
  targetId: string;
  targetType: string;
  relationship: string;
}
