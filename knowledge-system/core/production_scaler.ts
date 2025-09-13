
import cluster from 'cluster';
import os from 'os';
import { Redis } from 'ioredis';
import Bull from 'bull';
import { Pool } from 'pg';

export class ProductionScaler {
  private redis: Redis;
  private jobQueues: Map<string, Bull.Queue>;
  private connectionPools: Map<string, any>;
  private caches: Map<string, any>;
  private readonly CACHE_TTL = 3600; // 1 hour

  constructor() {
    this.jobQueues = new Map();
    this.connectionPools = new Map();
    this.caches = new Map();
    this.initializeRedis();
    this.initializeQueues();
    this.initializeConnectionPools();
  }

  private initializeRedis() {
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      reconnectOnError: (err) => {
        const targetError = 'READONLY';
        if (err.message.includes(targetError)) {
          return true;
        }
        return false;
      }
    });

    this.redis.on('error', (error) => {
      console.error('Redis error:', error);
    });
  }

  private initializeQueues() {
    // Create job queues for different tasks
    const queueConfigs = [
      { name: 'entity-extraction', concurrency: 10 },
      { name: 'inference', concurrency: 5 },
      { name: 'training', concurrency: 2 },
      { name: 'analysis', concurrency: 8 }
    ];

    for (const config of queueConfigs) {
      const queue = new Bull(config.name, {
        redis: {
          host: process.env.REDIS_HOST || 'localhost',
          port: parseInt(process.env.REDIS_PORT || '6379'),
          password: process.env.REDIS_PASSWORD
        },
        defaultJobOptions: {
          removeOnComplete: true,
          removeOnFail: false,
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000
          }
        }
      });

      // Process jobs
      queue.process(config.concurrency, async (job) => {
        return await this.processJob(config.name, job.data);
      });

      this.jobQueues.set(config.name, queue);
    }
  }

  private initializeConnectionPools() {
    // PostgreSQL connection pool
    this.connectionPools.set('postgres', new Pool({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME || 'caia',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD,
      max: 20, // Maximum number of clients
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
      statement_timeout: 30000,
      query_timeout: 30000
    }));

    // Neo4j connection pool is handled by the driver
  }

  public async scaleApplication() {
    if (cluster.isMaster) {
      const numCPUs = os.cpus().length;
      console.log(`Master ${process.pid} setting up ${numCPUs} workers`);

      // Fork workers
      for (let i = 0; i < numCPUs; i++) {
        cluster.fork();
      }

      cluster.on('exit', (worker, code, signal) => {
        console.log(`Worker ${worker.process.pid} died`);
        // Restart worker
        cluster.fork();
      });

      // Load balancing strategy
      this.setupLoadBalancing();

      // Monitor workers
      this.monitorWorkers();

    } else {
      // Worker process
      await this.startWorker();
    }
  }

  private async startWorker() {
    console.log(`Worker ${process.pid} started`);

    // Worker-specific initialization
    await this.initializeWorkerServices();

    // Handle graceful shutdown
    process.on('SIGTERM', async () => {
      await this.gracefulShutdown();
    });
  }

  private setupLoadBalancing() {
    // Implement custom load balancing if needed
    cluster.schedulingPolicy = cluster.SCHED_RR; // Round-robin
  }

  private monitorWorkers() {
    setInterval(() => {
      const workers = Object.values(cluster.workers || {});
      const stats = {
        total: workers.length,
        alive: workers.filter(w => !w.isDead()).length,
        memory: process.memoryUsage(),
        uptime: process.uptime()
      };

      // Send stats to monitoring service
      this.sendMonitoringData(stats);
    }, 30000); // Every 30 seconds
  }

  public async cacheResult(key: string, value: any, ttl: number = this.CACHE_TTL) {
    try {
      await this.redis.setex(key, ttl, JSON.stringify(value));
    } catch (error) {
      console.error('Cache write error:', error);
    }
  }

  public async getCached(key: string): Promise<any | null> {
    try {
      const cached = await this.redis.get(key);
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      console.error('Cache read error:', error);
      return null;
    }
  }

  public async batchProcess<T, R>(
    items: T[],
    processor: (batch: T[]) => Promise<R[]>,
    batchSize: number = 100
  ): Promise<R[]> {
    const results: R[] = [];

    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const batchResults = await processor(batch);
      results.push(...batchResults);

      // Add small delay to prevent overwhelming the system
      if (i + batchSize < items.length) {
        await this.delay(10);
      }
    }

    return results;
  }

  public async parallelProcess<T, R>(
    items: T[],
    processor: (item: T) => Promise<R>,
    maxConcurrency: number = 10
  ): Promise<R[]> {
    const results: R[] = [];
    const executing: Promise<void>[] = [];

    for (const item of items) {
      const promise = processor(item).then(result => {
        results.push(result);
      });

      executing.push(promise);

      if (executing.length >= maxConcurrency) {
        await Promise.race(executing);
        executing.splice(executing.findIndex(p => p), 1);
      }
    }

    await Promise.all(executing);
    return results;
  }

  public streamProcess<T>(
    stream: NodeJS.ReadableStream,
    processor: (chunk: T) => Promise<void>,
    options: {
      highWaterMark?: number;
      concurrency?: number;
    } = {}
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const { highWaterMark = 16, concurrency = 5 } = options;
      let processing = 0;
      let ended = false;

      stream.on('data', async (chunk: T) => {
        processing++;

        if (processing >= concurrency) {
          stream.pause();
        }

        try {
          await processor(chunk);
        } catch (error) {
          reject(error);
        } finally {
          processing--;

          if (processing < concurrency && !ended) {
            stream.resume();
          }

          if (processing === 0 && ended) {
            resolve();
          }
        }
      });

      stream.on('end', () => {
        ended = true;
        if (processing === 0) {
          resolve();
        }
      });

      stream.on('error', reject);
    });
  }

  public async addJob(queueName: string, data: any, options?: Bull.JobOptions) {
    const queue = this.jobQueues.get(queueName);

    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }

    return await queue.add(data, options);
  }

  private async processJob(queueName: string, data: any): Promise<any> {
    // Route to appropriate processor
    const processors = {
      'entity-extraction': this.processEntityExtraction,
      'inference': this.processInference,
      'training': this.processTraining,
      'analysis': this.processAnalysis
    };

    const processor = processors[queueName];

    if (!processor) {
      throw new Error(`No processor for queue ${queueName}`);
    }

    return await processor.call(this, data);
  }

  private async processEntityExtraction(data: any) {
    // Entity extraction logic
    return { entities: [] };
  }

  private async processInference(data: any) {
    // Inference logic
    return { inferences: [] };
  }

  private async processTraining(data: any) {
    // Training logic
    return { model: 'trained' };
  }

  private async processAnalysis(data: any) {
    // Analysis logic
    return { results: [] };
  }

  public async optimizeQuery(query: string): Promise<string> {
    // Query optimization logic
    const optimized = query
      .replace(/SELECT \*/g, 'SELECT specific_columns')
      .replace(/OR/g, 'UNION')
      .trim();

    // Add query plan caching
    const cacheKey = `query:${this.hashQuery(query)}`;
    await this.cacheResult(cacheKey, optimized, 7200);

    return optimized;
  }

  private hashQuery(query: string): string {
    const crypto = require('crypto');
    return crypto.createHash('md5').update(query).digest('hex');
  }

  public getConnectionPool(name: string): any {
    return this.connectionPools.get(name);
  }

  private async initializeWorkerServices() {
    // Initialize services specific to worker
    console.log(`Worker ${process.pid} services initialized`);
  }

  private async gracefulShutdown() {
    console.log(`Worker ${process.pid} shutting down gracefully`);

    // Close connections
    for (const [name, pool] of this.connectionPools) {
      await pool.end();
    }

    // Close Redis
    await this.redis.quit();

    // Close job queues
    for (const [name, queue] of this.jobQueues) {
      await queue.close();
    }

    process.exit(0);
  }

  private sendMonitoringData(stats: any) {
    // Send to monitoring service (Prometheus, DataDog, etc.)
    console.log('Monitoring stats:', stats);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Export singleton
export const scaler = new ProductionScaler();
