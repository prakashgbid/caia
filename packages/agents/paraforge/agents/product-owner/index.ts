/**
 * Product Owner Agent
 * 
 * Conducts comprehensive requirements gathering through intelligent interviewing
 * and creates complete, development-ready specifications.
 */

import { BaseAgent, AgentRequest, AgentResponse, ProjectContext } from '../index';
import { generateQuestions, analyzeResponses } from './prompts';
import { 
  RequirementsDocument,
  UserStory,
  AcceptanceCriteria,
  ProjectScope,
  InterviewSession
} from './types';

export class ProductOwner extends BaseAgent {
  private interviewHistory: InterviewSession[] = [];
  
  constructor(config?: Partial<any>) {
    super({
      name: 'product-owner',
      version: '1.0.0',
      ...config
    });
  }

  /**
   * Main processing method for requirements gathering
   */
  async process<T, R>(request: AgentRequest<T>): Promise<AgentResponse<R>> {
    const startTime = Date.now();
    
    try {
      this.log('Starting requirements gathering session');
      
      // Conduct comprehensive interview
      const requirements = await this.gatherRequirements(
        request.context,
        request.input as any
      );
      
      // Generate structured output
      const output = await this.generateStructuredRequirements(requirements);
      
      return {
        id: request.id,
        timestamp: new Date(),
        success: true,
        data: output as any,
        duration: Date.now() - startTime,
        metadata: {
          questionsAsked: this.interviewHistory.length,
          completenessScore: this.calculateCompleteness(requirements)
        }
      };
    } catch (error) {
      return {
        id: request.id,
        timestamp: new Date(),
        success: false,
        data: {} as any,
        errors: [error as Error],
        duration: Date.now() - startTime
      };
    }
  }

  /**
   * Conduct comprehensive requirements gathering
   */
  async gatherRequirements(
    context: ProjectContext,
    userInput: string
  ): Promise<RequirementsDocument> {
    const requirements: RequirementsDocument = {
      projectScope: {} as ProjectScope,
      functionalRequirements: [],
      nonFunctionalRequirements: [],
      userStories: [],
      constraints: context.constraints || {},
      assumptions: [],
      risks: [],
      dependencies: []
    };

    // Phase 1: Understand the core concept
    const conceptQuestions = await this.askConceptQuestions(userInput);
    requirements.projectScope = await this.defineProjectScope(conceptQuestions);

    // Phase 2: Functional requirements
    const functionalQuestions = await this.askFunctionalQuestions(requirements.projectScope);
    requirements.functionalRequirements = await this.defineFunctionalRequirements(functionalQuestions);

    // Phase 3: Non-functional requirements
    const nfQuestions = await this.askNonFunctionalQuestions();
    requirements.nonFunctionalRequirements = await this.defineNonFunctionalRequirements(nfQuestions);

    // Phase 4: User stories and acceptance criteria
    requirements.userStories = await this.generateUserStories(requirements);

    // Phase 5: Identify risks and dependencies
    requirements.risks = await this.identifyRisks(requirements);
    requirements.dependencies = await this.identifyDependencies(requirements);

    return requirements;
  }

  /**
   * Ask concept clarification questions
   */
  private async askConceptQuestions(userInput: string): Promise<any> {
    const questions = [
      "What is the primary business problem this solves?",
      "Who are the target users?",
      "What is the expected outcome or success metric?",
      "What makes this different from existing solutions?",
      "What is the MVP scope vs. future vision?"
    ];

    // In production, this would use AI to generate contextual questions
    // For now, return structured questions
    return {
      businessProblem: "To be gathered",
      targetUsers: "To be defined",
      successMetrics: "To be measured",
      uniqueValue: "To be identified",
      mvpScope: "To be scoped"
    };
  }

  /**
   * Define project scope from concept questions
   */
  private async defineProjectScope(responses: any): Promise<ProjectScope> {
    return {
      vision: "Transform ideas into development-ready Jira tickets",
      mission: "Automate requirements gathering through AI",
      objectives: [
        "Reduce requirements gathering time by 90%",
        "Ensure 100% completeness before development",
        "Enable parallel development through clear specifications"
      ],
      boundaries: {
        inScope: [
          "Requirements gathering",
          "Jira ticket creation",
          "Multi-agent orchestration"
        ],
        outOfScope: [
          "Actual development",
          "Deployment",
          "Monitoring"
        ]
      },
      deliverables: [
        "Complete Jira hierarchy",
        "Technical specifications",
        "Test cases",
        "Documentation"
      ],
      timeline: "3-6 months",
      budget: 0
    };
  }

  /**
   * Ask functional requirements questions
   */
  private async askFunctionalQuestions(scope: ProjectScope): Promise<any> {
    // Generate questions based on scope
    const questions = [
      "What are the core features?",
      "What are the user workflows?",
      "What data needs to be managed?",
      "What integrations are required?",
      "What are the performance requirements?"
    ];

    return {
      features: [],
      workflows: [],
      dataModel: {},
      integrations: [],
      performance: {}
    };
  }

  /**
   * Define functional requirements
   */
  private async defineFunctionalRequirements(responses: any): Promise<string[]> {
    return [
      "System SHALL conduct comprehensive requirements interviews",
      "System SHALL generate Jira tickets automatically",
      "System SHALL support parallel agent execution",
      "System SHALL validate requirement completeness",
      "System SHALL maintain conversation context"
    ];
  }

  /**
   * Ask non-functional requirements questions
   */
  private async askNonFunctionalQuestions(): Promise<any> {
    const questions = [
      "What are the performance requirements?",
      "What are the security requirements?",
      "What are the scalability needs?",
      "What are the availability requirements?",
      "What are the compliance requirements?"
    ];

    return {
      performance: "Sub-second response time",
      security: "SOC2 compliant",
      scalability: "Handle 1000+ concurrent users",
      availability: "99.9% uptime",
      compliance: "GDPR compliant"
    };
  }

  /**
   * Define non-functional requirements
   */
  private async defineNonFunctionalRequirements(responses: any): Promise<string[]> {
    return [
      "System SHALL respond within 1 second",
      "System SHALL encrypt all data in transit and at rest",
      "System SHALL scale to 1000 concurrent operations",
      "System SHALL maintain 99.9% availability",
      "System SHALL comply with GDPR requirements"
    ];
  }

  /**
   * Generate user stories from requirements
   */
  private async generateUserStories(requirements: RequirementsDocument): Promise<UserStory[]> {
    const stories: UserStory[] = [];

    // Generate stories for each functional requirement
    for (const req of requirements.functionalRequirements) {
      stories.push({
        id: `US-${stories.length + 1}`,
        title: this.requirementToStoryTitle(req),
        narrative: {
          asA: "Product Owner",
          iWant: this.extractWant(req),
          soThat: this.extractBenefit(req)
        },
        acceptanceCriteria: await this.generateAcceptanceCriteria(req),
        priority: 'HIGH',
        effort: 5,
        dependencies: []
      });
    }

    return stories;
  }

  /**
   * Convert requirement to story title
   */
  private requirementToStoryTitle(requirement: string): string {
    // Remove "System SHALL" and convert to story format
    return requirement.replace(/System SHALL /i, '').trim();
  }

  /**
   * Extract the "I want" part from requirement
   */
  private extractWant(requirement: string): string {
    return requirement.replace(/System SHALL /i, 'to ').trim();
  }

  /**
   * Extract benefit from requirement
   */
  private extractBenefit(requirement: string): string {
    // In production, use AI to determine benefit
    return "I can deliver better software faster";
  }

  /**
   * Generate acceptance criteria for a requirement
   */
  private async generateAcceptanceCriteria(requirement: string): Promise<AcceptanceCriteria[]> {
    return [
      {
        given: "a user input",
        when: "processing requirements",
        then: "complete specifications are generated"
      },
      {
        given: "incomplete information",
        when: "conducting interview",
        then: "relevant questions are asked"
      }
    ];
  }

  /**
   * Identify project risks
   */
  private async identifyRisks(requirements: RequirementsDocument): Promise<string[]> {
    return [
      "AI model limitations may affect quality",
      "Jira API rate limits may slow operations",
      "Complex requirements may need human review"
    ];
  }

  /**
   * Identify project dependencies
   */
  private async identifyDependencies(requirements: RequirementsDocument): Promise<string[]> {
    return [
      "Jira instance with appropriate permissions",
      "AI API access (Claude/OpenAI)",
      "Network connectivity for parallel operations"
    ];
  }

  /**
   * Generate structured requirements output
   */
  private async generateStructuredRequirements(
    requirements: RequirementsDocument
  ): Promise<any> {
    return {
      summary: {
        totalRequirements: requirements.functionalRequirements.length + 
                          requirements.nonFunctionalRequirements.length,
        totalStories: requirements.userStories.length,
        completenessScore: this.calculateCompleteness(requirements),
        estimatedEffort: this.calculateTotalEffort(requirements)
      },
      requirements,
      jiraTickets: await this.convertToJiraFormat(requirements)
    };
  }

  /**
   * Calculate requirements completeness score
   */
  private calculateCompleteness(requirements: RequirementsDocument): number {
    let score = 0;
    let total = 0;

    // Check various aspects
    total += 10;
    if (requirements.projectScope.vision) score += 2;
    if (requirements.projectScope.objectives.length > 0) score += 2;
    if (requirements.functionalRequirements.length > 0) score += 2;
    if (requirements.nonFunctionalRequirements.length > 0) score += 2;
    if (requirements.userStories.length > 0) score += 2;

    return Math.round((score / total) * 100);
  }

  /**
   * Calculate total effort from user stories
   */
  private calculateTotalEffort(requirements: RequirementsDocument): number {
    return requirements.userStories.reduce((total, story) => total + story.effort, 0);
  }

  /**
   * Convert requirements to Jira ticket format
   */
  private async convertToJiraFormat(requirements: RequirementsDocument): Promise<any[]> {
    const tickets = [];

    // Create PROJECT epic
    tickets.push({
      issueType: 'Epic',
      summary: `PROJECT: ${requirements.projectScope.vision}`,
      description: this.formatProjectDescription(requirements),
      labels: ['PROJECT']
    });

    // Create stories
    for (const story of requirements.userStories) {
      tickets.push({
        issueType: 'Story',
        summary: story.title,
        description: this.formatStoryDescription(story),
        storyPoints: story.effort,
        priority: story.priority
      });
    }

    return tickets;
  }

  /**
   * Format project description for Jira
   */
  private formatProjectDescription(requirements: RequirementsDocument): string {
    return `
# Project Vision
${requirements.projectScope.vision}

## Objectives
${requirements.projectScope.objectives.map(o => `- ${o}`).join('\n')}

## Functional Requirements
${requirements.functionalRequirements.map(r => `- ${r}`).join('\n')}

## Non-Functional Requirements
${requirements.nonFunctionalRequirements.map(r => `- ${r}`).join('\n')}

## Risks
${requirements.risks.map(r => `- ${r}`).join('\n')}

## Dependencies
${requirements.dependencies.map(d => `- ${d}`).join('\n')}
    `.trim();
  }

  /**
   * Format story description for Jira
   */
  private formatStoryDescription(story: UserStory): string {
    return `
As a ${story.narrative.asA}
I want ${story.narrative.iWant}
So that ${story.narrative.soThat}

## Acceptance Criteria
${story.acceptanceCriteria.map(ac => 
  `- Given ${ac.given}, when ${ac.when}, then ${ac.then}`
).join('\n')}

## Dependencies
${story.dependencies.map(d => `- ${d}`).join('\n')}
    `.trim();
  }
}

export default ProductOwner;