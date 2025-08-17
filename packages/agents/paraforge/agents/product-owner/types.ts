/**
 * Type definitions for Product Owner Agent
 */

export interface RequirementsDocument {
  projectScope: ProjectScope;
  functionalRequirements: string[];
  nonFunctionalRequirements: string[];
  userStories: UserStory[];
  constraints: ProjectConstraints;
  assumptions: string[];
  risks: string[];
  dependencies: string[];
}

export interface ProjectScope {
  vision: string;
  mission: string;
  objectives: string[];
  boundaries: {
    inScope: string[];
    outOfScope: string[];
  };
  deliverables: string[];
  timeline: string;
  budget: number;
}

export interface UserStory {
  id: string;
  title: string;
  narrative: {
    asA: string;
    iWant: string;
    soThat: string;
  };
  acceptanceCriteria: AcceptanceCriteria[];
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  effort: number; // Story points
  dependencies: string[];
}

export interface AcceptanceCriteria {
  given: string;
  when: string;
  then: string;
}

export interface ProjectConstraints {
  timeline?: string;
  budget?: number;
  team?: string[];
  technology?: string[];
  compliance?: string[];
}

export interface InterviewSession {
  id: string;
  timestamp: Date;
  phase: InterviewPhase;
  questions: Question[];
  responses: Response[];
  completeness: number;
}

export type InterviewPhase = 
  | 'concept'
  | 'functional'
  | 'non-functional'
  | 'user-stories'
  | 'technical'
  | 'validation';

export interface Question {
  id: string;
  text: string;
  type: QuestionType;
  required: boolean;
  followUp?: string[];
  validation?: (response: string) => boolean;
}

export type QuestionType = 
  | 'open-ended'
  | 'yes-no'
  | 'multiple-choice'
  | 'scale'
  | 'technical';

export interface Response {
  questionId: string;
  answer: string;
  confidence: number;
  needsClarification: boolean;
  metadata?: Record<string, any>;
}

export interface RequirementsAnalysis {
  completenessScore: number;
  clarityScore: number;
  feasibilityScore: number;
  riskScore: number;
  recommendations: string[];
  missingAreas: string[];
}

export interface JiraTicketTemplate {
  project: string;
  issueType: string;
  summary: string;
  description: string;
  labels: string[];
  epicName?: string;
  storyPoints?: number;
  priority?: string;
  components?: string[];
  acceptanceCriteria?: string[];
}

export interface PODecision {
  decision: string;
  rationale: string;
  alternatives: string[];
  impact: 'LOW' | 'MEDIUM' | 'HIGH';
  reversible: boolean;
}

export interface FeaturePrioritization {
  feature: string;
  value: number; // Business value 1-10
  effort: number; // Development effort 1-10
  risk: number; // Risk level 1-10
  priority: number; // Calculated priority
  rationale: string;
}

export interface MVPDefinition {
  core: string[];
  nice: string[];
  future: string[];
  rationale: Record<string, string>;
}

export interface StakeholderMap {
  primary: Stakeholder[];
  secondary: Stakeholder[];
  external: Stakeholder[];
}

export interface Stakeholder {
  name: string;
  role: string;
  interest: 'LOW' | 'MEDIUM' | 'HIGH';
  influence: 'LOW' | 'MEDIUM' | 'HIGH';
  needs: string[];
  concerns: string[];
}