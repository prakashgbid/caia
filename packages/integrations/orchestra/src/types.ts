/**
 * Orchestra Type Definitions
 */

export interface OrchestraConfig {
  providers: Record<string, ProviderConfig>
  defaultProvider?: string
  consensusThreshold?: number
  maxDebateRounds?: number
  timeout?: number
  cache?: boolean
}

export interface ProviderConfig {
  apiKey: string
  endpoint?: string
  model?: string
  maxTokens?: number
  temperature?: number
}

export interface QueryOptions {
  provider?: string
  maxTokens?: number
  temperature?: number
  stream?: boolean
}

export interface StreamOptions extends QueryOptions {
  onToken?: (token: string) => void
}

export interface Response {
  content: string
  provider: string
  model?: string
  tokens?: {
    input: number
    output: number
    total: number
  }
  cost?: number
  latency?: number
}

export interface ConsensusOptions {
  providers?: string[]
  mode?: 'democratic' | 'weighted' | 'hierarchical'
  weights?: Record<string, number>
  threshold?: number
  maxRounds?: number
  showDebate?: boolean
}

export interface ConsensusResult {
  result: string
  confidence: number
  agreement: number
  providers: string[]
  reasoning: string
  debate?: DebateRound[]
  dissenting?: Response[]
  metadata?: {
    rounds: number
    totalTime: number
    totalCost: number
  }
}

export interface DebateOptions {
  providers?: string[]
  maxRounds?: number
  threshold?: number
  stream?: boolean
}

export interface DebateResult {
  decision: string
  rounds: DebateRound[]
  agreement: number
  participants: string[]
  confidence: number
}

export interface DebateRound {
  round: number
  arguments: Response[]
  agreement: number
  synthesis?: string
}