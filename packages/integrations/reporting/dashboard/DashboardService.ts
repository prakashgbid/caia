/**
 * Dashboard Service for Hierarchical Agent System
 * 
 * Responsibilities:
 * - Real-time decomposition progress tracking
 * - Quality gate status visualization
 * - Estimation accuracy metrics
 * - Hierarchy visualization components
 * - Resource allocation views
 */

import { EventEmitter } from 'events';
import { Logger } from 'winston';
import { 
  Idea,
  Initiative,
  Feature,
  EnhancedEpic,
  HierarchicalBreakdown,
  QualityGate,
  Priority
} from '@caia/shared/hierarchical-types';
import { v4 as uuidv4 } from 'uuid';

export interface DashboardMetrics {
  decomposition: {
    totalIdeas: number;
    totalInitiatives: number;
    totalFeatures: number;
    totalEpics: number;
    completionRate: number;
    averageDecompositionTime: number;
    qualityGatePassRate: number;
  };
  qualityGates: {
    totalGates: number;
    passedGates: number;
    failedGates: number;
    averageConfidence: number;
    criticalIssues: number;
  };
  estimation: {
    accuracyScore: number;
    averageVariance: number;
    estimationTrends: Array<{
      date: Date;
      accuracy: number;
      variance: number;
    }>;
  };
  resources: {
    totalAllocated: number;
    utilizationRate: number;
    bottlenecks: string[];
    efficiency: number;
  };
}

export interface ProgressTrackingData {
  breakdown: HierarchicalBreakdown;
  startTime: Date;
  currentPhase: 'idea' | 'initiatives' | 'features' | 'epics' | 'stories' | 'tasks' | 'complete';
  completedPhases: string[];
  estimatedCompletion: Date;
  actualProgress: number; // 0-1
  qualityGateResults: QualityGate[];
}

export interface QualityGateVisualization {
  gateId: string;
  status: 'passed' | 'failed' | 'pending' | 'warning';
  confidence: number;
  issues: Array<{
    severity: 'critical' | 'high' | 'medium' | 'low';
    type: string;
    description: string;
    recommendation: string;
  }>;
  validations: Array<{
    rule: string;
    passed: boolean;
    score: number;
    details: string;
  }>;
}

export interface HierarchyVisualizationNode {
  id: string;
  type: 'idea' | 'initiative' | 'feature' | 'epic' | 'story' | 'task';
  title: string;
  description: string;
  status: 'completed' | 'in-progress' | 'pending' | 'blocked';
  priority: Priority;
  progress: number; // 0-1
  children: HierarchyVisualizationNode[];
  metadata: {
    estimatedEffort?: number;
    actualEffort?: number;
    businessValue?: number;
    riskLevel?: 'low' | 'medium' | 'high';
    dependencies?: string[];
  };
}

export interface ResourceAllocationView {
  teamMembers: Array<{
    id: string;
    name: string;
    role: string;
    skills: string[];
    currentAllocation: number; // 0-1
    plannedAllocation: number; // 0-1
    workItems: Array<{
      itemId: string;
      itemTitle: string;
      itemType: string;
      allocation: number;
      startDate: Date;
      endDate: Date;
    }>;
  }>;
  skillDemand: Map<string, {
    required: number;
    available: number;
    gap: number;
    impact: 'low' | 'medium' | 'high';
  }>;
  bottlenecks: Array<{
    type: 'skill' | 'capacity' | 'dependency';
    description: string;
    impact: 'low' | 'medium' | 'high';
    mitigation: string[];
  }>;
}

export interface RealTimeUpdate {
  timestamp: Date;
  type: 'progress' | 'quality-gate' | 'resource' | 'error' | 'completion';
  data: any;
  source: string;
}

export interface DashboardConfiguration {
  refreshInterval: number; // milliseconds
  enableRealTimeUpdates: boolean;
  defaultViews: string[];
  alertThresholds: {
    qualityGateFailureRate: number;
    resourceUtilizationMax: number;
    estimationVarianceMax: number;
  };
  customMetrics?: Array<{
    name: string;
    calculation: string;
    displayFormat: string;
  }>;
}

/**
 * Dashboard Service
 * Provides real-time monitoring and visualization for hierarchical decomposition
 */
export class DashboardService extends EventEmitter {
  private logger: Logger;
  private config: DashboardConfiguration;
  private activeBreakdowns: Map<string, ProgressTrackingData> = new Map();
  private metricsHistory: Map<string, DashboardMetrics[]> = new Map();
  private realTimeUpdates: RealTimeUpdate[] = [];
  private updateInterval?: NodeJS.Timeout;
  private maxHistorySize: number = 1000;

  constructor(logger: Logger, config: Partial<DashboardConfiguration> = {}) {
    super();
    this.logger = logger;
    this.config = {
      refreshInterval: 5000, // 5 seconds
      enableRealTimeUpdates: true,
      defaultViews: ['overview', 'progress', 'quality-gates', 'resources'],
      alertThresholds: {
        qualityGateFailureRate: 0.2, // 20%
        resourceUtilizationMax: 0.9, // 90%
        estimationVarianceMax: 0.3 // 30%
      },
      ...config
    };

    if (this.config.enableRealTimeUpdates) {
      this.startRealTimeUpdates();
    }
  }

  /**
   * Track decomposition progress in real-time
   */
  async trackDecompositionProgress(
    breakdown: HierarchicalBreakdown,
    options?: {
      estimatedDuration?: number;
      enableAlerts?: boolean;
    }
  ): Promise<string> {
    const trackingId = uuidv4();
    
    const progressData: ProgressTrackingData = {
      breakdown,
      startTime: new Date(),
      currentPhase: 'idea',
      completedPhases: [],
      estimatedCompletion: new Date(Date.now() + (options?.estimatedDuration || 3600000)), // 1 hour default
      actualProgress: 0,
      qualityGateResults: breakdown.qualityGates || []
    };

    this.activeBreakdowns.set(trackingId, progressData);
    
    this.logger.info('Started tracking decomposition progress', {
      trackingId,
      ideaId: breakdown.idea.id,
      estimatedCompletion: progressData.estimatedCompletion
    });

    // Emit real-time update
    this.emitRealTimeUpdate({
      timestamp: new Date(),
      type: 'progress',
      data: {
        trackingId,
        phase: 'started',
        progress: 0
      },
      source: 'decomposition-tracker'
    });

    return trackingId;
  }

  /**
   * Update decomposition progress
   */
  async updateDecompositionProgress(
    trackingId: string,
    updates: {
      currentPhase?: ProgressTrackingData['currentPhase'];
      completedPhases?: string[];
      actualProgress?: number;
      qualityGateResults?: QualityGate[];
      breakdown?: HierarchicalBreakdown;
    }
  ): Promise<void> {
    const progressData = this.activeBreakdowns.get(trackingId);
    if (!progressData) {
      throw new Error(`Tracking ID ${trackingId} not found`);
    }

    // Update progress data
    if (updates.currentPhase) progressData.currentPhase = updates.currentPhase;
    if (updates.completedPhases) progressData.completedPhases = updates.completedPhases;
    if (updates.actualProgress !== undefined) progressData.actualProgress = updates.actualProgress;
    if (updates.qualityGateResults) progressData.qualityGateResults = updates.qualityGateResults;
    if (updates.breakdown) progressData.breakdown = updates.breakdown;

    this.logger.info('Updated decomposition progress', {
      trackingId,
      currentPhase: progressData.currentPhase,
      progress: progressData.actualProgress
    });

    // Emit real-time update
    this.emitRealTimeUpdate({
      timestamp: new Date(),
      type: 'progress',
      data: {
        trackingId,
        ...updates
      },
      source: 'decomposition-tracker'
    });

    // Check for completion
    if (progressData.actualProgress >= 1.0) {
      await this.completeDecompositionTracking(trackingId);
    }

    // Check for alerts
    await this.checkAndEmitAlerts(trackingId, progressData);
  }

  /**
   * Get current dashboard metrics
   */
  async getDashboardMetrics(timeRange?: {
    start: Date;
    end: Date;
  }): Promise<DashboardMetrics> {
    this.logger.info('Calculating dashboard metrics', { timeRange });

    const allBreakdowns = Array.from(this.activeBreakdowns.values());
    const totalBreakdowns = allBreakdowns.length;
    const completedBreakdowns = allBreakdowns.filter(b => b.actualProgress >= 1.0).length;

    const metrics: DashboardMetrics = {
      decomposition: {
        totalIdeas: allBreakdowns.length,
        totalInitiatives: allBreakdowns.reduce((sum, b) => sum + b.breakdown.initiatives.length, 0),
        totalFeatures: allBreakdowns.reduce((sum, b) => sum + b.breakdown.features.length, 0),
        totalEpics: allBreakdowns.reduce((sum, b) => sum + b.breakdown.epics.length, 0),
        completionRate: totalBreakdowns > 0 ? completedBreakdowns / totalBreakdowns : 0,
        averageDecompositionTime: this.calculateAverageDecompositionTime(allBreakdowns),
        qualityGatePassRate: this.calculateQualityGatePassRate(allBreakdowns)
      },
      qualityGates: {
        totalGates: allBreakdowns.reduce((sum, b) => sum + b.qualityGateResults.length, 0),
        passedGates: allBreakdowns.reduce((sum, b) => 
          sum + b.qualityGateResults.filter(gate => gate.passed).length, 0
        ),
        failedGates: allBreakdowns.reduce((sum, b) => 
          sum + b.qualityGateResults.filter(gate => !gate.passed).length, 0
        ),
        averageConfidence: this.calculateAverageConfidence(allBreakdowns),
        criticalIssues: this.countCriticalIssues(allBreakdowns)
      },
      estimation: {
        accuracyScore: 0.85, // Mock - would be calculated from historical data
        averageVariance: 0.15,
        estimationTrends: this.generateEstimationTrends()
      },
      resources: {
        totalAllocated: 100, // Mock - would come from resource tracking
        utilizationRate: 0.82,
        bottlenecks: ['Frontend Development', 'Database Design'],
        efficiency: 0.78
      }
    };

    // Store metrics for historical tracking
    const historyKey = timeRange ? `${timeRange.start.getTime()}-${timeRange.end.getTime()}` : 'current';
    if (!this.metricsHistory.has(historyKey)) {
      this.metricsHistory.set(historyKey, []);
    }
    this.metricsHistory.get(historyKey)?.push({
      ...metrics,
      timestamp: new Date()
    } as any);

    return metrics;
  }

  /**
   * Get quality gate visualization data
   */
  async getQualityGateVisualization(
    trackingId?: string
  ): Promise<QualityGateVisualization[]> {
    const breakdowns = trackingId 
      ? [this.activeBreakdowns.get(trackingId)].filter(Boolean)
      : Array.from(this.activeBreakdowns.values());

    const visualizations: QualityGateVisualization[] = [];

    for (const breakdown of breakdowns) {
      for (const gate of breakdown?.qualityGateResults || []) {
        visualizations.push({
          gateId: `${gate.tier}-${gate.sourceTier}-${gate.targetTier}`,
          status: gate.passed ? 'passed' : gate.issues.length > 0 ? 'failed' : 'pending',
          confidence: gate.confidence,
          issues: gate.issues.map(issue => ({
            severity: issue.severity,
            type: issue.type,
            description: issue.description,
            recommendation: issue.suggestion
          })),
          validations: gate.validations
        });
      }
    }

    return visualizations;
  }

  /**
   * Generate hierarchy visualization data
   */
  async generateHierarchyVisualization(
    breakdown: HierarchicalBreakdown
  ): Promise<HierarchyVisualizationNode> {
    this.logger.info('Generating hierarchy visualization', {
      ideaId: breakdown.idea.id
    });

    const rootNode: HierarchyVisualizationNode = {
      id: breakdown.idea.id,
      type: 'idea',
      title: breakdown.idea.title,
      description: breakdown.idea.description,
      status: 'in-progress',
      priority: 'high',
      progress: this.calculateOverallProgress(breakdown),
      children: [],
      metadata: {
        businessValue: 100,
        riskLevel: 'medium'
      }
    };

    // Add initiatives as children
    for (const initiative of breakdown.initiatives) {
      const initiativeNode: HierarchyVisualizationNode = {
        id: initiative.id,
        type: 'initiative',
        title: initiative.title,
        description: initiative.description,
        status: this.getItemStatus(initiative),
        priority: initiative.priority,
        progress: Math.random(), // Mock progress
        children: [],
        metadata: {
          estimatedEffort: 40,
          businessValue: 80,
          riskLevel: 'medium',
          dependencies: initiative.dependencies
        }
      };

      // Add features for this initiative
      const initiativeFeatures = breakdown.features.filter(f => f.initiativeId === initiative.id);
      for (const feature of initiativeFeatures) {
        const featureNode: HierarchyVisualizationNode = {
          id: feature.id,
          type: 'feature',
          title: feature.title,
          description: feature.description,
          status: this.getItemStatus(feature),
          priority: 'medium',
          progress: Math.random(),
          children: [],
          metadata: {
            estimatedEffort: 13,
            businessValue: 60,
            riskLevel: 'low'
          }
        };

        // Add epics for this feature
        const featureEpics = breakdown.epics.filter(e => e.featureId === feature.id);
        for (const epic of featureEpics) {
          const epicNode: HierarchyVisualizationNode = {
            id: epic.id,
            type: 'epic',
            title: epic.title,
            description: epic.description,
            status: this.getItemStatus(epic),
            priority: epic.priority,
            progress: Math.random(),
            children: [],
            metadata: {
              estimatedEffort: epic.estimatedStories,
              businessValue: epic.businessValue,
              riskLevel: 'low'
            }
          };
          
          featureNode.children.push(epicNode);
        }
        
        initiativeNode.children.push(featureNode);
      }
      
      rootNode.children.push(initiativeNode);
    }

    return rootNode;
  }

  /**
   * Get resource allocation view
   */
  async getResourceAllocationView(
    breakdown?: HierarchicalBreakdown
  ): Promise<ResourceAllocationView> {
    this.logger.info('Getting resource allocation view');

    // Mock team data - in real implementation, would come from team management system
    const teamMembers = [
      {
        id: 'tm-001',
        name: 'Alice Johnson',
        role: 'Technical Lead',
        skills: ['Architecture', 'Backend Development', 'Team Leadership'],
        currentAllocation: 0.85,
        plannedAllocation: 0.90,
        workItems: [
          {
            itemId: 'init-001',
            itemTitle: 'Authentication System',
            itemType: 'initiative',
            allocation: 0.4,
            startDate: new Date(),
            endDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
          }
        ]
      },
      {
        id: 'tm-002',
        name: 'Bob Smith',
        role: 'Frontend Developer',
        skills: ['React', 'TypeScript', 'UI/UX'],
        currentAllocation: 0.75,
        plannedAllocation: 0.80,
        workItems: [
          {
            itemId: 'feat-001',
            itemTitle: 'User Dashboard',
            itemType: 'feature',
            allocation: 0.6,
            startDate: new Date(),
            endDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000)
          }
        ]
      }
    ];

    const skillDemand = new Map([
      ['Architecture', { required: 40, available: 30, gap: 10, impact: 'medium' as const }],
      ['Backend Development', { required: 80, available: 60, gap: 20, impact: 'high' as const }],
      ['Frontend Development', { required: 60, available: 40, gap: 20, impact: 'high' as const }],
      ['Database Design', { required: 30, available: 20, gap: 10, impact: 'medium' as const }]
    ]);

    const bottlenecks = [
      {
        type: 'skill' as const,
        description: 'Backend development capacity is 25% below demand',
        impact: 'high' as const,
        mitigation: ['Hire additional backend developer', 'Cross-train existing team members']
      },
      {
        type: 'capacity' as const,
        description: 'Team operating at 85% capacity with little buffer',
        impact: 'medium' as const,
        mitigation: ['Reduce scope of current sprint', 'Add team member or extend timeline']
      }
    ];

    return {
      teamMembers,
      skillDemand,
      bottlenecks
    };
  }

  /**
   * Get real-time updates
   */
  getRealTimeUpdates(since?: Date): RealTimeUpdate[] {
    const cutoff = since || new Date(Date.now() - 3600000); // Last hour by default
    return this.realTimeUpdates.filter(update => update.timestamp >= cutoff);
  }

  /**
   * Start real-time update monitoring
   */
  private startRealTimeUpdates(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }

    this.updateInterval = setInterval(() => {
      this.emitPeriodicUpdates();
    }, this.config.refreshInterval);

    this.logger.info('Started real-time updates', {
      interval: this.config.refreshInterval
    });
  }

  /**
   * Stop real-time update monitoring
   */
  stopRealTimeUpdates(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = undefined;
    }
    this.logger.info('Stopped real-time updates');
  }

  /**
   * Complete decomposition tracking
   */
  private async completeDecompositionTracking(trackingId: string): Promise<void> {
    const progressData = this.activeBreakdowns.get(trackingId);
    if (!progressData) return;

    this.logger.info('Completed decomposition tracking', {
      trackingId,
      duration: Date.now() - progressData.startTime.getTime()
    });

    this.emitRealTimeUpdate({
      timestamp: new Date(),
      type: 'completion',
      data: {
        trackingId,
        breakdown: progressData.breakdown,
        duration: Date.now() - progressData.startTime.getTime()
      },
      source: 'decomposition-tracker'
    });

    // Keep completed tracking for historical analysis
    // In production, might move to persistent storage
  }

  /**
   * Check and emit alerts based on thresholds
   */
  private async checkAndEmitAlerts(
    trackingId: string,
    progressData: ProgressTrackingData
  ): Promise<void> {
    const alerts = [];

    // Check quality gate failure rate
    const totalGates = progressData.qualityGateResults.length;
    const failedGates = progressData.qualityGateResults.filter(gate => !gate.passed).length;
    const failureRate = totalGates > 0 ? failedGates / totalGates : 0;

    if (failureRate > this.config.alertThresholds.qualityGateFailureRate) {
      alerts.push({
        type: 'quality-gate-failure',
        severity: 'high',
        message: `Quality gate failure rate (${(failureRate * 100).toFixed(1)}%) exceeds threshold`,
        data: { trackingId, failureRate, threshold: this.config.alertThresholds.qualityGateFailureRate }
      });
    }

    // Check if tracking is taking too long
    const elapsed = Date.now() - progressData.startTime.getTime();
    const estimated = progressData.estimatedCompletion.getTime() - progressData.startTime.getTime();
    
    if (elapsed > estimated * 1.2) { // 20% over estimate
      alerts.push({
        type: 'timeline-overrun',
        severity: 'medium',
        message: 'Decomposition is taking longer than estimated',
        data: { trackingId, elapsed, estimated }
      });
    }

    // Emit alerts
    for (const alert of alerts) {
      this.emit('alert', alert);
      this.emitRealTimeUpdate({
        timestamp: new Date(),
        type: 'error',
        data: alert,
        source: 'alert-system'
      });
    }
  }

  /**
   * Emit real-time update
   */
  private emitRealTimeUpdate(update: RealTimeUpdate): void {
    this.realTimeUpdates.push(update);
    
    // Limit history size
    if (this.realTimeUpdates.length > this.maxHistorySize) {
      this.realTimeUpdates = this.realTimeUpdates.slice(-this.maxHistorySize);
    }

    this.emit('real-time-update', update);
  }

  /**
   * Emit periodic updates
   */
  private emitPeriodicUpdates(): void {
    // Emit metrics update
    this.getDashboardMetrics().then(metrics => {
      this.emitRealTimeUpdate({
        timestamp: new Date(),
        type: 'progress',
        data: { metrics },
        source: 'periodic-update'
      });
    }).catch(error => {
      this.logger.error('Failed to get periodic metrics', { error });
    });
  }

  // Helper calculation methods

  private calculateAverageDecompositionTime(breakdowns: ProgressTrackingData[]): number {
    const completed = breakdowns.filter(b => b.actualProgress >= 1.0);
    if (completed.length === 0) return 0;

    const totalTime = completed.reduce((sum, b) => {
      const duration = (b.estimatedCompletion.getTime() - b.startTime.getTime());
      return sum + duration;
    }, 0);

    return totalTime / completed.length;
  }

  private calculateQualityGatePassRate(breakdowns: ProgressTrackingData[]): number {
    const allGates = breakdowns.flatMap(b => b.qualityGateResults);
    if (allGates.length === 0) return 1.0;

    const passedGates = allGates.filter(gate => gate.passed).length;
    return passedGates / allGates.length;
  }

  private calculateAverageConfidence(breakdowns: ProgressTrackingData[]): number {
    const allGates = breakdowns.flatMap(b => b.qualityGateResults);
    if (allGates.length === 0) return 0;

    const totalConfidence = allGates.reduce((sum, gate) => sum + gate.confidence, 0);
    return totalConfidence / allGates.length;
  }

  private countCriticalIssues(breakdowns: ProgressTrackingData[]): number {
    const allIssues = breakdowns.flatMap(b => 
      b.qualityGateResults.flatMap(gate => gate.issues)
    );
    return allIssues.filter(issue => issue.severity === 'critical').length;
  }

  private generateEstimationTrends(): Array<{
    date: Date;
    accuracy: number;
    variance: number;
  }> {
    // Mock trending data - in real implementation, would come from historical analysis
    const trends = [];
    const now = new Date();
    
    for (let i = 30; i >= 0; i--) {
      const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      trends.push({
        date,
        accuracy: 0.7 + Math.random() * 0.25, // 70-95%
        variance: 0.1 + Math.random() * 0.2   // 10-30%
      });
    }
    
    return trends;
  }

  private calculateOverallProgress(breakdown: HierarchicalBreakdown): number {
    // Simple progress calculation based on completed items
    const totalItems = breakdown.initiatives.length + breakdown.features.length + breakdown.epics.length;
    if (totalItems === 0) return 0;

    // Mock progress - in real implementation, would track actual completion
    return Math.random() * 0.8 + 0.1; // 10-90%
  }

  private getItemStatus(item: any): 'completed' | 'in-progress' | 'pending' | 'blocked' {
    // Mock status - in real implementation, would come from project management system
    const statuses: Array<'completed' | 'in-progress' | 'pending' | 'blocked'> = 
      ['completed', 'in-progress', 'pending', 'blocked'];
    return statuses[Math.floor(Math.random() * statuses.length)];
  }

  /**
   * Get dashboard configuration
   */
  getConfiguration(): DashboardConfiguration {
    return { ...this.config };
  }

  /**
   * Update dashboard configuration
   */
  updateConfiguration(updates: Partial<DashboardConfiguration>): void {
    this.config = { ...this.config, ...updates };
    
    // Restart real-time updates if interval changed
    if (updates.refreshInterval && this.config.enableRealTimeUpdates) {
      this.startRealTimeUpdates();
    }
    
    this.logger.info('Dashboard configuration updated', { updates });
  }

  /**
   * Get service status
   */
  getStatus(): any {
    return {
      activeBreakdowns: this.activeBreakdowns.size,
      realTimeUpdatesEnabled: this.config.enableRealTimeUpdates,
      updateInterval: this.config.refreshInterval,
      metricsHistorySize: Array.from(this.metricsHistory.values())
        .reduce((sum, history) => sum + history.length, 0),
      recentUpdatesCount: this.realTimeUpdates.length,
      uptime: process.uptime()
    };
  }

  /**
   * Clean up resources
   */
  shutdown(): void {
    this.stopRealTimeUpdates();
    this.activeBreakdowns.clear();
    this.metricsHistory.clear();
    this.realTimeUpdates.length = 0;
    this.removeAllListeners();
    this.logger.info('Dashboard service shut down');
  }
}

export default DashboardService;