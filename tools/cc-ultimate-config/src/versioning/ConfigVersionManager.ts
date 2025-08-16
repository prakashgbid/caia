/**
 * ConfigVersionManager
 * Manages configuration versions, snapshots, and history
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { createHash } from 'crypto';
import * as semver from 'semver';
import { Logger } from '../utils/logger';

interface ConfigVersion {
  version: string;
  timestamp: Date;
  description: string;
  changes: ConfigChange[];
  hash: string;
  author: string;
  tags: string[];
}

interface ConfigChange {
  type: 'add' | 'modify' | 'remove';
  category: string;
  configId: string;
  name: string;
  before?: any;
  after?: any;
  reason: string;
}

interface ConfigSnapshot {
  version: string;
  timestamp: Date;
  config: any;
  hash: string;
  size: number;
}

export class ConfigVersionManager {
  private logger: Logger;
  private versionsDir: string;
  private snapshotsDir: string;
  private currentVersion?: string;
  private configPath: string;

  constructor(configPath: string) {
    this.logger = new Logger('ConfigVersionManager');
    this.configPath = configPath;
    this.versionsDir = path.join(path.dirname(configPath), '../versions');
    this.snapshotsDir = path.join(path.dirname(configPath), '../snapshots');
  }

  /**
   * Initialize version management
   */
  async initialize(): Promise<void> {
    await this.ensureDirectories();
    await this.loadCurrentVersion();
    this.logger.info('Version manager initialized');
  }

  /**
   * Create a new version from current config
   */
  async createVersion(description: string, changes: ConfigChange[], tags: string[] = []): Promise<string> {
    try {
      // Load current configuration
      const config = await this.loadConfiguration();
      
      // Calculate next version
      const nextVersion = await this.calculateNextVersion(changes);
      
      // Create version record
      const version: ConfigVersion = {
        version: nextVersion,
        timestamp: new Date(),
        description,
        changes,
        hash: this.calculateConfigHash(config),
        author: process.env.USER || 'ccu-system',
        tags
      };

      // Save version metadata
      await this.saveVersion(version);
      
      // Create snapshot
      await this.createSnapshot(nextVersion, config);
      
      // Update current version
      this.currentVersion = nextVersion;
      
      this.logger.info(`Created version ${nextVersion}: ${description}`);
      return nextVersion;

    } catch (error) {
      this.logger.error('Failed to create version', error);
      throw error;
    }
  }

  /**
   * Restore to a specific version
   */
  async restoreVersion(version: string): Promise<boolean> {
    try {
      this.logger.info(`Restoring to version ${version}`);

      // Validate version exists
      const versionData = await this.getVersion(version);
      if (!versionData) {
        throw new Error(`Version ${version} not found`);
      }

      // Load snapshot
      const snapshot = await this.getSnapshot(version);
      if (!snapshot) {
        throw new Error(`Snapshot for version ${version} not found`);
      }

      // Create backup of current state
      const backupVersion = await this.createVersion(
        `Backup before restore to ${version}`,
        [{ type: 'modify', category: 'system', configId: 'restore', name: 'restore-backup', reason: 'Auto-backup before restore' }],
        ['backup', 'auto']
      );

      // Restore configuration
      await this.saveConfiguration(snapshot.config);
      
      // Update current version
      this.currentVersion = version;
      
      this.logger.info(`Successfully restored to version ${version} (backup: ${backupVersion})`);
      return true;

    } catch (error) {
      this.logger.error(`Failed to restore version ${version}`, error);
      return false;
    }
  }

  /**
   * Get version history
   */
  async getVersionHistory(limit?: number): Promise<ConfigVersion[]> {
    try {
      const versionFiles = await fs.readdir(this.versionsDir);
      const versions: ConfigVersion[] = [];

      for (const file of versionFiles) {
        if (file.endsWith('.json')) {
          const versionData = await this.loadVersionFile(file);
          if (versionData) {
            versions.push(versionData);
          }
        }
      }

      // Sort by version (newest first)
      versions.sort((a, b) => semver.rcompare(a.version, b.version));

      return limit ? versions.slice(0, limit) : versions;

    } catch (error) {
      this.logger.error('Failed to get version history', error);
      return [];
    }
  }

  /**
   * Get changes between versions
   */
  async getVersionDiff(fromVersion: string, toVersion: string): Promise<ConfigChange[]> {
    try {
      const fromSnapshot = await this.getSnapshot(fromVersion);
      const toSnapshot = await this.getSnapshot(toVersion);

      if (!fromSnapshot || !toSnapshot) {
        throw new Error('One or both snapshots not found');
      }

      return this.calculateDiff(fromSnapshot.config, toSnapshot.config);

    } catch (error) {
      this.logger.error(`Failed to get diff between ${fromVersion} and ${toVersion}`, error);
      return [];
    }
  }

  /**
   * Tag a version
   */
  async tagVersion(version: string, tags: string[]): Promise<boolean> {
    try {
      const versionData = await this.getVersion(version);
      if (!versionData) {
        throw new Error(`Version ${version} not found`);
      }

      // Add new tags (avoiding duplicates)
      const existingTags = new Set(versionData.tags);
      for (const tag of tags) {
        existingTags.add(tag);
      }

      versionData.tags = Array.from(existingTags);
      
      await this.saveVersion(versionData);
      
      this.logger.info(`Tagged version ${version} with: ${tags.join(', ')}`);
      return true;

    } catch (error) {
      this.logger.error(`Failed to tag version ${version}`, error);
      return false;
    }
  }

  /**
   * Get versions by tag
   */
  async getVersionsByTag(tag: string): Promise<ConfigVersion[]> {
    const allVersions = await this.getVersionHistory();
    return allVersions.filter(v => v.tags.includes(tag));
  }

  /**
   * Clean up old versions
   */
  async cleanupVersions(keepVersions: number = 10, keepDays: number = 30): Promise<void> {
    try {
      this.logger.info(`Cleaning up versions (keep ${keepVersions} versions, ${keepDays} days)`);

      const versions = await this.getVersionHistory();
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - keepDays);

      let deletedCount = 0;

      for (let i = keepVersions; i < versions.length; i++) {
        const version = versions[i];
        
        // Don't delete tagged versions
        if (version.tags.length > 0) {
          continue;
        }

        // Don't delete recent versions
        if (version.timestamp > cutoffDate) {
          continue;
        }

        await this.deleteVersion(version.version);
        deletedCount++;
      }

      this.logger.info(`Cleaned up ${deletedCount} old versions`);

    } catch (error) {
      this.logger.error('Failed to cleanup versions', error);
    }
  }

  /**
   * Export version data
   */
  async exportVersion(version: string, exportPath: string): Promise<boolean> {
    try {
      const versionData = await this.getVersion(version);
      const snapshot = await this.getSnapshot(version);

      if (!versionData || !snapshot) {
        throw new Error(`Version ${version} not found`);
      }

      const exportData = {
        version: versionData,
        config: snapshot.config,
        exportTime: new Date().toISOString(),
        exportedBy: process.env.USER || 'ccu-system'
      };

      await fs.writeFile(exportPath, JSON.stringify(exportData, null, 2));
      
      this.logger.info(`Exported version ${version} to ${exportPath}`);
      return true;

    } catch (error) {
      this.logger.error(`Failed to export version ${version}`, error);
      return false;
    }
  }

  /**
   * Import version data
   */
  async importVersion(importPath: string): Promise<string | null> {
    try {
      const importData = JSON.parse(await fs.readFile(importPath, 'utf-8'));
      
      // Validate import data
      if (!importData.version || !importData.config) {
        throw new Error('Invalid import data format');
      }

      const version = importData.version.version;
      
      // Check if version already exists
      const existingVersion = await this.getVersion(version);
      if (existingVersion) {
        throw new Error(`Version ${version} already exists`);
      }

      // Save imported version
      await this.saveVersion(importData.version);
      await this.createSnapshot(version, importData.config);
      
      this.logger.info(`Imported version ${version} from ${importPath}`);
      return version;

    } catch (error) {
      this.logger.error(`Failed to import version from ${importPath}`, error);
      return null;
    }
  }

  /**
   * Get current version
   */
  getCurrentVersion(): string | undefined {
    return this.currentVersion;
  }

  /**
   * Calculate next version number
   */
  private async calculateNextVersion(changes: ConfigChange[]): Promise<string> {
    const versions = await this.getVersionHistory(1);
    const currentVersion = versions.length > 0 ? versions[0].version : '0.0.0';

    // Determine version bump type based on changes
    const hasBreaking = changes.some(c => c.type === 'remove' || (c.type === 'modify' && c.reason.includes('breaking')));
    const hasFeature = changes.some(c => c.type === 'add');
    const hasPatch = changes.some(c => c.type === 'modify');

    if (hasBreaking) {
      return semver.inc(currentVersion, 'major') || '1.0.0';
    } else if (hasFeature) {
      return semver.inc(currentVersion, 'minor') || '0.1.0';
    } else if (hasPatch) {
      return semver.inc(currentVersion, 'patch') || '0.0.1';
    }

    return semver.inc(currentVersion, 'patch') || '0.0.1';
  }

  /**
   * Calculate configuration hash
   */
  private calculateConfigHash(config: any): string {
    const configString = JSON.stringify(config, null, 0);
    return createHash('sha256').update(configString).digest('hex');
  }

  /**
   * Calculate diff between two configurations
   */
  private calculateDiff(fromConfig: any, toConfig: any): ConfigChange[] {
    const changes: ConfigChange[] = [];

    // Compare each category
    const fromCategories = fromConfig.configurations || {};
    const toCategories = toConfig.configurations || {};

    const allCategories = new Set([
      ...Object.keys(fromCategories),
      ...Object.keys(toCategories)
    ]);

    for (const category of allCategories) {
      const fromItems = fromCategories[category] || [];
      const toItems = toCategories[category] || [];

      // Create maps for easier comparison
      const fromMap = new Map(fromItems.map((item: any) => [item.id, item]));
      const toMap = new Map(toItems.map((item: any) => [item.id, item]));

      // Find additions
      for (const [id, item] of toMap) {
        if (!fromMap.has(id)) {
          changes.push({
            type: 'add',
            category,
            configId: id,
            name: item.name || id,
            after: item,
            reason: 'Configuration added'
          });
        }
      }

      // Find removals
      for (const [id, item] of fromMap) {
        if (!toMap.has(id)) {
          changes.push({
            type: 'remove',
            category,
            configId: id,
            name: item.name || id,
            before: item,
            reason: 'Configuration removed'
          });
        }
      }

      // Find modifications
      for (const [id, toItem] of toMap) {
        const fromItem = fromMap.get(id);
        if (fromItem && JSON.stringify(fromItem) !== JSON.stringify(toItem)) {
          changes.push({
            type: 'modify',
            category,
            configId: id,
            name: toItem.name || id,
            before: fromItem,
            after: toItem,
            reason: 'Configuration modified'
          });
        }
      }
    }

    return changes;
  }

  /**
   * Load configuration from file
   */
  private async loadConfiguration(): Promise<any> {
    const content = await fs.readFile(this.configPath, 'utf-8');
    return yaml.load(content);
  }

  /**
   * Save configuration to file
   */
  private async saveConfiguration(config: any): Promise<void> {
    const yamlContent = yaml.dump(config);
    await fs.writeFile(this.configPath, yamlContent, 'utf-8');
  }

  /**
   * Load current version from config
   */
  private async loadCurrentVersion(): Promise<void> {
    try {
      const config = await this.loadConfiguration();
      this.currentVersion = config.version || '0.0.0';
    } catch (error) {
      this.currentVersion = '0.0.0';
    }
  }

  /**
   * Save version metadata
   */
  private async saveVersion(version: ConfigVersion): Promise<void> {
    const versionFile = path.join(this.versionsDir, `${version.version}.json`);
    await fs.writeFile(versionFile, JSON.stringify(version, null, 2));
  }

  /**
   * Get version metadata
   */
  private async getVersion(version: string): Promise<ConfigVersion | null> {
    try {
      const versionFile = path.join(this.versionsDir, `${version}.json`);
      const content = await fs.readFile(versionFile, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      return null;
    }
  }

  /**
   * Load version file
   */
  private async loadVersionFile(filename: string): Promise<ConfigVersion | null> {
    try {
      const content = await fs.readFile(path.join(this.versionsDir, filename), 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      return null;
    }
  }

  /**
   * Create configuration snapshot
   */
  private async createSnapshot(version: string, config: any): Promise<void> {
    const snapshot: ConfigSnapshot = {
      version,
      timestamp: new Date(),
      config,
      hash: this.calculateConfigHash(config),
      size: JSON.stringify(config).length
    };

    const snapshotFile = path.join(this.snapshotsDir, `${version}.json`);
    await fs.writeFile(snapshotFile, JSON.stringify(snapshot, null, 2));
  }

  /**
   * Get configuration snapshot
   */
  private async getSnapshot(version: string): Promise<ConfigSnapshot | null> {
    try {
      const snapshotFile = path.join(this.snapshotsDir, `${version}.json`);
      const content = await fs.readFile(snapshotFile, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      return null;
    }
  }

  /**
   * Delete version and snapshot
   */
  private async deleteVersion(version: string): Promise<void> {
    try {
      const versionFile = path.join(this.versionsDir, `${version}.json`);
      const snapshotFile = path.join(this.snapshotsDir, `${version}.json`);

      await fs.unlink(versionFile);
      await fs.unlink(snapshotFile);
      
      this.logger.info(`Deleted version ${version}`);
    } catch (error) {
      this.logger.warn(`Failed to delete version ${version}`, error);
    }
  }

  /**
   * Ensure required directories exist
   */
  private async ensureDirectories(): Promise<void> {
    await fs.mkdir(this.versionsDir, { recursive: true });
    await fs.mkdir(this.snapshotsDir, { recursive: true });
  }
}