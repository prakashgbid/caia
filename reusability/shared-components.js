/**
 * CAIA Shared Component Library
 * Universal components that work in both local and cloud environments
 */

class EnvironmentDetector {
  static get isCloud() {
    return process.env.CC_CLOUD === 'true' || process.env.DEPLOYMENT === 'cloud';
  }
  
  static get isLocal() {
    return !this.isCloud;
  }
  
  static get hasGPU() {
    // Check for GPU availability (for ML models)
    return process.env.CUDA_VISIBLE_DEVICES !== undefined;
  }
  
  static get cksEndpoint() {
    return this.isCloud 
      ? process.env.CLOUD_CKS_URL 
      : 'http://localhost:5555';
  }
}

/**
 * Universal Data Processor
 * Automatically selects best processing strategy based on environment
 */
class UniversalDataProcessor {
  static async process(data, options = {}) {
    const processor = EnvironmentDetector.isCloud
      ? new CloudProcessor()
      : new LocalProcessor();
    
    // Add environment-specific optimizations
    if (EnvironmentDetector.hasGPU) {
      options.useGPU = true;
    }
    
    return processor.execute(data, options);
  }
}

class LocalProcessor {
  async execute(data, options) {
    // Use local resources
    console.log('💻 Processing locally...');
    
    // Simulate processing
    return {
      processed: true,
      environment: 'local',
      dataSize: JSON.stringify(data).length,
      timestamp: new Date().toISOString()
    };
  }
}

class CloudProcessor {
  async execute(data, options) {
    // Use cloud resources
    console.log('☁️ Processing in cloud...');
    
    // Simulate cloud processing
    return {
      processed: true,
      environment: 'cloud',
      dataSize: JSON.stringify(data).length,
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * Adaptive Knowledge Query
 * Queries both local and cloud knowledge bases
 */
class AdaptiveKnowledgeQuery {
  static async query(question, options = {}) {
    const endpoints = [];
    
    // Always try local if available
    if (EnvironmentDetector.isLocal || options.includeLocal) {
      endpoints.push({
        name: 'local',
        url: 'http://localhost:5555/query'
      });
    }
    
    // Add cloud if available
    if (process.env.CLOUD_CKS_URL) {
      endpoints.push({
        name: 'cloud',
        url: process.env.CLOUD_CKS_URL + '/query'
      });
    }
    
    // Query all endpoints in parallel
    const results = await Promise.allSettled(
      endpoints.map(async (ep) => {
        try {
          const response = await this.fetch(ep.url, {
            method: 'POST',
            body: { question }
          });
          return { source: ep.name, data: response };
        } catch (error) {
          return { source: ep.name, error: error.message };
        }
      })
    );
    
    // Merge successful results
    return this.mergeResults(results);
  }
  
  static mergeResults(results) {
    const successful = results
      .filter(r => r.status === 'fulfilled' && !r.value.error)
      .map(r => r.value);
    
    if (successful.length === 0) {
      throw new Error('No knowledge sources available');
    }
    
    // Deduplicate and merge
    const merged = {
      sources: successful.map(s => s.source),
      answers: [],
      confidence: 0
    };
    
    // Combine answers from all sources
    successful.forEach(result => {
      if (result.data && result.data.answer) {
        merged.answers.push({
          source: result.source,
          answer: result.data.answer,
          confidence: result.data.confidence || 0
        });
      }
    });
    
    // Calculate average confidence
    if (merged.answers.length > 0) {
      merged.confidence = merged.answers.reduce((sum, a) => sum + a.confidence, 0) / merged.answers.length;
    }
    
    return merged;
  }
  
  static async fetch(url, options = {}) {
    // Simple fetch implementation
    const http = require('http');
    const https = require('https');
    
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const protocol = urlObj.protocol === 'https:' ? https : http;
      
      const req = protocol.request({
        hostname: urlObj.hostname,
        port: urlObj.port,
        path: urlObj.pathname,
        method: options.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...options.headers
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve(data);
          }
        });
      });
      
      req.on('error', reject);
      
      if (options.body) {
        req.write(JSON.stringify(options.body));
      }
      
      req.end();
    });
  }
}

/**
 * Environment-Agnostic Agent
 * Automatically adapts to local or cloud execution
 */
class EnvironmentAgnosticAgent {
  constructor(name) {
    this.name = name;
    this.environment = EnvironmentDetector.isCloud ? 'cloud' : 'local';
    this.resources = null;
    this.capabilities = null;
  }
  
  async initialize() {
    console.log(`🤖 Initializing ${this.name} in ${this.environment} mode...`);
    
    // Detect and load available resources
    this.resources = await this.detectResources();
    
    // Assess capabilities based on environment
    this.capabilities = await this.assessCapabilities();
    
    console.log(`✅ ${this.name} ready with capabilities:`, this.capabilities);
  }
  
  async detectResources() {
    const resources = {
      cpu: require('os').cpus().length,
      memory: require('os').totalmem(),
      storage: 'unlimited', // Simplified
      gpu: EnvironmentDetector.hasGPU,
      apis: []
    };
    
    // Check available APIs
    if (EnvironmentDetector.isLocal) {
      // Test local services
      const localServices = [
        { name: 'CKS', url: 'http://localhost:5555/health' },
        { name: 'Enhancement', url: 'http://localhost:5002/health' },
        { name: 'Learning', url: 'http://localhost:5003/health' }
      ];
      
      for (const service of localServices) {
        try {
          await AdaptiveKnowledgeQuery.fetch(service.url);
          resources.apis.push(service.name);
        } catch {
          // Service not available
        }
      }
    }
    
    return resources;
  }
  
  async assessCapabilities() {
    return {
      parallelExecution: this.resources.cpu > 2,
      largeModels: this.resources.memory > 8 * 1024 * 1024 * 1024, // 8GB
      gpuAcceleration: this.resources.gpu,
      knowledgeAccess: this.resources.apis.includes('CKS'),
      learning: this.resources.apis.includes('Learning'),
      enhancement: this.resources.apis.includes('Enhancement')
    };
  }
  
  async execute(task) {
    // Select best strategy based on capabilities
    const strategy = this.selectStrategy(task);
    
    console.log(`🎯 Executing task with ${strategy.name} strategy...`);
    
    return strategy.execute(task, this.resources);
  }
  
  selectStrategy(task) {
    // Simple strategy selection
    if (task.requiresGPU && this.capabilities.gpuAcceleration) {
      return new GPUStrategy();
    }
    
    if (task.requiresKnowledge && this.capabilities.knowledgeAccess) {
      return new KnowledgeStrategy();
    }
    
    if (task.parallel && this.capabilities.parallelExecution) {
      return new ParallelStrategy();
    }
    
    return new DefaultStrategy();
  }
}

// Strategy implementations
class DefaultStrategy {
  constructor() {
    this.name = 'default';
  }
  
  async execute(task, resources) {
    console.log('🔧 Executing with default strategy...');
    return { success: true, strategy: this.name };
  }
}

class GPUStrategy {
  constructor() {
    this.name = 'gpu-accelerated';
  }
  
  async execute(task, resources) {
    console.log('🚀 Executing with GPU acceleration...');
    return { success: true, strategy: this.name, gpu: true };
  }
}

class KnowledgeStrategy {
  constructor() {
    this.name = 'knowledge-enhanced';
  }
  
  async execute(task, resources) {
    console.log('🧠 Executing with knowledge enhancement...');
    
    // Query knowledge base
    const knowledge = await AdaptiveKnowledgeQuery.query(task.question || task.description);
    
    return { 
      success: true, 
      strategy: this.name, 
      knowledge: knowledge 
    };
  }
}

class ParallelStrategy {
  constructor() {
    this.name = 'parallel';
  }
  
  async execute(task, resources) {
    console.log('⚡ Executing in parallel...');
    
    // Split task into subtasks
    const subtasks = this.splitTask(task);
    
    // Execute in parallel
    const results = await Promise.all(
      subtasks.map(st => this.executeSubtask(st))
    );
    
    return { 
      success: true, 
      strategy: this.name, 
      parallelism: subtasks.length,
      results 
    };
  }
  
  splitTask(task) {
    // Simple task splitting
    if (Array.isArray(task.data)) {
      return task.data.map((item, i) => ({
        id: i,
        data: item
      }));
    }
    return [task];
  }
  
  async executeSubtask(subtask) {
    // Simulate subtask execution
    return { id: subtask.id, processed: true };
  }
}

/**
 * Performance-Based Router
 * Routes tasks to optimal environment based on performance
 */
class PerformanceRouter {
  constructor() {
    this.performanceHistory = new Map();
  }
  
  async route(task) {
    // Estimate performance in each environment
    const estimates = await this.estimatePerformance(task);
    
    // Select best environment
    const best = this.selectBest(estimates);
    
    console.log(`🎯 Routing to ${best.environment} (estimated time: ${best.time}ms)`);
    
    // Execute in selected environment
    const result = await this.executeIn(best.environment, task);
    
    // Record actual performance
    this.recordPerformance(task, best.environment, result.duration);
    
    return result;
  }
  
  async estimatePerformance(task) {
    const taskType = this.getTaskType(task);
    const history = this.performanceHistory.get(taskType) || {};
    
    return {
      local: {
        environment: 'local',
        time: history.local || this.estimateLocal(task),
        confidence: history.local ? 0.9 : 0.5
      },
      cloud: {
        environment: 'cloud',
        time: history.cloud || this.estimateCloud(task),
        confidence: history.cloud ? 0.9 : 0.5
      }
    };
  }
  
  estimateLocal(task) {
    // Simple estimation based on task size
    const baseTime = 100; // ms
    const sizeMultiplier = JSON.stringify(task).length / 1000;
    return baseTime * (1 + sizeMultiplier);
  }
  
  estimateCloud(task) {
    // Cloud has overhead but more power
    const baseTime = 200; // ms (includes network)
    const sizeMultiplier = JSON.stringify(task).length / 5000; // Better at scale
    return baseTime * (1 + sizeMultiplier);
  }
  
  selectBest(estimates) {
    // Select based on time and confidence
    if (estimates.local.time < estimates.cloud.time) {
      return estimates.local;
    }
    return estimates.cloud;
  }
  
  async executeIn(environment, task) {
    const startTime = Date.now();
    
    let result;
    if (environment === 'local') {
      result = await this.executeLocally(task);
    } else {
      result = await this.executeInCloud(task);
    }
    
    result.duration = Date.now() - startTime;
    return result;
  }
  
  async executeLocally(task) {
    console.log('💻 Executing locally...');
    return { success: true, environment: 'local' };
  }
  
  async executeInCloud(task) {
    console.log('☁️ Executing in cloud...');
    return { success: true, environment: 'cloud' };
  }
  
  getTaskType(task) {
    // Categorize task for performance tracking
    return task.type || 'generic';
  }
  
  recordPerformance(task, environment, duration) {
    const taskType = this.getTaskType(task);
    
    if (!this.performanceHistory.has(taskType)) {
      this.performanceHistory.set(taskType, {});
    }
    
    const history = this.performanceHistory.get(taskType);
    
    // Update with exponential moving average
    const alpha = 0.3; // Weight for new observation
    const oldTime = history[environment] || duration;
    history[environment] = alpha * duration + (1 - alpha) * oldTime;
  }
}

module.exports = {
  EnvironmentDetector,
  UniversalDataProcessor,
  AdaptiveKnowledgeQuery,
  EnvironmentAgnosticAgent,
  PerformanceRouter
};