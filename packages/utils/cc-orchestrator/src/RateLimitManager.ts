/**
 * Rate Limit Manager
 * 
 * Manages API rate limits and quotas across all CC instances.
 * Prevents hitting rate limits while maximizing throughput.
 */

import { EventEmitter } from 'eventemitter3';
import Bottleneck from 'bottleneck';

export interface RateLimitConfig {
  // Claude API limits
  claudeRequestsPerMinute: number;
  claudeTokensPerMinute: number;
  claudeTokensPerDay: number;
  claudeConcurrentRequests: number;
  
  // Jira API limits
  jiraRequestsPerMinute: number;
  jiraConcurrentRequests: number;
  
  // GitHub API limits
  githubRequestsPerHour: number;
  githubConcurrentRequests: number;
  
  // Global settings
  burstAllowance: number;      // Allow short bursts above limit
  backoffMultiplier: number;   // Exponential backoff multiplier
  reserveCapacity: number;     // Reserve % of capacity (0-1)
}

export interface APIQuota {
  service: 'claude' | 'jira' | 'github' | 'other';
  requestsUsed: number;
  requestsLimit: number;
  tokensUsed?: number;
  tokensLimit?: number;
  resetTime: Date;
  remaining: number;
  percentUsed: number;
}

export interface RateLimitEvent {
  service: string;
  type: 'throttled' | 'delayed' | 'rejected' | 'reset';
  details: any;
}

/**
 * Manages rate limits across multiple APIs
 */
export class RateLimitManager extends EventEmitter {
  private config: RateLimitConfig;
  private limiters: Map<string, Bottleneck> = new Map();
  private quotas: Map<string, APIQuota> = new Map();
  private backoffTimers: Map<string, NodeJS.Timeout> = new Map();
  private requestCounts: Map<string, number[]> = new Map();
  
  constructor(config?: Partial<RateLimitConfig>) {
    super();
    
    this.config = {
      claudeRequestsPerMinute: 100,
      claudeTokensPerMinute: 100000,
      claudeTokensPerDay: 10000000,
      claudeConcurrentRequests: 10,
      jiraRequestsPerMinute: 60,
      jiraConcurrentRequests: 10,
      githubRequestsPerHour: 5000,
      githubConcurrentRequests: 10,
      burstAllowance: 1.2,
      backoffMultiplier: 2,
      reserveCapacity: 0.1,
      ...config
    };
    
    this.initializeLimiters();
    this.startQuotaTracking();
  }

  /**
   * Initialize rate limiters for each service
   */
  private initializeLimiters(): void {
    // Claude API limiter
    this.limiters.set('claude', new Bottleneck({
      maxConcurrent: this.config.claudeConcurrentRequests,
      minTime: 60000 / this.config.claudeRequestsPerMinute,
      reservoir: Math.floor(this.config.claudeRequestsPerMinute * this.config.burstAllowance),
      reservoirRefreshAmount: this.config.claudeRequestsPerMinute,
      reservoirRefreshInterval: 60000,
      highWater: Math.floor(this.config.claudeRequestsPerMinute * 0.8),
      strategy: Bottleneck.strategy.LEAK
    }));
    
    // Jira API limiter
    this.limiters.set('jira', new Bottleneck({
      maxConcurrent: this.config.jiraConcurrentRequests,
      minTime: 60000 / this.config.jiraRequestsPerMinute,
      reservoir: this.config.jiraRequestsPerMinute,
      reservoirRefreshAmount: this.config.jiraRequestsPerMinute,
      reservoirRefreshInterval: 60000
    }));
    
    // GitHub API limiter
    this.limiters.set('github', new Bottleneck({
      maxConcurrent: this.config.githubConcurrentRequests,
      minTime: 3600000 / this.config.githubRequestsPerHour,
      reservoir: this.config.githubRequestsPerHour,
      reservoirRefreshAmount: this.config.githubRequestsPerHour,
      reservoirRefreshInterval: 3600000
    }));
    
    // Set up event listeners
    this.setupLimiterEvents();
  }

  /**
   * Set up event listeners for limiters
   */
  private setupLimiterEvents(): void {
    for (const [service, limiter] of this.limiters) {
      limiter.on('error', (error) => {
        this.emit('error', { service, error });
      });
      
      limiter.on('depleted', () => {
        this.handleDepleted(service);
      });
      
      limiter.on('dropped', (dropped) => {
        this.emit('dropped', { service, dropped });
      });
    }
  }

  /**
   * Request permission to make API call
   */
  async requestPermission(
    service: 'claude' | 'jira' | 'github',
    estimatedTokens?: number
  ): Promise<boolean> {
    const limiter = this.limiters.get(service);
    if (!limiter) {
      throw new Error(`Unknown service: ${service}`);
    }
    
    // Check token limits for Claude
    if (service === 'claude' && estimatedTokens) {
      const canProceed = await this.checkTokenLimit(estimatedTokens);
      if (!canProceed) {
        this.emit('rate-limited', {
          service: 'claude',
          type: 'tokens',
          details: { estimatedTokens }
        });
        return false;
      }
    }
    
    // Check if we're in backoff
    if (this.isInBackoff(service)) {
      this.emit('rate-limited', {
        service,
        type: 'backoff',
        details: { backoffUntil: this.getBackoffEndTime(service) }
      });
      return false;
    }
    
    // Schedule the request
    return new Promise((resolve) => {
      limiter.schedule(async () => {
        this.trackRequest(service, estimatedTokens);
        resolve(true);
      }).catch(() => {
        resolve(false);
      });
    });
  }

  /**
   * Check token limit for Claude
   */
  private async checkTokenLimit(tokens: number): Promise<boolean> {
    const quota = this.quotas.get('claude-tokens');
    if (!quota) return true;
    
    const minuteTokens = this.getTokensUsedInWindow('minute');
    const dayTokens = this.getTokensUsedInWindow('day');
    
    if (minuteTokens + tokens > this.config.claudeTokensPerMinute * (1 - this.config.reserveCapacity)) {
      return false;
    }
    
    if (dayTokens + tokens > this.config.claudeTokensPerDay * (1 - this.config.reserveCapacity)) {
      return false;
    }
    
    return true;
  }

  /**
   * Track API request
   */
  private trackRequest(service: string, tokens?: number): void {
    // Track request count
    if (!this.requestCounts.has(service)) {
      this.requestCounts.set(service, []);
    }
    
    const now = Date.now();
    const counts = this.requestCounts.get(service)!;
    counts.push(now);
    
    // Clean old entries
    const windowSize = service === 'github' ? 3600000 : 60000;
    const cutoff = now - windowSize;
    const filtered = counts.filter(time => time > cutoff);
    this.requestCounts.set(service, filtered);
    
    // Update quota
    this.updateQuota(service, filtered.length, tokens);
    
    this.emit('request-tracked', {
      service,
      count: filtered.length,
      tokens
    });
  }

  /**
   * Update quota information
   */
  private updateQuota(service: string, requestCount: number, tokens?: number): void {
    const limits = this.getServiceLimits(service);
    
    const quota: APIQuota = {
      service: service as any,
      requestsUsed: requestCount,
      requestsLimit: limits.requests,
      tokensUsed: tokens,
      tokensLimit: limits.tokens,
      resetTime: new Date(Date.now() + limits.window),
      remaining: limits.requests - requestCount,
      percentUsed: (requestCount / limits.requests) * 100
    };
    
    this.quotas.set(service, quota);
    
    // Check if approaching limit
    if (quota.percentUsed > 80) {
      this.emit('quota-warning', quota);
    }
  }

  /**
   * Get service rate limits
   */
  private getServiceLimits(service: string): {
    requests: number;
    tokens?: number;
    window: number;
  } {
    switch (service) {
      case 'claude':
        return {
          requests: this.config.claudeRequestsPerMinute,
          tokens: this.config.claudeTokensPerMinute,
          window: 60000
        };
      
      case 'jira':
        return {
          requests: this.config.jiraRequestsPerMinute,
          window: 60000
        };
      
      case 'github':
        return {
          requests: this.config.githubRequestsPerHour,
          window: 3600000
        };
      
      default:
        return { requests: 100, window: 60000 };
    }
  }

  /**
   * Handle depleted rate limit
   */
  private handleDepleted(service: string): void {
    this.emit('depleted', { service });
    
    // Implement exponential backoff
    const backoffTime = this.calculateBackoff(service);
    this.setBackoff(service, backoffTime);
  }

  /**
   * Calculate backoff time
   */
  private calculateBackoff(service: string): number {
    const attempts = this.getBackoffAttempts(service);
    const baseTime = 1000; // 1 second
    return Math.min(
      baseTime * Math.pow(this.config.backoffMultiplier, attempts),
      60000 // Max 1 minute
    );
  }

  /**
   * Set backoff for service
   */
  private setBackoff(service: string, duration: number): void {
    // Clear existing backoff
    const existing = this.backoffTimers.get(service);
    if (existing) {
      clearTimeout(existing);
    }
    
    // Set new backoff
    const timer = setTimeout(() => {
      this.backoffTimers.delete(service);
      this.emit('backoff-cleared', { service });
    }, duration);
    
    this.backoffTimers.set(service, timer);
    this.emit('backoff-set', { service, duration });
  }

  /**
   * Check if service is in backoff
   */
  private isInBackoff(service: string): boolean {
    return this.backoffTimers.has(service);
  }

  /**
   * Get backoff end time
   */
  private getBackoffEndTime(service: string): Date | null {
    // In production, track actual end times
    return this.isInBackoff(service) ? new Date(Date.now() + 5000) : null;
  }

  /**
   * Get backoff attempts for service
   */
  private getBackoffAttempts(service: string): number {
    // In production, track attempts
    return 1;
  }

  /**
   * Get tokens used in time window
   */
  private getTokensUsedInWindow(window: 'minute' | 'day'): number {
    // In production, track actual token usage
    return 0;
  }

  /**
   * Start quota tracking
   */
  private startQuotaTracking(): void {
    // Reset quotas periodically
    setInterval(() => {
      this.resetQuotas();
    }, 60000); // Every minute
  }

  /**
   * Reset expired quotas
   */
  private resetQuotas(): void {
    const now = new Date();
    
    for (const [service, quota] of this.quotas) {
      if (quota.resetTime < now) {
        quota.requestsUsed = 0;
        quota.tokensUsed = 0;
        quota.remaining = quota.requestsLimit;
        quota.percentUsed = 0;
        quota.resetTime = new Date(now.getTime() + 60000);
        
        this.emit('quota-reset', { service });
      }
    }
  }

  /**
   * Get current quotas
   */
  getQuotas(): APIQuota[] {
    return Array.from(this.quotas.values());
  }

  /**
   * Get specific service quota
   */
  getQuota(service: string): APIQuota | undefined {
    return this.quotas.get(service);
  }

  /**
   * Manually update rate limits
   */
  updateRateLimits(service: string, limits: {
    requests?: number;
    tokens?: number;
    concurrent?: number;
  }): void {
    const limiter = this.limiters.get(service);
    if (!limiter) return;
    
    // Update limiter configuration
    if (limits.requests) {
      limiter.updateSettings({
        reservoir: limits.requests,
        reservoirRefreshAmount: limits.requests
      });
    }
    
    if (limits.concurrent) {
      limiter.updateSettings({
        maxConcurrent: limits.concurrent
      });
    }
    
    this.emit('limits-updated', { service, limits });
  }

  /**
   * Get rate limit status
   */
  async getStatus(): Promise<{
    services: {
      name: string;
      available: number;
      running: number;
      queued: number;
      quota: APIQuota | undefined;
    }[];
  }> {
    const services = [];
    
    for (const [name, limiter] of this.limiters) {
      const counts = await limiter.counts();
      services.push({
        name,
        available: counts.RECEIVED - counts.RUNNING - counts.EXECUTING,
        running: counts.RUNNING + counts.EXECUTING,
        queued: counts.QUEUED,
        quota: this.quotas.get(name)
      });
    }
    
    return { services };
  }

  /**
   * Emergency stop - halt all requests
   */
  async emergencyStop(): Promise<void> {
    for (const [service, limiter] of this.limiters) {
      await limiter.stop();
      this.emit('emergency-stop', { service });
    }
  }

  /**
   * Resume after emergency stop
   */
  async resume(): Promise<void> {
    for (const [service, limiter] of this.limiters) {
      limiter.start();
      this.emit('resumed', { service });
    }
  }

  /**
   * Cleanup
   */
  async cleanup(): Promise<void> {
    // Clear all backoff timers
    for (const timer of this.backoffTimers.values()) {
      clearTimeout(timer);
    }
    
    // Stop all limiters
    for (const limiter of this.limiters.values()) {
      await limiter.stop();
    }
    
    this.limiters.clear();
    this.quotas.clear();
    this.backoffTimers.clear();
    this.requestCounts.clear();
  }
}

export default RateLimitManager;