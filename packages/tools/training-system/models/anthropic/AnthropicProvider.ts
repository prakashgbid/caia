/**
 * Anthropic Claude Provider - Integration with Claude AI
 */

import Anthropic from '@anthropic-ai/sdk';
import { AgentQuery } from '@sats/types';
import { Logger } from '@sats/utils/Logger';

export class AnthropicProvider {
  private client: Anthropic;
  private logger: Logger;
  public model: string;
  private config: {
    maxTokens: number;
    temperature: number;
    topP: number;
  };

  constructor(config: {
    apiKey: string;
    model?: string;
    maxTokens?: number;
    temperature?: number;
    topP?: number;
  }) {
    this.client = new Anthropic({ apiKey: config.apiKey });
    this.model = config.model || 'claude-3-5-sonnet-20241022';
    this.config = {
      maxTokens: config.maxTokens || 2000,
      temperature: config.temperature || 0.7,
      topP: config.topP || 1.0
    };
    this.logger = new Logger('AnthropicProvider');
  }

  async generateResponse(query: AgentQuery) {
    const startTime = Date.now();
    
    try {
      const systemPrompt = 'You are an expert AI assistant participating in a collaborative decision-making process. Provide thoughtful, well-reasoned responses with clear reasoning. Be precise and analytical in your approach.';
      
      const userPrompt = query.context ? 
        `Context: ${query.context}\n\nQuestion: ${query.prompt}\n\nPlease provide your response with clear reasoning and indicate your confidence level.` :
        `${query.prompt}\n\nPlease provide your response with clear reasoning and indicate your confidence level.`;

      const message = await this.client.messages.create({
        model: this.model,
        max_tokens: this.config.maxTokens,
        temperature: this.config.temperature,
        top_p: this.config.topP,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: userPrompt
          }
        ]
      });

      const content = message.content[0]?.type === 'text' ? message.content[0].text : '';
      const usage = message.usage;
      
      return {
        response: content,
        confidence: this.calculateConfidence(content),
        reasoning: this.extractReasoning(content),
        tokens: {
          input: usage.input_tokens,
          output: usage.output_tokens,
          total: usage.input_tokens + usage.output_tokens
        },
        latency: Date.now() - startTime,
        cost: this.calculateCost(usage.input_tokens, usage.output_tokens)
      };
    } catch (error) {
      this.logger.error('Anthropic Claude API error', error);
      throw error;
    }
  }

  private calculateConfidence(content: string): number {
    // Claude tends to be quite measured in responses
    if (!content || content.length < 50) return 0.4;
    
    // Look for confidence indicators
    const highConfidencePatterns = [
      /I'm confident/gi, /clearly/gi, /definitely/gi, /certainly/gi,
      /without question/gi, /undoubtedly/gi, /precisely/gi
    ];
    
    const moderateConfidencePatterns = [
      /likely/gi, /probably/gi, /generally/gi, /typically/gi,
      /in most cases/gi, /usually/gi
    ];
    
    const lowConfidencePatterns = [
      /might/gi, /could/gi, /possibly/gi, /perhaps/gi, /maybe/gi,
      /it seems/gi, /appears to/gi, /suggests/gi
    ];
    
    const highCount = highConfidencePatterns.reduce(
      (count, pattern) => count + (content.match(pattern) || []).length, 0
    );
    
    const moderateCount = moderateConfidencePatterns.reduce(
      (count, pattern) => count + (content.match(pattern) || []).length, 0
    );
    
    const lowCount = lowConfidencePatterns.reduce(
      (count, pattern) => count + (content.match(pattern) || []).length, 0
    );
    
    // Start with base confidence for Claude (tends to be thorough)
    let confidence = 0.8;
    
    // Adjust based on confidence indicators
    confidence += (highCount * 0.05);
    confidence += (moderateCount * 0.02);
    confidence -= (lowCount * 0.1);
    
    // Boost for analytical structure
    if (content.includes('analysis') || content.includes('considering') || content.includes('factors')) {
      confidence += 0.05;
    }
    
    // Boost for step-by-step reasoning
    if (content.match(/step \d+/gi) || content.match(/first.*second.*third/gi)) {
      confidence += 0.1;
    }
    
    return Math.max(0.1, Math.min(1.0, confidence));
  }

  private extractReasoning(content: string): string {
    // Claude often provides explicit reasoning sections
    const reasoningSections = [
      /reasoning:?\s*(.+?)(?:\n\n|$)/gi,
      /analysis:?\s*(.+?)(?:\n\n|$)/gi,
      /rationale:?\s*(.+?)(?:\n\n|$)/gi,
      /explanation:?\s*(.+?)(?:\n\n|$)/gi
    ];
    
    for (const pattern of reasoningSections) {
      const match = content.match(pattern);
      if (match) {
        return match[1].trim();
      }
    }
    
    // Look for logical connectors
    const logicalPatterns = [
      /(?:because|since|given that|due to)\s+(.+?)(?:\.|$|\n)/gi,
      /(?:therefore|thus|consequently|as a result)\s+(.+?)(?:\.|$|\n)/gi,
      /(?:this is based on|the key factors are|considering that)\s+(.+?)(?:\.|$|\n)/gi
    ];
    
    const reasoningParts = [];
    for (const pattern of logicalPatterns) {
      const matches = [...content.matchAll(pattern)];
      reasoningParts.push(...matches.map(match => match[1].trim()));
    }
    
    if (reasoningParts.length > 0) {
      return reasoningParts.join('. ') + '.';
    }
    
    // Extract first substantial paragraph as reasoning
    const paragraphs = content.split('\n\n');
    const firstSubstantialParagraph = paragraphs.find(p => p.trim().length > 50);
    
    if (firstSubstantialParagraph) {
      return firstSubstantialParagraph.trim().substring(0, 200) + (firstSubstantialParagraph.length > 200 ? '...' : '');
    }
    
    return content.substring(0, 150) + '...';
  }

  private calculateCost(inputTokens: number, outputTokens: number): number {
    // Claude 3.5 Sonnet pricing (as of 2024)
    const inputCostPer1K = 0.003;  // $3 per million input tokens
    const outputCostPer1K = 0.015; // $15 per million output tokens
    
    const inputCost = (inputTokens / 1000) * inputCostPer1K;
    const outputCost = (outputTokens / 1000) * outputCostPer1K;
    
    return inputCost + outputCost;
  }

  async healthCheck(): Promise<void> {
    try {
      await this.client.messages.create({
        model: this.model,
        max_tokens: 10,
        messages: [
          {
            role: 'user',
            content: 'test'
          }
        ]
      });
    } catch (error) {
      throw new Error(`Anthropic Claude health check failed: ${error.message}`);
    }
  }
}