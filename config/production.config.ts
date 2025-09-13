
export const productionConfig = {
  // Database Configuration
  database: {
    postgres: {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME || 'caia_production',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD,
      ssl: process.env.DB_SSL === 'true',
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000
    },
    neo4j: {
      uri: process.env.NEO4J_URI || 'bolt://localhost:7687',
      user: process.env.NEO4J_USER || 'neo4j',
      password: process.env.NEO4J_PASSWORD,
      encrypted: process.env.NEO4J_ENCRYPTED === 'true',
      maxConnectionPoolSize: 50,
      connectionAcquisitionTimeout: 60000
    },
    redis: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      db: parseInt(process.env.REDIS_DB || '0'),
      keyPrefix: 'caia:',
      enableOfflineQueue: true,
      maxRetriesPerRequest: 3
    }
  },

  // API Configuration
  api: {
    port: parseInt(process.env.API_PORT || '3000'),
    host: process.env.API_HOST || '0.0.0.0',
    cors: {
      origin: process.env.CORS_ORIGIN?.split(',') || ['*'],
      credentials: true
    },
    rateLimit: {
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: parseInt(process.env.RATE_LIMIT || '100')
    },
    timeout: parseInt(process.env.API_TIMEOUT || '30000'),
    bodyLimit: process.env.BODY_LIMIT || '10mb'
  },

  // ML/AI Configuration
  ml: {
    modelsPath: process.env.MODELS_PATH || './models',
    tensorflowBackend: process.env.TF_BACKEND || 'tensorflow',
    batchSize: parseInt(process.env.ML_BATCH_SIZE || '32'),
    maxSequenceLength: parseInt(process.env.MAX_SEQUENCE_LENGTH || '512'),
    embeddingDimension: parseInt(process.env.EMBEDDING_DIM || '768'),
    transformerModel: process.env.TRANSFORMER_MODEL || 'bert-base-uncased'
  },

  // Performance Configuration
  performance: {
    enableCaching: process.env.ENABLE_CACHE !== 'false',
    cacheTTL: parseInt(process.env.CACHE_TTL || '3600'),
    enableCompression: process.env.ENABLE_COMPRESSION !== 'false',
    workerThreads: parseInt(process.env.WORKER_THREADS || '4'),
    maxConcurrency: parseInt(process.env.MAX_CONCURRENCY || '10'),
    queueConcurrency: parseInt(process.env.QUEUE_CONCURRENCY || '5')
  },

  // Security Configuration
  security: {
    jwtSecret: process.env.JWT_SECRET || 'change-this-secret',
    jwtExpiry: process.env.JWT_EXPIRY || '7d',
    bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS || '10'),
    encryptionKey: process.env.ENCRYPTION_KEY,
    enableHelmet: process.env.ENABLE_HELMET !== 'false',
    enableCSRF: process.env.ENABLE_CSRF === 'true'
  },

  // Monitoring Configuration
  monitoring: {
    enableMetrics: process.env.ENABLE_METRICS !== 'false',
    metricsPort: parseInt(process.env.METRICS_PORT || '9090'),
    enableTracing: process.env.ENABLE_TRACING === 'true',
    tracingEndpoint: process.env.TRACING_ENDPOINT,
    logLevel: process.env.LOG_LEVEL || 'info',
    enableSentry: process.env.SENTRY_DSN ? true : false,
    sentryDSN: process.env.SENTRY_DSN
  },

  // Feature Flags
  features: {
    enableKnowledgeGraph: process.env.FEATURE_KNOWLEDGE_GRAPH !== 'false',
    enableLearningSystem: process.env.FEATURE_LEARNING !== 'false',
    enableAgentBridges: process.env.FEATURE_AGENTS !== 'false',
    enableAutoScaling: process.env.FEATURE_AUTOSCALE === 'true',
    enableExperimentalFeatures: process.env.FEATURE_EXPERIMENTAL === 'true'
  }
};

// Environment-specific overrides
const env = process.env.NODE_ENV || 'development';

const envConfigs = {
  development: {
    database: {
      postgres: { database: 'caia_dev' }
    },
    api: {
      cors: { origin: ['http://localhost:3000', 'http://localhost:3001'] }
    },
    security: {
      enableCSRF: false
    }
  },
  test: {
    database: {
      postgres: { database: 'caia_test' }
    },
    performance: {
      enableCaching: false
    }
  },
  production: {
    security: {
      enableCSRF: true,
      enableHelmet: true
    },
    performance: {
      enableCaching: true,
      enableCompression: true
    }
  }
};

// Merge environment-specific config
export const config = {
  ...productionConfig,
  ...envConfigs[env]
};

// Validation
export function validateConfig() {
  const required = [
    'database.postgres.password',
    'database.neo4j.password',
    'security.jwtSecret',
    'security.encryptionKey'
  ];

  const missing = [];

  for (const path of required) {
    const value = path.split('.').reduce((obj, key) => obj?.[key], config);
    if (!value || value === 'change-this-secret') {
      missing.push(path);
    }
  }

  if (missing.length > 0) {
    console.warn('Missing required configuration:', missing);
  }

  return missing.length === 0;
}
