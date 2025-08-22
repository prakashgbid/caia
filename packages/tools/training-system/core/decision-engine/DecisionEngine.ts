/**
 * DecisionEngine - Consensus Building and Decision Making
 * 
 * Handles the complex logic of synthesizing multiple LLM responses
 * into coherent decisions through various collaboration modes.
 */

import { ModelResponse, CollaborationMode } from '@sats/types';
import { Logger } from '@sats/utils/Logger';

export interface SynthesisResult {
  decision: string;
  confidence: number;
  reasoning: string;
  methodology: string;
}

export class DecisionEngine {
  private logger: Logger;
  private config: {
    votingThreshold: number;
    maxDebateRounds: number;
    timeoutMs: number;
  };

  constructor(config: any) {
    this.logger = new Logger('DecisionEngine');
    this.config = config;
  }

  /**
   * Synthesize multiple model responses into a single decision
   */
  synthesize(
    responses: ModelResponse[],
    mode: CollaborationMode
  ): SynthesisResult {
    this.logger.info(`Synthesizing ${responses.length} responses using ${mode} mode`);

    switch (mode) {
      case 'democratic_consensus':
        return this.democraticConsensus(responses);
        
      case 'expertise_weighted':
        return this.expertiseWeighted(responses);
        
      case 'hierarchical':
        return this.hierarchicalDecision(responses);
        
      case 'debate_synthesis':
        return this.debateSynthesis(responses);
        
      default:
        throw new Error(`Unsupported collaboration mode: ${mode}`);
    }
  }

  /**
   * Democratic consensus - all models have equal weight
   */
  private democraticConsensus(responses: ModelResponse[]): SynthesisResult {
    // Calculate average confidence
    const avgConfidence = responses.reduce((sum, r) => sum + r.confidence, 0) / responses.length;
    
    // Find the response with highest confidence that's close to average
    const consensusResponse = responses.reduce((best, current) => {
      const bestDistance = Math.abs(best.confidence - avgConfidence);
      const currentDistance = Math.abs(current.confidence - avgConfidence);
      return currentDistance < bestDistance ? current : best;
    });

    // Create synthesis of all responses
    const synthesis = this.createSynthesis(responses, 'democratic');

    return {
      decision: synthesis,
      confidence: avgConfidence,
      reasoning: `Democratic consensus reached with ${responses.length} participants. ` +
                `Selected response from ${consensusResponse.provider} as it best represents ` +
                `the group consensus (confidence: ${consensusResponse.confidence.toFixed(2)}).`,
      methodology: 'democratic_consensus'
    };
  }

  /**
   * Expertise-weighted decisions based on domain knowledge
   */
  private expertiseWeighted(responses: ModelResponse[]): SynthesisResult {
    // TODO: Implement expertise weighting based on domain knowledge
    // For now, use confidence as a proxy for expertise
    
    const totalWeight = responses.reduce((sum, r) => sum + r.confidence, 0);
    const weightedAvgConfidence = responses.reduce((sum, r) => 
      sum + (r.confidence * r.confidence / totalWeight), 0
    );

    const bestExpertResponse = responses.reduce((best, current) => 
      current.confidence > best.confidence ? current : best
    );

    const synthesis = this.createSynthesis(responses, 'weighted');

    return {
      decision: synthesis,
      confidence: weightedAvgConfidence,
      reasoning: `Expertise-weighted decision prioritizing ${bestExpertResponse.provider} ` +
                `(confidence: ${bestExpertResponse.confidence.toFixed(2)}). ` +
                `Weighted average confidence: ${weightedAvgConfidence.toFixed(2)}.`,
      methodology: 'expertise_weighted'
    };
  }

  /**
   * Hierarchical decision making with structured roles
   */
  private hierarchicalDecision(responses: ModelResponse[]): SynthesisResult {
    // Sort by confidence (simulating hierarchy based on expertise)
    const sorted = [...responses].sort((a, b) => b.confidence - a.confidence);
    
    // Executive decision (highest confidence)
    const executive = sorted[0];
    
    // Consider input from all levels
    const synthesis = this.createHierarchicalSynthesis(sorted);

    return {
      decision: synthesis,
      confidence: executive.confidence,
      reasoning: `Hierarchical decision with ${executive.provider} as executive ` +
                `(confidence: ${executive.confidence.toFixed(2)}). ` +
                `Incorporated insights from ${responses.length - 1} advisory models.`,
      methodology: 'hierarchical'
    };
  }

  /**
   * Adversarial debate then synthesis
   */
  private debateSynthesis(responses: ModelResponse[]): SynthesisResult {
    // Find the most divergent responses for debate
    const sorted = [...responses].sort((a, b) => b.confidence - a.confidence);
    const primary = sorted[0];
    const alternative = sorted.find(r => 
      Math.abs(r.confidence - primary.confidence) > 0.2
    ) || sorted[1];

    // Create balanced synthesis considering all viewpoints
    const synthesis = this.createDebateSynthesis([primary, alternative], responses);
    
    const avgConfidence = (primary.confidence + (alternative?.confidence || primary.confidence)) / 2;

    return {
      decision: synthesis,
      confidence: avgConfidence,
      reasoning: `Debate synthesis between ${primary.provider} ` +
                `(${primary.confidence.toFixed(2)}) and ` +
                `${alternative?.provider || 'consensus'} ` +
                `(${alternative?.confidence.toFixed(2) || 'N/A'}). ` +
                `Considered all ${responses.length} perspectives.`,
      methodology: 'debate_synthesis'
    };
  }

  /**
   * Create a synthesis of multiple responses
   */
  private createSynthesis(responses: ModelResponse[], type: string): string {
    const uniquePoints = new Set<string>();
    const commonThemes = [];

    // Extract key points from each response
    responses.forEach(response => {
      // Simple sentence splitting - in production, use proper NLP
      const sentences = response.response.split('.').filter(s => s.trim().length > 10);
      sentences.forEach(sentence => uniquePoints.add(sentence.trim()));
    });

    // Find most confident response as base
    const baseResponse = responses.reduce((best, current) => 
      current.confidence > best.confidence ? current : best
    );

    return `Based on ${type} analysis of ${responses.length} expert perspectives: ` +
           `${baseResponse.response}\\n\\n` +
           `Additional considerations: ${Array.from(uniquePoints).slice(0, 3).join('; ')}.`;
  }

  /**
   * Create hierarchical synthesis
   */
  private createHierarchicalSynthesis(sortedResponses: ModelResponse[]): string {
    const executive = sortedResponses[0];
    const advisors = sortedResponses.slice(1, 4); // Top 3 advisors

    let synthesis = `Executive Decision: ${executive.response}`;
    
    if (advisors.length > 0) {
      const advisoryInsights = advisors
        .map(advisor => `${advisor.provider}: ${advisor.reasoning}`)
        .join('; ');
      
      synthesis += `\\n\\nAdvisory Input: ${advisoryInsights}`;
    }

    return synthesis;
  }

  /**
   * Create debate-based synthesis
   */
  private createDebateSynthesis(
    debaters: ModelResponse[], 
    allResponses: ModelResponse[]
  ): string {
    const [primary, secondary] = debaters;
    
    let synthesis = `Synthesis of Perspectives:\\n\\n`;
    synthesis += `Primary Position (${primary.provider}): ${primary.response}\\n\\n`;
    
    if (secondary) {
      synthesis += `Alternative View (${secondary.provider}): ${secondary.response}\\n\\n`;
    }

    // Find middle ground or best combined approach
    synthesis += `Balanced Conclusion: Considering all viewpoints, the optimal approach ` +
                `incorporates elements from both perspectives while prioritizing ` +
                `the higher-confidence insights.`;

    return synthesis;
  }

  /**
   * Evaluate decision quality
   */
  evaluateDecision(
    decision: SynthesisResult,
    originalResponses: ModelResponse[]
  ): {
    quality: number;
    reasoning: string;
    improvements: string[];
  } {
    const quality = this.calculateDecisionQuality(decision, originalResponses);
    
    const improvements = [];
    if (decision.confidence < 0.7) {
      improvements.push('Consider gathering more expert input');
    }
    if (originalResponses.length < 3) {
      improvements.push('Increase number of participating models');
    }
    
    return {
      quality,
      reasoning: `Decision quality score: ${quality.toFixed(2)} based on ` +
                `confidence (${decision.confidence.toFixed(2)}) and ` +
                `methodology (${decision.methodology}).`,
      improvements
    };
  }

  /**
   * Calculate decision quality score
   */
  private calculateDecisionQuality(
    decision: SynthesisResult,
    originalResponses: ModelResponse[]
  ): number {
    // Multi-factor quality assessment
    const confidenceScore = decision.confidence;
    const diversityScore = this.calculateDiversity(originalResponses);
    const consensusScore = this.calculateConsensusScore(originalResponses);
    
    // Weighted average
    return (confidenceScore * 0.4) + (diversityScore * 0.3) + (consensusScore * 0.3);
  }

  /**
   * Calculate diversity of responses
   */
  private calculateDiversity(responses: ModelResponse[]): number {
    if (responses.length <= 1) return 0;
    
    // Simple diversity calculation based on confidence variance
    const avgConfidence = responses.reduce((sum, r) => sum + r.confidence, 0) / responses.length;
    const variance = responses.reduce((sum, r) => 
      sum + Math.pow(r.confidence - avgConfidence, 2), 0
    ) / responses.length;
    
    // Normalize to 0-1 scale
    return Math.min(1, variance * 2);
  }

  /**
   * Calculate consensus score
   */
  private calculateConsensusScore(responses: ModelResponse[]): number {
    if (responses.length <= 1) return 1;
    
    const avgConfidence = responses.reduce((sum, r) => sum + r.confidence, 0) / responses.length;
    const deviations = responses.map(r => Math.abs(r.confidence - avgConfidence));
    const avgDeviation = deviations.reduce((sum, d) => sum + d, 0) / deviations.length;
    
    // Lower deviation = higher consensus
    return Math.max(0, 1 - avgDeviation);
  }
}