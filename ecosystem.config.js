module.exports = {
  apps: [
    {
      // Main Application
      name: 'caia-main',
      script: './dist/index.js',
      instances: 'max',
      exec_mode: 'cluster',
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'development'
      },
      env_production: {
        NODE_ENV: 'production'
      },
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      log_file: './logs/pm2-combined.log',
      time: true,
      // Graceful shutdown
      kill_timeout: 5000,
      listen_timeout: 3000,
      // Auto restart
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      // Monitoring
      monitoring: true,
      merge_logs: true
    },
    {
      // Knowledge Graph Service
      name: 'caia-knowledge-graph',
      script: './dist/knowledge-system/knowledge_graph/api/server.js',
      instances: 2,
      exec_mode: 'cluster',
      watch: false,
      env_production: {
        NODE_ENV: 'production',
        PORT: 3001
      }
    },
    {
      // Learning System Service
      name: 'caia-learning',
      script: './dist/knowledge-system/learning/api/server.js',
      instances: 2,
      exec_mode: 'cluster',
      watch: false,
      env_production: {
        NODE_ENV: 'production',
        PORT: 3002
      }
    },
    {
      // Agent Bridge Service
      name: 'caia-agents',
      script: './dist/packages/integrations/agents/api/server.js',
      instances: 2,
      exec_mode: 'cluster',
      watch: false,
      env_production: {
        NODE_ENV: 'production',
        PORT: 3003
      }
    },
    {
      // Job Queue Worker
      name: 'caia-worker',
      script: './dist/workers/queue-processor.js',
      instances: 4,
      exec_mode: 'cluster',
      watch: false,
      env_production: {
        NODE_ENV: 'production',
        WORKER_TYPE: 'queue'
      }
    },
    {
      // Metrics Collector
      name: 'caia-metrics',
      script: './dist/monitoring/metrics-server.js',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      env_production: {
        NODE_ENV: 'production',
        PORT: 9090
      }
    }
  ],

  // Deployment configuration
  deploy: {
    production: {
      user: 'deploy',
      host: 'your-server.com',
      ref: 'origin/main',
      repo: 'git@github.com:your-username/caia.git',
      path: '/var/www/caia',
      'pre-deploy-local': '',
      'post-deploy': 'npm install && npm run build && pm2 reload ecosystem.config.js --env production',
      'pre-setup': '',
      'ssh_options': 'StrictHostKeyChecking=no',
      env: {
        NODE_ENV: 'production'
      }
    },
    staging: {
      user: 'deploy',
      host: 'staging.your-server.com',
      ref: 'origin/develop',
      repo: 'git@github.com:your-username/caia.git',
      path: '/var/www/caia-staging',
      'post-deploy': 'npm install && npm run build && pm2 reload ecosystem.config.js --env staging',
      env: {
        NODE_ENV: 'staging'
      }
    }
  }
};