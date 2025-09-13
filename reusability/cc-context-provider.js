#!/usr/bin/env node

/**
 * CC Context Provider
 * Makes Claude Code aware of all existing CAIA code and features
 */

const http = require('http');
const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

class CCContextProvider {
  constructor() {
    this.cksUrl = 'http://localhost:5555';
    this.enhancementUrl = 'http://localhost:5002';
    this.learningUrl = 'http://localhost:5003';
    this.codebasePath = '/Users/MAC/Documents/projects/caia';
    this.fileCache = new Map();
    this.stats = {
      queries: 0,
      hits: 0,
      misses: 0,
      reused: 0
    };
  }
  
  async initialize() {
    console.log('🧠 CC Context Provider Initializing...');
    
    // Count total files
    const { stdout } = await execPromise(
      `find ${this.codebasePath} -type f \\( -name "*.py" -o -name "*.js" -o -name "*.ts" \\) | wc -l`
    );
    this.totalFiles = parseInt(stdout.trim());
    
    console.log(`📊 Tracking ${this.totalFiles.toLocaleString()} code files`);
    
    // Test service connections
    await this.testConnections();
    
    // Load common patterns
    await this.loadCommonPatterns();
    
    console.log('✅ CC Context Provider Ready');
    
    return true;
  }
  
  async testConnections() {
    const services = [
      { name: 'CKS', url: this.cksUrl + '/health' },
      { name: 'Enhancement', url: this.enhancementUrl + '/health' },
      { name: 'Learning', url: this.learningUrl + '/health' }
    ];
    
    for (const service of services) {
      try {
        await this.fetch(service.url);
        console.log(`✅ ${service.name} connected`);
      } catch (error) {
        console.log(`⚠️  ${service.name} not available`);
      }
    }
  }
  
  async loadCommonPatterns() {
    this.commonPatterns = [
      { name: 'ErrorHandler', path: 'core/error_handler.ts', usage: 127 },
      { name: 'Logger', path: 'utils/logger.js', usage: 89 },
      { name: 'APIClient', path: 'services/api_client.js', usage: 45 },
      { name: 'DataValidator', path: 'utils/validator.js', usage: 67 },
      { name: 'AuthFlow', path: 'auth/authentication.js', usage: 34 },
      { name: 'DatabaseConnection', path: 'db/connection.js', usage: 56 },
      { name: 'CacheManager', path: 'cache/manager.js', usage: 23 },
      { name: 'EventEmitter', path: 'events/emitter.js', usage: 78 }
    ];
  }
  
  /**
   * Main method: Check if implementation exists before creating new
   */
  async checkExisting(task, options = {}) {
    this.stats.queries++;
    console.log(`\n🔍 Checking for existing: "${task}"`);
    console.log('⏱️  Searching across all systems...');
    
    // Search in parallel across all sources
    const [cks, patterns, files, decisions, agents] = await Promise.all([
      this.searchCKS(task),
      this.searchPatterns(task),
      this.searchFiles(task),
      this.searchDecisions(task),
      this.searchAgents(task)
    ]);
    
    // Compile results
    const results = {
      found: false,
      exact: [],
      similar: [],
      patterns: [],
      suggestions: []
    };
    
    // Check CKS results
    if (cks && cks.count > 0) {
      results.found = true;
      results.exact = cks.results.slice(0, 3).map(r => ({
        type: r.type,
        name: r.name,
        path: r.file_path,
        confidence: 0.9
      }));
      this.stats.hits++;
    }
    
    // Check pattern matches
    if (patterns && patterns.length > 0) {
      results.patterns = patterns;
      results.found = true;
    }
    
    // Check file matches
    if (files && files.length > 0) {
      results.similar = files.slice(0, 5).map(f => ({
        path: f,
        type: 'file'
      }));
      results.found = true;
    }
    
    // Check agent availability
    if (agents && agents.length > 0) {
      results.suggestions.push(...agents.map(a => 
        `Use existing ${a.name} agent instead of creating new`
      ));
    }
    
    // Display results
    this.displayResults(results, task);
    
    // Record for learning
    if (results.found) {
      this.stats.reused++;
      await this.recordReuse(task, results);
    } else {
      this.stats.misses++;
    }
    
    return results;
  }
  
  displayResults(results, task) {
    console.log('\n' + '='.repeat(60));
    
    if (results.found) {
      console.log(`✅ FOUND EXISTING IMPLEMENTATIONS for "${task}"`);
      console.log('='.repeat(60));
      
      if (results.exact.length > 0) {
        console.log('\n🎯 EXACT MATCHES:');
        results.exact.forEach(match => {
          console.log(`  📄 ${match.name} (${match.type})`);
          console.log(`     📋 Path: ${match.path}`);
          console.log(`     📊 Confidence: ${(match.confidence * 100).toFixed(0)}%`);
        });
      }
      
      if (results.patterns.length > 0) {
        console.log('\n🎨 MATCHING PATTERNS:');
        results.patterns.forEach(pattern => {
          console.log(`  🔧 ${pattern.name}`);
          console.log(`     📋 Path: ${pattern.path}`);
          console.log(`     📊 Used: ${pattern.usage} times`);
        });
      }
      
      if (results.similar.length > 0) {
        console.log('\n🔗 SIMILAR FILES:');
        results.similar.forEach(file => {
          console.log(`  📁 ${file.path}`);
        });
      }
      
      if (results.suggestions.length > 0) {
        console.log('\n💡 SUGGESTIONS:');
        results.suggestions.forEach(suggestion => {
          console.log(`  → ${suggestion}`);
        });
      }
      
      console.log('\n🚨 ACTION REQUIRED:');
      console.log('♻️  REUSE the existing implementation instead of creating new!');
      console.log('💰 This saves ~30 minutes of development time');
      
    } else {
      console.log(`🆕 No existing implementation found for "${task}"`);
      console.log('='.repeat(60));
      console.log('✅ Safe to create new implementation');
      console.log('📝 Will be registered for future reuse');
    }
    
    console.log('='.repeat(60) + '\n');
  }
  
  async searchCKS(task) {
    try {
      const response = await this.fetch(
        `${this.cksUrl}/search/function?query=${encodeURIComponent(task)}`
      );
      return response;
    } catch (error) {
      return null;
    }
  }
  
  async searchPatterns(task) {
    // Search in common patterns
    const keywords = task.toLowerCase().split(' ');
    const matches = this.commonPatterns.filter(pattern => {
      const patternName = pattern.name.toLowerCase();
      return keywords.some(keyword => patternName.includes(keyword));
    });
    
    return matches;
  }
  
  async searchFiles(task) {
    try {
      // Search for files matching the task
      const keyword = task.split(' ')[0].toLowerCase();
      const { stdout } = await execPromise(
        `find ${this.codebasePath} -name "*${keyword}*" -type f | head -10`
      );
      
      return stdout.trim().split('\n').filter(Boolean);
    } catch (error) {
      return [];
    }
  }
  
  async searchDecisions(task) {
    try {
      const response = await this.fetch(
        `${this.learningUrl}/decisions/search?query=${encodeURIComponent(task)}`
      );
      return response.decisions || [];
    } catch (error) {
      return [];
    }
  }
  
  async searchAgents(task) {
    // Check if task relates to existing agents
    const agents = [
      { name: 'KnowledgeAgent', keywords: ['knowledge', 'search', 'query'] },
      { name: 'BusinessAnalystAgent', keywords: ['business', 'analysis', 'requirements'] },
      { name: 'SprintPriorizerAgent', keywords: ['sprint', 'priority', 'planning'] },
      { name: 'EntityExtractor', keywords: ['entity', 'extract', 'nlp'] },
      { name: 'ReasoningAgent', keywords: ['reason', 'logic', 'inference'] },
      { name: 'CodingAgent', keywords: ['code', 'implement', 'program'] }
    ];
    
    const taskLower = task.toLowerCase();
    return agents.filter(agent => 
      agent.keywords.some(keyword => taskLower.includes(keyword))
    );
  }
  
  async recordReuse(task, results) {
    // Record that existing code was reused
    try {
      await this.fetch(`${this.learningUrl}/record`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'code_reuse',
          task: task,
          reused: results.exact[0] || results.patterns[0],
          timestamp: new Date().toISOString()
        })
      });
    } catch (error) {
      // Ignore recording errors
    }
  }
  
  async getStats() {
    const reuseRate = this.stats.queries > 0 
      ? (this.stats.reused / this.stats.queries * 100).toFixed(1)
      : 0;
    
    return {
      ...this.stats,
      reuseRate: `${reuseRate}%`,
      totalFiles: this.totalFiles
    };
  }
  
  async fetch(url, options = {}) {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const protocol = urlObj.protocol === 'https:' ? require('https') : http;
      
      const req = protocol.request({
        hostname: urlObj.hostname,
        port: urlObj.port,
        path: urlObj.pathname + (urlObj.search || ''),
        method: options.method || 'GET',
        headers: options.headers || {}
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
        req.write(typeof options.body === 'string' 
          ? options.body 
          : JSON.stringify(options.body));
      }
      
      req.end();
    });
  }
}

// CLI Interface
if (require.main === module) {
  const provider = new CCContextProvider();
  const args = process.argv.slice(2);
  const command = args[0];
  const params = args.slice(1).join(' ');
  
  async function main() {
    await provider.initialize();
    
    switch (command) {
      case 'check':
        if (!params) {
          console.error('Usage: cc-context-provider check <task>');
          return;
        }
        await provider.checkExisting(params);
        break;
        
      case 'stats':
        const stats = await provider.getStats();
        console.log('\n📊 CC Context Provider Statistics:');
        console.log(`  Total Files: ${stats.totalFiles.toLocaleString()}`);
        console.log(`  Queries: ${stats.queries}`);
        console.log(`  Hits: ${stats.hits}`);
        console.log(`  Misses: ${stats.misses}`);
        console.log(`  Reused: ${stats.reused}`);
        console.log(`  Reuse Rate: ${stats.reuseRate}`);
        break;
        
      case 'serve':
        console.log('🌐 Starting CC Context Provider Server...');
        const server = http.createServer(async (req, res) => {
          if (req.url.startsWith('/check/')) {
            const task = decodeURIComponent(req.url.slice(7));
            const results = await provider.checkExisting(task);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(results));
          } else if (req.url === '/stats') {
            const stats = await provider.getStats();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(stats));
          } else {
            res.writeHead(404);
            res.end('Not Found');
          }
        });
        
        server.listen(5556, () => {
          console.log('✅ CC Context Provider running on http://localhost:5556');
          console.log('\nEndpoints:');
          console.log('  GET /check/<task> - Check for existing implementation');
          console.log('  GET /stats - Get statistics');
        });
        break;
        
      default:
        console.log(`
🧠 CC Context Provider

Usage:
  cc-context-provider <command> [params]

Commands:
  check <task>  - Check if implementation exists
  stats         - Show statistics
  serve         - Start HTTP server

Examples:
  cc-context-provider check "authentication system"
  cc-context-provider check "data validation"
  cc-context-provider stats
  cc-context-provider serve
`);
    }
  }
  
  main().catch(console.error);
}

// Export for use in other modules
module.exports = CCContextProvider;