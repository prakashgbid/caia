/**
 * Consensus Engine - Builds consensus from multiple providers
 */

import { ProviderRegistry } from './registry'
import { ConsensusOptions, ConsensusResult, Response } from './types'

export class ConsensusEngine {
  constructor(private registry: ProviderRegistry) {}

  /**
   * Build consensus from multiple provider responses
   */
  async buildConsensus(
    prompt: string, 
    options?: ConsensusOptions
  ): Promise<ConsensusResult> {
    const startTime = Date.now()
    
    // Get providers to use
    const providerNames = options?.providers || this.registry.list()
    
    if (providerNames.length === 0) {
      throw new Error('No providers available for consensus')
    }

    // Get responses from all providers
    const responses = await this.getResponses(prompt, providerNames)
    
    // Calculate consensus based on mode
    const mode = options?.mode || 'democratic'
    const result = this.calculateConsensus(responses, mode, options)
    
    return {
      ...result,
      providers: providerNames,
      metadata: {
        rounds: 1,
        totalTime: Date.now() - startTime,
        totalCost: responses.reduce((sum, r) => sum + (r.cost || 0), 0)
      }
    }
  }

  /**
   * Get responses from all providers
   */
  private async getResponses(
    prompt: string, 
    providerNames: string[]
  ): Promise<Response[]> {
    const promises = providerNames.map(async (name) => {
      const provider = this.registry.get(name)
      if (!provider) {
        throw new Error(`Provider ${name} not found`)
      }
      return provider.complete(prompt)
    })

    return Promise.all(promises)
  }

  /**
   * Calculate consensus from responses
   */
  private calculateConsensus(
    responses: Response[],
    mode: 'democratic' | 'weighted' | 'hierarchical',
    options?: ConsensusOptions
  ): Omit<ConsensusResult, 'providers' | 'metadata'> {
    // For initial version, use simple majority consensus
    // This will be enhanced with more sophisticated algorithms
    
    // Group similar responses
    const groups = this.groupSimilarResponses(responses)
    
    // Find the largest group (majority)
    const largestGroup = groups.reduce((max, group) => 
      group.length > max.length ? group : max
    )

    const agreement = largestGroup.length / responses.length
    const confidence = this.calculateConfidence(largestGroup, responses)
    
    // Get dissenting opinions
    const dissenting = responses.filter(r => !largestGroup.includes(r))

    return {
      result: this.synthesizeResponse(largestGroup),
      confidence,
      agreement,
      reasoning: this.generateReasoning(largestGroup, dissenting),
      dissenting: dissenting.length > 0 ? dissenting : undefined
    }
  }

  /**
   * Group similar responses together
   */
  private groupSimilarResponses(responses: Response[]): Response[][] {
    // Simple grouping based on content similarity
    // In production, use embeddings for better similarity detection
    const groups: Response[][] = []
    const used = new Set<number>()

    for (let i = 0; i < responses.length; i++) {
      if (used.has(i)) continue
      
      const group = [responses[i]]
      used.add(i)
      
      for (let j = i + 1; j < responses.length; j++) {
        if (used.has(j)) continue
        
        if (this.areSimilar(responses[i], responses[j])) {
          group.push(responses[j])
          used.add(j)
        }
      }
      
      groups.push(group)
    }

    return groups
  }

  /**
   * Check if two responses are similar
   */
  private areSimilar(a: Response, b: Response): boolean {
    // Simple similarity check - enhance with embeddings
    const wordsA = new Set(a.content.toLowerCase().split(/\s+/))
    const wordsB = new Set(b.content.toLowerCase().split(/\s+/))
    
    const intersection = new Set([...wordsA].filter(x => wordsB.has(x)))
    const union = new Set([...wordsA, ...wordsB])
    
    const similarity = union.size > 0 ? intersection.size / union.size : 0
    return similarity > 0.6 // 60% similarity threshold
  }

  /**
   * Calculate confidence score
   */
  private calculateConfidence(
    majorityGroup: Response[], 
    allResponses: Response[]
  ): number {
    const agreementRatio = majorityGroup.length / allResponses.length
    const unanimity = majorityGroup.length === allResponses.length
    
    // Base confidence on agreement ratio
    let confidence = agreementRatio
    
    // Boost for unanimity
    if (unanimity) {
      confidence = Math.min(1, confidence * 1.2)
    }
    
    return confidence
  }

  /**
   * Synthesize a single response from a group
   */
  private synthesizeResponse(group: Response[]): string {
    // For now, return the first response
    // In production, use more sophisticated synthesis
    return group[0].content
  }

  /**
   * Generate reasoning for the consensus
   */
  private generateReasoning(
    majority: Response[], 
    dissenting: Response[]
  ): string {
    const agreementPercent = Math.round(
      (majority.length / (majority.length + dissenting.length)) * 100
    )
    
    let reasoning = `${agreementPercent}% of models agreed on this response.`
    
    if (dissenting.length > 0) {
      reasoning += ` ${dissenting.length} model(s) provided alternative perspectives.`
    }
    
    return reasoning
  }
}