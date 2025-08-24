# Enhanced Task Decomposer Agent

The Enhanced Task Decomposer Agent provides comprehensive 7-level hierarchical breakdown of ideas into actionable tasks with integrated market research, quality gates, and automated validation.

## Overview

This enhanced version extends the original task decomposer with:

- **7-Level Hierarchy**: Idea → Initiative → Feature → Epic → Story → Task → Subtask
- **Market Research Integration**: Automated competitive analysis and market sizing
- **Quality Gates**: 85% confidence threshold enforcement at each level
- **ROI Calculation**: Financial projections for initiatives
- **User Journey Mapping**: Comprehensive user experience analysis
- **Automated Rework**: Intelligent improvement suggestions and re-processing

## Architecture

### Core Components

1. **IdeaAnalyzer** (`src/analyzers/IdeaAnalyzer.ts`)
   - Market research integration using WebSearch
   - Feasibility scoring algorithm
   - Business value calculation
   - Risk assessment matrix
   - Competitor analysis

2. **InitiativePlanner** (`src/planners/InitiativePlanner.ts`)
   - Strategic initiative breakdown (3-7 initiatives)
   - Timeline generation (3-6 month windows)
   - Resource requirement estimation
   - ROI calculation
   - Dependency mapping

3. **FeatureArchitect** (`src/architects/FeatureArchitect.ts`)
   - Feature breakdown (5-12 features per initiative)
   - User journey mapping
   - Technical component identification
   - Platform requirement analysis
   - Integration point discovery

4. **QualityGateController** (`src/services/QualityGateController.ts`)
   - Validation rules per hierarchy level
   - 85% confidence threshold enforcement
   - Automated feedback generation
   - Rework loop management
   - Gate history tracking

## Usage

### Enhanced 7-Level Decomposition

```typescript
import { TaskDecomposer, DecompositionOptions } from '@caia/task-decomposer';

const decomposer = new TaskDecomposer(githubToken, {
  ideaAnalyzer: {
    marketResearchDepth: 'comprehensive',
    enableCompetitorAnalysis: true,
    webSearchApiKey: 'your-api-key'
  },
  qualityGate: {
    globalConfidenceThreshold: 0.85,
    enableAutomaticRework: true,
    maxReworkCycles: 3
  }
});

const options: DecompositionOptions = {
  enableHierarchicalDecomposition: true,
  marketResearchDepth: 'deep',
  enableROICalculation: true,
  enableUserJourneyMapping: true,
  qualityGateThreshold: 0.85
};

const result = await decomposer.decomposeEnhanced(
  'Create a comprehensive CRM system for enterprise sales teams',
  'B2B SaaS targeting Fortune 500 companies',
  options
);

console.log('Validation passed:', result.validationPassed);
console.log('Confidence score:', result.confidenceScore);
console.log('Ideas:', result.idea);
console.log('Initiatives:', result.initiatives.length);
console.log('Features:', result.features.length);
console.log('Quality gates:', result.qualityGates.length);
```

### Backward Compatibility

The enhanced decomposer maintains full backward compatibility:

```typescript
// Legacy 4-level decomposition still works
const legacyResult = await decomposer.decompose(
  'Build a todo application',
  'Simple task management for individuals'
);

// Enhanced mode through legacy interface
const enhancedLegacy = await decomposer.decompose(ideaText, context, {
  enableHierarchicalDecomposition: true
});
```

### GitHub Integration

Create comprehensive GitHub issues for the entire hierarchy:

```typescript
await decomposer.createEnhancedGitHubIssues(result, 'owner', 'repo');
```

This creates issues for:
- [IDEA] High-level concept
- [INITIATIVE] Strategic initiatives  
- [FEATURE] Feature specifications
- [EPIC] Development epics
- [STORY] User stories
- [TASK] Implementation tasks

## Configuration

### DecompositionOptions

```typescript
interface DecompositionOptions {
  // Enhanced options
  enableHierarchicalDecomposition?: boolean;
  webSearchApiKey?: string;
  webSearchApiUrl?: string;
  marketResearchDepth?: 'shallow' | 'medium' | 'deep';
  enableROICalculation?: boolean;
  enableUserJourneyMapping?: boolean;
  qualityGateThreshold?: number;
  maxReworkCycles?: number;
  enableAutomaticRework?: boolean;
  
  // Legacy options (maintained for compatibility)
  maxDepth?: number;
  autoEstimate?: boolean;
  includeTechnicalDetails?: boolean;
  generateAcceptanceCriteria?: boolean;
  analyzeComplexity?: boolean;
  identifyDependencies?: boolean;
  suggestLabels?: boolean;
}
```

### EnhancedDecomposerConfig

```typescript
interface EnhancedDecomposerConfig {
  ideaAnalyzer?: {
    confidenceThreshold?: number;
    marketResearchDepth?: 'shallow' | 'medium' | 'deep';
    enableCompetitorAnalysis?: boolean;
    riskAssessmentLevel?: 'basic' | 'comprehensive';
    webSearchApiKey?: string;
    webSearchApiUrl?: string;
  };
  
  initiativePlanner?: {
    confidenceThreshold?: number;
    maxInitiatives?: number;
    defaultTimelineMonths?: number;
    enableROICalculation?: boolean;
    dependencyAnalysisDepth?: 'basic' | 'comprehensive';
  };
  
  featureArchitect?: {
    confidenceThreshold?: number;
    maxFeaturesPerInitiative?: number;
    minFeaturesPerInitiative?: number;
    enableUserJourneyMapping?: boolean;
    platformAnalysisDepth?: 'basic' | 'comprehensive';
  };
  
  qualityGate?: {
    globalConfidenceThreshold?: number;
    enableAutomaticRework?: boolean;
    maxReworkCycles?: number;
    reworkTriggerThreshold?: number;
    gateHistoryRetention?: number;
  };
}
```

## Quality Gates

The system implements comprehensive quality validation at each tier:

### Validation Rules

- **Idea Tier**: Completeness, feasibility score, market analysis quality
- **Initiative Tier**: Count (3-7), resource allocation, timeline feasibility, objective clarity
- **Feature Tier**: Distribution balance, user story quality, technical feasibility, acceptance criteria
- **Epic Tier**: Scope definition, business value assessment, dependency analysis

### Automatic Rework

When quality gates fail, the system can automatically:
1. Identify specific issues and root causes
2. Generate improvement suggestions
3. Re-process the problematic tier
4. Track improvement over rework cycles
5. Abandon after maximum cycles (default: 3)

## Event System

The enhanced decomposer emits detailed events for monitoring:

```typescript
decomposer.on('idea:analysis:start', (data) => console.log('Analyzing idea:', data.idea));
decomposer.on('initiative:planning:complete', (data) => console.log('Initiatives planned:', data.breakdown.initiatives.length));
decomposer.on('quality:gate:complete', (data) => console.log('Quality gate:', data.result.passed));
decomposer.on('quality:rework:started', (data) => console.log('Rework triggered:', data.suggestions));
```

## Market Research Integration

### WebSearch API Integration

Configure with your preferred search API:

```typescript
const decomposer = new TaskDecomposer(githubToken, {
  ideaAnalyzer: {
    webSearchApiKey: process.env.SEARCH_API_KEY,
    webSearchApiUrl: 'https://api.search-provider.com/v1/search',
    marketResearchDepth: 'comprehensive'
  }
});
```

### Research Capabilities

- **Market Sizing**: Automated market size estimation
- **Competitor Analysis**: Identification and analysis of competing solutions
- **Opportunity Detection**: Market gaps and opportunities
- **Threat Assessment**: Competitive threats and market risks
- **Positioning**: Recommended market positioning strategy

## ROI Calculation

Financial projections include:

- **Investment Required**: Resource costs and timeline estimates
- **Expected Return**: Revenue projections based on market analysis
- **Time to Breakeven**: Payback period calculations
- **Risk-Adjusted ROI**: Returns adjusted for identified risks
- **Sensitivity Analysis**: Impact of key assumptions

## User Journey Mapping

Comprehensive user experience analysis:

- **Persona Identification**: User types from feature analysis
- **Journey Steps**: Detailed interaction flows
- **Touchpoint Analysis**: Platform and interface requirements
- **Pain Point Identification**: Potential user friction areas
- **Success Criteria**: Measurable journey outcomes

## Testing

Run the comprehensive test suite:

```bash
npm test
```

Key test scenarios:
- 7-level hierarchy decomposition
- Quality gate validation
- Backward compatibility
- Market research integration
- Event system functionality
- Error handling and rework loops

## API Reference

### Main Classes

- `TaskDecomposer`: Enhanced main class with 7-level support
- `IdeaAnalyzer`: Market research and feasibility analysis
- `InitiativePlanner`: Strategic initiative planning and ROI
- `FeatureArchitect`: Feature breakdown and user journey mapping
- `QualityGateController`: Validation and quality assurance

### Key Methods

- `decomposeEnhanced()`: Full 7-level hierarchical decomposition
- `decompose()`: Legacy 4-level decomposition (backward compatible)
- `createEnhancedGitHubIssues()`: Create GitHub issues for full hierarchy
- `validateAnalysis()`: Run quality gates on specific tiers

### Types

- `EnhancedTaskHierarchy`: Complete 7-level breakdown with quality gates
- `TaskHierarchy`: Legacy 4-level breakdown
- `QualityGate`: Validation results and recommendations
- `Idea`, `Initiative`, `Feature`: Enhanced hierarchy levels

## Integration with CAIA

This enhanced task decomposer integrates seamlessly with the broader CAIA ecosystem:

- Uses shared hierarchical types from `@caia/shared/hierarchical-types`
- Integrates with WebSearch agents for market research
- Supports multi-agent orchestration workflows
- Provides comprehensive event system for monitoring
- Maintains traceability across all hierarchy levels

## Performance Considerations

- **Parallel Processing**: Market research and analysis run concurrently
- **Caching**: Search results and analysis cached to avoid duplicate work
- **Progressive Validation**: Quality gates run incrementally
- **Event-Driven**: Non-blocking event system for real-time monitoring
- **Resource Management**: Configurable limits and timeouts

## Contributing

When contributing to the enhanced task decomposer:

1. Maintain backward compatibility with legacy interfaces
2. Add comprehensive tests for new functionality
3. Update quality gate rules as needed
4. Document configuration changes
5. Follow the established event naming patterns

## License

MIT - See LICENSE file for details.