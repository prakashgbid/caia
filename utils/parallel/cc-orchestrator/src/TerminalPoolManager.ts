/**
 * Terminal Pool Manager for CC Orchestrator
 * 
 * Manages a fixed pool of CC terminals with:
 * - Continuous pool management with FIFO task processing
 * - Multi-level terminal repair strategy (5 levels)
 * - Comprehensive context transfer between terminals
 * - Automatic permission acceptance
 * - API error recovery with continuation
 * - Task reassignment with 3-attempt limit
 * - User escalation for persistent failures
 * 
 * SAFETY FIRST: Prioritizes reliability and completeness over speed
 */

import { EventEmitter } from 'eventemitter3';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

export interface Terminal {
  id: string;
  process: ChildProcess;
  status: 'healthy' | 'repairing' | 'dead';
  health: {
    lastResponse: Date;
    consecutiveFailures: number;
    totalErrors: number;
    repairAttempts: number;
  };
  currentTask?: Task;
  history: TaskExecution[];
  startTime: Date;
  pid?: number;
}

export interface Task {
  id: string;
  type: string;
  input: any;
  context: TaskContext;
  priority: number;
  attempts: number;
  maxAttempts: number;
  timeout: number;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  error?: Error;
}

export interface TaskContext {
  // Task state
  taskHistory: string[];
  partialResults: any;
  checkpoints: Map<string, any>;
  
  // Terminal state
  terminalId: string;
  workingDirectory: string;
  environmentVars: Record<string, string>;
  openFiles: string[];
  
  // Execution history
  completedSteps: string[];
  pendingSteps: string[];
  errors: Array<{ timestamp: Date; error: string; recovered: boolean }>;
  
  // Context from previous attempts
  previousAttempts: Array<{
    terminalId: string;
    startTime: Date;
    endTime: Date;
    outcome: 'success' | 'failure' | 'timeout' | 'terminated';
    lastCompletedStep?: string;
  }>;
}

export interface TaskExecution {
  taskId: string;
  startTime: Date;
  endTime?: Date;
  success: boolean;
  error?: string;
}

export interface PoolConfig {
  maxTerminals: number;          // Fixed pool size based on system resources
  taskQueueLimit: number;        // Max tasks in queue
  terminalTimeout: number;       // Terminal health check timeout (ms)
  taskTimeout: number;           // Default task timeout (ms)
  repairTimeout: number;         // Max time for repair attempts (ms)
  maxRepairAttempts: number;     // Max repair attempts before kill
  maxTaskAttempts: number;       // Max attempts per task (default 3)
  permissionAutoAccept: boolean; // Auto-accept folder permissions
  apiErrorRecovery: boolean;     // Enable API error recovery
  apiErrorWaitTime: number;      // Wait time for API errors (ms)
  contextTransfer: boolean;      // Enable comprehensive context transfer
  auditLog: boolean;             // Enable detailed audit logging
  safetyMode: boolean;           // Conservative timeouts and recovery
}

/**
 * Repair Levels (escalating severity):
 * 1. GENTLE: Send newline, wait for response
 * 2. CONTEXT: Request context dump, restore state
 * 3. INTERRUPT: Send Ctrl+C, wait for recovery
 * 4. RESTART: Restart CC process in same terminal
 * 5. KILL: Kill and recreate terminal (last resort)
 */
enum RepairLevel {
  GENTLE = 1,
  CONTEXT = 2,
  INTERRUPT = 3,
  RESTART = 4,
  KILL = 5
}

export class TerminalPoolManager extends EventEmitter {
  private config: PoolConfig;
  private terminals: Map<string, Terminal> = new Map();
  private taskQueue: Task[] = [];
  private activeTaskCount: number = 0;
  private auditLog: any[] = [];
  private isShuttingDown: boolean = false;
  private poolMaintenanceInterval?: NodeJS.Timeout;
  private healthCheckInterval?: NodeJS.Timeout;

  constructor(config: Partial<PoolConfig> = {}) {
    super();
    
    this.config = {
      maxTerminals: 10,
      taskQueueLimit: 1000,
      terminalTimeout: 30000,        // 30 seconds
      taskTimeout: 300000,           // 5 minutes (conservative)
      repairTimeout: 60000,          // 1 minute for repair
      maxRepairAttempts: 5,
      maxTaskAttempts: 3,
      permissionAutoAccept: true,
      apiErrorRecovery: true,
      apiErrorWaitTime: 300000,      // 5 minutes
      contextTransfer: true,
      auditLog: true,
      safetyMode: true,              // Safety first!
      ...config
    };

    // Apply safety mode adjustments
    if (this.config.safetyMode) {
      this.config.taskTimeout = Math.max(this.config.taskTimeout, 600000);      // Min 10 minutes
      this.config.repairTimeout = Math.max(this.config.repairTimeout, 120000);  // Min 2 minutes
      this.config.terminalTimeout = Math.max(this.config.terminalTimeout, 60000); // Min 1 minute
    }

    this.initialize();
  }

  private async initialize(): Promise<void> {
    this.log('🚀 Initializing Terminal Pool Manager (Safety-First Mode)');
    
    // Create initial pool
    await this.createInitialPool();
    
    // Start pool maintenance
    this.startPoolMaintenance();
    
    // Start health monitoring
    this.startHealthMonitoring();
    
    // Start task processor
    this.startTaskProcessor();
    
    this.emit('initialized', {
      maxTerminals: this.config.maxTerminals,
      safetyMode: this.config.safetyMode
    });
  }

  /**
   * Create initial terminal pool
   */
  private async createInitialPool(): Promise<void> {
    this.log(`Creating initial pool of ${this.config.maxTerminals} terminals...`);
    
    const promises = [];
    for (let i = 0; i < this.config.maxTerminals; i++) {
      promises.push(this.createTerminal());
    }
    
    await Promise.all(promises);
    this.log(`✅ Pool initialized with ${this.terminals.size} terminals`);
  }

  /**
   * Create a new terminal
   */
  private async createTerminal(): Promise<Terminal> {
    const id = `terminal-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    this.log(`🖥️  Creating terminal: ${id}`);
    
    const process = spawn('claude', ['--no-interactive'], {
      env: {
        ...process.env,
        TERMINAL_ID: id,
        AUTO_ACCEPT_PERMISSIONS: 'true'
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const terminal: Terminal = {
      id,
      process,
      status: 'healthy',
      health: {
        lastResponse: new Date(),
        consecutiveFailures: 0,
        totalErrors: 0,
        repairAttempts: 0
      },
      history: [],
      startTime: new Date(),
      pid: process.pid
    };

    // Set up event handlers
    this.setupTerminalHandlers(terminal);

    this.terminals.set(id, terminal);
    this.emit('terminal:created', terminal);
    
    return terminal;
  }

  /**
   * Set up terminal event handlers
   */
  private setupTerminalHandlers(terminal: Terminal): void {
    // Handle stdout
    terminal.process.stdout?.on('data', (data) => {
      this.handleTerminalOutput(terminal, data.toString());
    });

    // Handle stderr
    terminal.process.stderr?.on('data', (data) => {
      this.handleTerminalError(terminal, data.toString());
    });

    // Handle exit
    terminal.process.on('exit', (code) => {
      this.handleTerminalExit(terminal, code);
    });

    // Handle errors
    terminal.process.on('error', (error) => {
      this.handleTerminalProcessError(terminal, error);
    });
  }

  /**
   * Handle terminal output
   */
  private handleTerminalOutput(terminal: Terminal, output: string): void {
    terminal.health.lastResponse = new Date();
    terminal.health.consecutiveFailures = 0;

    // Check for permission prompts
    if (this.config.permissionAutoAccept && output.includes('grant access')) {
      this.log(`🔓 Auto-accepting permission for terminal ${terminal.id}`);
      terminal.process.stdin?.write('y\n');
    }

    // Check for API errors
    if (this.config.apiErrorRecovery && output.includes('API error')) {
      this.handleApiError(terminal);
    }

    // Update task progress if applicable
    if (terminal.currentTask) {
      this.emit('task:output', {
        taskId: terminal.currentTask.id,
        terminalId: terminal.id,
        output
      });
    }
  }

  /**
   * Handle terminal errors
   */
  private handleTerminalError(terminal: Terminal, error: string): void {
    terminal.health.totalErrors++;
    
    this.log(`⚠️  Terminal ${terminal.id} error: ${error}`);
    
    if (terminal.currentTask) {
      // Add to task context
      terminal.currentTask.context.errors.push({
        timestamp: new Date(),
        error,
        recovered: false
      });
    }
  }

  /**
   * Handle terminal exit
   */
  private handleTerminalExit(terminal: Terminal, code: number | null): void {
    this.log(`💀 Terminal ${terminal.id} exited with code ${code}`);
    
    terminal.status = 'dead';
    
    // Transfer task if one was active
    if (terminal.currentTask && !this.isShuttingDown) {
      this.reassignTask(terminal.currentTask, terminal);
    }
    
    // Replace terminal if not shutting down
    if (!this.isShuttingDown) {
      this.replaceTerminal(terminal);
    }
  }

  /**
   * Handle terminal process errors
   */
  private handleTerminalProcessError(terminal: Terminal, error: Error): void {
    this.log(`❌ Terminal ${terminal.id} process error: ${error.message}`);
    
    terminal.health.consecutiveFailures++;
    
    if (terminal.health.consecutiveFailures > 3) {
      terminal.status = 'dead';
      this.replaceTerminal(terminal);
    }
  }

  /**
   * Handle API errors with recovery
   */
  private async handleApiError(terminal: Terminal): Promise<void> {
    this.log(`🔄 Handling API error for terminal ${terminal.id}`);
    
    // Wait for specified time
    await new Promise(resolve => setTimeout(resolve, this.config.apiErrorWaitTime));
    
    // Send continue command
    terminal.process.stdin?.write('continue\n');
    
    this.emit('api:recovered', {
      terminalId: terminal.id,
      waitTime: this.config.apiErrorWaitTime
    });
  }

  /**
   * Multi-level terminal repair strategy
   */
  private async repairTerminal(terminal: Terminal, level: RepairLevel = RepairLevel.GENTLE): Promise<boolean> {
    if (terminal.health.repairAttempts >= this.config.maxRepairAttempts) {
      this.log(`❌ Terminal ${terminal.id} exceeded max repair attempts`);
      return false;
    }

    terminal.health.repairAttempts++;
    terminal.status = 'repairing';
    
    this.log(`🔧 Repairing terminal ${terminal.id} - Level ${level} (${RepairLevel[level]})`);
    
    const startTime = Date.now();
    
    try {
      switch (level) {
        case RepairLevel.GENTLE:
          // Send newline and wait for response
          terminal.process.stdin?.write('\n');
          await this.waitForResponse(terminal, 5000);
          break;
          
        case RepairLevel.CONTEXT:
          // Request context dump and restore
          const context = await this.dumpTerminalContext(terminal);
          await this.restoreTerminalContext(terminal, context);
          break;
          
        case RepairLevel.INTERRUPT:
          // Send progressive interrupts
          terminal.process.stdin?.write('\x03'); // Ctrl+C
          await this.wait(1000);
          terminal.process.stdin?.write('\n');
          await this.waitForResponse(terminal, 10000);
          break;
          
        case RepairLevel.RESTART:
          // Restart CC in same terminal
          terminal.process.stdin?.write('exit\n');
          await this.wait(2000);
          // Recreate process with same ID
          await this.restartTerminalProcess(terminal);
          break;
          
        case RepairLevel.KILL:
          // Last resort - kill and replace
          terminal.process.kill('SIGKILL');
          return false; // Will be replaced
      }
      
      // Test if repair successful
      const isHealthy = await this.testTerminalHealth(terminal);
      
      if (isHealthy) {
        terminal.status = 'healthy';
        terminal.health.consecutiveFailures = 0;
        this.log(`✅ Terminal ${terminal.id} repaired successfully`);
        return true;
      } else if (level < RepairLevel.KILL) {
        // Try next level
        return this.repairTerminal(terminal, level + 1);
      }
      
      return false;
      
    } catch (error) {
      this.log(`❌ Repair failed for terminal ${terminal.id}: ${error.message}`);
      
      if (level < RepairLevel.KILL) {
        return this.repairTerminal(terminal, level + 1);
      }
      
      return false;
    } finally {
      const duration = Date.now() - startTime;
      this.audit('terminal:repair', {
        terminalId: terminal.id,
        level: RepairLevel[level],
        duration,
        success: terminal.status === 'healthy'
      });
    }
  }

  /**
   * Dump terminal context for recovery
   */
  private async dumpTerminalContext(terminal: Terminal): Promise<any> {
    // In production, would query terminal for state
    return {
      workingDirectory: process.cwd(),
      environmentVars: process.env,
      openFiles: [],
      history: terminal.history
    };
  }

  /**
   * Restore terminal context
   */
  private async restoreTerminalContext(terminal: Terminal, context: any): Promise<void> {
    // Restore working directory
    if (context.workingDirectory) {
      terminal.process.stdin?.write(`cd ${context.workingDirectory}\n`);
    }
    
    // Restore environment variables
    for (const [key, value] of Object.entries(context.environmentVars || {})) {
      terminal.process.stdin?.write(`export ${key}="${value}"\n`);
    }
    
    await this.wait(1000);
  }

  /**
   * Restart terminal process
   */
  private async restartTerminalProcess(terminal: Terminal): Promise<void> {
    const newProcess = spawn('claude', ['--no-interactive'], {
      env: {
        ...process.env,
        TERMINAL_ID: terminal.id,
        AUTO_ACCEPT_PERMISSIONS: 'true'
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    terminal.process = newProcess;
    terminal.pid = newProcess.pid;
    terminal.health.repairAttempts = 0;
    
    this.setupTerminalHandlers(terminal);
  }

  /**
   * Test terminal health
   */
  private async testTerminalHealth(terminal: Terminal): Promise<boolean> {
    try {
      terminal.process.stdin?.write('echo "HEALTH_CHECK"\n');
      
      return new Promise((resolve) => {
        const timeout = setTimeout(() => resolve(false), 5000);
        
        const handler = (data: Buffer) => {
          if (data.toString().includes('HEALTH_CHECK')) {
            clearTimeout(timeout);
            terminal.process.stdout?.removeListener('data', handler);
            resolve(true);
          }
        };
        
        terminal.process.stdout?.on('data', handler);
      });
    } catch {
      return false;
    }
  }

  /**
   * Wait for terminal response
   */
  private async waitForResponse(terminal: Terminal, timeout: number): Promise<boolean> {
    const startTime = Date.now();
    
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        const timeSinceResponse = Date.now() - terminal.health.lastResponse.getTime();
        
        if (timeSinceResponse < 1000) {
          clearInterval(checkInterval);
          resolve(true);
        } else if (Date.now() - startTime > timeout) {
          clearInterval(checkInterval);
          resolve(false);
        }
      }, 100);
    });
  }

  /**
   * Replace a dead terminal
   */
  private async replaceTerminal(deadTerminal: Terminal): Promise<void> {
    this.log(`🔄 Replacing dead terminal ${deadTerminal.id}`);
    
    // Remove from pool
    this.terminals.delete(deadTerminal.id);
    
    // Create replacement
    const newTerminal = await this.createTerminal();
    
    // Transfer any active task
    if (deadTerminal.currentTask) {
      await this.transferTaskContext(deadTerminal.currentTask, deadTerminal, newTerminal);
    }
    
    this.emit('terminal:replaced', {
      old: deadTerminal.id,
      new: newTerminal.id
    });
  }

  /**
   * Add task to queue (FIFO)
   */
  public addTask(task: Partial<Task>): string {
    if (this.taskQueue.length >= this.config.taskQueueLimit) {
      throw new Error('Task queue is full');
    }

    const fullTask: Task = {
      id: `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: task.type || 'generic',
      input: task.input || {},
      context: task.context || this.createEmptyContext(),
      priority: task.priority || 5,
      attempts: 0,
      maxAttempts: task.maxAttempts || this.config.maxTaskAttempts,
      timeout: task.timeout || this.config.taskTimeout,
      createdAt: new Date()
    };

    this.taskQueue.push(fullTask);
    this.emit('task:queued', fullTask);
    
    return fullTask.id;
  }

  /**
   * Create empty task context
   */
  private createEmptyContext(): TaskContext {
    return {
      taskHistory: [],
      partialResults: null,
      checkpoints: new Map(),
      terminalId: '',
      workingDirectory: process.cwd(),
      environmentVars: {},
      openFiles: [],
      completedSteps: [],
      pendingSteps: [],
      errors: [],
      previousAttempts: []
    };
  }

  /**
   * Start task processor (FIFO)
   */
  private startTaskProcessor(): void {
    setInterval(() => {
      if (this.isShuttingDown) return;
      
      // Process tasks while we have available terminals
      while (this.taskQueue.length > 0 && this.hasAvailableTerminal()) {
        const task = this.taskQueue.shift()!;
        this.processTask(task);
      }
    }, 1000);
  }

  /**
   * Check if any terminal is available
   */
  private hasAvailableTerminal(): boolean {
    for (const terminal of this.terminals.values()) {
      if (terminal.status === 'healthy' && !terminal.currentTask) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get next available terminal
   */
  private getAvailableTerminal(): Terminal | null {
    for (const terminal of this.terminals.values()) {
      if (terminal.status === 'healthy' && !terminal.currentTask) {
        return terminal;
      }
    }
    return null;
  }

  /**
   * Process a task
   */
  private async processTask(task: Task): Promise<void> {
    const terminal = this.getAvailableTerminal();
    if (!terminal) {
      // Re-queue task
      this.taskQueue.unshift(task);
      return;
    }

    task.attempts++;
    task.startedAt = new Date();
    task.context.terminalId = terminal.id;
    
    // Add to previous attempts
    if (task.attempts > 1) {
      task.context.previousAttempts.push({
        terminalId: terminal.id,
        startTime: task.startedAt,
        endTime: new Date(),
        outcome: 'failure',
        lastCompletedStep: task.context.completedSteps[task.context.completedSteps.length - 1]
      });
    }

    terminal.currentTask = task;
    this.activeTaskCount++;
    
    this.log(`📋 Processing task ${task.id} on terminal ${terminal.id} (attempt ${task.attempts}/${task.maxAttempts})`);
    this.emit('task:started', { task, terminal });

    try {
      // Execute task with timeout
      const result = await this.executeTaskWithTimeout(terminal, task);
      
      // Task completed successfully
      task.completedAt = new Date();
      terminal.currentTask = undefined;
      terminal.history.push({
        taskId: task.id,
        startTime: task.startedAt,
        endTime: task.completedAt,
        success: true
      });
      
      this.activeTaskCount--;
      this.emit('task:completed', { task, result });
      
    } catch (error) {
      // Task failed
      task.error = error;
      terminal.currentTask = undefined;
      terminal.history.push({
        taskId: task.id,
        startTime: task.startedAt,
        endTime: new Date(),
        success: false,
        error: error.message
      });
      
      this.activeTaskCount--;
      
      // Determine if we should retry
      if (task.attempts < task.maxAttempts) {
        this.log(`🔄 Retrying task ${task.id} (${task.attempts}/${task.maxAttempts})`);
        this.taskQueue.push(task); // Re-queue at end (FIFO)
      } else {
        // Escalate to user after max attempts
        this.escalateToUser(task);
      }
      
      this.emit('task:failed', { task, error });
    }
  }

  /**
   * Execute task with timeout
   */
  private async executeTaskWithTimeout(terminal: Terminal, task: Task): Promise<any> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Task ${task.id} timed out after ${task.timeout}ms`));
      }, task.timeout);

      // In production, would send task to terminal and monitor
      // For now, simulate execution
      setTimeout(() => {
        clearTimeout(timeout);
        
        // Simulate 90% success rate
        if (Math.random() > 0.1) {
          resolve({ success: true, data: 'Task completed' });
        } else {
          reject(new Error('Simulated task failure'));
        }
      }, Math.random() * 5000 + 1000);
    });
  }

  /**
   * Reassign task to another terminal
   */
  private async reassignTask(task: Task, failedTerminal: Terminal): Promise<void> {
    this.log(`🔀 Reassigning task ${task.id} from failed terminal ${failedTerminal.id}`);
    
    // Capture context from failed terminal
    const context = await this.captureTaskContext(task, failedTerminal);
    
    // Update task context
    task.context = { ...task.context, ...context };
    
    // Re-queue task
    this.taskQueue.unshift(task); // Add to front for immediate processing
    
    this.emit('task:reassigned', {
      task,
      fromTerminal: failedTerminal.id
    });
  }

  /**
   * Transfer task context between terminals
   */
  private async transferTaskContext(
    task: Task, 
    fromTerminal: Terminal, 
    toTerminal: Terminal
  ): Promise<void> {
    if (!this.config.contextTransfer) return;
    
    this.log(`📦 Transferring context for task ${task.id}: ${fromTerminal.id} → ${toTerminal.id}`);
    
    // Capture comprehensive context
    const context = await this.captureTaskContext(task, fromTerminal);
    
    // Apply context to new terminal
    await this.applyTaskContext(context, toTerminal);
    
    // Update task
    task.context = { ...task.context, ...context };
    task.context.terminalId = toTerminal.id;
    
    this.emit('context:transferred', {
      task,
      from: fromTerminal.id,
      to: toTerminal.id
    });
  }

  /**
   * Capture task context from terminal
   */
  private async captureTaskContext(task: Task, terminal: Terminal): Promise<Partial<TaskContext>> {
    return {
      taskHistory: [...task.context.taskHistory, `Failed on ${terminal.id}`],
      partialResults: task.context.partialResults,
      checkpoints: new Map(task.context.checkpoints),
      workingDirectory: task.context.workingDirectory,
      environmentVars: { ...task.context.environmentVars },
      openFiles: [...task.context.openFiles],
      completedSteps: [...task.context.completedSteps],
      pendingSteps: [...task.context.pendingSteps],
      errors: [...task.context.errors]
    };
  }

  /**
   * Apply task context to terminal
   */
  private async applyTaskContext(context: Partial<TaskContext>, terminal: Terminal): Promise<void> {
    // Change to working directory
    if (context.workingDirectory) {
      terminal.process.stdin?.write(`cd ${context.workingDirectory}\n`);
    }
    
    // Set environment variables
    for (const [key, value] of Object.entries(context.environmentVars || {})) {
      terminal.process.stdin?.write(`export ${key}="${value}"\n`);
    }
    
    // Open files
    for (const file of context.openFiles || []) {
      terminal.process.stdin?.write(`# Previously opened: ${file}\n`);
    }
    
    // Provide task history
    terminal.process.stdin?.write(`# Task history:\n`);
    for (const step of context.completedSteps || []) {
      terminal.process.stdin?.write(`# ✓ ${step}\n`);
    }
    
    await this.wait(1000);
  }

  /**
   * Escalate task to user after max failures
   */
  private escalateToUser(task: Task): void {
    this.log(`🚨 ESCALATION: Task ${task.id} failed ${task.maxAttempts} times`);
    
    const escalation = {
      task,
      attempts: task.attempts,
      errors: task.context.errors,
      lastError: task.error?.message,
      recommendation: this.generateRecommendation(task)
    };
    
    this.emit('task:escalated', escalation);
    
    // Log to audit trail
    this.audit('task:escalated', escalation);
    
    // In production, would notify user via configured channel
    console.error('\n🚨 USER ATTENTION REQUIRED 🚨');
    console.error(`Task ${task.id} has failed ${task.maxAttempts} times`);
    console.error(`Type: ${task.type}`);
    console.error(`Last error: ${task.error?.message}`);
    console.error(`Recommendation: ${escalation.recommendation}`);
    console.error('Please investigate and intervene manually.\n');
  }

  /**
   * Generate recommendation for escalated task
   */
  private generateRecommendation(task: Task): string {
    const errors = task.context.errors;
    
    if (errors.some(e => e.error.includes('permission'))) {
      return 'Check file/folder permissions and access rights';
    }
    
    if (errors.some(e => e.error.includes('API'))) {
      return 'Check API credentials and rate limits';
    }
    
    if (errors.some(e => e.error.includes('timeout'))) {
      return 'Increase timeout or break task into smaller parts';
    }
    
    if (errors.some(e => e.error.includes('memory'))) {
      return 'Check system resources and terminal memory limits';
    }
    
    return 'Manual investigation required - check logs for details';
  }

  /**
   * Start pool maintenance
   */
  private startPoolMaintenance(): void {
    this.poolMaintenanceInterval = setInterval(() => {
      this.maintainPool();
    }, 10000); // Every 10 seconds
  }

  /**
   * Maintain terminal pool
   */
  private async maintainPool(): Promise<void> {
    if (this.isShuttingDown) return;
    
    // Ensure pool is at full capacity
    const currentSize = this.terminals.size;
    if (currentSize < this.config.maxTerminals) {
      const needed = this.config.maxTerminals - currentSize;
      this.log(`📊 Pool maintenance: Creating ${needed} terminals to reach capacity`);
      
      for (let i = 0; i < needed; i++) {
        await this.createTerminal();
      }
    }
    
    // Check for unhealthy terminals
    for (const terminal of this.terminals.values()) {
      if (terminal.status !== 'healthy' && terminal.status !== 'repairing') {
        const repaired = await this.repairTerminal(terminal);
        if (!repaired) {
          await this.replaceTerminal(terminal);
        }
      }
    }
  }

  /**
   * Start health monitoring
   */
  private startHealthMonitoring(): void {
    this.healthCheckInterval = setInterval(() => {
      this.checkTerminalHealth();
    }, 30000); // Every 30 seconds
  }

  /**
   * Check health of all terminals
   */
  private async checkTerminalHealth(): Promise<void> {
    if (this.isShuttingDown) return;
    
    for (const terminal of this.terminals.values()) {
      const timeSinceResponse = Date.now() - terminal.health.lastResponse.getTime();
      
      if (timeSinceResponse > this.config.terminalTimeout) {
        this.log(`⚠️  Terminal ${terminal.id} unresponsive for ${timeSinceResponse}ms`);
        terminal.health.consecutiveFailures++;
        
        if (terminal.health.consecutiveFailures > 2) {
          await this.repairTerminal(terminal);
        }
      }
    }
  }

  /**
   * Get pool metrics
   */
  public getMetrics() {
    const terminals = Array.from(this.terminals.values());
    
    return {
      poolSize: this.terminals.size,
      maxPoolSize: this.config.maxTerminals,
      healthyTerminals: terminals.filter(t => t.status === 'healthy').length,
      repairingTerminals: terminals.filter(t => t.status === 'repairing').length,
      deadTerminals: terminals.filter(t => t.status === 'dead').length,
      queueLength: this.taskQueue.length,
      activeTasks: this.activeTaskCount,
      totalProcessed: terminals.reduce((sum, t) => sum + t.history.length, 0),
      totalErrors: terminals.reduce((sum, t) => sum + t.health.totalErrors, 0),
      avgRepairAttempts: terminals.reduce((sum, t) => sum + t.health.repairAttempts, 0) / terminals.length
    };
  }

  /**
   * Graceful shutdown
   */
  public async shutdown(): Promise<void> {
    this.log('🛑 Shutting down Terminal Pool Manager');
    this.isShuttingDown = true;
    
    // Stop intervals
    if (this.poolMaintenanceInterval) clearInterval(this.poolMaintenanceInterval);
    if (this.healthCheckInterval) clearInterval(this.healthCheckInterval);
    
    // Wait for active tasks to complete (with timeout)
    const shutdownTimeout = 30000;
    const startTime = Date.now();
    
    while (this.activeTaskCount > 0 && Date.now() - startTime < shutdownTimeout) {
      await this.wait(1000);
    }
    
    // Kill all terminals
    for (const terminal of this.terminals.values()) {
      terminal.process.kill();
    }
    
    // Save audit log if enabled
    if (this.config.auditLog) {
      await this.saveAuditLog();
    }
    
    this.emit('shutdown');
  }

  /**
   * Add entry to audit log
   */
  private audit(event: string, data: any): void {
    if (!this.config.auditLog) return;
    
    this.auditLog.push({
      timestamp: new Date(),
      event,
      data
    });
  }

  /**
   * Save audit log to file
   */
  private async saveAuditLog(): Promise<void> {
    const logPath = path.join(process.cwd(), `terminal-pool-audit-${Date.now()}.json`);
    fs.writeFileSync(logPath, JSON.stringify(this.auditLog, null, 2));
    this.log(`📝 Audit log saved to ${logPath}`);
  }

  /**
   * Utility: wait for specified time
   */
  private wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Log message
   */
  private log(message: string): void {
    console.log(`[TerminalPool] ${message}`);
    this.emit('log', message);
  }
}

export default TerminalPoolManager;