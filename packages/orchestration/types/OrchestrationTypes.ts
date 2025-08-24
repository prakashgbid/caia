/**
 * Type definitions for the Orchestration module
 */

export interface OrchestrationConfig {
  deployment_id?: string;
  environment: 'development' | 'staging' | 'production';
  debug?: boolean;
  log_level?: 'debug' | 'info' | 'warn' | 'error';
  
  parallel_execution?: {
    cc_orchestrator_enabled: boolean;
    max_instances: number;
    auto_calculate_instances: boolean;
    task_timeout: number;
    rate_limit: number;
  };
  
  quality_gates?: {
    enabled: boolean;
    confidence_threshold: number;
    validation_timeout: number;
    auto_retry: boolean;
    max_retries: number;
  };
  
  jira_integration?: {
    use_advanced_roadmaps: boolean;
    bulk_operations: boolean;
    rate_limit_buffer: number;
    connection_pool_size: number;
  };
  
  intelligence?: {
    learning_enabled: boolean;
    pattern_recognition: boolean;
    confidence_scoring: boolean;
    analytics_reporting: boolean;
  };
  
  caching?: {
    enabled: boolean;
    ttl_patterns: number;
    ttl_jira_metadata: number;
    ttl_quality_results: number;
    max_memory_usage: string;
  };
  
  monitoring?: {
    metrics_enabled: boolean;
    alerts_enabled: boolean;
    health_checks: boolean;
    performance_tracking: boolean;
  };
  
  security?: {
    input_validation: boolean;
    rate_limiting: boolean;
    webhook_verification: boolean;
    audit_logging: boolean;
  };
}

export interface DecompositionRequest {
  id: string;
  idea: string;
  context?: string;
  options?: DecompositionOptions;
  priority?: 'low' | 'medium' | 'high' | 'critical';
  requester?: string;
  timestamp: Date;
}

export interface DecompositionOptions {
  maxDepth?: number;
  qualityGatesEnabled?: boolean;
  generateDocumentation?: boolean;
  createJiraHierarchy?: boolean;
  enableLearning?: boolean;
  customFields?: Record<string, any>;
}

export interface DecompositionResult {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  hierarchy?: any; // HierarchicalBreakdown from shared types
  qualityGates: QualityGateResult[];
  jiraLinks?: JiraHierarchyLinks;
  documentation?: GeneratedDocumentation;
  metrics: DecompositionMetrics;
  error?: string;
  timestamp: Date;
}

export interface QualityGateResult {
  tier: string;
  passed: boolean;
  confidence: number;
  issues: string[];
  timestamp: Date;
}

export interface JiraHierarchyLinks {
  initiativeId?: string;
  epicIds: string[];
  storyIds: string[];
  taskIds: string[];
  subtaskIds: string[];
}

export interface GeneratedDocumentation {
  executiveSummary: string;
  technicalSpecification: string;
  roadmap: string;
  resourcePlan: string;
  riskRegister: string;
}

export interface DecompositionMetrics {
  totalItems: number;
  processingTimeMs: number;
  qualityGateSuccessRate: number;
  memoryUsageMB: number;
  cacheHitRate: number;
}

export interface TriggerEvent {
  type: 'github' | 'slack' | 'email' | 'calendar' | 'manual';
  source: string;
  payload: any;
  timestamp: Date;
}

export interface SystemMetrics {
  totalDecompositions: number;
  successRate: number;
  averageProcessingTime: number;
  memoryUsage: number;
  cacheHitRate: number;
  qualityGateSuccessRate: number;
  timestamp: Date;
}

export interface Alert {
  type: 'error' | 'warning' | 'info';
  message: string;
  component: string;
  details?: any;
  timestamp: Date;
}