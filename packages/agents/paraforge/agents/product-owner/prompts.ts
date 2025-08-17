/**
 * AI Prompts for Product Owner Agent
 * 
 * These prompts guide the AI in conducting comprehensive requirements gathering
 */

export const SYSTEM_PROMPT = `You are an expert Product Owner with 20+ years of experience in software development, requirements gathering, and agile methodologies. Your role is to conduct comprehensive requirements gathering interviews to ensure ZERO ambiguity before development begins.

Your approach:
1. Ask clarifying questions until you have 100% clarity
2. Identify edge cases and potential issues
3. Define clear acceptance criteria
4. Prioritize features based on value
5. Ensure technical feasibility
6. Consider user experience at every step

You never make assumptions. You always dig deeper. You think about scalability, maintainability, and user delight.`;

export const INTERVIEW_PHASES = {
  concept: {
    prompt: `Analyze the user's project idea and generate questions to understand:
1. The core business problem being solved
2. Target users and their pain points
3. Success metrics and KPIs
4. Unique value proposition
5. Market differentiation

Generate 5-10 specific questions that will clarify the concept.`,
    
    followUp: `Based on their answers, what follow-up questions would help clarify any ambiguities?`
  },

  functional: {
    prompt: `Based on the project concept, generate questions about functional requirements:
1. Core features and capabilities
2. User workflows and journeys
3. Data management needs
4. Integration requirements
5. Business rules and logic

Generate 10-15 specific questions about functionality.`,
    
    followUp: `What edge cases or scenarios haven't been covered?`
  },

  nonFunctional: {
    prompt: `Generate questions about non-functional requirements:
1. Performance expectations (response time, throughput)
2. Security requirements
3. Scalability needs
4. Availability and reliability
5. Compliance and regulatory needs
6. Accessibility requirements
7. Localization needs

Generate 8-12 specific questions about quality attributes.`,
    
    followUp: `What technical constraints or limitations should be considered?`
  },

  userExperience: {
    prompt: `Generate questions about user experience:
1. User personas and their goals
2. UI/UX preferences
3. Device and platform requirements
4. Accessibility needs
5. User onboarding flow
6. Error handling preferences

Generate 6-10 UX-focused questions.`,
    
    followUp: `What would make this experience delightful for users?`
  },

  technical: {
    prompt: `Generate technical architecture questions:
1. Technology preferences or constraints
2. Existing system integrations
3. Data storage and management
4. API requirements
5. Deployment environment
6. Monitoring and logging needs

Generate 8-12 technical questions.`,
    
    followUp: `What technical risks or challenges should be addressed?`
  },

  validation: {
    prompt: `Review all gathered requirements and identify:
1. Any contradictions or conflicts
2. Missing information
3. Ambiguous statements
4. Unrealistic expectations
5. Hidden complexity

Generate final clarification questions.`,
    
    followUp: `What needs to be validated with stakeholders?`
  }
};

export const STORY_GENERATION_PROMPT = `Convert the following requirement into a well-structured user story:

Requirement: {requirement}

Generate:
1. A clear story title
2. User story in "As a... I want... So that..." format
3. 3-5 specific acceptance criteria in Given/When/Then format
4. Any dependencies or prerequisites
5. Estimated effort (1-13 story points)
6. Priority (LOW/MEDIUM/HIGH/CRITICAL)

Ensure the story is:
- Independent
- Negotiable
- Valuable
- Estimable
- Small
- Testable`;

export const EPIC_GENERATION_PROMPT = `Create a comprehensive epic description for:

Project: {projectName}
Vision: {vision}
Objectives: {objectives}

Include:
1. Executive summary
2. Business value
3. Success criteria
4. Scope (in/out)
5. Risks and mitigations
6. Dependencies
7. Timeline estimate
8. Required resources

Format for Jira with clear sections and bullet points.`;

export const PRIORITIZATION_PROMPT = `Prioritize these features using WSJF (Weighted Shortest Job First):

Features: {features}

For each feature, evaluate:
1. Business Value (1-10)
2. Time Criticality (1-10)
3. Risk Reduction/Opportunity Enablement (1-10)
4. Job Size/Effort (1-10)

Calculate WSJF = (Business Value + Time Criticality + Risk Reduction) / Job Size

Provide rationale for each score and final prioritization order.`;

export const COMPLETENESS_CHECK_PROMPT = `Review these requirements for completeness:

{requirements}

Check for:
1. Clear acceptance criteria
2. Defined error cases
3. Performance requirements
4. Security considerations
5. Data validation rules
6. User permissions
7. Audit/logging needs
8. Integration points
9. Rollback procedures
10. Documentation needs

List any missing areas and generate questions to address them.`;

export const RISK_ASSESSMENT_PROMPT = `Analyze these requirements for risks:

{requirements}

Identify:
1. Technical risks
2. Business risks
3. Security risks
4. Performance risks
5. Integration risks
6. Compliance risks

For each risk, provide:
- Description
- Probability (LOW/MEDIUM/HIGH)
- Impact (LOW/MEDIUM/HIGH)
- Mitigation strategy`;

/**
 * Generate contextual questions based on user input
 */
export function generateQuestions(
  phase: string,
  context: any,
  previousResponses?: any
): string[] {
  // In production, this would call AI with the appropriate prompt
  // For now, return phase-appropriate questions
  
  const baseQuestions: Record<string, string[]> = {
    concept: [
      "What problem does this solve?",
      "Who are the target users?",
      "What's the expected outcome?",
      "What's the MVP scope?",
      "What's the timeline?"
    ],
    functional: [
      "What are the core features?",
      "What actions can users perform?",
      "What data needs to be stored?",
      "What reports are needed?",
      "What notifications are required?"
    ],
    nonFunctional: [
      "How many concurrent users?",
      "What's the acceptable response time?",
      "What security measures are needed?",
      "What compliance requirements exist?",
      "What's the uptime requirement?"
    ],
    technical: [
      "What technology stack is preferred?",
      "What systems need integration?",
      "Where will this be deployed?",
      "What's the data retention policy?",
      "What monitoring is needed?"
    ]
  };

  return baseQuestions[phase] || [];
}

/**
 * Analyze responses for completeness and clarity
 */
export function analyzeResponses(
  responses: any,
  phase: string
): {
  complete: boolean;
  clarifications: string[];
  nextQuestions: string[];
} {
  // In production, use AI to analyze responses
  // For now, return basic analysis
  
  return {
    complete: false,
    clarifications: [
      "Can you elaborate on the user workflow?",
      "What happens in error scenarios?"
    ],
    nextQuestions: [
      "How should the system handle concurrent updates?",
      "What are the data validation rules?"
    ]
  };
}

/**
 * Generate follow-up questions based on responses
 */
export function generateFollowUp(
  question: string,
  response: string,
  context: any
): string[] {
  // In production, use AI to generate contextual follow-ups
  // For now, return generic follow-ups
  
  return [
    `Can you provide more details about "${response}"?`,
    "What are the edge cases for this scenario?",
    "How should errors be handled?",
    "What's the expected behavior when this fails?"
  ];
}

/**
 * Convert requirements to acceptance criteria
 */
export function generateAcceptanceCriteria(
  requirement: string,
  context: any
): string[] {
  // In production, use AI to generate criteria
  // For now, return template criteria
  
  return [
    `Given a valid input, when the action is performed, then the expected result occurs`,
    `Given an invalid input, when the action is attempted, then an appropriate error is shown`,
    `Given the feature is used, when monitoring the system, then performance metrics are within acceptable ranges`
  ];
}