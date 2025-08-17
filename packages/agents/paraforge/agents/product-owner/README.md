# Product Owner Agent

AI-powered requirements gathering agent that conducts comprehensive interviews to ensure 100% clarity before development.

## Purpose

The Product Owner agent eliminates ambiguity by:
- Conducting exhaustive requirements interviews
- Identifying edge cases and risks
- Generating complete user stories
- Defining clear acceptance criteria
- Prioritizing features by value

## Features

### 🎯 Comprehensive Interviewing
- Multi-phase questioning approach
- Contextual follow-up questions
- Completeness validation
- Ambiguity detection

### 📝 Requirements Documentation
- Functional requirements
- Non-functional requirements
- User stories with acceptance criteria
- Risk assessment
- Dependency mapping

### 🎨 Story Generation
- Converts requirements to user stories
- INVEST criteria compliance
- Given/When/Then acceptance criteria
- Story point estimation
- Priority assignment

### 🔍 Analysis & Validation
- Completeness scoring
- Feasibility assessment
- Risk identification
- Dependency analysis
- Conflict detection

## Usage

```typescript
import { ProductOwner } from '../agents/product-owner';

const po = new ProductOwner({
  debug: true,
  timeout: 60000
});

// Gather requirements from user input
const request = {
  id: 'req-001',
  timestamp: new Date(),
  context: {
    projectId: 'PROJ-123',
    projectName: 'My App',
    description: 'A social media analytics platform'
  },
  input: 'I want to build a tool that tracks social media engagement'
};

const response = await po.process(request);

console.log(response.data.requirements);
// {
//   projectScope: { ... },
//   functionalRequirements: [ ... ],
//   userStories: [ ... ],
//   jiraTickets: [ ... ]
// }
```

## Interview Process

### Phase 1: Concept Understanding
- Business problem identification
- Target user definition
- Success metrics
- Value proposition
- MVP vs. future vision

### Phase 2: Functional Requirements
- Core features
- User workflows
- Data management
- Business rules
- Integration needs

### Phase 3: Non-Functional Requirements
- Performance expectations
- Security requirements
- Scalability needs
- Compliance requirements
- Accessibility standards

### Phase 4: User Experience
- User personas
- UI/UX preferences
- Platform requirements
- Error handling
- Onboarding flow

### Phase 5: Technical Architecture
- Technology constraints
- System integrations
- Deployment environment
- Monitoring needs
- Data architecture

### Phase 6: Validation
- Conflict resolution
- Completeness check
- Feasibility validation
- Risk assessment
- Final clarifications

## Output Format

### Requirements Document
```typescript
{
  projectScope: {
    vision: string,
    objectives: string[],
    boundaries: {
      inScope: string[],
      outOfScope: string[]
    }
  },
  functionalRequirements: string[],
  nonFunctionalRequirements: string[],
  userStories: UserStory[],
  risks: string[],
  dependencies: string[]
}
```

### User Story Format
```typescript
{
  id: string,
  title: string,
  narrative: {
    asA: string,
    iWant: string,
    soThat: string
  },
  acceptanceCriteria: [
    {
      given: string,
      when: string,
      then: string
    }
  ],
  priority: 'HIGH',
  effort: 5
}
```

## Integration with ParaForge

The Product Owner agent is the first agent invoked in the ParaForge pipeline:

1. **User Input** → Product Owner conducts interview
2. **Requirements** → Creates PROJECT epic in Jira
3. **Decomposition** → Spawns parallel instances for INITIATIVEs
4. **Enrichment** → Other agents add technical details

## Best Practices

### For Optimal Results:
1. Provide detailed initial descriptions
2. Answer all questions thoroughly
3. Include constraints upfront
4. Specify technical preferences
5. Define success metrics clearly

### Common Patterns:
- Start with business problem, not solution
- Include user personas and their goals
- Specify performance requirements early
- Identify integration points
- Define compliance needs

## Metrics

The agent tracks:
- Questions asked per session
- Completeness score (0-100%)
- Interview duration
- Requirements generated
- Stories created
- Risks identified

## Configuration

```typescript
const po = new ProductOwner({
  maxQuestions: 50,      // Max questions per session
  timeout: 60000,         // Session timeout (ms)
  debug: true,            // Enable debug logging
  aiModel: 'gpt-4',      // AI model for generation
  temperature: 0.7        // AI creativity level
});
```

## Future Enhancements

- [ ] Machine learning from past projects
- [ ] Industry-specific templates
- [ ] Multi-stakeholder interviews
- [ ] Real-time collaboration
- [ ] Voice-based interviewing
- [ ] Automated feasibility scoring

## Testing

```bash
# Run Product Owner tests
npm test -- product-owner

# Test specific scenarios
npm test -- product-owner --grep "story generation"

# Test with coverage
npm test -- product-owner --coverage
```

## Extraction Plan

This agent will be extracted to `@autoforge/agent-product-owner` when stable.

---

**Remember**: The goal is ZERO questions during development. Every ambiguity resolved here saves hours later.