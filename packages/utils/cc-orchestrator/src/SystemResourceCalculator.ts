/**
 * SystemResourceCalculator
 * Dynamically calculates optimal CC instance count based on system resources
 */

import * as os from 'os';
import * as fs from 'fs/promises';
import { execSync } from 'child_process';
import { Logger } from './utils/Logger';

interface SystemResources {
  totalRAM: number;          // Total system RAM in MB
  availableRAM: number;      // Available RAM in MB
  allocatedRAM: number;      // RAM allocated for parallel processing (50% of total)
  totalStorage: number;      // Total storage in MB
  availableStorage: number;  // Available storage in MB
  cpuCores: number;         // Number of CPU cores
  platform: string;        // Operating system platform
}

interface InstanceRequirements {
  ramPerInstance: number;    // RAM needed per CC instance in MB
  storagePerInstance: number; // Storage needed per instance in MB
  cpuWeight: number;        // CPU weight per instance (0-1)
}

interface ResourceCalculation {
  maxInstances: number;      // Recommended max instances
  reason: string;           // Why this number was chosen
  bottleneck: 'ram' | 'storage' | 'cpu' | 'none';
  recommendations: string[];
  systemInfo: SystemResources;
  instanceRequirements: InstanceRequirements;
}

export class SystemResourceCalculator {
  private logger: Logger;
  private platform: NodeJS.Platform;

  constructor() {
    this.logger = new Logger('SystemResourceCalculator');
    this.platform = os.platform();
  }

  /**
   * Calculate optimal max instances based on system resources
   */
  async calculateOptimalInstances(): Promise<ResourceCalculation> {
    try {
      this.logger.info('🔍 Analyzing system resources for optimal CC instance count');

      // Get system resources
      const systemResources = await this.getSystemResources();
      
      // Define instance requirements
      const instanceRequirements = this.getInstanceRequirements();
      
      // Calculate based on different constraints
      const ramBasedMax = this.calculateRamBasedMax(systemResources, instanceRequirements);
      const storageBasedMax = this.calculateStorageBasedMax(systemResources, instanceRequirements);
      const cpuBasedMax = this.calculateCpuBasedMax(systemResources, instanceRequirements);
      
      // Find the limiting factor
      const calculations = [
        { type: 'ram', max: ramBasedMax },
        { type: 'storage', max: storageBasedMax },
        { type: 'cpu', max: cpuBasedMax }
      ];
      
      const limitingFactor = calculations.reduce((min, curr) => 
        curr.max < min.max ? curr : min
      );
      
      // Apply safety margin (85% of calculated max)
      const safeMaxInstances = Math.floor(limitingFactor.max * 0.85);
      const finalMaxInstances = Math.max(1, Math.min(safeMaxInstances, 50)); // Cap at 50
      
      const result: ResourceCalculation = {
        maxInstances: finalMaxInstances,
        reason: this.generateReason(limitingFactor.type as any, finalMaxInstances, systemResources),
        bottleneck: limitingFactor.type as any,
        recommendations: this.generateRecommendations(limitingFactor.type as any, systemResources),
        systemInfo: systemResources,
        instanceRequirements
      };
      
      this.logger.info(`💡 Calculated optimal instances: ${finalMaxInstances} (bottleneck: ${limitingFactor.type})`);
      return result;

    } catch (error) {
      this.logger.error('Failed to calculate optimal instances', error);
      
      // Fallback to conservative defaults
      return {
        maxInstances: 5,
        reason: 'Using conservative fallback due to calculation error',
        bottleneck: 'none',
        recommendations: ['Check system resource access permissions'],
        systemInfo: await this.getSystemResourcesFallback(),
        instanceRequirements: this.getInstanceRequirements()
      };
    }
  }

  /**
   * Get comprehensive system resource information
   */
  private async getSystemResources(): Promise<SystemResources> {
    const totalRAM = os.totalmem() / (1024 * 1024); // Convert to MB
    const freeRAM = os.freemem() / (1024 * 1024);
    const allocatedRAM = totalRAM * 0.5; // Use 50% of total RAM
    
    let totalStorage = 0;
    let availableStorage = 0;
    
    try {
      const storageInfo = await this.getStorageInfo();
      totalStorage = storageInfo.total;
      availableStorage = storageInfo.available;
    } catch (error) {
      this.logger.warn('Could not get storage info, using estimates', error);
      totalStorage = 500000; // 500GB estimate
      availableStorage = 100000; // 100GB estimate
    }

    return {
      totalRAM: Math.round(totalRAM),
      availableRAM: Math.round(freeRAM),
      allocatedRAM: Math.round(allocatedRAM),
      totalStorage: Math.round(totalStorage),
      availableStorage: Math.round(availableStorage),
      cpuCores: os.cpus().length,
      platform: this.platform
    };
  }

  /**
   * Get storage information based on platform
   */
  private async getStorageInfo(): Promise<{ total: number; available: number }> {
    try {
      switch (this.platform) {
        case 'darwin': // macOS
          return await this.getMacOSStorageInfo();
        case 'linux':
          return await this.getLinuxStorageInfo();
        case 'win32':
          return await this.getWindowsStorageInfo();
        default:
          throw new Error(`Unsupported platform: ${this.platform}`);
      }
    } catch (error) {
      this.logger.warn('Platform-specific storage detection failed', error);
      return { total: 500000, available: 100000 }; // Fallback estimates
    }
  }

  /**
   * Get macOS storage information
   */
  private async getMacOSStorageInfo(): Promise<{ total: number; available: number }> {
    try {
      const output = execSync('df -m / | tail -1', { encoding: 'utf8' });
      const parts = output.trim().split(/\s+/);
      
      const total = parseInt(parts[1]); // Total in MB
      const available = parseInt(parts[3]); // Available in MB
      
      return { total, available };
    } catch (error) {
      throw new Error(`Failed to get macOS storage info: ${error.message}`);
    }
  }

  /**
   * Get Linux storage information
   */
  private async getLinuxStorageInfo(): Promise<{ total: number; available: number }> {
    try {
      const output = execSync('df -m / | tail -1', { encoding: 'utf8' });
      const parts = output.trim().split(/\s+/);
      
      const total = parseInt(parts[1]);
      const available = parseInt(parts[3]);
      
      return { total, available };
    } catch (error) {
      throw new Error(`Failed to get Linux storage info: ${error.message}`);
    }
  }

  /**
   * Get Windows storage information
   */
  private async getWindowsStorageInfo(): Promise<{ total: number; available: number }> {
    try {
      const output = execSync('wmic logicaldisk where caption="C:" get size,freespace /value', { encoding: 'utf8' });
      
      const freeMatch = output.match(/FreeSpace=(\d+)/);
      const sizeMatch = output.match(/Size=(\d+)/);
      
      if (!freeMatch || !sizeMatch) {
        throw new Error('Could not parse Windows storage info');
      }
      
      const total = Math.round(parseInt(sizeMatch[1]) / (1024 * 1024)); // Convert to MB
      const available = Math.round(parseInt(freeMatch[1]) / (1024 * 1024));
      
      return { total, available };
    } catch (error) {
      throw new Error(`Failed to get Windows storage info: ${error.message}`);
    }
  }

  /**
   * Define resource requirements per CC instance
   */
  private getInstanceRequirements(): InstanceRequirements {
    return {
      ramPerInstance: 512,       // 512MB RAM per CC instance (Node.js + Claude context)
      storagePerInstance: 50,    // 50MB storage per instance (temp files, logs)
      cpuWeight: 0.25           // Each instance uses ~25% of a CPU core on average
    };
  }

  /**
   * Calculate max instances based on RAM availability
   */
  private calculateRamBasedMax(system: SystemResources, requirements: InstanceRequirements): number {
    const maxInstances = Math.floor(system.allocatedRAM / requirements.ramPerInstance);
    this.logger.debug(`RAM calculation: ${system.allocatedRAM}MB allocated ÷ ${requirements.ramPerInstance}MB per instance = ${maxInstances}`);
    return maxInstances;
  }

  /**
   * Calculate max instances based on storage availability
   */
  private calculateStorageBasedMax(system: SystemResources, requirements: InstanceRequirements): number {
    // Use 10% of available storage for CC instances
    const storageForInstances = system.availableStorage * 0.1;
    const maxInstances = Math.floor(storageForInstances / requirements.storagePerInstance);
    this.logger.debug(`Storage calculation: ${storageForInstances}MB available ÷ ${requirements.storagePerInstance}MB per instance = ${maxInstances}`);
    return maxInstances;
  }

  /**
   * Calculate max instances based on CPU cores
   */
  private calculateCpuBasedMax(system: SystemResources, requirements: InstanceRequirements): number {
    // Leave 1 core for system, use 80% of remaining cores
    const availableCores = Math.max(1, system.cpuCores - 1) * 0.8;
    const maxInstances = Math.floor(availableCores / requirements.cpuWeight);
    this.logger.debug(`CPU calculation: ${availableCores} available cores ÷ ${requirements.cpuWeight} weight per instance = ${maxInstances}`);
    return maxInstances;
  }

  /**
   * Generate human-readable reason for the calculated max instances
   */
  private generateReason(bottleneck: 'ram' | 'storage' | 'cpu', maxInstances: number, system: SystemResources): string {
    const reasons = {
      ram: `Limited by RAM: ${system.allocatedRAM}MB allocated for parallel processing (50% of ${system.totalRAM}MB total)`,
      storage: `Limited by storage: ${Math.round(system.availableStorage * 0.1)}MB allocated for instances (10% of ${system.availableStorage}MB available)`,
      cpu: `Limited by CPU: ${system.cpuCores} cores available for parallel processing`
    };

    return `${reasons[bottleneck]}. Recommended ${maxInstances} instances with 15% safety margin.`;
  }

  /**
   * Generate recommendations for optimization
   */
  private generateRecommendations(bottleneck: 'ram' | 'storage' | 'cpu', system: SystemResources): string[] {
    const recommendations: string[] = [];

    switch (bottleneck) {
      case 'ram':
        recommendations.push('💾 Consider adding more RAM for higher parallelization');
        recommendations.push('🧹 Close unnecessary applications to free up memory');
        if (system.allocatedRAM < 4000) {
          recommendations.push('⚠️  Low RAM detected - consider upgrading to 16GB+ for optimal performance');
        }
        break;

      case 'storage':
        recommendations.push('💿 Free up disk space for better performance');
        recommendations.push('🗄️ Consider using SSD for faster I/O operations');
        if (system.availableStorage < 10000) {
          recommendations.push('⚠️  Low storage detected - consider freeing up space or adding storage');
        }
        break;

      case 'cpu':
        recommendations.push('🔥 Consider upgrading to a CPU with more cores');
        recommendations.push('⚡ Close CPU-intensive applications during parallel processing');
        if (system.cpuCores < 8) {
          recommendations.push('⚠️  Limited CPU cores - consider upgrading for better parallel performance');
        }
        break;
    }

    // General recommendations
    recommendations.push('📊 Use CCU to apply performance optimizations automatically');
    recommendations.push('🔄 Monitor instance performance and adjust based on actual usage');

    return recommendations;
  }

  /**
   * Fallback system resource detection
   */
  private async getSystemResourcesFallback(): Promise<SystemResources> {
    const totalRAM = os.totalmem() / (1024 * 1024);
    const freeRAM = os.freemem() / (1024 * 1024);

    return {
      totalRAM: Math.round(totalRAM),
      availableRAM: Math.round(freeRAM),
      allocatedRAM: Math.round(totalRAM * 0.5),
      totalStorage: 500000, // 500GB estimate
      availableStorage: 100000, // 100GB estimate
      cpuCores: os.cpus().length,
      platform: this.platform
    };
  }

  /**
   * Get current system resource utilization
   */
  async getCurrentUtilization(): Promise<{
    ramUsage: number;
    storageUsage: number;
    cpuLoad: number;
  }> {
    const system = await this.getSystemResources();
    
    return {
      ramUsage: (system.totalRAM - system.availableRAM) / system.totalRAM,
      storageUsage: (system.totalStorage - system.availableStorage) / system.totalStorage,
      cpuLoad: await this.getCpuLoad()
    };
  }

  /**
   * Get current CPU load average
   */
  private async getCpuLoad(): Promise<number> {
    try {
      const loadAvg = os.loadavg();
      const cpuCores = os.cpus().length;
      
      // Use 1-minute load average normalized by core count
      return Math.min(1, loadAvg[0] / cpuCores);
    } catch (error) {
      this.logger.warn('Could not get CPU load', error);
      return 0.5; // Assume 50% load
    }
  }

  /**
   * Monitor resources and suggest adjustments
   */
  async monitorAndSuggestAdjustments(currentInstances: number): Promise<{
    shouldAdjust: boolean;
    suggestedInstances: number;
    reason: string;
  }> {
    const utilization = await this.getCurrentUtilization();
    const calculation = await this.calculateOptimalInstances();
    
    // If utilization is high (>80%) and we're at max, suggest reducing
    if (utilization.ramUsage > 0.8 && currentInstances >= calculation.maxInstances) {
      return {
        shouldAdjust: true,
        suggestedInstances: Math.max(1, Math.floor(currentInstances * 0.8)),
        reason: 'High resource utilization detected - reducing instances for stability'
      };
    }
    
    // If utilization is low (<50%) and we're below max, suggest increasing
    if (utilization.ramUsage < 0.5 && currentInstances < calculation.maxInstances) {
      return {
        shouldAdjust: true,
        suggestedInstances: Math.min(calculation.maxInstances, currentInstances + 2),
        reason: 'Low resource utilization - can safely increase instances'
      };
    }
    
    return {
      shouldAdjust: false,
      suggestedInstances: currentInstances,
      reason: 'Current instance count is optimal'
    };
  }
}

// Helper function to get current utilization (for monitoring)
async function getCurrentUtilization() {
  const calculator = new SystemResourceCalculator();
  return await calculator.getCurrentUtilization();
}