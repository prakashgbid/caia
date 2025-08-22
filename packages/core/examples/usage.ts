/**
 * Complete usage example of the @caia/core package
 * This demonstrates how to set up and use the orchestrator with agents and plugins
 */

import { createLogger } from 'winston';
import {
  Orchestrator,
  createDevelopmentConfig,
  AgentStatus,
  TaskPriority,
  MessageType,
  PluginConfig,
  Plugin
} from '../src/index.js';
import { SimpleAgent } from './SimpleAgent.js';

/**
 * Example plugin that logs all task completions
 */
class LoggingPlugin implements Plugin {
  public readonly id = 'logging-plugin';
  public readonly name = 'Task Logging Plugin';
  public readonly version = '1.0.0';

  private logger: any;

  async initialize(config: Record<string, unknown>): Promise<void> {
    this.logger = createLogger({
      level: 'info',
      format: require('winston').format.simple(),
      transports: [new (require('winston').transports.Console)()]
    });
    
    this.logger.info('Logging plugin initialized', { config });
  }

  async destroy(): Promise<void> {
    this.logger.info('Logging plugin destroyed');
  }

  async onTaskCompleted(result: any): Promise<void> {
    this.logger.info('Task completed', {
      taskId: result.taskId,
      status: result.status,
      executionTime: result.executionTime
    });
  }
}

/**
 * Example plugin that tracks metrics
 */
class MetricsPlugin implements Plugin {
  public readonly id = 'metrics-plugin';
  public readonly name = 'Metrics Tracking Plugin';
  public readonly version = '1.0.0';

  private metrics = {
    tasksCompleted: 0,
    tasksFailed: 0,
    averageExecutionTime: 0,
    totalExecutionTime: 0
  };

  async initialize(config: Record<string, unknown>): Promise<void> {
    console.log('Metrics plugin initialized');
  }

  async destroy(): Promise<void> {
    console.log('Metrics plugin destroyed');
    console.log('Final metrics:', this.metrics);
  }

  async onTaskCompleted(result: any): Promise<void> {
    if (result.status === 'completed') {
      this.metrics.tasksCompleted++;
    } else {
      this.metrics.tasksFailed++;
    }
    
    this.metrics.totalExecutionTime += result.executionTime;
    this.metrics.averageExecutionTime = 
      this.metrics.totalExecutionTime / (this.metrics.tasksCompleted + this.metrics.tasksFailed);
  }

  getMetrics(): typeof this.metrics {
    return { ...this.metrics };
  }
}

async function runExample(): Promise<void> {
  // Create logger
  const logger = createLogger({
    level: 'info',
    format: require('winston').format.combine(
      require('winston').format.timestamp(),
      require('winston').format.simple()
    ),
    transports: [
      new (require('winston').transports.Console)()
    ]
  });

  // Create orchestrator configuration
  const config = createDevelopmentConfig();
  
  // Add plugin configurations
  const pluginConfigs: PluginConfig[] = [
    {
      id: 'logging-plugin',
      name: 'Task Logging Plugin',
      version: '1.0.0',
      enabled: true
    },
    {
      id: 'metrics-plugin',
      name: 'Metrics Tracking Plugin',
      version: '1.0.0',
      enabled: true
    }
  ];
  
  config.plugins = pluginConfigs;

  // Create orchestrator
  const orchestrator = new Orchestrator(config);

  // Create plugin instances
  const loggingPlugin = new LoggingPlugin();
  const metricsPlugin = new MetricsPlugin();

  try {
    console.log('🚀 Starting CAIA Core Example');
    
    // Start orchestrator
    await orchestrator.start();
    
    // Load plugins
    const pluginManager = orchestrator.getPluginManager();
    await pluginManager.loadPlugin('logging-plugin', () => loggingPlugin);
    await pluginManager.loadPlugin('metrics-plugin', () => metricsPlugin);
    
    await pluginManager.initializePlugin('logging-plugin');
    await pluginManager.initializePlugin('metrics-plugin');

    // Create and register agents
    const agent1 = new SimpleAgent({
      id: 'simple-agent-1',
      name: 'Simple Agent 1',
      capabilities: [
        { name: 'echo', version: '1.0.0', description: 'Echo text back' },
        { name: 'text-process', version: '1.0.0', description: 'Process text' }
      ],
      maxConcurrentTasks: 2,
      processingDelay: 500,
      allowedTaskTypes: ['echo', 'text-process']
    }, logger);

    const agent2 = new SimpleAgent({
      id: 'simple-agent-2',
      name: 'Simple Agent 2',
      capabilities: [
        { name: 'delay', version: '1.0.0', description: 'Apply delay' },
        { name: 'echo', version: '1.0.0', description: 'Echo text back' }
      ],
      maxConcurrentTasks: 1,
      processingDelay: 1000,
      allowedTaskTypes: ['delay', 'echo']
    }, logger);

    await orchestrator.registerAgent(agent1);
    await orchestrator.registerAgent(agent2);

    console.log('✅ Orchestrator and agents initialized');

    // Submit various tasks
    const tasks = [
      {
        type: 'echo',
        priority: TaskPriority.MEDIUM,
        payload: { text: 'Hello, CAIA!' }
      },
      {
        type: 'text-process',
        priority: TaskPriority.HIGH,
        payload: { text: 'This is a TEXT processing EXAMPLE with Multiple Words!' }
      },
      {
        type: 'delay',
        priority: TaskPriority.LOW,
        payload: { delay: 2000 }
      },
      {
        type: 'echo',
        priority: TaskPriority.CRITICAL,
        payload: { text: 'Critical echo task' }
      }
    ];

    console.log('📝 Submitting tasks...');
    const taskIds: string[] = [];
    
    for (const task of tasks) {
      const taskId = await orchestrator.submitTask(task);
      taskIds.push(taskId);
      console.log(`   Task submitted: ${taskId} (${task.type})`);
    }

    // Monitor task completion
    let completedTasks = 0;
    const totalTasks = tasks.length;

    orchestrator.on('taskCompleted', (event) => {
      completedTasks++;
      console.log(`✅ Task completed: ${event.result.taskId} (${event.result.status})`);
      
      if (event.result.result) {
        console.log('   Result:', JSON.stringify(event.result.result, null, 2));
      }
      
      if (event.result.error) {
        console.log('   Error:', event.result.error.message);
      }
    });

    // Wait for all tasks to complete
    while (completedTasks < totalTasks) {
      await sleep(100);
      
      // Print stats periodically
      if (completedTasks % 2 === 0) {
        const stats = orchestrator.getStats();
        console.log(`📊 Stats: ${stats.completedTasks} completed, ${stats.pendingTasks} pending, ${stats.runningTasks} running`);
      }
    }

    console.log('🎉 All tasks completed!');

    // Print final statistics
    const finalStats = orchestrator.getStats();
    console.log('\n📈 Final Statistics:');
    console.log(`   Total tasks: ${finalStats.totalTasks}`);
    console.log(`   Completed: ${finalStats.completedTasks}`);
    console.log(`   Failed: ${finalStats.failedTasks}`);
    console.log(`   Average task time: ${finalStats.averageTaskTime.toFixed(2)}ms`);
    console.log(`   Active agents: ${finalStats.activeAgents}/${finalStats.registeredAgents}`);
    console.log(`   Uptime: ${(finalStats.uptime / 1000).toFixed(2)}s`);

    // Print plugin metrics
    console.log('\n🔌 Plugin Metrics:');
    const metrics = metricsPlugin.getMetrics();
    console.log(`   Tasks completed: ${metrics.tasksCompleted}`);
    console.log(`   Tasks failed: ${metrics.tasksFailed}`);
    console.log(`   Average execution time: ${metrics.averageExecutionTime.toFixed(2)}ms`);

    // Demonstrate message bus usage
    console.log('\n💬 Testing message bus...');
    const messageBus = orchestrator.getMessageBus();
    
    // Subscribe to messages
    const subscriptionId = messageBus.subscribe(
      { type: MessageType.SYSTEM_EVENT },
      'example-subscriber',
      async (message) => {
        console.log(`   Received system event: ${JSON.stringify(message.payload)}`);
      }
    );

    // Send a system event
    await messageBus.send({
      type: MessageType.SYSTEM_EVENT,
      from: 'example',
      payload: { event: 'example-event', data: 'test data' }
    });

    await sleep(500); // Wait for message delivery

    // Cleanup subscription
    messageBus.unsubscribe(subscriptionId);

    // Test agent capabilities
    console.log('\n🤖 Agent Information:');
    const agentMetadata = orchestrator.getAgentMetadata() as any[];
    for (const metadata of agentMetadata) {
      console.log(`   Agent: ${metadata.name} (${metadata.id})`);
      console.log(`     Status: ${metadata.status}`);
      console.log(`     Capabilities: ${metadata.capabilities.map((c: any) => c.name).join(', ')}`);
      console.log(`     Completed tasks: ${metadata.completedTasks}`);
      console.log(`     Failed tasks: ${metadata.failedTasks}`);
    }

  } catch (error) {
    console.error('❌ Example failed:', error);
  } finally {
    // Cleanup
    console.log('\n🧹 Cleaning up...');
    await orchestrator.stop();
    console.log('✅ Example completed');
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Run the example
if (require.main === module) {
  runExample().catch(console.error);
}

export { runExample };