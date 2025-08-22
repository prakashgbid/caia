/**
 * Type definitions for @caia/work-divider
 */

export type ComplexityScore = number;
export type Duration = number;
export type WorkerId = string | number;

export interface Resources {
  memory: number;
  cpu: number;
  disk?: number;
  network?: number;
}

export interface Metrics {
  throughput: number;
  latency: number;
  errorRate?: number;
  successRate?: number;
}

export interface Optimization {
  type: 'rebalance' | 'merge' | 'split' | 'redistribute';
  reason: string;
  impact: number;
  recommendation: string;
}

export interface Bottleneck {
  location: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  impact: number;
  suggestions: string[];
}