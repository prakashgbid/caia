import { EventEmitter } from 'events';
import axios from 'axios';
import {
  Idea,
  MarketAnalysis,
  FeasibilityAnalysis,
  Risk,
  QualityGate,
  ValidationResult,
  QualityIssue
} from '@caia/shared/hierarchical-types';

/**
 * Configuration interface for IdeaAnalyzer
 */
export interface IdeaAnalyzerConfig {
  webSearchApiKey?: string;
  webSearchApiUrl?: string;
  confidenceThreshold?: number;
  marketResearchDepth?: 'shallow' | 'medium' | 'deep';
  enableCompetitorAnalysis?: boolean;
  riskAssessmentLevel?: 'basic' | 'comprehensive';
}

/**
 * Market research result interface
 */
interface MarketResearchResult {
  queries: string[];
  results: WebSearchResult[];
  insights: MarketInsight[];
  competitorCount: number;
  marketSignals: string[];
}

interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  relevanceScore: number;
  sourceType: 'competitor' | 'market' | 'news' | 'research' | 'unknown';
}

interface MarketInsight {
  type: 'opportunity' | 'threat' | 'trend' | 'gap';
  description: string;
  confidence: number;
  sources: string[];
}

/**
 * Enhanced IdeaAnalyzer with market research integration
 * Analyzes ideas for feasibility, business value, and market positioning
 */
export class IdeaAnalyzer extends EventEmitter {
  private config: IdeaAnalyzerConfig;
  private webSearchCache: Map<string, MarketResearchResult> = new Map();
  private competitorDatabase: Map<string, string[]> = new Map();

  constructor(config: IdeaAnalyzerConfig) {
    super();
    this.config = {
      confidenceThreshold: 0.85,
      marketResearchDepth: 'medium',
      enableCompetitorAnalysis: true,
      riskAssessmentLevel: 'comprehensive',
      ...config
    };
  }

  /**
   * Analyzes an idea comprehensively with market research integration
   */
  async analyzeIdea(ideaText: string, context?: string): Promise<Idea> {
    this.emit('analysis:start', { idea: ideaText, context });

    try {
      const idea: Idea = {
        id: this.generateId(),
        title: this.extractTitle(ideaText),
        description: ideaText,
        context,
        timestamp: new Date()
      };

      // Run analysis components in parallel for speed
      const [marketAnalysis, feasibilityAnalysis, risks] = await Promise.all([
        this.performMarketAnalysis(idea),
        this.assessFeasibility(idea),
        this.assessRisks(idea)
      ]);

      idea.marketAnalysis = marketAnalysis;
      idea.feasibility = feasibilityAnalysis;
      idea.risks = risks;

      this.emit('analysis:complete', idea);
      return idea;
    } catch (error) {
      this.emit('analysis:error', error);
      throw error;
    }
  }

  /**
   * Performs comprehensive market research using WebSearch integration
   */
  private async performMarketAnalysis(idea: Idea): Promise<MarketAnalysis> {
    this.emit('market:analysis:start', idea.id);

    try {
      const researchResult = await this.conductMarketResearch(idea);
      
      const analysis: MarketAnalysis = {
        marketSize: await this.estimateMarketSize(researchResult),
        competitors: await this.identifyCompetitors(researchResult),
        opportunities: this.extractOpportunities(researchResult),
        threats: this.extractThreats(researchResult),
        positioning: await this.suggestPositioning(idea, researchResult)
      };

      this.emit('market:analysis:complete', { ideaId: idea.id, analysis });
      return analysis;
    } catch (error) {
      this.emit('market:analysis:error', { ideaId: idea.id, error });
      // Return basic analysis if web search fails
      return this.generateBasicMarketAnalysis(idea);
    }
  }

  /**
   * Conducts market research using web search
   */
  private async conductMarketResearch(idea: Idea): Promise<MarketResearchResult> {
    const cacheKey = this.generateCacheKey(idea);
    if (this.webSearchCache.has(cacheKey)) {
      return this.webSearchCache.get(cacheKey)!;
    }

    const queries = this.generateSearchQueries(idea);
    const searchPromises = queries.map(query => this.performWebSearch(query));
    const searchResults = await Promise.all(searchPromises);

    const allResults = searchResults.flat();
    const insights = this.extractMarketInsights(allResults, idea);
    const competitorCount = allResults.filter(r => r.sourceType === 'competitor').length;
    const marketSignals = this.extractMarketSignals(allResults);

    const result: MarketResearchResult = {
      queries,
      results: allResults,
      insights,
      competitorCount,
      marketSignals
    };

    this.webSearchCache.set(cacheKey, result);
    return result;
  }

  /**
   * Performs web search using configured API
   */
  private async performWebSearch(query: string): Promise<WebSearchResult[]> {
    if (!this.config.webSearchApiKey || !this.config.webSearchApiUrl) {
      // Return mock results for development
      return this.generateMockSearchResults(query);
    }

    try {
      const response = await axios.get(this.config.webSearchApiUrl, {
        params: {
          query,
          api_key: this.config.webSearchApiKey,
          num_results: this.getSearchResultCount()
        },
        timeout: 10000
      });

      return this.parseSearchResults(response.data, query);
    } catch (error) {
      this.emit('websearch:error', { query, error });
      return this.generateMockSearchResults(query);
    }
  }

  /**
   * Assesses technical and business feasibility
   */
  private async assessFeasibility(idea: Idea): Promise<FeasibilityAnalysis> {
    const technical = this.assessTechnicalFeasibility(idea);
    const business = this.assessBusinessFeasibility(idea);
    const resource = this.assessResourceFeasibility(idea);
    
    const overall = (technical + business + resource) / 3;
    const constraints = this.identifyConstraints(idea, { technical, business, resource });

    return {
      technical,
      business,
      resource,
      overall,
      constraints
    };
  }

  /**
   * Assesses various risks associated with the idea
   */
  private async assessRisks(idea: Idea): Promise<Risk[]> {
    const risks: Risk[] = [];

    // Technical risks
    risks.push(...this.assessTechnicalRisks(idea));
    
    // Market risks
    risks.push(...this.assessMarketRisks(idea));
    
    // Business risks
    risks.push(...this.assessBusinessRisks(idea));
    
    // Resource risks
    risks.push(...this.assessResourceRisks(idea));

    return risks.sort((a, b) => (b.probability * b.impact) - (a.probability * a.impact));
  }

  /**
   * Creates a quality gate for idea analysis validation
   */
  async validateAnalysis(idea: Idea): Promise<QualityGate> {
    const validations: ValidationResult[] = [];

    // Market analysis validation
    if (idea.marketAnalysis) {
      validations.push(this.validateMarketAnalysis(idea.marketAnalysis));
    }

    // Feasibility validation
    if (idea.feasibility) {
      validations.push(this.validateFeasibilityAnalysis(idea.feasibility));
    }

    // Risk assessment validation
    if (idea.risks) {
      validations.push(this.validateRiskAssessment(idea.risks));
    }

    const confidence = this.calculateOverallConfidence(validations);
    const passed = confidence >= this.config.confidenceThreshold;
    const issues = this.identifyQualityIssues(validations, confidence);
    const recommendations = this.generateRecommendations(validations, issues);

    return {
      tier: 'idea',
      sourceTier: 'raw_input',
      targetTier: 'initiative',
      confidence,
      threshold: this.config.confidenceThreshold,
      validations,
      passed,
      issues,
      recommendations,
      timestamp: new Date()
    };
  }

  // === PRIVATE HELPER METHODS ===

  private generateId(): string {
    return `idea_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private extractTitle(ideaText: string): string {
    // Extract first sentence or first 50 characters as title
    const firstSentence = ideaText.split('.')[0].trim();
    return firstSentence.length > 50 
      ? firstSentence.substring(0, 47) + '...' 
      : firstSentence;
  }

  private generateSearchQueries(idea: Idea): string[] {
    const baseTerms = this.extractKeyTerms(idea.description);
    const queries: string[] = [];

    // Market size queries
    queries.push(`${baseTerms.join(' ')} market size`);
    queries.push(`${baseTerms.join(' ')} industry trends`);

    // Competitor queries
    queries.push(`${baseTerms.join(' ')} competitors`);
    queries.push(`${baseTerms.join(' ')} alternative solutions`);

    // Opportunity queries
    queries.push(`${baseTerms.join(' ')} challenges`);
    queries.push(`${baseTerms.join(' ')} problems`);

    return queries.slice(0, this.getMaxQueries());
  }

  private extractKeyTerms(text: string): string[] {
    // Simple keyword extraction - could be enhanced with NLP
    const words = text.toLowerCase().split(/\s+/);
    const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by']);
    
    return words
      .filter(word => word.length > 3 && !stopWords.has(word))
      .slice(0, 5);
  }

  private getSearchResultCount(): number {
    const counts = { shallow: 5, medium: 10, deep: 20 };
    return counts[this.config.marketResearchDepth];
  }

  private getMaxQueries(): number {
    const maxQueries = { shallow: 3, medium: 6, deep: 10 };
    return maxQueries[this.config.marketResearchDepth];
  }

  private generateMockSearchResults(query: string): WebSearchResult[] {
    // Mock results for development/testing
    return [
      {
        title: `Mock Result for ${query}`,
        url: 'https://example.com',
        snippet: `This is a mock search result for the query: ${query}`,
        relevanceScore: 0.8,
        sourceType: 'unknown'
      }
    ];
  }

  private parseSearchResults(data: any, query: string): WebSearchResult[] {
    // Parse actual search API results - implementation depends on API format
    if (!data.results) return [];
    
    return data.results.map((result: any) => ({
      title: result.title || '',
      url: result.url || '',
      snippet: result.snippet || result.description || '',
      relevanceScore: result.score || 0.5,
      sourceType: this.classifySourceType(result.url, result.title)
    }));
  }

  private classifySourceType(url: string, title: string): WebSearchResult['sourceType'] {
    const domain = new URL(url).hostname.toLowerCase();
    
    if (domain.includes('competitor') || this.competitorDatabase.has(domain)) {
      return 'competitor';
    }
    if (domain.includes('news') || domain.includes('reuters') || domain.includes('bloomberg')) {
      return 'news';
    }
    if (domain.includes('research') || domain.includes('gartner') || domain.includes('forrester')) {
      return 'research';
    }
    if (title.toLowerCase().includes('market')) {
      return 'market';
    }
    
    return 'unknown';
  }

  private extractMarketInsights(results: WebSearchResult[], idea: Idea): MarketInsight[] {
    const insights: MarketInsight[] = [];
    
    // Analyze search results to extract insights
    for (const result of results) {
      const insight = this.analyzeResultForInsights(result, idea);
      if (insight) insights.push(insight);
    }
    
    return insights;
  }

  private analyzeResultForInsights(result: WebSearchResult, idea: Idea): MarketInsight | null {
    const snippet = result.snippet.toLowerCase();
    const title = result.title.toLowerCase();
    const content = `${title} ${snippet}`;
    
    // Look for opportunity signals
    const opportunityKeywords = ['opportunity', 'gap', 'need', 'demand', 'growing', 'trend'];
    if (opportunityKeywords.some(keyword => content.includes(keyword))) {
      return {
        type: 'opportunity',
        description: `Market opportunity identified: ${result.snippet}`,
        confidence: result.relevanceScore,
        sources: [result.url]
      };
    }
    
    // Look for threat signals
    const threatKeywords = ['competition', 'saturated', 'declining', 'challenge', 'barrier'];
    if (threatKeywords.some(keyword => content.includes(keyword))) {
      return {
        type: 'threat',
        description: `Market threat identified: ${result.snippet}`,
        confidence: result.relevanceScore,
        sources: [result.url]
      };
    }
    
    return null;
  }

  private extractMarketSignals(results: WebSearchResult[]): string[] {
    const signals: string[] = [];
    
    for (const result of results) {
      // Extract market signals from search results
      if (result.snippet.includes('$') && result.snippet.includes('billion')) {
        signals.push(`Large market size indicated: ${result.snippet}`);
      }
      if (result.sourceType === 'competitor') {
        signals.push(`Competitor presence: ${result.title}`);
      }
      if (result.snippet.toLowerCase().includes('trend')) {
        signals.push(`Market trend: ${result.snippet}`);
      }
    }
    
    return signals;
  }

  private async estimateMarketSize(research: MarketResearchResult): Promise<number> {
    // Extract market size estimates from research results
    const sizeIndicators = research.results
      .map(r => this.extractMarketSizeFromText(r.snippet))
      .filter(size => size > 0);
    
    if (sizeIndicators.length > 0) {
      return Math.max(...sizeIndicators);
    }
    
    // Fallback estimation based on competitor count and market signals
    const baseSize = research.competitorCount * 100000; // $100K per competitor
    const signalMultiplier = research.marketSignals.length * 0.1 + 1;
    
    return baseSize * signalMultiplier;
  }

  private extractMarketSizeFromText(text: string): number {
    // Extract dollar amounts from text
    const billionMatch = text.match(/\$(\d+(?:\.\d+)?)\s*billion/i);
    if (billionMatch) {
      return parseFloat(billionMatch[1]) * 1000000000;
    }
    
    const millionMatch = text.match(/\$(\d+(?:\.\d+)?)\s*million/i);
    if (millionMatch) {
      return parseFloat(millionMatch[1]) * 1000000;
    }
    
    return 0;
  }

  private async identifyCompetitors(research: MarketResearchResult): Promise<string[]> {
    const competitors = new Set<string>();
    
    research.results
      .filter(r => r.sourceType === 'competitor')
      .forEach(r => {
        const domain = new URL(r.url).hostname;
        competitors.add(domain);
      });
    
    // Also extract competitor names from content
    research.results.forEach(result => {
      const competitorNames = this.extractCompetitorNames(result.snippet);
      competitorNames.forEach(name => competitors.add(name));
    });
    
    return Array.from(competitors).slice(0, 10);
  }

  private extractCompetitorNames(text: string): string[] {
    // Simple competitor name extraction - could be enhanced with NER
    const competitorKeywords = ['competitor', 'alternative', 'similar', 'like'];
    const names: string[] = [];
    
    // Look for patterns like "competitors include X, Y, Z"
    competitorKeywords.forEach(keyword => {
      const regex = new RegExp(`${keyword}s?\s+(?:include|are|such as)\s+([^.]+)`, 'i');
      const match = text.match(regex);
      if (match) {
        const competitors = match[1].split(/[,&]/).map(s => s.trim());
        names.push(...competitors);
      }
    });
    
    return names;
  }

  private extractOpportunities(research: MarketResearchResult): string[] {
    return research.insights
      .filter(insight => insight.type === 'opportunity')
      .map(insight => insight.description);
  }

  private extractThreats(research: MarketResearchResult): string[] {
    return research.insights
      .filter(insight => insight.type === 'threat')
      .map(insight => insight.description);
  }

  private async suggestPositioning(idea: Idea, research: MarketResearchResult): Promise<string> {
    const opportunities = research.insights.filter(i => i.type === 'opportunity');
    const threats = research.insights.filter(i => i.type === 'threat');
    
    if (opportunities.length > threats.length) {
      return 'Market entry opportunity with differentiated approach';
    } else if (research.competitorCount > 5) {
      return 'Niche positioning in competitive market';
    } else {
      return 'Pioneer in emerging market category';
    }
  }

  private generateBasicMarketAnalysis(idea: Idea): MarketAnalysis {
    // Fallback analysis when web search is unavailable
    return {
      marketSize: 1000000, // $1M default
      competitors: ['Unknown competitors'],
      opportunities: ['Market research needed'],
      threats: ['Competition analysis needed'],
      positioning: 'Positioning analysis pending market research'
    };
  }

  private assessTechnicalFeasibility(idea: Idea): number {
    let score = 50; // Base score
    
    const text = idea.description.toLowerCase();
    
    // Technology indicators
    const complexTech = ['ai', 'machine learning', 'blockchain', 'quantum', 'neural'];
    const simpleTech = ['web', 'mobile', 'dashboard', 'form', 'report'];
    
    if (complexTech.some(tech => text.includes(tech))) score -= 20;
    if (simpleTech.some(tech => text.includes(tech))) score += 20;
    
    // Integration complexity
    if (text.includes('integration') || text.includes('api')) score -= 10;
    if (text.includes('existing') || text.includes('current')) score -= 5;
    
    return Math.max(0, Math.min(100, score));
  }

  private assessBusinessFeasibility(idea: Idea): number {
    let score = 60; // Base score
    
    const text = idea.description.toLowerCase();
    
    // Business model indicators
    const revenueKeywords = ['revenue', 'subscription', 'sale', 'payment', 'monetize'];
    const costKeywords = ['expensive', 'costly', 'investment', 'budget'];
    
    if (revenueKeywords.some(kw => text.includes(kw))) score += 15;
    if (costKeywords.some(kw => text.includes(kw))) score -= 10;
    
    // Market indicators
    if (text.includes('customer') || text.includes('user')) score += 10;
    if (text.includes('niche') || text.includes('specialized')) score -= 5;
    
    return Math.max(0, Math.min(100, score));
  }

  private assessResourceFeasibility(idea: Idea): number {
    let score = 70; // Base score
    
    const text = idea.description.toLowerCase();
    
    // Resource requirement indicators
    const highResourceKeywords = ['team', 'department', 'enterprise', 'scale'];
    const lowResourceKeywords = ['simple', 'basic', 'minimal', 'lightweight'];
    
    if (highResourceKeywords.some(kw => text.includes(kw))) score -= 15;
    if (lowResourceKeywords.some(kw => text.includes(kw))) score += 15;
    
    // Time indicators
    if (text.includes('quick') || text.includes('fast')) score += 10;
    if (text.includes('long-term') || text.includes('complex')) score -= 10;
    
    return Math.max(0, Math.min(100, score));
  }

  private identifyConstraints(idea: Idea, scores: { technical: number; business: number; resource: number }): string[] {
    const constraints: string[] = [];
    
    if (scores.technical < 50) {
      constraints.push('Technical complexity may require specialized expertise');
    }
    if (scores.business < 50) {
      constraints.push('Business model validation needed');
    }
    if (scores.resource < 50) {
      constraints.push('Resource requirements may exceed current capacity');
    }
    
    return constraints;
  }

  private assessTechnicalRisks(idea: Idea): Risk[] {
    const risks: Risk[] = [];
    const text = idea.description.toLowerCase();
    
    if (text.includes('new technology') || text.includes('cutting edge')) {
      risks.push({
        type: 'Technical',
        probability: 0.7,
        impact: 0.8,
        mitigation: 'Conduct proof of concept and technical feasibility study'
      });
    }
    
    if (text.includes('integration') || text.includes('legacy')) {
      risks.push({
        type: 'Integration',
        probability: 0.6,
        impact: 0.6,
        mitigation: 'Plan phased integration approach with fallback options'
      });
    }
    
    return risks;
  }

  private assessMarketRisks(idea: Idea): Risk[] {
    const risks: Risk[] = [];
    
    // Add basic market risks - could be enhanced with actual market data
    risks.push({
      type: 'Competition',
      probability: 0.5,
      impact: 0.7,
      mitigation: 'Develop unique value proposition and competitive differentiation'
    });
    
    return risks;
  }

  private assessBusinessRisks(idea: Idea): Risk[] {
    const risks: Risk[] = [];
    const text = idea.description.toLowerCase();
    
    if (!text.includes('revenue') && !text.includes('monetize')) {
      risks.push({
        type: 'Revenue Model',
        probability: 0.8,
        impact: 0.9,
        mitigation: 'Define clear revenue model and pricing strategy'
      });
    }
    
    return risks;
  }

  private assessResourceRisks(idea: Idea): Risk[] {
    const risks: Risk[] = [];
    
    risks.push({
      type: 'Resource Allocation',
      probability: 0.4,
      impact: 0.6,
      mitigation: 'Secure resource commitment and create resource plan'
    });
    
    return risks;
  }

  private validateMarketAnalysis(analysis: MarketAnalysis): ValidationResult {
    let score = 0;
    const checks = [];
    
    if (analysis.marketSize > 0) { score += 25; checks.push('Market size estimated'); }
    if (analysis.competitors.length > 0) { score += 25; checks.push('Competitors identified'); }
    if (analysis.opportunities.length > 0) { score += 25; checks.push('Opportunities found'); }
    if (analysis.positioning) { score += 25; checks.push('Positioning defined'); }
    
    return {
      rule: 'Market Analysis Completeness',
      passed: score >= 75,
      score,
      details: checks.join(', ')
    };
  }

  private validateFeasibilityAnalysis(analysis: FeasibilityAnalysis): ValidationResult {
    const score = analysis.overall;
    
    return {
      rule: 'Feasibility Threshold',
      passed: score >= 60,
      score,
      details: `Overall feasibility: ${score}% (Technical: ${analysis.technical}%, Business: ${analysis.business}%, Resource: ${analysis.resource}%)`
    };
  }

  private validateRiskAssessment(risks: Risk[]): ValidationResult {
    const highRiskCount = risks.filter(r => r.probability * r.impact > 0.6).length;
    const totalRisks = risks.length;
    const score = totalRisks > 0 ? Math.max(0, 100 - (highRiskCount / totalRisks) * 100) : 100;
    
    return {
      rule: 'Risk Assessment',
      passed: highRiskCount <= totalRisks * 0.5,
      score,
      details: `${highRiskCount}/${totalRisks} high-risk items identified`
    };
  }

  private calculateOverallConfidence(validations: ValidationResult[]): number {
    if (validations.length === 0) return 0;
    
    const totalScore = validations.reduce((sum, v) => sum + v.score, 0);
    return totalScore / validations.length / 100;
  }

  private identifyQualityIssues(validations: ValidationResult[], confidence: number): QualityIssue[] {
    const issues: QualityIssue[] = [];
    
    if (confidence < this.config.confidenceThreshold) {
      issues.push({
        severity: 'high',
        type: 'Low Confidence',
        description: `Analysis confidence ${(confidence * 100).toFixed(1)}% is below threshold ${(this.config.confidenceThreshold * 100)}%`,
        suggestion: 'Gather more market data or refine the idea description'
      });
    }
    
    validations.forEach(validation => {
      if (!validation.passed) {
        issues.push({
          severity: validation.score < 30 ? 'critical' : 'medium',
          type: validation.rule,
          description: `Failed validation: ${validation.details}`,
          suggestion: 'Address the identified gaps before proceeding'
        });
      }
    });
    
    return issues;
  }

  private generateRecommendations(validations: ValidationResult[], issues: QualityIssue[]): string[] {
    const recommendations: string[] = [];
    
    if (issues.some(i => i.type === 'Market Analysis Completeness')) {
      recommendations.push('Conduct more comprehensive market research');
    }
    
    if (issues.some(i => i.type === 'Feasibility Threshold')) {
      recommendations.push('Consider simplifying the scope or breaking into phases');
    }
    
    if (issues.some(i => i.type === 'Risk Assessment')) {
      recommendations.push('Develop more detailed risk mitigation strategies');
    }
    
    if (recommendations.length === 0) {
      recommendations.push('Idea analysis is comprehensive and ready for initiative planning');
    }
    
    return recommendations;
  }

  private generateCacheKey(idea: Idea): string {
    return `${idea.title}_${idea.description.substring(0, 100)}`;
  }
}