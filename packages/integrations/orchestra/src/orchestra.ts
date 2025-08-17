/**
 * Orchestra - Main orchestration class
 */

import { EventEmitter } from 'eventemitter3'
import { 
  OrchestraConfig, 
  ConsensusOptions, 
  ConsensusResult, 
  DebateOptions,
  DebateResult,
  DebateRound,
  QueryOptions,
  Response,
  ProviderConfig
} from './types'
import { ProviderRegistry } from './registry'
import { ConsensusEngine } from './consensus'

export class Orchestra extends EventEmitter {
  private registry: ProviderRegistry
  private consensusEngine: ConsensusEngine
  private config: OrchestraConfig

  constructor(config: OrchestraConfig) {
    super()
    this.config = config
    this.registry = new ProviderRegistry()
    this.consensusEngine = new ConsensusEngine(this.registry)
    
    this.initialize()
  }

  private async initialize() {
    // Register configured providers
    for (const [name, config] of Object.entries(this.config.providers)) {
      await this.registry.register(name, config)
    }
    
    this.emit('initialized', {
      providers: Object.keys(this.config.providers)
    })
  }

  /**
   * Simple query to a single provider
   */
  async query(prompt: string, options?: QueryOptions): Promise<Response> {
    const providerName = options?.provider || this.config.defaultProvider || 'openai'
    const provider = this.registry.get(providerName)
    
    if (!provider) {
      throw new Error(`Provider ${providerName} not found`)
    }

    const startTime = Date.now()
    const response = await provider.complete(prompt, options)
    
    return {
      ...response,
      provider: providerName,
      latency: Date.now() - startTime
    }
  }

  /**
   * Get consensus from multiple providers
   */
  async consensus(prompt: string, options?: ConsensusOptions): Promise<ConsensusResult> {
    this.emit('consensus:start', { prompt, options })
    
    const result = await this.consensusEngine.buildConsensus(prompt, options)
    
    this.emit('consensus:complete', result)
    return result
  }

  /**
   * Run a structured debate between providers
   */
  async debate(prompt: string, options?: DebateOptions): Promise<DebateResult> {
    this.emit('debate:start', { prompt, options })
    
    const rounds: DebateRound[] = []
    let agreement = 0
    let round = 0
    const maxRounds = options?.maxRounds || this.config.maxDebateRounds || 3
    const threshold = options?.threshold || this.config.consensusThreshold || 0.7

    const providers = options?.providers || Object.keys(this.config.providers)

    while (agreement < threshold && round < maxRounds) {
      round++
      
      // Get responses from all providers
      const responses = await Promise.all(
        providers.map(p => this.query(prompt, { provider: p }))
      )

      // Calculate agreement
      agreement = this.calculateAgreement(responses)
      
      rounds.push({
        round,
        arguments: responses,
        agreement
      })

      this.emit('debate:round', { round, agreement })

      // Update prompt with debate context for next round
      if (agreement < threshold && round < maxRounds) {
        prompt = this.buildDebatePrompt(prompt, rounds)
      }
    }

    const result: DebateResult = {
      decision: this.synthesizeDecision(rounds),
      rounds,
      agreement,
      participants: providers,
      confidence: agreement
    }

    this.emit('debate:complete', result)
    return result
  }

  /**
   * Calculate agreement between responses
   */
  private calculateAgreement(responses: Response[]): number {
    // Simple implementation - can be enhanced with embeddings
    if (responses.length <= 1) return 1

    // For now, use a simple length/content similarity
    const contents = responses.map(r => r.content.toLowerCase())
    let totalSimilarity = 0
    let comparisons = 0

    for (let i = 0; i < contents.length; i++) {
      for (let j = i + 1; j < contents.length; j++) {
        totalSimilarity += this.calculateSimilarity(contents[i], contents[j])
        comparisons++
      }
    }

    return comparisons > 0 ? totalSimilarity / comparisons : 0
  }

  /**
   * Calculate similarity between two strings
   */
  private calculateSimilarity(a: string, b: string): number {
    // Simple implementation - can be enhanced
    const wordsA = new Set(a.split(/\s+/))
    const wordsB = new Set(b.split(/\s+/))
    
    const intersection = new Set([...wordsA].filter(x => wordsB.has(x)))
    const union = new Set([...wordsA, ...wordsB])
    
    return union.size > 0 ? intersection.size / union.size : 0
  }

  /**
   * Build debate prompt with context from previous rounds
   */
  private buildDebatePrompt(originalPrompt: string, rounds: DebateRound[]): string {
    const lastRound = rounds[rounds.length - 1]
    const perspectives = lastRound.arguments
      .map((arg) => `${arg.provider}: ${arg.content.substring(0, 200)}...`)
      .join('\n')

    return `
Original question: ${originalPrompt}

Previous perspectives:
${perspectives}

Please reconsider your response taking into account these other viewpoints.
Aim for consensus while maintaining your analytical rigor.`
  }

  /**
   * Synthesize final decision from debate rounds
   */
  private synthesizeDecision(rounds: DebateRound[]): string {
    const lastRound = rounds[rounds.length - 1]
    
    // For now, return the response with highest implicit confidence
    // Can be enhanced with more sophisticated synthesis
    const bestResponse = lastRound.arguments[0]
    return bestResponse.content
  }

  /**
   * Add a new provider dynamically
   */
  async addProvider(name: string, config: ProviderConfig): Promise<void> {
    await this.registry.register(name, config)
    this.emit('provider:added', { name })
  }

  /**
   * Remove a provider
   */
  removeProvider(name: string): void {
    this.registry.remove(name)
    this.emit('provider:removed', { name })
  }

  /**
   * Get list of available providers
   */
  getProviders(): string[] {
    return this.registry.list()
  }

  /**
   * Health check for all providers
   */
  async healthCheck(): Promise<Record<string, boolean>> {
    const providers = this.registry.list()
    const health: Record<string, boolean> = {}

    for (const provider of providers) {
      try {
        const p = this.registry.get(provider)
        if (p && p.healthCheck) {
          health[provider] = await p.healthCheck()
        } else {
          health[provider] = true // Assume healthy if no health check
        }
      } catch (error) {
        health[provider] = false
      }
    }

    return health
  }
}