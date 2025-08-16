#!/usr/bin/env node

/**
 * Memory Profiler for CC Instances
 * Measures actual memory usage of Claude Code processes
 */

import { spawn, execSync } from 'child_process';
import * as os from 'os';

interface ProcessMemory {
  pid: number;
  command: string;
  rss: number;    // Resident Set Size (physical memory)
  vsz: number;    // Virtual Size
  cpu: number;    // CPU usage
}

class CCMemoryProfiler {
  
  /**
   * Get memory usage of all Claude Code processes
   */
  async getCCProcessMemory(): Promise<ProcessMemory[]> {
    try {
      // Find all claude code processes
      const psOutput = execSync('ps aux | grep -i claude', { encoding: 'utf8' });
      const lines = psOutput.split('\n').filter(line => 
        line.includes('claude') && !line.includes('grep')
      );

      const processes: ProcessMemory[] = [];
      
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 11) {
          processes.push({
            pid: parseInt(parts[1]),
            command: parts.slice(10).join(' '),
            rss: parseInt(parts[5]) * 1024, // Convert KB to bytes
            vsz: parseInt(parts[4]) * 1024, // Convert KB to bytes  
            cpu: parseFloat(parts[2])
          });
        }
      }

      return processes;
    } catch (error) {
      console.warn('Could not get process memory info:', error.message);
      return [];
    }
  }

  /**
   * Estimate CC instance memory requirements
   */
  estimateCCMemoryRequirements(): {
    baseline: number;
    working: number;
    peak: number;
    recommended: number;
  } {
    
    // Component analysis (in MB)
    const components = {
      nodeRuntime: 75,        // Base Node.js process
      ccApplication: 125,     // Claude Code CLI + dependencies
      apiClient: 150,         // Claude API client + context
      contextBuffer: 100,     // Context window buffer
      fileOperations: 75,     // File I/O buffers
      tempData: 50,          // Temporary processing data
      overhead: 25           // OS and misc overhead
    };

    const baseline = Object.values(components).reduce((sum, val) => sum + val, 0);
    const working = baseline * 1.2;  // 20% working overhead
    const peak = baseline * 1.5;     // 50% peak usage
    const recommended = Math.ceil(peak / 50) * 50; // Round up to nearest 50MB

    console.log('🧮 CC Instance Memory Analysis:');
    console.log('================================');
    
    Object.entries(components).forEach(([component, mb]) => {
      console.log(`${component.padEnd(20)}: ${mb.toString().padStart(3)} MB`);
    });
    
    console.log('================================');
    console.log(`Baseline total       : ${baseline} MB`);
    console.log(`Working memory       : ${working.toFixed(0)} MB`);
    console.log(`Peak usage          : ${peak.toFixed(0)} MB`);
    console.log(`Recommended buffer  : ${recommended} MB`);

    return {
      baseline,
      working: Math.round(working),
      peak: Math.round(peak),
      recommended
    };
  }

  /**
   * Benchmark actual CC instance spawn
   */
  async benchmarkCCInstance(): Promise<{
    spawnTime: number;
    initialMemory: number;
    workingMemory: number;
    peakMemory: number;
  }> {
    
    console.log('\n🧪 Benchmarking actual CC instance...');
    
    const startTime = Date.now();
    
    // Simulate CC instance (we'll use a simple Node.js process as proxy)
    const testProcess = spawn('node', ['-e', `
      console.log('CC Instance starting...');
      
      // Simulate CC memory usage
      const buffers = [];
      
      // Simulate API client
      buffers.push(Buffer.alloc(150 * 1024 * 1024)); // 150MB
      
      // Simulate context buffer  
      buffers.push(Buffer.alloc(100 * 1024 * 1024)); // 100MB
      
      // Simulate file operations
      buffers.push(Buffer.alloc(75 * 1024 * 1024));  // 75MB
      
      console.log('Memory allocated, monitoring...');
      
      setInterval(() => {
        const usage = process.memoryUsage();
        console.log(JSON.stringify({
          rss: usage.rss,
          heapUsed: usage.heapUsed,
          heapTotal: usage.heapTotal,
          external: usage.external
        }));
      }, 1000);
      
      // Keep alive for 10 seconds
      setTimeout(() => {
        console.log('CC Instance shutting down...');
        process.exit(0);
      }, 10000);
    `], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let initialMemory = 0;
    let workingMemory = 0;
    let peakMemory = 0;
    let measurements = 0;

    return new Promise((resolve) => {
      testProcess.stdout?.on('data', (data) => {
        const output = data.toString().trim();
        
        try {
          const usage = JSON.parse(output);
          const rssMB = Math.round(usage.rss / (1024 * 1024));
          
          if (measurements === 0) {
            initialMemory = rssMB;
          } else if (measurements < 5) {
            workingMemory = Math.max(workingMemory, rssMB);
          } else {
            peakMemory = Math.max(peakMemory, rssMB);
          }
          
          measurements++;
          console.log(`Memory usage: ${rssB} MB`);
          
        } catch (error) {
          // Non-JSON output, ignore
        }
      });

      testProcess.on('close', () => {
        const spawnTime = Date.now() - startTime;
        
        resolve({
          spawnTime,
          initialMemory,
          workingMemory,
          peakMemory
        });
      });
    });
  }

  /**
   * Compare with system resources
   */
  compareWithSystemResources(recommendedMB: number): {
    totalRAM: number;
    maxInstances: number;
    memoryUtilization: number;
    recommendation: string;
  } {
    const totalRAM = Math.round(os.totalmem() / (1024 * 1024));
    const allocatedRAM = Math.round(totalRAM * 0.5);
    const maxInstances = Math.floor(allocatedRAM / recommendedMB);
    const memoryUtilization = (maxInstances * recommendedMB) / totalRAM;

    console.log('\n📊 System Resource Comparison:');
    console.log('===============================');
    console.log(`Total system RAM     : ${totalRAM.toLocaleString()} MB`);
    console.log(`Allocated for CC     : ${allocatedRAM.toLocaleString()} MB (50%)`);
    console.log(`Memory per instance  : ${recommendedMB} MB`);
    console.log(`Max possible instances: ${maxInstances}`);
    console.log(`Memory utilization   : ${(memoryUtilization * 100).toFixed(1)}%`);

    let recommendation = '';
    if (maxInstances < 5) {
      recommendation = '⚠️  Consider adding more RAM for better parallelization';
    } else if (maxInstances > 50) {
      recommendation = '🚀 Excellent RAM for massive parallel operations';
    } else {
      recommendation = '✅ Good RAM allocation for parallel processing';
    }

    return {
      totalRAM,
      maxInstances,
      memoryUtilization,
      recommendation
    };
  }
}

// Main execution
async function main() {
  const profiler = new CCMemoryProfiler();
  
  console.log('🔍 Claude Code Memory Profiler');
  console.log('===============================\n');

  // 1. Check current CC processes
  const currentProcesses = await profiler.getCCProcessMemory();
  if (currentProcesses.length > 0) {
    console.log('📋 Current CC Processes:');
    currentProcesses.forEach(proc => {
      console.log(`PID ${proc.pid}: ${Math.round(proc.rss / (1024 * 1024))} MB - ${proc.command.substring(0, 50)}...`);
    });
  }

  // 2. Estimate requirements
  const estimates = profiler.estimateCCMemoryRequirements();

  // 3. Benchmark actual instance (commented out for safety)
  // const benchmark = await profiler.benchmarkCCInstance();

  // 4. Compare with system
  const comparison = profiler.compareWithSystemResources(estimates.recommended);
  
  console.log(`\n💡 ${comparison.recommendation}`);
  
  console.log('\n🎯 Final Recommendation:');
  console.log(`Use ${estimates.recommended} MB per CC instance for optimal performance`);
}

if (require.main === module) {
  main().catch(console.error);
}

export { CCMemoryProfiler };