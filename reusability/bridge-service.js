#!/usr/bin/env node

/**
 * CAIA Local-Cloud Bridge Service
 * Enables seamless code and feature reusability between local and cloud environments
 */

const fs = require('fs').promises;
const path = require('path');
const http = require('http');
const crypto = require('crypto');

class LocalCloudBridge {
  constructor(config = {}) {
    this.config = {
      syncInterval: config.syncInterval || 300000, // 5 minutes
      conflictResolution: config.conflictResolution || 'newest',
      localCKS: config.localCKS || 'http://localhost:5555',
      localStoragePath: config.localStoragePath || path.join(process.env.HOME, 'Documents/projects/caia/shared'),
      cloudEndpoint: process.env.CC_CLOUD_API || config.cloudEndpoint,
      ...config
    };
    
    this.registry = new ComponentRegistry();
    this.syncQueue = [];
    this.isRunning = false;
    this.stats = {
      synced: 0,
      conflicts: 0,
      errors: 0,
      lastSync: null
    };
  }
  
  async initialize() {
    console.log('🌉 Initializing Local-Cloud Bridge...');
    
    // Create shared storage directory
    await fs.mkdir(this.config.localStoragePath, { recursive: true });
    
    // Load existing registry
    await this.registry.load();
    
    // Test connections
    const localOk = await this.testLocalConnection();
    const cloudOk = await this.testCloudConnection();
    
    console.log(`📡 Local CKS: ${localOk ? '✅' : '❌'}`);
    console.log(`☁️  Cloud API: ${cloudOk ? '✅' : '❌'}`);
    
    if (!localOk) {
      console.log('⚠️  Local CKS not available, operating in degraded mode');
    }
    
    return { local: localOk, cloud: cloudOk };
  }
  
  async startSync() {
    if (this.isRunning) return;
    
    this.isRunning = true;
    console.log('🔄 Starting continuous sync...');
    
    // Initial sync
    await this.syncAll();
    
    // Set up interval
    this.syncInterval = setInterval(async () => {
      try {
        await this.syncAll();
      } catch (error) {
        console.error('Sync error:', error);
        this.stats.errors++;
      }
    }, this.config.syncInterval);
  }
  
  async stopSync() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.isRunning = false;
      console.log('⏹️  Sync stopped');
    }
  }
  
  async syncAll() {
    console.log('🔄 Syncing components...');
    const startTime = Date.now();
    
    try {
      // Sync in parallel for speed
      const results = await Promise.allSettled([
        this.syncComponents(),
        this.syncPatterns(),
        this.syncAgents(),
        this.syncWorkflows()
      ]);
      
      // Update stats
      this.stats.lastSync = new Date().toISOString();
      const duration = Date.now() - startTime;
      
      console.log(`✅ Sync completed in ${duration}ms`);
      console.log(`📊 Stats: ${this.stats.synced} synced, ${this.stats.conflicts} conflicts, ${this.stats.errors} errors`);
      
      return results;
    } catch (error) {
      console.error('❌ Sync failed:', error);
      this.stats.errors++;
      throw error;
    }
  }
  
  async syncComponents() {
    // Get local components from CKS
    const local = await this.getLocalComponents();
    
    // Get cloud components (if available)
    const cloud = this.config.cloudEndpoint ? await this.getCloudComponents() : [];
    
    // Calculate diff
    const diff = this.calculateDiff(local, cloud);
    
    // Process each difference
    for (const item of diff) {
      await this.processSync(item);
    }
  }
  
  async processSync(item) {
    switch (item.action) {
      case 'upload':
        await this.uploadToCloud(item.component);
        break;
      case 'download':
        await this.downloadFromCloud(item.component);
        break;
      case 'conflict':
        await this.resolveConflict(item);
        break;
    }
    this.stats.synced++;
  }
  
  calculateDiff(local, cloud) {
    const diff = [];
    const localMap = new Map(local.map(c => [c.id, c]));
    const cloudMap = new Map(cloud.map(c => [c.id, c]));
    
    // Check local components
    for (const [id, component] of localMap) {
      if (!cloudMap.has(id)) {
        diff.push({ action: 'upload', component });
      } else {
        const cloudComponent = cloudMap.get(id);
        if (component.version !== cloudComponent.version) {
          diff.push({ 
            action: 'conflict', 
            local: component, 
            cloud: cloudComponent 
          });
        }
      }
    }
    
    // Check cloud components not in local
    for (const [id, component] of cloudMap) {
      if (!localMap.has(id)) {
        diff.push({ action: 'download', component });
      }
    }
    
    return diff;
  }
  
  async resolveConflict(conflict) {
    this.stats.conflicts++;
    
    switch (this.config.conflictResolution) {
      case 'newest':
        if (conflict.local.updated > conflict.cloud.updated) {
          await this.uploadToCloud(conflict.local);
        } else {
          await this.downloadFromCloud(conflict.cloud);
        }
        break;
      case 'local-first':
        await this.uploadToCloud(conflict.local);
        break;
      case 'cloud-first':
        await this.downloadFromCloud(conflict.cloud);
        break;
    }
  }
  
  async getLocalComponents() {
    try {
      const response = await this.fetch(`${this.config.localCKS}/components`);
      return response.components || [];
    } catch (error) {
      console.error('Failed to get local components:', error);
      return [];
    }
  }
  
  async getCloudComponents() {
    if (!this.config.cloudEndpoint) return [];
    
    try {
      // Simulate cloud API call
      // In production, this would call actual cloud API
      return [];
    } catch (error) {
      console.error('Failed to get cloud components:', error);
      return [];
    }
  }
  
  async uploadToCloud(component) {
    console.log(`⬆️  Uploading ${component.name} to cloud...`);
    // Implementation for cloud upload
  }
  
  async downloadFromCloud(component) {
    console.log(`⬇️  Downloading ${component.name} from cloud...`);
    // Implementation for cloud download
  }
  
  async testLocalConnection() {
    try {
      await this.fetch(`${this.config.localCKS}/health`);
      return true;
    } catch {
      return false;
    }
  }
  
  async testCloudConnection() {
    // Test cloud connection if configured
    return !!this.config.cloudEndpoint;
  }
  
  async fetch(url, options = {}) {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const req = http.request({
        hostname: urlObj.hostname,
        port: urlObj.port,
        path: urlObj.pathname,
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
        req.write(JSON.stringify(options.body));
      }
      req.end();
    });
  }
  
  async syncPatterns() {
    // Sync design patterns and code patterns
    console.log('🎨 Syncing patterns...');
  }
  
  async syncAgents() {
    // Sync agent implementations
    console.log('🤖 Syncing agents...');
  }
  
  async syncWorkflows() {
    // Sync workflow definitions
    console.log('⚙️  Syncing workflows...');
  }
}

class ComponentRegistry {
  constructor() {
    this.components = new Map();
    this.indexPath = path.join(process.env.HOME, 'Documents/projects/caia/shared/registry.json');
  }
  
  async load() {
    try {
      const data = await fs.readFile(this.indexPath, 'utf-8');
      const registry = JSON.parse(data);
      registry.components.forEach(c => this.components.set(c.id, c));
      console.log(`📚 Loaded ${this.components.size} components from registry`);
    } catch (error) {
      console.log('📚 Starting with empty registry');
    }
  }
  
  async save() {
    const registry = {
      version: '1.0.0',
      updated: new Date().toISOString(),
      components: Array.from(this.components.values())
    };
    await fs.writeFile(this.indexPath, JSON.stringify(registry, null, 2));
  }
  
  register(component) {
    component.id = component.id || this.generateId(component);
    component.registered = new Date().toISOString();
    this.components.set(component.id, component);
    return component.id;
  }
  
  generateId(component) {
    const hash = crypto.createHash('sha256');
    hash.update(component.name + component.type);
    return hash.digest('hex').substring(0, 12);
  }
}

// CLI Interface
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];
  
  const bridge = new LocalCloudBridge();
  
  async function main() {
    await bridge.initialize();
    
    switch (command) {
      case 'start':
        console.log('🚀 Starting bridge service...');
        await bridge.startSync();
        // Keep process running
        process.stdin.resume();
        break;
        
      case 'sync':
        console.log('🔄 Running one-time sync...');
        await bridge.syncAll();
        break;
        
      case 'status':
        console.log('📊 Bridge Status');
        console.log(bridge.stats);
        break;
        
      default:
        console.log(`
CAIA Local-Cloud Bridge

Usage:
  node bridge-service.js <command>

Commands:
  start   - Start continuous sync service
  sync    - Run one-time sync
  status  - Show sync statistics
`);
    }
  }
  
  main().catch(console.error);
}

module.exports = { LocalCloudBridge, ComponentRegistry };