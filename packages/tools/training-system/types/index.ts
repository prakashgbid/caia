/**
 * SATS Core Types
 */

export interface LLMProvider {
  name: string;
  model: string;
  apiKey: string;
  endpoint?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface ProviderConfig {
  openai?: {
    apiKey: string;
    model?: string;
    maxTokens?: number;
    temperature?: number;
  };
  google?: {
    apiKey: string;
    model?: string;
    maxTokens?: number;
    temperature?: number;
  };
  anthropic?: {
    apiKey: string;
    model?: string;
    maxTokens?: number;
    temperature?: number;
  };
  meta?: {
    apiKey: string;
    model?: string;
    endpoint?: string;
  };
}

export interface AgentQuery {
  prompt: string;
  context?: string;
  requireConsensus?: boolean;
  showDebate?: boolean;
  maxDebateRounds?: number;
  votingThreshold?: number;
  timeoutMs?: number;
  metadata?: Record<string, any>;
}

export interface ModelResponse {
  provider: string;
  model: string;
  response: string;
  confidence: number;
  reasoning: string;
  tokens: {
    input: number;
    output: number;
    total: number;
  };
  latency: number;
  cost: number;
}

export interface DebateRound {
  round: number;
  participants: string[];
  arguments: ModelResponse[];
  counterArguments: ModelResponse[];
  synthesis: string;
  agreement: number;
}

export interface ConsensusResult {
  decision: string;
  confidence: number;
  agreement: number;
  debate?: DebateRound[];
  participants: string[];
  reasoning: string;
  dissenting: ModelResponse[];
  metadata: {
    totalTokens: number;
    totalCost: number;
    processingTime: number;
    rounds: number;
  };
}

export interface AgentCapability {
  name: string;
  description: string;
  parameters: Record<string, any>;
  required: boolean;
}

export interface AgentProfile {
  id: string;
  name: string;
  type: 'specialist' | 'supervisor' | 'executive';
  domain: string;
  capabilities: AgentCapability[];
  model: string;
  personality: string;
  instructions: string;
  memory: {
    shortTerm: any[];
    longTerm: string[];
  };
}

export interface MemoryItem {
  id: string;
  content: string;
  vector: number[];
  metadata: {
    timestamp: number;
    source: string;
    importance: number;
    tags: string[];
  };
}

export interface VectorSearchResult {
  item: MemoryItem;
  similarity: number;
}

export type CollaborationMode = 
  | 'democratic_consensus'  // All models vote equally
  | 'expertise_weighted'    // Models weighted by domain expertise
  | 'hierarchical'          // Structured decision hierarchy
  | 'debate_synthesis';     // Adversarial debate then synthesis

export type AgentRole = 'sme' | 'lead' | 'manager' | 'executive';

export interface SystemMetrics {
  responseTime: number;
  consensusAccuracy: number;
  modelAgreement: number;
  systemUptime: number;
  totalQueries: number;
  successRate: number;
}

export interface RateLimitConfig {
  requests: number;
  windowMs: number;
  skipSuccessfulRequests: boolean;
}

export interface SecurityConfig {
  apiKeyEncryption: boolean;
  auditLogging: boolean;
  rateLimiting: RateLimitConfig;
  ipWhitelist?: string[];
}