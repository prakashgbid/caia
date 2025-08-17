/**
 * ParaForge Agents - Central export point for all agents
 * 
 * These agents will eventually be extracted to independent packages
 * but are currently developed within ParaForge for rapid iteration.
 */

// Core Agents
export { JiraConnect } from './jira-connect';
export type { 
  JiraConnectConfig, 
  JiraIssue, 
  JiraSearchResult,
  JiraMetrics 
} from './jira-connect';

// Requirements Gathering Agents
export { ProductOwner } from './product-owner';
// export { SolutionArchitect } from './solution-architect';
// export { UXDesigner } from './ux-designer';
// export { QAEngineer } from './qa-engineer';

// Agent Types and Interfaces
export interface AgentConfig {
  name: string;
  version: string;
  timeout?: number;
  retryAttempts?: number;
  debug?: boolean;
}

export interface AgentRequest<T = any> {
  id: string;
  timestamp: Date;
  context: ProjectContext;
  input: T;
  constraints?: Record<string, any>;
}

export interface AgentResponse<T = any> {
  id: string;
  timestamp: Date;
  success: boolean;
  data: T;
  errors?: Error[];
  metadata?: Record<string, any>;
  recommendations?: string[];
  duration?: number;
}

export interface ProjectContext {
  projectId: string;
  projectName: string;
  description: string;
  constraints?: {
    timeline?: string;
    budget?: number;
    team?: string[];
    technology?: string[];
    compliance?: string[];
  };
  metadata?: Record<string, any>;
}

// Base Agent Class (for future agents)
export abstract class BaseAgent {
  protected config: AgentConfig;
  
  constructor(config: Partial<AgentConfig>) {
    this.config = {
      name: 'base-agent',
      version: '1.0.0',
      timeout: 30000,
      retryAttempts: 3,
      debug: false,
      ...config
    };
  }

  abstract async process<T, R>(request: AgentRequest<T>): Promise<AgentResponse<R>>;
  
  protected async retry<T>(
    fn: () => Promise<T>,
    attempts: number = this.config.retryAttempts || 3
  ): Promise<T> {
    let lastError: Error | undefined;
    
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;
        if (i < attempts - 1) {
          await this.delay(Math.pow(2, i) * 1000); // Exponential backoff
        }
      }
    }
    
    throw lastError;
  }
  
  protected delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  protected log(message: string, ...args: any[]): void {
    if (this.config.debug) {
      console.log(`[${this.config.name}] ${message}`, ...args);
    }
  }
}

// Agent Registry (for dynamic agent loading)
export class AgentRegistry {
  private static agents = new Map<string, BaseAgent>();
  
  static register(name: string, agent: BaseAgent): void {
    this.agents.set(name, agent);
  }
  
  static get(name: string): BaseAgent | undefined {
    return this.agents.get(name);
  }
  
  static list(): string[] {
    return Array.from(this.agents.keys());
  }
  
  static clear(): void {
    this.agents.clear();
  }
}