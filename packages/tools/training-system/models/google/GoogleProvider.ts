/**
 * Google Gemini Provider - Integration with Google's Gemini AI
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { AgentQuery } from '@sats/types';
import { Logger } from '@sats/utils/Logger';

export class GoogleProvider {
  private client: GoogleGenerativeAI;
  private logger: Logger;
  public model: string;
  private config: {
    maxOutputTokens: number;
    temperature: number;
    topP: number;
    topK: number;
  };

  constructor(config: {
    apiKey: string;
    model?: string;
    maxOutputTokens?: number;
    temperature?: number;
    topP?: number;
    topK?: number;
  }) {
    this.client = new GoogleGenerativeAI(config.apiKey);
    this.model = config.model || 'gemini-1.5-pro';
    this.config = {
      maxOutputTokens: config.maxOutputTokens || 2000,
      temperature: config.temperature || 0.7,
      topP: config.topP || 0.9,
      topK: config.topK || 40
    };
    this.logger = new Logger('GoogleProvider');
  }

  async generateResponse(query: AgentQuery) {
    const startTime = Date.now();
    
    try {
      const model = this.client.getGenerativeModel({ 
        model: this.model,
        generationConfig: {
          maxOutputTokens: this.config.maxOutputTokens,
          temperature: this.config.temperature,
          topP: this.config.topP,
          topK: this.config.topK,
        },
      });

      const prompt = `You are an expert AI assistant participating in a collaborative decision-making process. Provide thoughtful, well-reasoned responses.

${query.context ? `Context: ${query.context}\n\n` : ''}Question: ${query.prompt}

Please provide:
1. Your response to the question
2. Your reasoning for this response
3. Your confidence level in this response (0-1)`;

      const result = await model.generateContent(prompt);
      const response = result.response;
      const content = response.text();
      
      // Extract token usage (if available)
      const usageMetadata = response.usageMetadata || {
        promptTokenCount: 0,
        candidatesTokenCount: 0,
        totalTokenCount: 0
      };
      
      return {
        response: content,
        confidence: this.calculateConfidence(content),
        reasoning: this.extractReasoning(content),
        tokens: {
          input: usageMetadata.promptTokenCount,
          output: usageMetadata.candidatesTokenCount,
          total: usageMetadata.totalTokenCount
        },
        latency: Date.now() - startTime,
        cost: this.calculateCost(usageMetadata.totalTokenCount)
      };
    } catch (error) {
      this.logger.error('Google Gemini API error', error);
      throw error;
    }
  }

  private calculateConfidence(content: string): number {
    // Simple confidence calculation based on response quality
    if (!content || content.length < 50) return 0.3;
    
    // Check for uncertainty indicators
    const uncertaintyPatterns = [
      /I think/gi, /maybe/gi, /possibly/gi, /might/gi, /could be/gi,
      /not sure/gi, /uncertain/gi, /unclear/gi, /I believe/gi
    ];
    
    const certaintyPatterns = [
      /definitely/gi, /certainly/gi, /clearly/gi, /obviously/gi,
      /without doubt/gi, /confident/gi, /sure/gi
    ];
    
    const uncertaintyCount = uncertaintyPatterns.reduce(
      (count, pattern) => count + (content.match(pattern) || []).length, 0
    );
    
    const certaintyCount = certaintyPatterns.reduce(
      (count, pattern) => count + (content.match(pattern) || []).length, 0
    );
    
    // Base confidence adjusted by certainty/uncertainty indicators
    let confidence = 0.75 - (uncertaintyCount * 0.1) + (certaintyCount * 0.05);
    
    // Boost confidence for structured responses
    if (content.includes('because') || content.includes('therefore') || content.includes('since')) {
      confidence += 0.1;
    }
    
    // Boost for numbered lists or structured format
    if (content.match(/^\d+\./m) || content.includes('First,') || content.includes('Second,')) {
      confidence += 0.05;
    }
    
    return Math.max(0.1, Math.min(1.0, confidence));
  }

  private extractReasoning(content: string): string {
    // Try to extract explicit reasoning
    const reasoningPatterns = [
      /(?:because|since|as|given that)\s+(.+?)(?:\.|$|,)/gi,
      /(?:therefore|thus|consequently|hence)\s+(.+?)(?:\.|$|,)/gi,
      /(?:the reason|this is because)\s+(.+?)(?:\.|$|,)/gi
    ];
    
    for (const pattern of reasoningPatterns) {
      const matches = [...content.matchAll(pattern)];
      if (matches.length > 0) {
        return matches.map(match => match[1]).join('. ') + '.';
      }
    }
    
    // Look for confidence explanation
    const confidenceMatch = content.match(/confidence.*?(\d*\.?\d+)/i);
    if (confidenceMatch) {
      const confidenceSection = content.substring(
        content.indexOf(confidenceMatch[0]) - 100,
        content.indexOf(confidenceMatch[0]) + 200
      );
      return confidenceSection.trim();
    }
    
    // Return first sentence as reasoning if no explicit reasoning found
    const sentences = content.split(/[.!?]+/);
    const firstSentence = sentences[0]?.trim();
    return firstSentence && firstSentence.length > 10 ? firstSentence + '.' : content.substring(0, 150) + '...';
  }

  private calculateCost(totalTokens: number): number {
    // Gemini pricing (approximate as of 2024)
    // Free tier: 15 requests per minute, 1500 requests per day
    // Paid tier: $0.00025 per 1K input tokens, $0.00075 per 1K output tokens
    const avgCostPerToken = 0.0005 / 1000; // Average cost
    return totalTokens * avgCostPerToken;
  }

  async healthCheck(): Promise<void> {
    try {
      const model = this.client.getGenerativeModel({ model: this.model });
      await model.generateContent('test');
    } catch (error) {
      throw new Error(`Google Gemini health check failed: ${error.message}`);
    }
  }
}