/**
 * Canonical Project Spec — the ONE source of truth for what a founder has
 * shared with CAIA. Every wizard stage reads its inputs from this spec and
 * writes its outputs back. Every AI call serialises the relevant slice as
 * context so the model never re-asks for something the founder already told us.
 *
 * Additive-only: never remove or rename fields; only add.
 */

export type Stage =
  | 'onboarding' | 'grand-idea' | 'interview' | 'architecture'
  | 'proposal' | 'landing' | 'design' | 'login' | 'build' | 'subscribe';

export interface InterviewTurn {
  role: 'user' | 'assistant';
  text: string;
  ts: number;
}

export interface DesignChoices {
  designSystem?: 'shadcn' | 'mui' | 'chakra' | 'ant' | 'custom';
  styleGuide?: 'minimal' | 'warm' | 'corporate' | 'playful' | 'editorial' | 'brutalist';
  theme?: 'light' | 'dark' | 'auto';
  accentColor?: string;
  radius?: 'sm' | 'md' | 'lg' | 'full';
  fontFamily?: 'inter' | 'geist' | 'satoshi' | 'system';
}

export interface StoryStatus { status: 'todo' | 'in-progress' | 'done'; }
export interface MvpStory extends StoryStatus {
  id: string; title: string; purpose: string; code?: string;
}
export interface MvpEpic { id: string; title: string; purpose: string; stories: MvpStory[]; }
export interface MvpInitiative { id: string; title: string; purpose: string; epics: MvpEpic[]; }
export interface ScreenSpec { name: string; routePath: string; purpose: string; picked: boolean; }

export interface StartupDoc {
  id: string; type: string; title: string;
  format: 'markdown' | 'pdf' | 'pptx' | 'html';
  content: string; createdAt: number; tokens: number;
}

export interface ProjectSpec {
  id: string;
  createdAt: number;
  updatedAt: number;
  name?: string;
  currentStage?: Stage;

  founderName?: string;
  founderEmail?: string;
  grandIdea?: string;

  interview?: {
    turns: InterviewTurn[];
    summary?: string;
    completedAt?: number;
  };

  informationArchitecture?: {
    entities: Array<{ name: string; description: string; fields?: string[] }>;
    routes: Array<{ path: string; purpose: string }>;
    summary?: string;
  };

  proposal?: string;
  productName?: string;
  landingHtml?: string;
  design?: DesignChoices;
  initiatives?: MvpInitiative[];
  screens?: ScreenSpec[];
  builtScreens?: Record<string, { code: string; ts: number }>;
  subscriptionTier?: 'monthly' | 'yearly' | 'none';

  docs: StartupDoc[];
}

export function newSpec(id: string): ProjectSpec {
  return {
    id, createdAt: Date.now(), updatedAt: Date.now(),
    currentStage: 'onboarding', docs: [], design: {}, initiatives: [], builtScreens: {},
    interview: { turns: [] },
  };
}

/** Slice for AI-call context — small, focused. */
export function specToAiContext(spec: ProjectSpec, focus: Stage): Record<string, unknown> {
  const base = {
    productName: spec.productName,
    founderName: spec.founderName,
    grandIdea: spec.grandIdea,
    interviewSummary: spec.interview?.summary,
    design: spec.design,
  };
  switch (focus) {
    case 'interview': return { ...base };
    case 'architecture': return { ...base, interviewSummary: spec.interview?.summary };
    case 'proposal': return { ...base, ia: spec.informationArchitecture };
    case 'landing':
    case 'design': return { ...base, proposal: spec.proposal };
    case 'build': return {
      ...base, proposal: spec.proposal, informationArchitecture: spec.informationArchitecture,
      initiatives: spec.initiatives?.map((i) => ({ title: i.title, purpose: i.purpose })),
    };
    default: return base;
  }
}
