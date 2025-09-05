# Performance Tuning

Comprehensive guide for optimizing the CAIA Hierarchical Agent System for maximum performance and scalability.

---

## 📚 Table of Contents

1. [Performance Overview](#performance-overview)
2. [System Resource Optimization](#system-resource-optimization)
3. [Concurrency & Parallel Processing](#concurrency--parallel-processing)
4. [Memory Management](#memory-management)
5. [JIRA Integration Performance](#jira-integration-performance)
6. [Caching Strategies](#caching-strategies)
7. [Database Optimization](#database-optimization)
8. [Network & I/O Optimization](#network--io-optimization)
9. [Monitoring & Profiling](#monitoring--profiling)
10. [Troubleshooting Performance Issues](#troubleshooting-performance-issues)

---

## Performance Overview

### Baseline Performance Metrics

| Operation | Small Project (<50 issues) | Medium Project (50-200) | Large Project (200-500) | Enterprise (500+) |
|-----------|----------------------------|-------------------------|------------------------|-----------------|
| **Task Decomposition** | 5-15 seconds | 30-90 seconds | 2-5 minutes | 5-15 minutes |
| **Intelligence Analysis** | 3-8 seconds | 15-45 seconds | 1-3 minutes | 3-8 minutes |
| **JIRA Creation** | 10-30 seconds | 1-5 minutes | 5-15 minutes | 15+ minutes |
| **Total Processing** | 30-60 seconds | 2-8 minutes | 10-25 minutes | 25+ minutes |

### Performance Goals

- 🎯 **Sub-minute processing** for projects under 100 issues
- 🎯 **Linear scalability** up to 1000 concurrent operations
- 🎯 **Memory efficiency** under 2GB for typical workloads
- 🎯 **99.9% uptime** in production environments
- 🎯 **20x faster** than manual planning processes

---

## System Resource Optimization

### CPU Optimization

```javascript
// Optimal CPU configuration
const cpuOptimization = {
  // Node.js settings
  nodeOptions: {
    "--max-old-space-size": "4096",     // 4GB heap
    "--max-semi-space-size": "128",     // 128MB young generation
    "--optimize-for-size": false,       // Optimize for speed
    "--use-largepages": "silent"        // Use large memory pages
  },
  
  // Process settings
  processSettings: {
    UV_THREADPOOL_SIZE: Math.min(16, require('os').cpus().length * 2),
    UV_USE_IO_URING: "1",               // Linux: Use io_uring
    NODE_ENV: "production"               // Enable production optimizations
  },
  
  // Application settings
  appSettings: {
    maxConcurrency: require('os').cpus().length * 2,
    workerThreads: require('os').cpus().length,
    enableClusterMode: true              // Multi-process mode
  }
};
```

### Memory Configuration

```typescript
// Memory-optimized configuration
class MemoryOptimizer {
  private readonly maxHeapSize: number;
  private readonly gcThreshold: number;
  
  constructor() {
    this.maxHeapSize = this.calculateOptimalHeapSize();
    this.gcThreshold = this.maxHeapSize * 0.8;
    this.setupGarbageCollection();
  }
  
  private calculateOptimalHeapSize(): number {
    const totalMemory = require('os').totalmem();
    const freeMemory = require('os').freemem();
    
    // Use 50% of available memory, max 8GB
    return Math.min(8 * 1024 * 1024 * 1024, totalMemory * 0.5);
  }
  
  private setupGarbageCollection(): void {
    // Monitor memory usage
    setInterval(() => {
      const used = process.memoryUsage();
      if (used.heapUsed > this.gcThreshold) {
        if (global.gc) {
          global.gc();
          console.log('Manual GC triggered');
        }
      }
    }, 60000); // Check every minute
  }
  
  optimizeForLargeDatasets(): void {
    // Stream processing for large datasets
    process.setMaxListeners(0); // Remove listener limit
    
    // Increase buffer sizes
    process.env.NODE_OPTIONS = [
      process.env.NODE_OPTIONS,
      '--max-old-space-size=8192',
      '--max-semi-space-size=256'
    ].filter(Boolean).join(' ');
  }
}
```

---

## Concurrency & Parallel Processing

### Optimal Concurrency Configuration

```typescript
// Dynamic concurrency calculation
class ConcurrencyOptimizer {
  private readonly cpuCount: number;
  private readonly memoryGB: number;
  
  constructor() {
    this.cpuCount = require('os').cpus().length;
    this.memoryGB = Math.floor(require('os').totalmem() / (1024 * 1024 * 1024));
  }
  
  calculateOptimalConcurrency(): {
    taskDecomposition: number;
    jiraOperations: number;
    intelligence: number;
    maxTotal: number;
  } {
    return {
      // CPU-intensive operations
      taskDecomposition: Math.min(this.cpuCount, 8),
      
      // I/O-intensive operations  
      jiraOperations: Math.min(this.cpuCount * 4, 20),
      
      // Memory-intensive operations
      intelligence: Math.min(Math.floor(this.memoryGB / 2), 6),
      
      // Overall limit
      maxTotal: Math.min(this.cpuCount * 6, 50)
    };
  }
  
  createOptimalWorkerPool(): WorkerPool {
    const concurrency = this.calculateOptimalConcurrency();
    
    return new WorkerPool({
      minWorkers: Math.ceil(concurrency.maxTotal * 0.2),
      maxWorkers: concurrency.maxTotal,
      idleTimeout: 30000,
      taskTimeout: 300000,
      workerScript: path.join(__dirname, 'worker.js')
    });
  }
}
```

### Parallel Processing Patterns

```typescript
// Efficient parallel processing implementation
class ParallelProcessor {
  private readonly semaphore: Semaphore;
  private readonly batchSize: number;
  
  constructor(maxConcurrency: number) {
    this.semaphore = new Semaphore(maxConcurrency);
    this.batchSize = Math.max(10, Math.floor(maxConcurrency * 2));
  }
  
  async processBatch<T, R>(
    items: T[],
    processor: (item: T) => Promise<R>,
    options: { 
      preserveOrder?: boolean;
      errorHandling?: 'fail-fast' | 'continue';
      progressCallback?: (completed: number, total: number) => void;
    } = {}
  ): Promise<R[]> {
    const batches = this.createBatches(items, this.batchSize);
    const results: R[] = new Array(items.length);
    let completed = 0;
    
    const processBatch = async (batch: T[], startIndex: number): Promise<void> => {
      const batchPromises = batch.map(async (item, index) => {
        await this.semaphore.acquire();
        
        try {
          const result = await processor(item);
          results[startIndex + index] = result;
          
          completed++;
          options.progressCallback?.(completed, items.length);
          
          return result;
        } catch (error) {
          if (options.errorHandling === 'fail-fast') {
            throw error;
          }
          console.error(`Item ${startIndex + index} failed:`, error);
          return null;
        } finally {
          this.semaphore.release();
        }
      });
      
      if (options.errorHandling === 'fail-fast') {
        await Promise.all(batchPromises);
      } else {
        await Promise.allSettled(batchPromises);
      }
    };
    
    // Process all batches in parallel
    await Promise.all(
      batches.map((batch, index) => 
        processBatch(batch, index * this.batchSize)
      )
    );
    
    return options.preserveOrder ? results : results.filter(Boolean);
  }
  
  private createBatches<T>(items: T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    return batches;
  }
}
```

---

## Memory Management

### Memory Pool Implementation

```typescript
// Memory pool for object reuse
class MemoryPool<T> {
  private readonly pool: T[] = [];
  private readonly factory: () => T;
  private readonly reset: (obj: T) => void;
  private readonly maxSize: number;
  
  constructor(
    factory: () => T,
    reset: (obj: T) => void,
    maxSize: number = 100
  ) {
    this.factory = factory;
    this.reset = reset;
    this.maxSize = maxSize;
  }
  
  acquire(): T {
    if (this.pool.length > 0) {
      return this.pool.pop()!;
    }
    return this.factory();
  }
  
  release(obj: T): void {
    if (this.pool.length < this.maxSize) {
      this.reset(obj);
      this.pool.push(obj);
    }
  }
  
  clear(): void {
    this.pool.length = 0;
  }
  
  size(): number {
    return this.pool.length;
  }
}

// Usage example
const hierarchyPool = new MemoryPool(
  () => ({ initiatives: [], epics: [], stories: [], tasks: [] }),
  (hierarchy) => {
    hierarchy.initiatives.length = 0;
    hierarchy.epics.length = 0;
    hierarchy.stories.length = 0;
    hierarchy.tasks.length = 0;
  },
  50
);
```

### Memory Monitoring

```typescript
// Real-time memory monitoring
class MemoryMonitor {
  private readonly alertThreshold: number;
  private readonly criticalThreshold: number;
  private monitoring: boolean = false;
  
  constructor() {
    this.alertThreshold = 0.8; // 80% of heap
    this.criticalThreshold = 0.95; // 95% of heap
  }
  
  startMonitoring(): void {
    if (this.monitoring) return;
    
    this.monitoring = true;
    
    const interval = setInterval(() => {
      const usage = process.memoryUsage();
      const heapUsedPercent = usage.heapUsed / usage.heapTotal;
      
      if (heapUsedPercent > this.criticalThreshold) {
        console.error('CRITICAL: Memory usage above 95%', {
          heapUsed: this.formatBytes(usage.heapUsed),
          heapTotal: this.formatBytes(usage.heapTotal),
          percentage: (heapUsedPercent * 100).toFixed(1)
        });
        
        // Force garbage collection if available
        if (global.gc) {
          global.gc();
        }
        
      } else if (heapUsedPercent > this.alertThreshold) {
        console.warn('WARNING: Memory usage above 80%', {
          heapUsed: this.formatBytes(usage.heapUsed),
          heapTotal: this.formatBytes(usage.heapTotal),
          percentage: (heapUsedPercent * 100).toFixed(1)
        });
      }
      
    }, 10000); // Check every 10 seconds
    
    // Stop monitoring on process exit
    process.on('exit', () => {
      clearInterval(interval);
      this.monitoring = false;
    });
  }
  
  private formatBytes(bytes: number): string {
    const sizes = ['B', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 B';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
  }
}
```

---

## JIRA Integration Performance

### Connection Pool Optimization

```typescript
// Optimized JIRA connection pool
class JiraConnectionPool {
  private readonly connections: AxiosInstance[] = [];
  private readonly available: boolean[] = [];
  private readonly maxConnections: number;
  private readonly requestQueue: Array<{
    resolve: (connection: AxiosInstance) => void;
    reject: (error: Error) => void;
  }> = [];
  
  constructor(maxConnections: number = 10) {
    this.maxConnections = maxConnections;
    this.initializePool();
  }
  
  private initializePool(): void {
    for (let i = 0; i < this.maxConnections; i++) {
      const connection = this.createOptimizedConnection();
      this.connections.push(connection);
      this.available.push(true);
    }
  }
  
  private createOptimizedConnection(): AxiosInstance {
    return axios.create({
      baseURL: process.env.JIRA_HOST_URL,
      timeout: 30000,
      
      // Connection optimization
      httpAgent: new http.Agent({
        keepAlive: true,
        maxSockets: 5,
        maxFreeSockets: 2,
        timeout: 30000,
        freeSocketTimeout: 30000
      }),
      
      httpsAgent: new https.Agent({
        keepAlive: true,
        maxSockets: 5,
        maxFreeSockets: 2,
        timeout: 30000,
        freeSocketTimeout: 30000
      }),
      
      // Compression
      decompress: true,
      
      // Auth
      auth: {
        username: process.env.JIRA_USERNAME!,
        password: process.env.JIRA_API_TOKEN!
      },
      
      // Headers optimization
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Connection': 'keep-alive'
      }
    });
  }
  
  async acquire(): Promise<AxiosInstance> {
    // Find available connection
    for (let i = 0; i < this.maxConnections; i++) {
      if (this.available[i]) {
        this.available[i] = false;
        return this.connections[i];
      }
    }
    
    // No available connections, queue the request
    return new Promise((resolve, reject) => {
      this.requestQueue.push({ resolve, reject });
    });
  }
  
  release(connection: AxiosInstance): void {
    const index = this.connections.indexOf(connection);
    if (index !== -1) {
      this.available[index] = true;
      
      // Process queued requests
      if (this.requestQueue.length > 0) {
        const request = this.requestQueue.shift()!;
        this.available[index] = false;
        request.resolve(connection);
      }
    }
  }
}
```

### Batch Operation Optimization

```typescript
// Optimized JIRA batch operations
class OptimizedJiraBatch {
  private readonly connectionPool: JiraConnectionPool;
  private readonly rateLimiter: RateLimiter;
  
  constructor() {
    this.connectionPool = new JiraConnectionPool(15);
    this.rateLimiter = new RateLimiter({
      tokensPerInterval: 100,
      interval: 'minute'
    });
  }
  
  async createIssuesInOptimalBatches(
    issues: IssueData[],
    options: {
      batchSize?: number;
      maxRetries?: number;
      progressCallback?: (completed: number, total: number) => void;
    } = {}
  ): Promise<BatchResult> {
    const batchSize = this.calculateOptimalBatchSize(issues.length);
    const batches = this.createBatches(issues, batchSize);
    
    const results: BatchResult = {
      created: [],
      errors: [],
      timing: {}
    };
    
    let completed = 0;
    
    // Process batches with optimal concurrency
    const concurrency = Math.min(5, batches.length);
    
    for (let i = 0; i < batches.length; i += concurrency) {
      const batchGroup = batches.slice(i, i + concurrency);
      
      const batchPromises = batchGroup.map(async (batch, index) => {
        const batchStartTime = Date.now();
        
        try {
          await this.rateLimiter.removeTokens(batch.length);
          
          const connection = await this.connectionPool.acquire();
          
          try {
            const batchResults = await this.processSingleBatch(
              connection,
              batch,
              options.maxRetries || 3
            );
            
            results.created.push(...batchResults.created);
            results.errors.push(...batchResults.errors);
            
            completed += batch.length;
            options.progressCallback?.(completed, issues.length);
            
            return batchResults;
            
          } finally {
            this.connectionPool.release(connection);
          }
          
        } catch (error) {
          console.error(`Batch ${i + index} failed:`, error);
          
          // Add all items in batch to errors
          batch.forEach(issue => {
            results.errors.push({
              issue,
              error: error.message
            });
          });
        } finally {
          results.timing[`batch_${i + index}`] = Date.now() - batchStartTime;
        }
      });
      
      await Promise.allSettled(batchPromises);
    }
    
    return results;
  }
  
  private calculateOptimalBatchSize(totalIssues: number): number {
    // Dynamic batch sizing based on total issues
    if (totalIssues < 50) return 10;
    if (totalIssues < 200) return 25;
    if (totalIssues < 500) return 50;
    return 75; // Max batch size
  }
}
```

---

## Caching Strategies

### Multi-Level Caching

```typescript
// Advanced caching implementation
class MultiLevelCache {
  private l1Cache: Map<string, CacheEntry>; // Memory cache
  private l2Cache: RedisClient; // Redis cache
  private l3Cache: FileCache; // Disk cache
  
  constructor() {
    this.l1Cache = new Map();
    this.l2Cache = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      maxRetriesPerRequest: 3,
      retryDelayOnFailover: 100,
      lazyConnect: true
    });
    this.l3Cache = new FileCache('./cache');
  }
  
  async get<T>(key: string, options: {
    deserializer?: (data: string) => T;
    skipL1?: boolean;
    skipL2?: boolean;
  } = {}): Promise<T | null> {
    const cacheKey = this.generateCacheKey(key);
    
    // L1: Memory cache (fastest)
    if (!options.skipL1 && this.l1Cache.has(cacheKey)) {
      const entry = this.l1Cache.get(cacheKey)!;
      if (!this.isExpired(entry)) {
        return entry.value as T;
      }
      this.l1Cache.delete(cacheKey);
    }
    
    // L2: Redis cache (fast)
    if (!options.skipL2) {
      try {
        const data = await this.l2Cache.get(cacheKey);
        if (data) {
          const value = options.deserializer ? 
            options.deserializer(data) : JSON.parse(data);
          
          // Populate L1 cache
          this.setL1Cache(cacheKey, value);
          return value;
        }
      } catch (error) {
        console.warn('Redis cache error:', error);
      }
    }
    
    // L3: File cache (slower but persistent)
    try {
      const data = await this.l3Cache.get(cacheKey);
      if (data) {
        const value = options.deserializer ? 
          options.deserializer(data) : JSON.parse(data);
        
        // Populate higher-level caches
        this.setL1Cache(cacheKey, value);
        await this.setL2Cache(cacheKey, value);
        
        return value;
      }
    } catch (error) {
      console.warn('File cache error:', error);
    }
    
    return null;
  }
  
  async set<T>(
    key: string, 
    value: T, 
    options: {
      ttl?: number;
      serializer?: (data: T) => string;
      skipL1?: boolean;
      skipL2?: boolean;
      skipL3?: boolean;
    } = {}
  ): Promise<void> {
    const cacheKey = this.generateCacheKey(key);
    const ttl = options.ttl || 3600; // 1 hour default
    const serializedValue = options.serializer ? 
      options.serializer(value) : JSON.stringify(value);
    
    // Set in all cache levels
    const promises: Promise<any>[] = [];
    
    if (!options.skipL1) {
      this.setL1Cache(cacheKey, value, ttl);
    }
    
    if (!options.skipL2) {
      promises.push(this.setL2Cache(cacheKey, serializedValue, ttl));
    }
    
    if (!options.skipL3) {
      promises.push(this.l3Cache.set(cacheKey, serializedValue, ttl));
    }
    
    await Promise.allSettled(promises);
  }
}
```

### Intelligent Cache Warming

```typescript
// Cache warming strategies
class CacheWarmer {
  private readonly cache: MultiLevelCache;
  private readonly warmingStrategies: Map<string, WarmingStrategy> = new Map();
  
  constructor(cache: MultiLevelCache) {
    this.cache = cache;
    this.setupWarmingStrategies();
  }
  
  private setupWarmingStrategies(): void {
    // Warm frequently accessed project data
    this.warmingStrategies.set('projects', {
      pattern: 'project:*',
      refreshInterval: 300000, // 5 minutes
      preloader: this.warmProjectData.bind(this)
    });
    
    // Warm decomposition patterns
    this.warmingStrategies.set('patterns', {
      pattern: 'pattern:*',
      refreshInterval: 600000, // 10 minutes
      preloader: this.warmPatternData.bind(this)
    });
    
    // Warm JIRA metadata
    this.warmingStrategies.set('jira-meta', {
      pattern: 'jira:meta:*',
      refreshInterval: 900000, // 15 minutes
      preloader: this.warmJiraMetadata.bind(this)
    });
  }
  
  async warmCache(): Promise<void> {
    console.log('Starting cache warming...');
    
    const warmingPromises = Array.from(this.warmingStrategies.entries())
      .map(async ([name, strategy]) => {
        try {
          const startTime = Date.now();
          await strategy.preloader();
          const duration = Date.now() - startTime;
          console.log(`Warmed ${name} cache in ${duration}ms`);
        } catch (error) {
          console.error(`Failed to warm ${name} cache:`, error);
        }
      });
    
    await Promise.allSettled(warmingPromises);
    console.log('Cache warming completed');
  }
  
  private async warmProjectData(): Promise<void> {
    // Pre-load commonly accessed project configurations
    const commonProjects = ['ECOM', 'DASH', 'API', 'MOBILE'];
    
    await Promise.all(
      commonProjects.map(async (projectKey) => {
        const projectConfig = await this.loadProjectConfig(projectKey);
        if (projectConfig) {
          await this.cache.set(`project:${projectKey}`, projectConfig, {
            ttl: 600 // 10 minutes
          });
        }
      })
    );
  }
}
```

---

## Database Optimization

### Connection Pool Tuning

```typescript
// Optimized database connection pool
class DatabaseOptimizer {
  private pool: Pool;
  
  constructor() {
    this.pool = this.createOptimizedPool();
    this.setupMonitoring();
  }
  
  private createOptimizedPool(): Pool {
    const cpuCount = require('os').cpus().length;
    
    return new Pool({
      // Connection limits
      min: Math.max(2, Math.floor(cpuCount * 0.5)),
      max: Math.min(25, cpuCount * 4),
      
      // Timing settings
      acquireTimeoutMs: 30000,
      createTimeoutMs: 30000,
      destroyTimeoutMs: 5000,
      idleTimeoutMs: 300000,
      reapIntervalMs: 1000,
      
      // Retry settings
      createRetryIntervalMs: 200,
      
      // Connection validation
      validate: (connection) => {
        return connection.query('SELECT 1').then(() => true).catch(() => false);
      },
      
      // Pool events
      log: (message, logLevel) => {
        if (logLevel === 'error') {
          console.error('Database pool error:', message);
        }
      }
    });
  }
  
  private setupMonitoring(): void {
    setInterval(() => {
      const stats = {
        size: this.pool.numUsed() + this.pool.numFree(),
        used: this.pool.numUsed(),
        free: this.pool.numFree(),
        pendingAcquires: this.pool.numPendingAcquires(),
        pendingCreates: this.pool.numPendingCreates()
      };
      
      // Log warnings for pool issues
      if (stats.pendingAcquires > 5) {
        console.warn('High pending acquires:', stats.pendingAcquires);
      }
      
      if (stats.free === 0 && stats.used === stats.size) {
        console.warn('Connection pool exhausted');
      }
      
    }, 30000); // Check every 30 seconds
  }
}
```

---

## Network & I/O Optimization

### Request Optimization

```typescript
// Optimized HTTP client
class OptimizedHttpClient {
  private readonly client: AxiosInstance;
  private readonly compressionEnabled: boolean = true;
  
  constructor() {
    this.client = this.createOptimizedClient();
  }
  
  private createOptimizedClient(): AxiosInstance {
    const client = axios.create({
      // Connection optimization
      httpAgent: new http.Agent({
        keepAlive: true,
        maxSockets: 50,
        maxFreeSockets: 10,
        timeout: 30000,
        freeSocketTimeout: 30000
      }),
      
      httpsAgent: new https.Agent({
        keepAlive: true,
        maxSockets: 50,
        maxFreeSockets: 10,
        timeout: 30000,
        freeSocketTimeout: 30000
      }),
      
      // Request optimization
      timeout: 30000,
      maxRedirects: 3,
      
      // Compression
      decompress: true,
      
      // Headers
      headers: {
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'User-Agent': 'CAIA-Hierarchical-Agent/1.0'
      }
    });
    
    // Request interceptor for compression
    client.interceptors.request.use((config) => {
      if (this.compressionEnabled && config.data) {
        const dataSize = JSON.stringify(config.data).length;
        if (dataSize > 1024) { // Compress if > 1KB
          config.headers['Content-Encoding'] = 'gzip';
          config.data = zlib.gzipSync(Buffer.from(JSON.stringify(config.data)));
        }
      }
      return config;
    });
    
    return client;
  }
}
```

---

## Monitoring & Profiling

### Performance Monitoring

```typescript
// Comprehensive performance monitor
class PerformanceMonitor {
  private metrics: Map<string, PerformanceMetric> = new Map();
  private startTimes: Map<string, number> = new Map();
  
  startTimer(operation: string): void {
    this.startTimes.set(operation, Date.now());
  }
  
  endTimer(operation: string): number {
    const startTime = this.startTimes.get(operation);
    if (!startTime) {
      console.warn(`No start time found for operation: ${operation}`);
      return 0;
    }
    
    const duration = Date.now() - startTime;
    this.recordMetric(operation, duration);
    this.startTimes.delete(operation);
    
    return duration;
  }
  
  private recordMetric(operation: string, duration: number): void {
    const existing = this.metrics.get(operation);
    
    if (existing) {
      existing.count++;
      existing.totalTime += duration;
      existing.averageTime = existing.totalTime / existing.count;
      existing.minTime = Math.min(existing.minTime, duration);
      existing.maxTime = Math.max(existing.maxTime, duration);
    } else {
      this.metrics.set(operation, {
        count: 1,
        totalTime: duration,
        averageTime: duration,
        minTime: duration,
        maxTime: duration,
        operation
      });
    }
  }
  
  generateReport(): PerformanceReport {
    const operations = Array.from(this.metrics.values())
      .sort((a, b) => b.totalTime - a.totalTime);
    
    return {
      timestamp: new Date().toISOString(),
      totalOperations: operations.reduce((sum, op) => sum + op.count, 0),
      operations,
      summary: {
        slowestOperation: operations[0],
        fastestOperation: operations[operations.length - 1],
        totalTime: operations.reduce((sum, op) => sum + op.totalTime, 0)
      }
    };
  }
}
```

---

This comprehensive performance tuning guide provides the tools and strategies needed to optimize the Hierarchical Agent System for maximum performance across all deployment scenarios, from development to enterprise production environments.