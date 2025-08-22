/**
 * Type definitions for Product Owner Agent
 */

export type PriorityLevel = 'high' | 'medium' | 'low';
export type BacklogItemStatus = 'ready' | 'in-progress' | 'done' | 'blocked';
export type PrioritizationMethod = 'WSJF' | 'RICE' | 'Value-vs-Effort' | 'MoSCoW';
export type MoSCoWCategory = 'Must' | 'Should' | 'Could' | 'Wont';

export interface ProductContext {
  businessGoals: string[];
  marketResearch: Record<string, any>;
  userPersonas: UserPersona[];
  competitiveAnalysis: Record<string, any>;
}

export interface UserPersona {
  id: string;
  name: string;
  role: string;
  goals: string[];
  painPoints: string[];
  behaviors: string[];
}

export interface MarketSegment {
  name: string;
  size: number;
  growth: number;
  characteristics: string[];
}

export interface CompetitiveFeature {
  feature: string;
  competitors: string[];
  ourStatus: 'missing' | 'basic' | 'competitive' | 'superior';
  priority: PriorityLevel;
}

export interface BusinessCase {
  title: string;
  problem: string;
  solution: string;
  investment: number;
  expectedReturn: number;
  roi: number;
  risks: string[];
  timeline: string;
}

export interface ReleaseContext {
  version: string;
  targetDate: Date;
  availableCapacity: number;
  backlogItems: BacklogItem[];
  businessPriorities: string[];
  teamVelocity?: number;
  dependencies?: string[];
}

export interface SprintContext {
  sprintNumber: number;
  capacity: number;
  prioritizedBacklog: BacklogItem[];
  teamVelocity: number;
  sprintGoal: string;
  previousSprintRetrospective?: string[];
}

export interface MetricsContext {
  productGoals: string[];
  userJourney: UserJourneyStep[];
  businessKPIs: string[];
  currentMetrics?: Record<string, number>;
}

export interface UserJourneyStep {
  step: string;
  description: string;
  touchpoints: string[];
  painPoints: string[];
  metrics: string[];
}

export interface ProductHealthDashboard {
  userMetrics: {
    activeUsers: number;
    engagement: number;
    retention: number;
    satisfaction: number;
  };
  businessMetrics: {
    revenue: number;
    growth: number;
    churn: number;
    acquisition: number;
  };
  technicalMetrics: {
    uptime: number;
    performance: number;
    errors: number;
    deployment: number;
  };
}

export interface FeatureFlag {
  name: string;
  description: string;
  enabled: boolean;
  rolloutPercentage: number;
  targetAudience: string[];
  metrics: string[];
  rollbackCriteria: string[];
}

export interface RoadmapItem {
  id: string;
  title: string;
  description: string;
  quarter: string;
  themes: string[];
  outcomes: string[];
  confidence: number;
  dependencies: string[];
}

export interface StakeholderMatrix {
  stakeholder: string;
  influence: PriorityLevel;
  interest: PriorityLevel;
  engagement: 'champion' | 'supporter' | 'neutral' | 'critic' | 'blocker';
  communication: string;
}

export interface RiskAssessment {
  risk: string;
  probability: number;
  impact: number;
  severity: PriorityLevel;
  mitigation: string;
  owner: string;
  status: 'identified' | 'mitigating' | 'resolved' | 'accepted';
}

export interface ExperimentDesign {
  hypothesis: string;
  metrics: string[];
  variants: ExperimentVariant[];
  duration: number;
  sampleSize: number;
  successCriteria: string[];
}

export interface ExperimentVariant {
  name: string;
  description: string;
  trafficPercentage: number;
  changes: string[];
}

export interface GoToMarketPlan {
  launchDate: Date;
  targetAudience: string[];
  messaging: string;
  channels: string[];
  pricing: PricingStrategy;
  success: string[];
  risks: string[];
}

export interface PricingStrategy {
  model: 'freemium' | 'subscription' | 'usage' | 'enterprise';
  tiers: PricingTier[];
  discounts: string[];
  competitive: string;
}

export interface PricingTier {
  name: string;
  price: number;
  features: string[];
  limits: Record<string, number>;
  target: string;
}