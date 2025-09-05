/**
 * Stream 4: Agent Integration Bridges and Documentation Systems
 * 
 * This module provides integration bridges to existing CAIA agents and
 * comprehensive documentation and reporting capabilities for the 
 * Hierarchical Agent System.
 */

// Agent Integration Bridges
export { SolutionArchitectBridge } from './agents/solution-architect/bridge';
export { BusinessAnalystBridge } from './agents/business-analyst/bridge';
export { SprintPrioritizerBridge } from './agents/sprint-prioritizer/bridge';

// Documentation System
export { DocumentationGenerator } from './documentation/generator/DocumentationGenerator';

// Reporting and Dashboard
export { DashboardService } from './reporting/dashboard/DashboardService';

// Re-export types for external use
export type {
  // Solution Architect Bridge Types
  TechnicalFeasibilityRequest,
  TechnicalFeasibilityResult,
  ArchitecturalAnalysisRequest,
  ArchitecturalAnalysisResult,
  ComplianceValidationRequest,
  ComplianceValidationResult
} from './agents/solution-architect/bridge';

export type {
  // Business Analyst Bridge Types
  RequirementsExtractionRequest,
  RequirementsExtractionResult,
  AcceptanceCriteriaRequest,
  AcceptanceCriteriaResult,
  UserStoryRefinementRequest,
  UserStoryRefinementResult,
  StakeholderImpactRequest,
  StakeholderImpactResult,
  BusinessValueRequest,
  BusinessValueResult
} from './agents/business-analyst/bridge';

export type {
  // Sprint Prioritizer Bridge Types
  SprintPlanningRequest,
  SprintPlanningResult,
  PriorityScoreRequest,
  PriorityScoreResult,
  CapacityPlanningRequest,
  CapacityPlanningResult,
  VelocityAdjustmentRequest,
  VelocityAdjustmentResult
} from './agents/sprint-prioritizer/bridge';

export type {
  // Documentation Generator Types
  DocumentationRequest,
  DocumentationResult,
  ExecutiveSummaryData,
  TechnicalSpecificationData,
  RoadmapVisualizationData,
  ResourcePlanningData
} from './documentation/generator/DocumentationGenerator';

export type {
  // Dashboard Service Types
  DashboardMetrics,
  ProgressTrackingData,
  QualityGateVisualization,
  HierarchyVisualizationNode,
  ResourceAllocationView,
  RealTimeUpdate,
  DashboardConfiguration
} from './reporting/dashboard/DashboardService';

/**
 * Stream 4 Integration Factory
 * Creates and configures all Stream 4 components
 */
export class Stream4IntegrationFactory {
  /**
   * Create a complete Stream 4 integration suite
   */
  static createIntegrationSuite(options: {
    logger: any;
    solutionArchitectAgent?: any;
    businessAnalystAgent?: any;
    sprintPrioritizerAgent?: any;
    documentationOutputPath?: string;
    dashboardConfig?: any;
  }) {
    const {
      logger,
      solutionArchitectAgent,
      businessAnalystAgent,
      sprintPrioritizerAgent,
      documentationOutputPath,
      dashboardConfig
    } = options;

    // Create agent bridges
    const solutionArchitectBridge = new SolutionArchitectBridge(
      solutionArchitectAgent,
      logger
    );

    const businessAnalystBridge = new BusinessAnalystBridge(
      businessAnalystAgent,
      logger
    );

    const sprintPrioritizerBridge = new SprintPrioritizerBridge(
      sprintPrioritizerAgent,
      logger
    );

    // Create documentation generator
    const documentationGenerator = new DocumentationGenerator(
      logger,
      documentationOutputPath
    );

    // Create dashboard service
    const dashboardService = new DashboardService(
      logger,
      dashboardConfig
    );

    return {
      bridges: {
        solutionArchitect: solutionArchitectBridge,
        businessAnalyst: businessAnalystBridge,
        sprintPrioritizer: sprintPrioritizerBridge
      },
      documentation: documentationGenerator,
      dashboard: dashboardService,
      
      // Utility methods
      async getStatus() {
        return {
          bridges: {
            solutionArchitect: solutionArchitectBridge.getStatus(),
            businessAnalyst: businessAnalystBridge.getStatus(),
            sprintPrioritizer: sprintPrioritizerBridge.getStatus()
          },
          documentation: documentationGenerator.getStatus(),
          dashboard: dashboardService.getStatus()
        };
      },

      async shutdown() {
        documentationGenerator.clearCache();
        dashboardService.shutdown();
        logger.info('Stream 4 integration suite shut down');
      }
    };
  }
}

export default Stream4IntegrationFactory;