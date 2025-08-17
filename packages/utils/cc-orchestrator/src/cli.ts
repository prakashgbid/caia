#!/usr/bin/env node

/**
 * CC Orchestrator CLI
 * Test and manage dynamic resource calculation
 */

import { Command } from 'commander';
import { SystemResourceCalculator } from './SystemResourceCalculator';
import { CCOrchestrator } from './index';
import { TerminalPoolManager } from './TerminalPoolManager';

const program = new Command();

program
  .name('cco')
  .description('CC Orchestrator - Dynamic resource management')
  .version('1.0.0');

// Resource analysis command
program
  .command('analyze')
  .description('Analyze system resources and calculate optimal instances')
  .action(async () => {
    console.log('🔍 Analyzing system resources...\n');
    
    try {
      const calculator = new SystemResourceCalculator();
      const result = await calculator.calculateOptimalInstances();
      
      console.log('📊 SYSTEM RESOURCES');
      console.log('='.repeat(50));
      console.log(`💾 Total RAM: ${result.systemInfo.totalRAM.toLocaleString()} MB`);
      console.log(`💾 Available RAM: ${result.systemInfo.availableRAM.toLocaleString()} MB`);
      console.log(`⚡ Allocated for CC: ${result.systemInfo.allocatedRAM.toLocaleString()} MB (50%)`);
      console.log(`🖥️  CPU Cores: ${result.systemInfo.cpuCores}`);
      console.log(`💿 Total Storage: ${result.systemInfo.totalStorage.toLocaleString()} MB`);
      console.log(`💿 Available Storage: ${result.systemInfo.availableStorage.toLocaleString()} MB`);
      console.log(`🏗️  Platform: ${result.systemInfo.platform}`);
      
      console.log('\n🧮 INSTANCE CALCULATION');
      console.log('='.repeat(50));
      console.log(`📦 RAM per instance: ${result.instanceRequirements.ramPerInstance} MB`);
      console.log(`💿 Storage per instance: ${result.instanceRequirements.storagePerInstance} MB`);
      console.log(`🔥 CPU weight per instance: ${result.instanceRequirements.cpuWeight}`);
      
      console.log('\n🎯 RESULT');
      console.log('='.repeat(50));
      console.log(`🚀 Optimal instances: ${result.maxInstances}`);
      console.log(`⚠️  Bottleneck: ${result.bottleneck.toUpperCase()}`);
      console.log(`💭 Reason: ${result.reason}`);
      
      if (result.recommendations.length > 0) {
        console.log('\n💡 RECOMMENDATIONS');
        console.log('='.repeat(50));
        result.recommendations.forEach(rec => {
          console.log(`• ${rec}`);
        });
      }
      
    } catch (error) {
      console.error('❌ Analysis failed:', error.message);
      process.exit(1);
    }
  });

// Test orchestrator command
program
  .command('test')
  .description('Test CC Orchestrator with dynamic resource calculation')
  .option('-t, --tasks <number>', 'Number of test tasks', '10')
  .action(async (options) => {
    console.log('🧪 Testing CC Orchestrator...\n');
    
    try {
      const orchestrator = new CCOrchestrator({
        autoCalculateInstances: true,
        debug: true
      });
      
      // Wait for initialization
      orchestrator.on('initialized', (data) => {
        console.log('✅ Orchestrator initialized');
        console.log(`📊 Max instances: ${data.config.maxInstances}`);
        if (data.resourceCalculation) {
          console.log(`💭 Calculation: ${data.resourceCalculation.reason}`);
        }
      });
      
      orchestrator.on('resource:calculated', (calculation) => {
        console.log('🎯 Resource calculation completed');
      });
      
      // Create test tasks
      const numTasks = parseInt(options.tasks);
      const testTasks = Array.from({ length: numTasks }, (_, i) => ({
        id: `test-task-${i}`,
        type: 'TASK' as const,
        input: `Test task ${i + 1}`,
        context: {},
        priority: 1,
        retries: 0,
        timeout: 5000
      }));
      
      console.log(`📋 Created ${numTasks} test tasks`);
      console.log('⚡ Executing in parallel...\n');
      
      const startTime = Date.now();
      
      // Execute tasks (this will use the simulated execution)
      const results = await orchestrator.executeParallelTasks(testTasks);
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      console.log('\n📊 TEST RESULTS');
      console.log('='.repeat(50));
      console.log(`✅ Completed: ${results.filter(r => r.success).length}/${numTasks}`);
      console.log(`❌ Failed: ${results.filter(r => !r.success).length}/${numTasks}`);
      console.log(`⏱️  Duration: ${duration}ms`);
      console.log(`🚀 Throughput: ${(numTasks / (duration / 1000)).toFixed(2)} tasks/sec`);
      
      const metrics = orchestrator.getMetrics();
      console.log(`📈 Active instances: ${metrics.activeInstances}`);
      console.log(`📊 Instance utilization: ${(metrics.instanceUtilization * 100).toFixed(1)}%`);
      
      await orchestrator.cleanup();
      
    } catch (error) {
      console.error('❌ Test failed:', error.message);
      process.exit(1);
    }
  });

// Test terminal pool command
program
  .command('test-pool')
  .description('Test Terminal Pool Manager with safety-first approach')
  .option('-t, --tasks <number>', 'Number of test tasks', '20')
  .option('-p, --pool-size <number>', 'Pool size', '5')
  .action(async (options) => {
    console.log('🧪 Testing Terminal Pool Manager...\n');
    
    try {
      const poolManager = new TerminalPoolManager({
        maxTerminals: parseInt(options.poolSize),
        safetyMode: true,
        auditLog: true,
        permissionAutoAccept: true,
        apiErrorRecovery: true,
        contextTransfer: true
      });
      
      // Monitor pool events
      poolManager.on('initialized', (data) => {
        console.log('✅ Pool initialized with', data.maxTerminals, 'terminals');
      });
      
      poolManager.on('terminal:created', (terminal) => {
        console.log(`🖥️  Terminal created: ${terminal.id}`);
      });
      
      poolManager.on('task:started', (data) => {
        console.log(`📋 Task ${data.task.id} started on terminal ${data.terminal.id}`);
      });
      
      poolManager.on('task:completed', (data) => {
        console.log(`✅ Task ${data.task.id} completed`);
      });
      
      poolManager.on('task:failed', (data) => {
        console.log(`❌ Task ${data.task.id} failed: ${data.error.message}`);
      });
      
      poolManager.on('task:reassigned', (data) => {
        console.log(`🔀 Task ${data.task.id} reassigned from terminal ${data.fromTerminal}`);
      });
      
      poolManager.on('task:escalated', (escalation) => {
        console.log(`🚨 ESCALATION: Task ${escalation.task.id} needs user attention`);
        console.log(`   Attempts: ${escalation.attempts}`);
        console.log(`   Recommendation: ${escalation.recommendation}`);
      });
      
      poolManager.on('terminal:replaced', (data) => {
        console.log(`🔄 Terminal replaced: ${data.old} → ${data.new}`);
      });
      
      poolManager.on('context:transferred', (data) => {
        console.log(`📦 Context transferred: ${data.from} → ${data.to}`);
      });
      
      // Create test tasks
      const numTasks = parseInt(options.tasks);
      const taskIds: string[] = [];
      
      console.log(`\n📋 Queuing ${numTasks} test tasks...\n`);
      
      for (let i = 0; i < numTasks; i++) {
        const taskId = poolManager.addTask({
          type: 'test',
          input: { taskNumber: i + 1, test: true },
          priority: Math.floor(Math.random() * 10),
          maxAttempts: 3,
          timeout: 30000
        });
        taskIds.push(taskId);
      }
      
      // Monitor metrics
      const metricsInterval = setInterval(() => {
        const metrics = poolManager.getMetrics();
        console.log('\n📊 POOL METRICS');
        console.log('='.repeat(40));
        console.log(`Pool size: ${metrics.poolSize}/${metrics.maxPoolSize}`);
        console.log(`Healthy terminals: ${metrics.healthyTerminals}`);
        console.log(`Repairing terminals: ${metrics.repairingTerminals}`);
        console.log(`Dead terminals: ${metrics.deadTerminals}`);
        console.log(`Queue length: ${metrics.queueLength}`);
        console.log(`Active tasks: ${metrics.activeTasks}`);
        console.log(`Total processed: ${metrics.totalProcessed}`);
        console.log(`Total errors: ${metrics.totalErrors}`);
        console.log(`Avg repair attempts: ${metrics.avgRepairAttempts.toFixed(2)}`);
      }, 5000);
      
      // Wait for tasks to complete or timeout
      const startTime = Date.now();
      const maxWaitTime = 120000; // 2 minutes
      
      await new Promise<void>((resolve) => {
        const checkInterval = setInterval(() => {
          const metrics = poolManager.getMetrics();
          
          if (metrics.queueLength === 0 && metrics.activeTasks === 0) {
            clearInterval(checkInterval);
            clearInterval(metricsInterval);
            resolve();
          } else if (Date.now() - startTime > maxWaitTime) {
            clearInterval(checkInterval);
            clearInterval(metricsInterval);
            console.log('\n⏱️  Timeout reached');
            resolve();
          }
        }, 1000);
      });
      
      // Final metrics
      const finalMetrics = poolManager.getMetrics();
      const duration = Date.now() - startTime;
      
      console.log('\n📊 FINAL RESULTS');
      console.log('='.repeat(50));
      console.log(`✅ Total processed: ${finalMetrics.totalProcessed}`);
      console.log(`❌ Total errors: ${finalMetrics.totalErrors}`);
      console.log(`⏱️  Duration: ${(duration / 1000).toFixed(2)} seconds`);
      console.log(`🚀 Throughput: ${(finalMetrics.totalProcessed / (duration / 1000)).toFixed(2)} tasks/sec`);
      console.log(`🔧 Avg repair attempts: ${finalMetrics.avgRepairAttempts.toFixed(2)}`);
      
      // Shutdown pool
      console.log('\n🛑 Shutting down pool...');
      await poolManager.shutdown();
      console.log('✅ Pool shutdown complete');
      
    } catch (error) {
      console.error('❌ Test failed:', error.message);
      process.exit(1);
    }
  });

// Monitor command
program
  .command('monitor')
  .description('Monitor system resources and instance adjustments')
  .option('-i, --interval <seconds>', 'Monitoring interval', '10')
  .action(async (options) => {
    console.log('📊 Starting resource monitoring...\n');
    
    try {
      const orchestrator = new CCOrchestrator({
        autoCalculateInstances: true,
        debug: true
      });
      
      const interval = parseInt(options.interval) * 1000;
      
      const monitor = async () => {
        console.log(`[${new Date().toLocaleTimeString()}] Monitoring resources...`);
        
        const monitoring = await orchestrator.monitorResources();
        
        if (monitoring.utilization) {
          console.log(`💾 RAM: ${(monitoring.utilization.ramUsage * 100).toFixed(1)}%`);
          console.log(`🔥 CPU: ${(monitoring.utilization.cpuLoad * 100).toFixed(1)}%`);
          console.log(`💿 Storage: ${(monitoring.utilization.storageUsage * 100).toFixed(1)}%`);
        }
        
        if (monitoring.shouldAdjust) {
          console.log(`💡 ${monitoring.suggestion.reason}`);
          
          const adjustment = await orchestrator.recalculateInstances();
          if (adjustment.adjusted) {
            console.log(`🔄 Adjusted: ${adjustment.oldMax} → ${adjustment.newMax} instances`);
          }
        }
        
        console.log('---');
      };
      
      // Initial check
      await monitor();
      
      // Periodic monitoring
      setInterval(monitor, interval);
      
      console.log('Press Ctrl+C to stop monitoring');
      
      // Keep process alive
      process.on('SIGINT', async () => {
        console.log('\n👋 Stopping monitor...');
        await orchestrator.cleanup();
        process.exit(0);
      });
      
    } catch (error) {
      console.error('❌ Monitoring failed:', error.message);
      process.exit(1);
    }
  });

program.parse(process.argv);

// Show help if no command provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
}