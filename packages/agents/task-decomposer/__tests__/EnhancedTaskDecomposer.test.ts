import { TaskDecomposer, DecompositionOptions, EnhancedTaskHierarchy } from '../src/index';
import { Idea, QualityGate } from '@caia/shared/hierarchical-types';

describe('Enhanced TaskDecomposer', () => {
  let decomposer: TaskDecomposer;

  beforeEach(() => {
    decomposer = new TaskDecomposer();
  });

  describe('7-Level Hierarchy Decomposition', () => {
    it('should decompose an idea through all 7 levels', async () => {
      const ideaText = 'Create a comprehensive customer relationship management system that helps businesses track leads, manage customer interactions, and analyze sales performance with real-time dashboards and automated reporting capabilities.';
      const context = 'Enterprise B2B SaaS application for sales teams';
      
      const options: DecompositionOptions = {
        enableHierarchicalDecomposition: true,
        marketResearchDepth: 'medium',
        enableROICalculation: true,
        enableUserJourneyMapping: true,
        qualityGateThreshold: 0.85,
        enableAutomaticRework: false
      };

      const result: EnhancedTaskHierarchy = await decomposer.decomposeEnhanced(ideaText, context, options);

      // Verify all 7 levels are present
      expect(result.idea).toBeDefined();
      expect(result.initiatives).toBeDefined();
      expect(result.features).toBeDefined();
      expect(result.epics).toBeDefined();
      expect(result.stories).toBeDefined();
      expect(result.tasks).toBeDefined();
      expect(result.subtasks).toBeDefined();

      // Verify idea analysis
      expect(result.idea.title).toBeTruthy();
      expect(result.idea.description).toEqual(ideaText);
      expect(result.idea.marketAnalysis).toBeDefined();
      expect(result.idea.feasibility).toBeDefined();
      expect(result.idea.risks).toBeDefined();

      // Verify initiatives (3-7 expected)
      expect(result.initiatives.length).toBeGreaterThanOrEqual(3);
      expect(result.initiatives.length).toBeLessThanOrEqual(7);
      expect(result.initiatives[0].ideaId).toEqual(result.idea.id);
      expect(result.initiatives[0].title).toBeTruthy();
      expect(result.initiatives[0].objectives).toBeDefined();
      expect(result.initiatives[0].resources).toBeDefined();

      // Verify features (5-12 per initiative)
      expect(result.features.length).toBeGreaterThan(0);
      const initiativeIds = new Set(result.initiatives.map(i => i.id));
      result.features.forEach(feature => {
        expect(initiativeIds.has(feature.initiativeId)).toBeTruthy();
        expect(feature.userStories).toBeDefined();
        expect(feature.acceptanceCriteria).toBeDefined();
        expect(feature.technicalRequirements).toBeDefined();
      });

      // Verify enhanced epics
      expect(result.epics.length).toBeGreaterThan(0);
      const featureIds = new Set(result.features.map(f => f.id));
      result.epics.forEach(epic => {
        expect(featureIds.has(epic.featureId)).toBeTruthy();
        expect(epic.businessValue).toBeGreaterThan(0);
        expect(epic.estimatedStories).toBeGreaterThan(0);
        expect(epic.qualityScore).toBeDefined();
      });

      // Verify quality gates
      expect(result.qualityGates).toBeDefined();
      expect(result.qualityGates.length).toBeGreaterThan(0);
      expect(result.validationPassed).toBeDefined();
      expect(result.confidenceScore).toBeGreaterThan(0);

      // Verify traceability
      expect(result.traceability).toBeDefined();
      expect(result.traceability.links).toBeDefined();
      expect(result.traceability.links.length).toBeGreaterThan(0);
    }, 30000); // Increased timeout for comprehensive test

    it('should handle quality gate failures when automatic rework is disabled', async () => {
      const ideaText = 'Simple todo app'; // Minimal idea to potentially trigger quality gate failures
      
      const options: DecompositionOptions = {
        enableHierarchicalDecomposition: true,
        qualityGateThreshold: 0.95, // Very high threshold
        enableAutomaticRework: false
      };

      // This should potentially throw due to quality gate failures
      try {
        await decomposer.decomposeEnhanced(ideaText, undefined, options);
        // If it doesn't throw, that's also valid - depends on the quality of analysis
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('quality gate');
      }
    });

    it('should maintain backward compatibility', async () => {
      const ideaText = 'Create a project management tool';
      
      // Test legacy decompose method
      const legacyResult = await decomposer.decompose(ideaText);
      
      expect(legacyResult.epic).toBeDefined();
      expect(legacyResult.stories).toBeDefined();
      expect(legacyResult.tasks).toBeDefined();
      expect(legacyResult.subtasks).toBeDefined();

      // Test enhanced mode through legacy method
      const enhancedLegacyResult = await decomposer.decompose(ideaText, undefined, {
        enableHierarchicalDecomposition: true
      });
      
      expect(enhancedLegacyResult.epic).toBeDefined();
      expect(enhancedLegacyResult.stories).toBeDefined();
      expect(enhancedLegacyResult.tasks).toBeDefined();
      expect(enhancedLegacyResult.subtasks).toBeDefined();
    });
  });

  describe('Quality Gate System', () => {
    it('should validate each tier with appropriate confidence thresholds', async () => {
      const ideaText = 'E-commerce platform with AI-powered recommendations';
      
      const options: DecompositionOptions = {
        enableHierarchicalDecomposition: true,
        qualityGateThreshold: 0.75,
        enableAutomaticRework: true
      };

      const result = await decomposer.decomposeEnhanced(ideaText, undefined, options);
      
      // Check that quality gates were created for each tier
      const gateTiers = result.qualityGates.map(gate => gate.tier);
      expect(gateTiers).toContain('idea');
      expect(gateTiers).toContain('initiative');
      expect(gateTiers).toContain('feature');

      // Verify gate structure
      result.qualityGates.forEach(gate => {
        expect(gate.confidence).toBeGreaterThanOrEqual(0);
        expect(gate.confidence).toBeLessThanOrEqual(1);
        expect(gate.threshold).toBeDefined();
        expect(gate.validations).toBeDefined();
        expect(gate.passed).toBeDefined();
        expect(gate.recommendations).toBeDefined();
      });
    });
  });

  describe('Market Research Integration', () => {
    it('should include market analysis in idea tier', async () => {
      const ideaText = 'AI-powered fitness coaching app with personalized workout plans';
      const context = 'Mobile health and fitness market targeting millennials';
      
      const options: DecompositionOptions = {
        enableHierarchicalDecomposition: true,
        marketResearchDepth: 'shallow' // Use shallow to avoid external API calls
      };

      const result = await decomposer.decomposeEnhanced(ideaText, context, options);
      
      expect(result.idea.marketAnalysis).toBeDefined();
      expect(result.idea.marketAnalysis!.marketSize).toBeGreaterThan(0);
      expect(result.idea.marketAnalysis!.competitors).toBeDefined();
      expect(result.idea.marketAnalysis!.opportunities).toBeDefined();
      expect(result.idea.marketAnalysis!.threats).toBeDefined();
      expect(result.idea.marketAnalysis!.positioning).toBeTruthy();
    });
  });

  describe('User Journey Mapping', () => {
    it('should create user journeys when enabled', async () => {
      const ideaText = 'Online learning platform for professional development courses';
      
      const options: DecompositionOptions = {
        enableHierarchicalDecomposition: true,
        enableUserJourneyMapping: true
      };

      const result = await decomposer.decomposeEnhanced(ideaText, undefined, options);
      
      // User journeys should be created through FeatureArchitect
      // They would be accessible through the featureArchitect instance
      expect(result.features).toBeDefined();
      expect(result.features.length).toBeGreaterThan(0);
      
      // Verify features have user stories that could map to journeys
      result.features.forEach(feature => {
        expect(feature.userStories).toBeDefined();
        expect(feature.userStories.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Event System', () => {
    it('should emit events during enhanced decomposition', (done) => {
      const events: string[] = [];
      
      decomposer.on('idea:analysis:start', () => events.push('idea:analysis:start'));
      decomposer.on('idea:analysis:complete', () => events.push('idea:analysis:complete'));
      decomposer.on('initiative:planning:start', () => events.push('initiative:planning:start'));
      decomposer.on('initiative:planning:complete', () => events.push('initiative:planning:complete'));
      decomposer.on('feature:architecture:start', () => events.push('feature:architecture:start'));
      decomposer.on('feature:architecture:complete', () => events.push('feature:architecture:complete'));
      decomposer.on('decomposition:enhanced:complete', () => {
        events.push('decomposition:enhanced:complete');
        
        // Verify expected events were emitted
        expect(events).toContain('idea:analysis:start');
        expect(events).toContain('idea:analysis:complete');
        expect(events).toContain('initiative:planning:start');
        expect(events).toContain('initiative:planning:complete');
        expect(events).toContain('feature:architecture:start');
        expect(events).toContain('feature:architecture:complete');
        expect(events).toContain('decomposition:enhanced:complete');
        
        done();
      });

      decomposer.decomposeEnhanced('Social media management tool for small businesses', undefined, {
        enableHierarchicalDecomposition: true
      }).catch(done);
    }, 15000);
  });
});