/**
 * @fileoverview Integration test setup helpers for CAIA
 * Provides utilities for setting up complex test environments
 */

import { EventEmitter } from 'events';
import { MockAgentRegistry } from '../mocks/agent-mocks';

export interface TestEnvironmentConfig {
  name: string;
  services: ServiceConfig[];
  agents: AgentConfig[];
  networking: NetworkConfig;
  storage: StorageConfig;
  monitoring: MonitoringConfig;
}

export interface ServiceConfig {
  name: string;
  type: 'api' | 'database' | 'queue' | 'cache' | 'external';
  port?: number;
  config: Record<string, any>;
  dependencies?: string[];
  healthCheck?: HealthCheckConfig;
}

export interface AgentConfig {
  id: string;
  type: string;
  config: Record<string, any>;
  dependencies?: string[];
}

export interface NetworkConfig {
  isolation: boolean;
  latency?: number;
  bandwidth?: number;
  reliability?: number;
}

export interface StorageConfig {
  type: 'memory' | 'file' | 'database';
  config: Record<string, any>;
  cleanup: boolean;
}

export interface MonitoringConfig {
  metrics: boolean;
  logs: boolean;
  tracing: boolean;
  outputDir?: string;
}

export interface HealthCheckConfig {
  endpoint?: string;
  timeout: number;
  retries: number;
  interval: number;
}

/**
 * Main class for setting up integration test environments
 */
export class IntegrationTestSetup extends EventEmitter {
  private environments: Map<string, TestEnvironment> = new Map();
  private activeEnvironment?: TestEnvironment;

  /**
   * Create and configure a test environment
   */
  async createEnvironment(config: TestEnvironmentConfig): Promise<TestEnvironment> {
    const environment = new TestEnvironment(config);
    await environment.initialize();
    
    this.environments.set(config.name, environment);
    this.emit('environmentCreated', config.name);
    
    return environment;
  }

  /**
   * Set the active environment for tests
   */
  setActiveEnvironment(name: string): void {
    const environment = this.environments.get(name);
    if (!environment) {
      throw new Error(`Environment '${name}' not found`);
    }
    
    this.activeEnvironment = environment;
    this.emit('environmentActivated', name);
  }

  /**
   * Get the currently active environment
   */
  getActiveEnvironment(): TestEnvironment {
    if (!this.activeEnvironment) {
      throw new Error('No active environment set');
    }
    return this.activeEnvironment;
  }

  /**
   * Clean up all environments
   */
  async cleanupAll(): Promise<void> {
    const cleanupPromises = Array.from(this.environments.values()).map(env => 
      env.cleanup()
    );
    
    await Promise.all(cleanupPromises);
    this.environments.clear();
    this.activeEnvironment = undefined;
    
    this.emit('allEnvironmentsCleanedUp');
  }

  /**
   * Get environment by name
   */
  getEnvironment(name: string): TestEnvironment | undefined {
    return this.environments.get(name);
  }

  /**
   * List all environment names
   */
  listEnvironments(): string[] {
    return Array.from(this.environments.keys());
  }
}

/**
 * Represents a single test environment
 */
export class TestEnvironment extends EventEmitter {
  private services: Map<string, ServiceInstance> = new Map();
  private agents: Map<string, AgentInstance> = new Map();
  private agentRegistry: MockAgentRegistry = new MockAgentRegistry();
  private initialized = false;

  constructor(private config: TestEnvironmentConfig) {
    super();
  }

  /**
   * Initialize the test environment
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.emit('initializationStarted');

    try {
      // Setup storage
      await this.setupStorage();
      
      // Start services in dependency order
      await this.startServices();
      
      // Initialize agents
      await this.initializeAgents();
      
      // Setup monitoring
      await this.setupMonitoring();
      
      // Wait for all health checks
      await this.waitForHealthChecks();
      
      this.initialized = true;
      this.emit('initializationCompleted');
      
    } catch (error) {
      this.emit('initializationFailed', error);
      throw error;
    }
  }

  /**
   * Setup storage for the environment
   */
  private async setupStorage(): Promise<void> {
    const { storage } = this.config;
    
    switch (storage.type) {
      case 'memory':
        // In-memory storage setup
        break;
      case 'file':
        // File-based storage setup
        const fs = await import('fs/promises');
        const path = await import('path');
        
        if (storage.config.baseDir) {
          await fs.mkdir(storage.config.baseDir, { recursive: true });
        }
        break;
      case 'database':
        // Database setup
        // Implementation depends on database type
        break;
    }
  }

  /**
   * Start services in dependency order
   */
  private async startServices(): Promise<void> {
    const sortedServices = this.topologicalSort(this.config.services);
    
    for (const serviceConfig of sortedServices) {
      const service = new ServiceInstance(serviceConfig);
      await service.start();
      this.services.set(serviceConfig.name, service);
      this.emit('serviceStarted', serviceConfig.name);
    }
  }

  /**
   * Initialize agents
   */
  private async initializeAgents(): Promise<void> {
    for (const agentConfig of this.config.agents) {
      const agent = new AgentInstance(agentConfig);
      await agent.initialize();
      this.agents.set(agentConfig.id, agent);
      this.agentRegistry.register(agent.getMockAgent());
      this.emit('agentInitialized', agentConfig.id);
    }
  }

  /**
   * Setup monitoring and observability
   */
  private async setupMonitoring(): Promise<void> {
    const { monitoring } = this.config;
    
    if (monitoring.metrics) {
      // Setup metrics collection
    }
    
    if (monitoring.logs) {
      // Setup log aggregation
    }
    
    if (monitoring.tracing) {
      // Setup distributed tracing
    }
  }

  /**
   * Wait for all services to be healthy
   */
  private async waitForHealthChecks(): Promise<void> {
    const healthCheckPromises = Array.from(this.services.values()).map(service =>
      service.waitForHealth()
    );
    
    await Promise.all(healthCheckPromises);
  }

  /**
   * Topological sort for service dependencies
   */
  private topologicalSort(services: ServiceConfig[]): ServiceConfig[] {
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const result: ServiceConfig[] = [];
    const serviceMap = new Map(services.map(s => [s.name, s]));

    const visit = (serviceName: string): void => {
      if (visiting.has(serviceName)) {
        throw new Error(`Circular dependency detected involving service: ${serviceName}`);
      }
      
      if (visited.has(serviceName)) {
        return;
      }

      visiting.add(serviceName);
      
      const service = serviceMap.get(serviceName);
      if (service?.dependencies) {
        for (const dep of service.dependencies) {
          visit(dep);
        }
      }
      
      visiting.delete(serviceName);
      visited.add(serviceName);
      
      if (service) {
        result.push(service);
      }
    };

    for (const service of services) {
      visit(service.name);
    }

    return result;
  }

  /**
   * Get a service by name
   */
  getService(name: string): ServiceInstance | undefined {
    return this.services.get(name);
  }

  /**
   * Get an agent by ID
   */
  getAgent(id: string): AgentInstance | undefined {
    return this.agents.get(id);
  }

  /**
   * Get the agent registry
   */
  getAgentRegistry(): MockAgentRegistry {
    return this.agentRegistry;
  }

  /**
   * Check if environment is ready
   */
  isReady(): boolean {
    return this.initialized;
  }

  /**
   * Clean up the environment
   */
  async cleanup(): Promise<void> {
    this.emit('cleanupStarted');

    // Stop agents
    const agentCleanupPromises = Array.from(this.agents.values()).map(agent =>
      agent.cleanup()
    );
    await Promise.all(agentCleanupPromises);

    // Stop services
    const serviceCleanupPromises = Array.from(this.services.values()).map(service =>
      service.stop()
    );
    await Promise.all(serviceCleanupPromises);

    // Cleanup storage
    if (this.config.storage.cleanup) {
      await this.cleanupStorage();
    }

    this.services.clear();
    this.agents.clear();
    this.agentRegistry.clear();
    this.initialized = false;

    this.emit('cleanupCompleted');
  }

  /**
   * Cleanup storage
   */
  private async cleanupStorage(): Promise<void> {
    const { storage } = this.config;
    
    if (storage.type === 'file' && storage.config.baseDir) {
      const fs = await import('fs/promises');
      try {
        await fs.rm(storage.config.baseDir, { recursive: true, force: true });
      } catch (error) {
        // Ignore cleanup errors
      }
    }
  }
}

/**
 * Represents a service instance in the test environment
 */
export class ServiceInstance {
  private healthy = false;
  private process?: any;

  constructor(private config: ServiceConfig) {}

  /**
   * Start the service
   */
  async start(): Promise<void> {
    // Implementation depends on service type
    switch (this.config.type) {
      case 'api':
        await this.startApiService();
        break;
      case 'database':
        await this.startDatabaseService();
        break;
      case 'queue':
        await this.startQueueService();
        break;
      case 'cache':
        await this.startCacheService();
        break;
      case 'external':
        await this.startExternalService();
        break;
    }
  }

  /**
   * Start API service (mock HTTP server)
   */
  private async startApiService(): Promise<void> {
    const http = await import('http');
    
    const server = http.createServer((req, res) => {
      // Basic mock API responses
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', service: this.config.name }));
    });

    const port = this.config.port || 0;
    server.listen(port);
    this.process = server;
    this.healthy = true;
  }

  /**
   * Start database service (mock)
   */
  private async startDatabaseService(): Promise<void> {
    // Mock database implementation
    this.healthy = true;
  }

  /**
   * Start queue service (mock)
   */
  private async startQueueService(): Promise<void> {
    // Mock queue implementation
    this.healthy = true;
  }

  /**
   * Start cache service (mock)
   */
  private async startCacheService(): Promise<void> {
    // Mock cache implementation
    this.healthy = true;
  }

  /**
   * Start external service (mock)
   */
  private async startExternalService(): Promise<void> {
    // Mock external service
    this.healthy = true;
  }

  /**
   * Wait for service to be healthy
   */
  async waitForHealth(): Promise<void> {
    const { healthCheck } = this.config;
    if (!healthCheck) {
      return; // No health check configured
    }

    const { timeout, retries, interval } = healthCheck;
    let attempts = 0;

    while (attempts < retries) {
      if (this.healthy) {
        return;
      }

      await new Promise(resolve => setTimeout(resolve, interval));
      attempts++;
    }

    throw new Error(`Service ${this.config.name} failed health check after ${retries} attempts`);
  }

  /**
   * Stop the service
   */
  async stop(): Promise<void> {
    if (this.process) {
      if (typeof this.process.close === 'function') {
        this.process.close();
      } else if (typeof this.process.kill === 'function') {
        this.process.kill();
      }
    }
    this.healthy = false;
  }

  /**
   * Check if service is healthy
   */
  isHealthy(): boolean {
    return this.healthy;
  }
}

/**
 * Represents an agent instance in the test environment
 */
export class AgentInstance {
  private mockAgent: any;

  constructor(private config: AgentConfig) {}

  /**
   * Initialize the agent
   */
  async initialize(): Promise<void> {
    const { createMockAgent } = await import('../mocks/agent-mocks');
    
    this.mockAgent = createMockAgent({
      id: this.config.id,
      type: this.config.type,
      ...this.config.config
    });
  }

  /**
   * Get the mock agent
   */
  getMockAgent(): any {
    return this.mockAgent;
  }

  /**
   * Clean up the agent
   */
  async cleanup(): Promise<void> {
    if (this.mockAgent?.stop) {
      await this.mockAgent.stop();
    }
  }
}

// Global instance for convenience
export const integrationSetup = new IntegrationTestSetup();