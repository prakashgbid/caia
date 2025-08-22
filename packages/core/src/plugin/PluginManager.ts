import { EventEmitter } from 'eventemitter3';
import {
  Plugin,
  PluginConfig,
  PluginError,
  CAIAError,
  Task,
  TaskResult,
  Message
} from '../types/index.js';
import { Logger } from 'winston';

export interface PluginMetadata {
  id: string;
  name: string;
  version: string;
  enabled: boolean;
  loaded: boolean;
  initialized: boolean;
  dependencies: string[];
  dependents: string[];
  loadTime?: number;
  initTime?: number;
  errorCount: number;
  lastError?: Error;
}

export interface PluginLoadResult {
  success: boolean;
  plugin?: Plugin;
  error?: Error;
  loadTime: number;
}

export interface PluginDependencyGraph {
  [pluginId: string]: {
    dependencies: string[];
    dependents: string[];
  };
}

export class PluginManager extends EventEmitter {
  private plugins: Map<string, Plugin> = new Map();
  private configs: Map<string, PluginConfig> = new Map();
  private metadata: Map<string, PluginMetadata> = new Map();
  private loadOrder: string[] = [];
  private readonly logger: Logger;

  constructor(logger: Logger) {
    super();
    this.logger = logger.child({ component: 'PluginManager' });
    this.logger.info('PluginManager initialized');
  }

  /**
   * Register a plugin configuration
   */
  registerPlugin(config: PluginConfig): void {
    this.logger.info('Registering plugin', { pluginId: config.id, name: config.name });
    
    if (this.configs.has(config.id)) {
      throw new PluginError(`Plugin already registered: ${config.id}`, config.id);
    }

    this.configs.set(config.id, config);
    
    const metadata: PluginMetadata = {
      id: config.id,
      name: config.name,
      version: config.version,
      enabled: config.enabled,
      loaded: false,
      initialized: false,
      dependencies: config.dependencies || [],
      dependents: [],
      errorCount: 0
    };
    
    this.metadata.set(config.id, metadata);
    this.emit('pluginRegistered', { config, metadata });
  }

  /**
   * Load a plugin instance
   */
  async loadPlugin(pluginId: string, pluginFactory: () => Plugin | Promise<Plugin>): Promise<PluginLoadResult> {
    const startTime = Date.now();
    
    try {
      this.logger.info('Loading plugin', { pluginId });
      
      const config = this.configs.get(pluginId);
      if (!config) {
        throw new PluginError(`Plugin not registered: ${pluginId}`, pluginId);
      }

      const metadata = this.metadata.get(pluginId)!;
      if (metadata.loaded) {
        throw new PluginError(`Plugin already loaded: ${pluginId}`, pluginId);
      }

      // Check dependencies
      await this.checkDependencies(pluginId);

      // Create plugin instance
      const plugin = await pluginFactory();
      
      // Validate plugin interface
      this.validatePlugin(plugin, config);
      
      // Store plugin
      this.plugins.set(pluginId, plugin);
      
      // Update metadata
      const loadTime = Date.now() - startTime;
      metadata.loaded = true;
      metadata.loadTime = loadTime;
      
      this.logger.info('Plugin loaded successfully', { pluginId, loadTime });
      this.emit('pluginLoaded', { pluginId, plugin, loadTime });
      
      return {
        success: true,
        plugin,
        loadTime
      };
      
    } catch (error) {
      const loadTime = Date.now() - startTime;
      const pluginError = error instanceof PluginError ? error : 
        new PluginError(`Failed to load plugin: ${error instanceof Error ? error.message : 'Unknown error'}`, pluginId);
      
      this.updateErrorCount(pluginId, pluginError);
      this.logger.error('Plugin load failed', { pluginId, error: pluginError, loadTime });
      this.emit('pluginLoadFailed', { pluginId, error: pluginError, loadTime });
      
      return {
        success: false,
        error: pluginError,
        loadTime
      };
    }
  }

  /**
   * Initialize a loaded plugin
   */
  async initializePlugin(pluginId: string): Promise<void> {
    const startTime = Date.now();
    
    try {
      this.logger.info('Initializing plugin', { pluginId });
      
      const plugin = this.plugins.get(pluginId);
      const config = this.configs.get(pluginId);
      const metadata = this.metadata.get(pluginId);
      
      if (!plugin || !config || !metadata) {
        throw new PluginError(`Plugin not found or not loaded: ${pluginId}`, pluginId);
      }

      if (metadata.initialized) {
        throw new PluginError(`Plugin already initialized: ${pluginId}`, pluginId);
      }

      if (!metadata.enabled) {
        throw new PluginError(`Plugin is disabled: ${pluginId}`, pluginId);
      }

      // Initialize dependencies first
      for (const depId of metadata.dependencies) {
        const depMetadata = this.metadata.get(depId);
        if (!depMetadata?.initialized) {
          await this.initializePlugin(depId);
        }
      }

      // Initialize plugin
      await plugin.initialize(config.configuration || {});
      
      // Update metadata
      const initTime = Date.now() - startTime;
      metadata.initialized = true;
      metadata.initTime = initTime;
      
      this.logger.info('Plugin initialized successfully', { pluginId, initTime });
      this.emit('pluginInitialized', { pluginId, plugin, initTime });
      
    } catch (error) {
      const initTime = Date.now() - startTime;
      const pluginError = error instanceof PluginError ? error :
        new PluginError(`Failed to initialize plugin: ${error instanceof Error ? error.message : 'Unknown error'}`, pluginId);
      
      this.updateErrorCount(pluginId, pluginError);
      this.logger.error('Plugin initialization failed', { pluginId, error: pluginError, initTime });
      this.emit('pluginInitializeFailed', { pluginId, error: pluginError, initTime });
      throw pluginError;
    }
  }

  /**
   * Load and initialize all registered plugins
   */
  async loadAllPlugins(pluginFactories: Map<string, () => Plugin | Promise<Plugin>>): Promise<void> {
    const enabledConfigs = Array.from(this.configs.values()).filter(config => config.enabled);
    
    if (enabledConfigs.length === 0) {
      this.logger.info('No enabled plugins to load');
      return;
    }

    // Calculate load order based on dependencies
    this.loadOrder = this.calculateLoadOrder(enabledConfigs);
    
    this.logger.info('Loading plugins in dependency order', { loadOrder: this.loadOrder });

    // Load plugins
    for (const pluginId of this.loadOrder) {
      const factory = pluginFactories.get(pluginId);
      if (!factory) {
        this.logger.warn('No factory provided for plugin', { pluginId });
        continue;
      }

      const result = await this.loadPlugin(pluginId, factory);
      if (!result.success) {
        this.logger.warn('Skipping initialization due to load failure', { pluginId });
        continue;
      }

      try {
        await this.initializePlugin(pluginId);
      } catch (error) {
        this.logger.warn('Plugin initialization failed, continuing with others', { pluginId, error });
      }
    }

    const initializedCount = Array.from(this.metadata.values())
      .filter(m => m.initialized).length;
    
    this.logger.info('Plugin loading completed', { 
      total: enabledConfigs.length, 
      initialized: initializedCount 
    });
  }

  /**
   * Unload a plugin
   */
  async unloadPlugin(pluginId: string): Promise<void> {
    try {
      this.logger.info('Unloading plugin', { pluginId });
      
      const plugin = this.plugins.get(pluginId);
      const metadata = this.metadata.get(pluginId);
      
      if (!plugin || !metadata) {
        throw new PluginError(`Plugin not found: ${pluginId}`, pluginId);
      }

      // Check if other plugins depend on this one
      const dependents = this.getDependents(pluginId);
      if (dependents.length > 0) {
        throw new PluginError(
          `Cannot unload plugin ${pluginId}: other plugins depend on it: ${dependents.join(', ')}`,
          pluginId
        );
      }

      // Destroy plugin if initialized
      if (metadata.initialized) {
        try {
          await plugin.destroy();
        } catch (error) {
          this.logger.warn('Plugin destroy failed', { pluginId, error });
        }
      }

      // Remove plugin
      this.plugins.delete(pluginId);
      
      // Update metadata
      metadata.loaded = false;
      metadata.initialized = false;
      
      this.logger.info('Plugin unloaded successfully', { pluginId });
      this.emit('pluginUnloaded', { pluginId });
      
    } catch (error) {
      const pluginError = error instanceof PluginError ? error :
        new PluginError(`Failed to unload plugin: ${error instanceof Error ? error.message : 'Unknown error'}`, pluginId);
      
      this.updateErrorCount(pluginId, pluginError);
      this.logger.error('Plugin unload failed', { pluginId, error: pluginError });
      this.emit('pluginUnloadFailed', { pluginId, error: pluginError });
      throw pluginError;
    }
  }

  /**
   * Enable a plugin
   */
  async enablePlugin(pluginId: string): Promise<void> {
    const config = this.configs.get(pluginId);
    const metadata = this.metadata.get(pluginId);
    
    if (!config || !metadata) {
      throw new PluginError(`Plugin not found: ${pluginId}`, pluginId);
    }

    if (metadata.enabled) {
      return; // Already enabled
    }

    config.enabled = true;
    metadata.enabled = true;
    
    this.logger.info('Plugin enabled', { pluginId });
    this.emit('pluginEnabled', { pluginId });
  }

  /**
   * Disable a plugin
   */
  async disablePlugin(pluginId: string): Promise<void> {
    const config = this.configs.get(pluginId);
    const metadata = this.metadata.get(pluginId);
    
    if (!config || !metadata) {
      throw new PluginError(`Plugin not found: ${pluginId}`, pluginId);
    }

    if (!metadata.enabled) {
      return; // Already disabled
    }

    // Unload if loaded
    if (metadata.loaded) {
      await this.unloadPlugin(pluginId);
    }

    config.enabled = false;
    metadata.enabled = false;
    
    this.logger.info('Plugin disabled', { pluginId });
    this.emit('pluginDisabled', { pluginId });
  }

  /**
   * Notify plugins of agent registration
   */
  async notifyAgentRegistered(agentId: string): Promise<void> {
    const tasks = Array.from(this.plugins.entries())
      .filter(([id, plugin]) => {
        const metadata = this.metadata.get(id);
        return metadata?.initialized && plugin.onAgentRegistered;
      })
      .map(async ([id, plugin]) => {
        try {
          await plugin.onAgentRegistered!(agentId);
        } catch (error) {
          this.logger.error('Plugin onAgentRegistered failed', { pluginId: id, agentId, error });
          this.updateErrorCount(id, error instanceof Error ? error : new Error(String(error)));
        }
      });

    await Promise.allSettled(tasks);
  }

  /**
   * Notify plugins of task assignment
   */
  async notifyTaskAssigned(task: Task): Promise<void> {
    const tasks = Array.from(this.plugins.entries())
      .filter(([id, plugin]) => {
        const metadata = this.metadata.get(id);
        return metadata?.initialized && plugin.onTaskAssigned;
      })
      .map(async ([id, plugin]) => {
        try {
          await plugin.onTaskAssigned!(task);
        } catch (error) {
          this.logger.error('Plugin onTaskAssigned failed', { pluginId: id, taskId: task.id, error });
          this.updateErrorCount(id, error instanceof Error ? error : new Error(String(error)));
        }
      });

    await Promise.allSettled(tasks);
  }

  /**
   * Notify plugins of task completion
   */
  async notifyTaskCompleted(result: TaskResult): Promise<void> {
    const tasks = Array.from(this.plugins.entries())
      .filter(([id, plugin]) => {
        const metadata = this.metadata.get(id);
        return metadata?.initialized && plugin.onTaskCompleted;
      })
      .map(async ([id, plugin]) => {
        try {
          await plugin.onTaskCompleted!(result);
        } catch (error) {
          this.logger.error('Plugin onTaskCompleted failed', { pluginId: id, taskId: result.taskId, error });
          this.updateErrorCount(id, error instanceof Error ? error : new Error(String(error)));
        }
      });

    await Promise.allSettled(tasks);
  }

  /**
   * Notify plugins of message
   */
  async notifyMessage(message: Message): Promise<void> {
    const tasks = Array.from(this.plugins.entries())
      .filter(([id, plugin]) => {
        const metadata = this.metadata.get(id);
        return metadata?.initialized && plugin.onMessage;
      })
      .map(async ([id, plugin]) => {
        try {
          await plugin.onMessage!(message);
        } catch (error) {
          this.logger.error('Plugin onMessage failed', { pluginId: id, messageId: message.id, error });
          this.updateErrorCount(id, error instanceof Error ? error : new Error(String(error)));
        }
      });

    await Promise.allSettled(tasks);
  }

  /**
   * Get plugin metadata
   */
  getPluginMetadata(pluginId: string): PluginMetadata | undefined {
    return this.metadata.get(pluginId);
  }

  /**
   * Get all plugin metadata
   */
  getAllPluginMetadata(): PluginMetadata[] {
    return Array.from(this.metadata.values());
  }

  /**
   * Get plugin instance
   */
  getPlugin(pluginId: string): Plugin | undefined {
    return this.plugins.get(pluginId);
  }

  /**
   * Get dependency graph
   */
  getDependencyGraph(): PluginDependencyGraph {
    const graph: PluginDependencyGraph = {};
    
    for (const [id, metadata] of this.metadata.entries()) {
      graph[id] = {
        dependencies: [...metadata.dependencies],
        dependents: [...metadata.dependents]
      };
    }
    
    return graph;
  }

  /**
   * Get load order
   */
  getLoadOrder(): string[] {
    return [...this.loadOrder];
  }

  /**
   * Shutdown all plugins
   */
  async shutdown(): Promise<void> {
    this.logger.info('Shutting down all plugins');

    // Shutdown in reverse load order
    const shutdownOrder = [...this.loadOrder].reverse();
    
    for (const pluginId of shutdownOrder) {
      try {
        await this.unloadPlugin(pluginId);
      } catch (error) {
        this.logger.warn('Plugin shutdown failed', { pluginId, error });
      }
    }

    // Clear all data
    this.plugins.clear();
    this.configs.clear();
    this.metadata.clear();
    this.loadOrder = [];

    this.logger.info('Plugin manager shutdown completed');
  }

  // Private methods

  private async checkDependencies(pluginId: string): Promise<void> {
    const metadata = this.metadata.get(pluginId);
    if (!metadata) return;

    for (const depId of metadata.dependencies) {
      const depMetadata = this.metadata.get(depId);
      if (!depMetadata) {
        throw new PluginError(`Dependency not found: ${depId}`, pluginId);
      }
      if (!depMetadata.enabled) {
        throw new PluginError(`Dependency is disabled: ${depId}`, pluginId);
      }
      if (!depMetadata.loaded) {
        throw new PluginError(`Dependency not loaded: ${depId}`, pluginId);
      }
    }
  }

  private validatePlugin(plugin: Plugin, config: PluginConfig): void {
    if (plugin.id !== config.id) {
      throw new PluginError(`Plugin ID mismatch: expected ${config.id}, got ${plugin.id}`, config.id);
    }
    if (plugin.name !== config.name) {
      throw new PluginError(`Plugin name mismatch: expected ${config.name}, got ${plugin.name}`, config.id);
    }
    if (plugin.version !== config.version) {
      throw new PluginError(`Plugin version mismatch: expected ${config.version}, got ${plugin.version}`, config.id);
    }
    if (typeof plugin.initialize !== 'function') {
      throw new PluginError('Plugin must implement initialize method', config.id);
    }
    if (typeof plugin.destroy !== 'function') {
      throw new PluginError('Plugin must implement destroy method', config.id);
    }
  }

  private calculateLoadOrder(configs: PluginConfig[]): string[] {
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const order: string[] = [];

    const visit = (id: string): void => {
      if (visited.has(id)) return;
      if (visiting.has(id)) {
        throw new PluginError(`Circular dependency detected involving plugin: ${id}`, id);
      }

      visiting.add(id);
      
      const metadata = this.metadata.get(id);
      if (metadata) {
        for (const depId of metadata.dependencies) {
          visit(depId);
        }
        
        // Update dependents
        for (const depId of metadata.dependencies) {
          const depMetadata = this.metadata.get(depId);
          if (depMetadata && !depMetadata.dependents.includes(id)) {
            depMetadata.dependents.push(id);
          }
        }
      }

      visiting.delete(id);
      visited.add(id);
      order.push(id);
    };

    for (const config of configs) {
      visit(config.id);
    }

    return order;
  }

  private getDependents(pluginId: string): string[] {
    const dependents: string[] = [];
    
    for (const [id, metadata] of this.metadata.entries()) {
      if (metadata.dependencies.includes(pluginId) && metadata.loaded) {
        dependents.push(id);
      }
    }
    
    return dependents;
  }

  private updateErrorCount(pluginId: string, error: Error): void {
    const metadata = this.metadata.get(pluginId);
    if (metadata) {
      metadata.errorCount++;
      metadata.lastError = error;
    }
  }
}