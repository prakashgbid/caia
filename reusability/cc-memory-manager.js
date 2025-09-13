#!/usr/bin/env node

/**
 * CC Memory Manager
 * Maintains persistent memory across CC sessions
 */

const fs = require('fs').promises;
const path = require('path');
const http = require('http');

class CCMemoryManager {
  constructor() {
    this.memoryPath = path.join(process.env.HOME, '.claude/session-memory');
    this.contextPath = path.join(process.env.HOME, '.claude/context');
    this.currentSession = null;
    this.contextCache = null;
    this.reuseTracking = {
      total: 0,
      reused: 0,
      created: 0,
      savedTime: 0 // in minutes
    };
  }
  
  async initialize() {
    console.log('🧠 CC Memory Manager Initializing...');
    
    // Create directories
    await fs.mkdir(this.memoryPath, { recursive: true });
    await fs.mkdir(this.contextPath, { recursive: true });
    
    // Load context
    await this.loadContext();
    
    // Load previous sessions
    await this.loadSessionHistory();
    
    console.log('✅ CC Memory Manager Ready');
    
    return true;
  }
  
  async startSession() {
    this.currentSession = {
      id: `session_${Date.now()}`,
      started: new Date().toISOString(),
      context: await this.gatherFullContext(),
      interactions: [],
      reusedComponents: [],
      newComponents: [],
      decisions: [],
      learnings: []
    };
    
    console.log('\n' + '='.repeat(60));
    console.log('📝 CC SESSION STARTED: ' + this.currentSession.id);
    console.log('='.repeat(60));
    console.log('📊 Context Loaded:');
    console.log(`  📁 Total Files: ${this.currentSession.context.totalFiles.toLocaleString()}`);
    console.log(`  🤖 Available Agents: ${this.currentSession.context.agents.length}`);
    console.log(`  🎨 Common Patterns: ${this.currentSession.context.patterns.length}`);
    console.log(`  🔧 Utilities: ${this.currentSession.context.utilities.length}`);
    console.log(`  📚 Past Sessions: ${this.sessionHistory.length}`);
    console.log('='.repeat(60) + '\n');
    
    // Save session start
    await this.saveSession();
    
    return this.currentSession;
  }
  
  async gatherFullContext() {
    const context = {
      totalFiles: 74270, // Known count
      services: {
        cks: { url: 'http://localhost:5555', status: await this.checkService('http://localhost:5555/health') },
        enhancement: { url: 'http://localhost:5002', status: await this.checkService('http://localhost:5002/health') },
        learning: { url: 'http://localhost:5003', status: await this.checkService('http://localhost:5003/health') }
      },
      agents: [
        'KnowledgeAgent',
        'BusinessAnalystAgent',
        'SprintPriorizerAgent',
        'EntityExtractor',
        'ReasoningAgent',
        'CodingAgent',
        'IntegrationAgent',
        'TestWriterFixerAgent'
      ],
      patterns: [
        'ErrorHandler',
        'Logger',
        'APIClient',
        'DataValidator',
        'AuthFlow',
        'CacheManager',
        'EventEmitter',
        'StateManager'
      ],
      utilities: [
        'parallel-implementation.js',
        'production-upgrade.js',
        'bridge-service.js',
        'shared-components.js',
        'cc-context-provider.js',
        'cc-memory-manager.js'
      ],
      recentWork: await this.getRecentWork(),
      statistics: await this.getStatistics()
    };
    
    return context;
  }
  
  async recordInteraction(type, data) {
    if (!this.currentSession) {
      await this.startSession();
    }
    
    const interaction = {
      type: type,
      timestamp: new Date().toISOString(),
      ...data
    };
    
    this.currentSession.interactions.push(interaction);
    
    // Process based on type
    switch (type) {
      case 'reuse':
        await this.recordReuse(data);
        break;
      case 'create':
        await this.recordCreation(data);
        break;
      case 'decision':
        await this.recordDecision(data);
        break;
      case 'learning':
        await this.recordLearning(data);
        break;
    }
    
    // Save periodically
    if (this.currentSession.interactions.length % 10 === 0) {
      await this.saveSession();
    }
  }
  
  async recordReuse(data) {
    this.currentSession.reusedComponents.push({
      name: data.component,
      path: data.path,
      timestamp: new Date().toISOString(),
      savedTime: data.savedTime || 30 // minutes
    });
    
    this.reuseTracking.reused++;
    this.reuseTracking.savedTime += (data.savedTime || 30);
    
    console.log(`♻️  REUSED: ${data.component}`);
    console.log(`   💰 Saved: ~${data.savedTime || 30} minutes`);
    
    // Teach learning system
    await this.teachLearning('reuse', data);
  }
  
  async recordCreation(data) {
    this.currentSession.newComponents.push({
      name: data.component,
      reason: data.reason,
      timestamp: new Date().toISOString()
    });
    
    this.reuseTracking.created++;
    
    console.log(`🆕 CREATED: ${data.component}`);
    console.log(`   📝 Reason: ${data.reason}`);
    
    // Register for future reuse
    await this.registerComponent(data);
    
    // Teach learning system
    await this.teachLearning('creation', data);
  }
  
  async recordDecision(data) {
    this.currentSession.decisions.push({
      decision: data.decision,
      reasoning: data.reasoning,
      timestamp: new Date().toISOString()
    });
    
    console.log(`🎯 DECISION: ${data.decision}`);
  }
  
  async recordLearning(data) {
    this.currentSession.learnings.push({
      insight: data.insight,
      context: data.context,
      timestamp: new Date().toISOString()
    });
    
    console.log(`💡 LEARNED: ${data.insight}`);
  }
  
  async endSession() {
    if (!this.currentSession) return;
    
    this.currentSession.ended = new Date().toISOString();
    
    // Calculate session stats
    const duration = new Date(this.currentSession.ended) - new Date(this.currentSession.started);
    const durationMinutes = Math.round(duration / 1000 / 60);
    
    const stats = {
      duration: durationMinutes,
      interactions: this.currentSession.interactions.length,
      reused: this.currentSession.reusedComponents.length,
      created: this.currentSession.newComponents.length,
      decisions: this.currentSession.decisions.length,
      learnings: this.currentSession.learnings.length,
      reuseRate: this.calculateReuseRate(),
      timeSaved: this.reuseTracking.savedTime
    };
    
    this.currentSession.stats = stats;
    
    // Display session summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 CC SESSION SUMMARY');
    console.log('='.repeat(60));
    console.log(`🆔 Session: ${this.currentSession.id}`);
    console.log(`⏱️  Duration: ${stats.duration} minutes`);
    console.log(`🔄 Interactions: ${stats.interactions}`);
    console.log(`\n🎯 Key Metrics:`);
    console.log(`  ♻️  Components Reused: ${stats.reused}`);
    console.log(`  🆕 New Components: ${stats.created}`);
    console.log(`  📈 Reuse Rate: ${stats.reuseRate}%`);
    console.log(`  💰 Time Saved: ${stats.timeSaved} minutes`);
    console.log(`\n💡 Insights:`);
    console.log(`  🎯 Decisions Made: ${stats.decisions}`);
    console.log(`  🧠 Learnings Captured: ${stats.learnings}`);
    
    if (stats.reuseRate >= 70) {
      console.log(`\n🎆 EXCELLENT! ${stats.reuseRate}% reuse rate!`);
    } else if (stats.reuseRate >= 50) {
      console.log(`\n👍 Good reuse rate: ${stats.reuseRate}%`);
    } else {
      console.log(`\n📉 Low reuse rate: ${stats.reuseRate}% - Check existing code more!`);
    }
    
    console.log('='.repeat(60) + '\n');
    
    // Save final session
    await this.saveSession();
    
    // Archive session
    await this.archiveSession();
    
    return stats;
  }
  
  calculateReuseRate() {
    const total = this.currentSession.reusedComponents.length + this.currentSession.newComponents.length;
    if (total === 0) return 0;
    
    return Math.round((this.currentSession.reusedComponents.length / total) * 100);
  }
  
  async saveSession() {
    if (!this.currentSession) return;
    
    const sessionFile = path.join(this.memoryPath, `${this.currentSession.id}.json`);
    await fs.writeFile(sessionFile, JSON.stringify(this.currentSession, null, 2));
  }
  
  async archiveSession() {
    if (!this.currentSession) return;
    
    const archivePath = path.join(this.memoryPath, 'archive');
    await fs.mkdir(archivePath, { recursive: true });
    
    const archiveFile = path.join(archivePath, `${this.currentSession.id}.json`);
    await fs.writeFile(archiveFile, JSON.stringify(this.currentSession, null, 2));
    
    // Remove from active
    const sessionFile = path.join(this.memoryPath, `${this.currentSession.id}.json`);
    try {
      await fs.unlink(sessionFile);
    } catch (e) {
      // Ignore
    }
  }
  
  async loadSessionHistory() {
    this.sessionHistory = [];
    
    try {
      const archivePath = path.join(this.memoryPath, 'archive');
      const files = await fs.readdir(archivePath);
      
      for (const file of files.slice(-10)) { // Last 10 sessions
        try {
          const content = await fs.readFile(path.join(archivePath, file), 'utf-8');
          const session = JSON.parse(content);
          this.sessionHistory.push({
            id: session.id,
            started: session.started,
            stats: session.stats
          });
        } catch (e) {
          // Skip invalid files
        }
      }
    } catch (e) {
      // No history yet
    }
  }
  
  async loadContext() {
    try {
      const contextFile = path.join(this.contextPath, 'current.json');
      const content = await fs.readFile(contextFile, 'utf-8');
      this.contextCache = JSON.parse(content);
    } catch (e) {
      // No context yet
      this.contextCache = {};
    }
  }
  
  async saveContext() {
    const contextFile = path.join(this.contextPath, 'current.json');
    await fs.writeFile(contextFile, JSON.stringify(this.contextCache, null, 2));
  }
  
  async teachLearning(type, data) {
    // Send to learning system
    try {
      await this.fetch('http://localhost:5003/learn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: type,
          data: data,
          session: this.currentSession.id,
          timestamp: new Date().toISOString()
        })
      });
    } catch (e) {
      // Learning system might not be available
    }
  }
  
  async registerComponent(data) {
    // Register new component for future reuse
    try {
      await this.fetch('http://localhost:5555/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: data.component,
          type: data.type || 'component',
          path: data.path,
          description: data.reason,
          timestamp: new Date().toISOString()
        })
      });
    } catch (e) {
      // CKS might not be available
    }
  }
  
  async getRecentWork() {
    // Get recent work from sessions
    const recent = [];
    
    for (const session of this.sessionHistory.slice(-3)) {
      if (session.stats) {
        recent.push({
          session: session.id,
          reused: session.stats.reused,
          created: session.stats.created,
          reuseRate: session.stats.reuseRate
        });
      }
    }
    
    return recent;
  }
  
  async getStatistics() {
    let totalReused = 0;
    let totalCreated = 0;
    let totalTimeSaved = 0;
    
    for (const session of this.sessionHistory) {
      if (session.stats) {
        totalReused += session.stats.reused || 0;
        totalCreated += session.stats.created || 0;
        totalTimeSaved += session.stats.timeSaved || 0;
      }
    }
    
    return {
      totalSessions: this.sessionHistory.length,
      totalReused,
      totalCreated,
      totalTimeSaved,
      averageReuseRate: totalReused + totalCreated > 0 
        ? Math.round((totalReused / (totalReused + totalCreated)) * 100)
        : 0
    };
  }
  
  async checkService(url) {
    try {
      await this.fetch(url);
      return 'online';
    } catch (e) {
      return 'offline';
    }
  }
  
  async fetch(url, options = {}) {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const protocol = urlObj.protocol === 'https:' ? require('https') : http;
      
      const req = protocol.request({
        hostname: urlObj.hostname,
        port: urlObj.port,
        path: urlObj.pathname,
        method: options.method || 'GET',
        headers: options.headers || {},
        timeout: 5000
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
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Timeout'));
      });
      
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
  const manager = new CCMemoryManager();
  const args = process.argv.slice(2);
  const command = args[0];
  
  async function main() {
    await manager.initialize();
    
    switch (command) {
      case 'start':
        await manager.startSession();
        console.log('Session started. Use "end" to finish.');
        break;
        
      case 'end':
        await manager.endSession();
        break;
        
      case 'stats':
        const stats = await manager.getStatistics();
        console.log('\n📊 Overall Statistics:');
        console.log(`  Sessions: ${stats.totalSessions}`);
        console.log(`  Total Reused: ${stats.totalReused}`);
        console.log(`  Total Created: ${stats.totalCreated}`);
        console.log(`  Time Saved: ${stats.totalTimeSaved} minutes`);
        console.log(`  Average Reuse Rate: ${stats.averageReuseRate}%`);
        break;
        
      case 'record':
        const type = args[1];
        const component = args[2];
        
        if (!type || !component) {
          console.error('Usage: cc-memory-manager record <type> <component>');
          return;
        }
        
        await manager.recordInteraction(type, { component });
        break;
        
      default:
        console.log(`
🧠 CC Memory Manager

Usage:
  cc-memory-manager <command>

Commands:
  start   - Start new session
  end     - End current session
  stats   - Show overall statistics
  record  - Record interaction

Examples:
  cc-memory-manager start
  cc-memory-manager record reuse "AuthenticationFlow"
  cc-memory-manager record create "NewFeature"
  cc-memory-manager end
  cc-memory-manager stats
`);
    }
  }
  
  main().catch(console.error);
}

module.exports = CCMemoryManager;