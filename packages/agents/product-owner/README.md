# @caia/agent-product-owner

Certified Product Owner agent with expertise in agile product management, value maximization, and stakeholder alignment. This agent owns the product vision and is responsible for delivering maximum value to users and the business through effective backlog management and prioritization.

## Features

- **Product Vision & Strategy**: Define and communicate product vision, create roadmaps, identify market opportunities
- **Backlog Management**: Maintain and prioritize product backlog using proven methodologies (WSJF, RICE, MoSCoW)
- **Stakeholder Alignment**: Manage competing priorities, facilitate feedback, build consensus
- **Release Planning**: Define release goals, coordinate go-to-market strategies, manage feature rollouts
- **Data-Driven Decisions**: Define metrics, analyze user behavior, validate features with data
- **Sprint Planning**: Lead planning sessions, accept stories, ensure sustainable velocity

## Installation

```bash
npm install @caia/agent-product-owner
```

## Usage

### Basic Usage

```typescript
import { productOwnerAgent, BacklogItem } from '@caia/agent-product-owner';

// Create product vision
const vision = await productOwnerAgent.createProductVision({
  businessGoals: ['Increase user engagement', 'Reduce churn', 'Grow revenue'],
  marketResearch: { /* market data */ },
  userPersonas: [ /* user personas */ ],
  competitiveAnalysis: { /* competitive data */ }
});

// Prioritize backlog
const backlogItems: BacklogItem[] = [
  {
    id: 'US-001',
    title: 'User authentication',
    description: 'Implement secure user login',
    acceptanceCriteria: ['Secure password handling', 'Remember me option'],
    priority: 1,
    estimatedValue: 8,
    estimatedEffort: 5,
    labels: ['security', 'foundation'],
    dependencies: [],
    status: 'ready'
  }
  // ... more items
];

const prioritized = await productOwnerAgent.prioritizeBacklog(backlogItems, 'WSJF');
```

### Prioritization Methodologies

```typescript
// WSJF (Weighted Shortest Job First)
const wsjfResult = await productOwnerAgent.prioritizeBacklog(items, 'WSJF');

// RICE (Reach, Impact, Confidence, Effort)
const riceResult = await productOwnerAgent.prioritizeBacklog(items, 'RICE');

// Value vs Effort Matrix
const valueEffortResult = await productOwnerAgent.prioritizeBacklog(items, 'Value-vs-Effort');

// MoSCoW (Must, Should, Could, Won't)
const moscowResult = await productOwnerAgent.prioritizeBacklog(items, 'MoSCoW');
```

### Release Planning

```typescript
const releaseGoal = await productOwnerAgent.planRelease({
  version: '2.1.0',
  targetDate: new Date('2024-03-15'),
  availableCapacity: 100,
  backlogItems: prioritizedItems,
  businessPriorities: ['user engagement', 'performance']
});

console.log(releaseGoal.objectives);
console.log(releaseGoal.features);
console.log(releaseGoal.successCriteria);
```

### Stakeholder Management

```typescript
const feedback = [
  {
    stakeholder: 'Sales Team',
    priority: 'high' as const,
    feedback: 'Need better reporting features for enterprise clients',
    actionItems: ['Add advanced analytics', 'Implement custom dashboards']
  },
  {
    stakeholder: 'Customer Support',
    priority: 'medium' as const,
    feedback: 'Users struggling with onboarding process',
    actionItems: ['Simplify signup flow', 'Add guided tour']
  }
];

const result = await productOwnerAgent.processStakeholderFeedback(feedback);
console.log(result.summary);
console.log(result.prioritizedActions);
console.log(`Consensus level: ${result.consensusLevel}%`);
```

### Sprint Planning

```typescript
const sprintPlan = await productOwnerAgent.planSprint({
  sprintNumber: 15,
  capacity: 40,
  prioritizedBacklog: prioritizedItems,
  teamVelocity: 35,
  sprintGoal: 'Complete user authentication and basic dashboard'
});

console.log(sprintPlan.selectedItems);
console.log(`Commitment level: ${sprintPlan.commitmentLevel}%`);
```

### Metrics Definition

```typescript
const metrics = await productOwnerAgent.defineProductMetrics({
  productGoals: ['Increase engagement', 'Reduce support load'],
  userJourney: [ /* user journey steps */ ],
  businessKPIs: ['Revenue growth', 'User retention']
});

console.log('Leading indicators:', metrics.leadingIndicators);
console.log('Lagging indicators:', metrics.laggingIndicators);
console.log('Health metrics:', metrics.healthMetrics);
```

## API Reference

### Core Classes

#### ProductOwnerAgent

Main agent class that provides all product owner capabilities.

#### Interfaces

- `ProductVision` - Product vision statement and goals
- `BacklogItem` - Backlog item with priority and estimation
- `PrioritizationResult` - Result of backlog prioritization
- `ReleaseGoal` - Release planning output
- `StakeholderFeedback` - Stakeholder input structure

### Methods

#### Product Vision
- `createProductVision(context)` - Define product vision and strategy

#### Backlog Management
- `prioritizeBacklog(items, methodology)` - Prioritize backlog using various methodologies

#### Release Planning
- `planRelease(context)` - Create release plan with goals and timeline

#### Stakeholder Management
- `processStakeholderFeedback(feedback)` - Process and align stakeholder input

#### Metrics & Analytics
- `defineProductMetrics(context)` - Define leading and lagging indicators

#### Sprint Planning
- `planSprint(context)` - Plan sprint with capacity and velocity

## Prioritization Frameworks

### WSJF (Weighted Shortest Job First)
Maximizes economic value by considering:
- User-Business Value
- Time Criticality  
- Risk Reduction
- Job Size

### RICE Scoring
Balances four factors:
- **Reach**: How many users will be affected?
- **Impact**: How much will it impact each user?
- **Confidence**: How confident are we in our estimates?
- **Effort**: How much work is required?

### Value vs Effort Matrix
Categorizes items into:
- Quick Wins (High Value, Low Effort)
- Strategic Bets (High Value, High Effort)
- Fill-ins (Low Value, Low Effort)
- Time Sinks (Low Value, High Effort)

### MoSCoW
Categorizes requirements:
- **Must have**: Critical for release
- **Should have**: Important but not critical
- **Could have**: Nice to have if time permits
- **Won't have**: Not in this release

## Integration with CAIA

This agent integrates seamlessly with the CAIA framework:

- Uses `@caia/core` BaseAgent for consistency
- Follows CAIA agent patterns and conventions
- Integrates with CAIA's decision logging system
- Supports CAIA orchestration and workflow automation

## Best Practices

1. **Regular Backlog Grooming**: Keep backlog items refined and estimated
2. **Stakeholder Communication**: Maintain regular touchpoints with all stakeholders
3. **Data-Driven Decisions**: Always validate assumptions with data
4. **Incremental Value**: Focus on delivering value incrementally
5. **Sustainable Pace**: Balance ambitious goals with team capacity

## Example Workflows

### Feature Prioritization Workflow
1. Gather feature requests from stakeholders
2. Define acceptance criteria and estimate effort
3. Apply prioritization methodology (WSJF recommended)
4. Review with stakeholders and build consensus
5. Update product roadmap and communicate changes

### Release Planning Workflow
1. Review prioritized backlog
2. Assess team capacity and velocity
3. Define release objectives and success criteria
4. Select features for release scope
5. Create release plan and timeline
6. Communicate plan to stakeholders

## License

MIT