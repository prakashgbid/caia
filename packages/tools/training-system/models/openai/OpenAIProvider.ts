/**
 * OpenAI Provider - ChatGPT Integration
 */

import OpenAI from 'openai';
import { AgentQuery } from '@sats/types';
import { Logger } from '@sats/utils/Logger';

export class OpenAIProvider {
  private client: OpenAI;
  private logger: Logger;
  public model: string;
  private config: {
    maxTokens: number;
    temperature: number;
  };

  constructor(config: {
    apiKey: string;
    model?: string;
    maxTokens?: number;
    temperature?: number;
  }) {
    this.client = new OpenAI({ apiKey: config.apiKey });
    this.model = config.model || 'gpt-4';
    this.config = {
      maxTokens: config.maxTokens || 2000,
      temperature: config.temperature || 0.7
    };
    this.logger = new Logger('OpenAIProvider');
  }

  async generateResponse(query: AgentQuery) {
    const startTime = Date.now();
    
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: 'You are an expert AI assistant participating in a collaborative decision-making process. Provide thoughtful, well-reasoned responses.'
          },
          {
            role: 'user',
            content: query.context ? `${query.context}\\n\\n${query.prompt}` : query.prompt
          }
        ],
        max_tokens: this.config.maxTokens,
        temperature: this.config.temperature
      });

      const content = response.choices[0]?.message?.content || '';
      const tokens = response.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
      
      return {
        response: content,
        confidence: this.calculateConfidence(content, response),
        reasoning: this.extractReasoning(content),
        tokens: {
          input: tokens.prompt_tokens,
          output: tokens.completion_tokens,
          total: tokens.total_tokens
        },
        latency: Date.now() - startTime,
        cost: this.calculateCost(tokens.total_tokens)
      };
    } catch (error) {
      this.logger.error('OpenAI API error', error);
      throw error;
    }
  }

  private calculateConfidence(content: string, response: any): number {
    // Simple confidence calculation based on response length and structure
    // In production, this could use more sophisticated methods
    
    if (!content || content.length < 50) return 0.3;
    
    // Check for uncertainty indicators
    const uncertaintyPatterns = [
      /I think/gi, /maybe/gi, /possibly/gi, /might/gi, /could be/gi,
      /not sure/gi, /uncertain/gi, /unclear/gi
    ];
    
    const uncertaintyCount = uncertaintyPatterns.reduce(
      (count, pattern) => count + (content.match(pattern) || []).length, 0
    );
    
    // Base confidence reduced by uncertainty indicators
    let confidence = 0.8 - (uncertaintyCount * 0.1);
    
    // Boost confidence for structured responses
    if (content.includes('because') || content.includes('therefore')) {
      confidence += 0.1;
    }
    
    return Math.max(0.1, Math.min(1.0, confidence));
  }

  private extractReasoning(content: string): string {
    // Extract reasoning section if available
    const reasoningPatterns = [
      /because\s+(.+?)(?:\.|$)/gi,
      /therefore\s+(.+?)(?:\.|$)/gi,
      /since\s+(.+?)(?:\.|$)/gi
    ];
    
    for (const pattern of reasoningPatterns) {
      const match = content.match(pattern);
      if (match) {
        return match[0];
      }
    }
    
    // Return first sentence as reasoning if no explicit reasoning found
    const firstSentence = content.split('.')[0];
    return firstSentence.length > 10 ? firstSentence + '.' : content.substring(0, 100) + '...';
  }

  private calculateCost(totalTokens: number): number {
    // GPT-4 pricing (approximate)
    const costPerToken = 0.00003; // $0.03 per 1K tokens
    return totalTokens * costPerToken;
  }

  async healthCheck(): Promise<void> {
    try {
      await this.client.chat.completions.create({
        model: this.model,
        messages: [{ role: 'user', content: 'test' }],
        max_tokens: 5
      });
    } catch (error) {
      throw new Error(`OpenAI health check failed: ${error.message}`);
    }
  }
}