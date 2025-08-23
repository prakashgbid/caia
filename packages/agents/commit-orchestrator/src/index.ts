import { EventEmitter } from 'events';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface CommitRule {
  maxFiles: number;
  maxLines: number;
  maxCommitsPerPR: number;
  requireTests: boolean;
  requireLinting: boolean;
  atomicOnly: boolean;
}

export interface FileChange {
  path: string;
  additions: number;
  deletions: number;
  type: 'added' | 'modified' | 'deleted';
}

export interface CommitBatch {
  id: string;
  files: FileChange[];
  message: string;
  branch: string;
  totalLines: number;
  relatedTests: string[];
}

export interface CommitResult {
  success: boolean;
  commitHash?: string;
  error?: string;
  pushedToRemote: boolean;
}

export class CommitOrchestrator extends EventEmitter {
  private rules: CommitRule;
  private pendingChanges: Map<string, FileChange[]>;
  private commitHistory: CommitResult[];
  private currentBranch: string;

  constructor(rules?: Partial<CommitRule>) {
    super();
    this.rules = {
      maxFiles: 3,
      maxLines: 150,
      maxCommitsPerPR: 5,
      requireTests: true,
      requireLinting: true,
      atomicOnly: true,
      ...rules
    };
    this.pendingChanges = new Map();
    this.commitHistory = [];
    this.currentBranch = 'main';
  }

  async analyzeChanges(directory: string = '.'): Promise<FileChange[]> {
    this.emit('analysis:start', directory);
    
    try {
      const { stdout } = await execAsync('git diff --stat --name-status', { cwd: directory });
      const changes = this.parseGitStatus(stdout);
      
      this.emit('analysis:complete', changes);
      return changes;
    } catch (error) {
      this.emit('analysis:error', error);
      throw error;
    }
  }

  private parseGitStatus(output: string): FileChange[] {
    const lines = output.split('\n').filter(line => line.trim());
    return lines.map(line => {
      const [type, path] = line.split('\t');
      return {
        path,
        additions: 0,
        deletions: 0,
        type: type === 'A' ? 'added' : type === 'D' ? 'deleted' : 'modified'
      };
    });
  }

  async createCommitBatches(changes: FileChange[]): Promise<CommitBatch[]> {
    this.emit('batching:start', changes.length);
    
    const batches: CommitBatch[] = [];
    const groups = this.groupRelatedChanges(changes);
    
    for (const group of groups) {
      const atomicBatches = this.createAtomicBatches(group);
      batches.push(...atomicBatches);
    }
    
    this.emit('batching:complete', batches);
    return batches;
  }

  private groupRelatedChanges(changes: FileChange[]): FileChange[][] {
    const groups: Map<string, FileChange[]> = new Map();
    
    for (const change of changes) {
      const category = this.categorizeFile(change.path);
      if (!groups.has(category)) {
        groups.set(category, []);
      }
      groups.get(category)!.push(change);
    }
    
    return Array.from(groups.values());
  }

  private categorizeFile(path: string): string {
    if (path.includes('test') || path.includes('spec')) return 'tests';
    if (path.includes('src/')) return 'source';
    if (path.includes('docs/')) return 'documentation';
    if (path.includes('config')) return 'configuration';
    return 'other';
  }

  private createAtomicBatches(changes: FileChange[]): CommitBatch[] {
    const batches: CommitBatch[] = [];
    let currentBatch: FileChange[] = [];
    let currentLines = 0;
    
    for (const change of changes) {
      const changeLines = change.additions + change.deletions;
      
      if (currentBatch.length >= this.rules.maxFiles ||
          currentLines + changeLines > this.rules.maxLines) {
        if (currentBatch.length > 0) {
          batches.push(this.createBatch(currentBatch, currentLines));
        }
        currentBatch = [change];
        currentLines = changeLines;
      } else {
        currentBatch.push(change);
        currentLines += changeLines;
      }
    }
    
    if (currentBatch.length > 0) {
      batches.push(this.createBatch(currentBatch, currentLines));
    }
    
    return batches;
  }

  private createBatch(files: FileChange[], totalLines: number): CommitBatch {
    return {
      id: `batch-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      files,
      message: this.generateCommitMessage(files),
      branch: this.currentBranch,
      totalLines,
      relatedTests: this.findRelatedTests(files)
    };
  }

  private generateCommitMessage(files: FileChange[]): string {
    const types = new Set(files.map(f => f.type));
    const paths = files.map(f => f.path);
    
    let prefix = 'chore';
    if (types.has('added')) prefix = 'feat';
    else if (types.has('modified')) prefix = 'fix';
    
    const scope = this.extractScope(paths);
    const description = this.generateDescription(files);
    
    return `${prefix}(${scope}): ${description}`;
  }

  private extractScope(paths: string[]): string {
    const commonPath = this.findCommonPath(paths);
    const parts = commonPath.split('/');
    return parts[parts.length - 1] || 'general';
  }

  private findCommonPath(paths: string[]): string {
    if (paths.length === 0) return '';
    if (paths.length === 1) return paths[0].split('/').slice(0, -1).join('/');
    
    const parts = paths[0].split('/');
    let common = '';
    
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (paths.every(p => p.split('/')[i] === part)) {
        common += (common ? '/' : '') + part;
      } else {
        break;
      }
    }
    
    return common;
  }

  private generateDescription(files: FileChange[]): string {
    const actions = {
      added: 'Add',
      modified: 'Update',
      deleted: 'Remove'
    };
    
    const summary = files.map(f => {
      const name = f.path.split('/').pop();
      return `${actions[f.type]} ${name}`;
    });
    
    if (summary.length <= 2) {
      return summary.join(' and ');
    }
    
    return `${summary[0]} and ${summary.length - 1} other changes`;
  }

  private findRelatedTests(files: FileChange[]): string[] {
    const tests: string[] = [];
    
    for (const file of files) {
      const testFile = file.path.replace('/src/', '/__tests__/').replace('.ts', '.test.ts');
      tests.push(testFile);
    }
    
    return tests;
  }

  async executeCommit(batch: CommitBatch): Promise<CommitResult> {
    this.emit('commit:start', batch);
    
    try {
      if (this.rules.requireLinting) {
        await this.runLinting(batch.files.map(f => f.path));
      }
      
      if (this.rules.requireTests) {
        await this.runTests(batch.relatedTests);
      }
      
      const { stdout } = await execAsync(`git add ${batch.files.map(f => f.path).join(' ')}`);
      const commitResult = await execAsync(`git commit -m "${batch.message}"`);
      
      const result: CommitResult = {
        success: true,
        commitHash: this.extractCommitHash(commitResult.stdout),
        pushedToRemote: false
      };
      
      this.commitHistory.push(result);
      this.emit('commit:complete', result);
      
      return result;
    } catch (error: any) {
      const result: CommitResult = {
        success: false,
        error: error.message,
        pushedToRemote: false
      };
      
      this.commitHistory.push(result);
      this.emit('commit:error', result);
      
      return result;
    }
  }

  private extractCommitHash(output: string): string {
    const match = output.match(/\[\w+ ([a-f0-9]+)\]/);
    return match ? match[1] : 'unknown';
  }

  private async runLinting(files: string[]): Promise<void> {
    this.emit('linting:start', files);
    try {
      await execAsync(`npx eslint ${files.join(' ')}`);
      this.emit('linting:complete');
    } catch (error) {
      this.emit('linting:error', error);
      if (this.rules.requireLinting) throw error;
    }
  }

  private async runTests(tests: string[]): Promise<void> {
    this.emit('tests:start', tests);
    try {
      if (tests.length > 0) {
        await execAsync(`npx jest ${tests.join(' ')}`);
      }
      this.emit('tests:complete');
    } catch (error) {
      this.emit('tests:error', error);
      if (this.rules.requireTests) throw error;
    }
  }

  async pushToRemote(branch: string = this.currentBranch): Promise<void> {
    this.emit('push:start', branch);
    
    try {
      await execAsync(`git push origin ${branch}`);
      this.emit('push:complete', branch);
    } catch (error) {
      this.emit('push:error', error);
      throw error;
    }
  }

  getCommitHistory(): CommitResult[] {
    return [...this.commitHistory];
  }

  getRules(): CommitRule {
    return { ...this.rules };
  }

  updateRules(updates: Partial<CommitRule>): void {
    Object.assign(this.rules, updates);
    this.emit('rules:updated', this.rules);
  }
}