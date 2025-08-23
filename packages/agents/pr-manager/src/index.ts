import { EventEmitter } from 'events';
import { Octokit } from '@octokit/rest';

export interface PRConfig {
  autoMerge: boolean;
  requireReviews: number;
  requireTests: boolean;
  requireApprovals: number;
  deleteAfterMerge: boolean;
  squashMerge: boolean;
  protectedBranches: string[];
}

export interface PullRequest {
  id: number;
  title: string;
  body: string;
  branch: string;
  baseBranch: string;
  commits: number;
  additions: number;
  deletions: number;
  status: 'open' | 'closed' | 'merged';
  checks: CheckStatus[];
  reviews: Review[];
}

export interface CheckStatus {
  name: string;
  status: 'pending' | 'success' | 'failure';
  conclusion?: string;
  detailsUrl?: string;
}

export interface Review {
  reviewer: string;
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED';
  submittedAt: Date;
}

export interface MergeResult {
  success: boolean;
  mergeCommit?: string;
  error?: string;
  branchDeleted: boolean;
}

export class PRManager extends EventEmitter {
  private octokit: Octokit;
  private config: PRConfig;
  private activePRs: Map<number, PullRequest>;
  private autoMergeQueue: number[];

  constructor(githubToken: string, config?: Partial<PRConfig>) {
    super();
    this.octokit = new Octokit({ auth: githubToken });
    this.config = {
      autoMerge: true,
      requireReviews: 1,
      requireTests: true,
      requireApprovals: 1,
      deleteAfterMerge: true,
      squashMerge: true,
      protectedBranches: ['main', 'master', 'develop'],
      ...config
    };
    this.activePRs = new Map();
    this.autoMergeQueue = [];
    
    if (this.config.autoMerge) {
      this.startAutoMergeMonitor();
    }
  }

  async createPR(
    owner: string,
    repo: string,
    title: string,
    body: string,
    head: string,
    base: string = 'main'
  ): Promise<PullRequest> {
    this.emit('pr:create:start', { owner, repo, title });
    
    try {
      const { data } = await this.octokit.pulls.create({
        owner,
        repo,
        title,
        body: this.formatPRBody(body),
        head,
        base
      });
      
      const pr: PullRequest = {
        id: data.number,
        title: data.title,
        body: data.body || '',
        branch: head,
        baseBranch: base,
        commits: data.commits,
        additions: data.additions,
        deletions: data.deletions,
        status: 'open',
        checks: [],
        reviews: []
      };
      
      this.activePRs.set(pr.id, pr);
      
      if (this.config.autoMerge) {
        this.autoMergeQueue.push(pr.id);
      }
      
      this.emit('pr:create:complete', pr);
      return pr;
    } catch (error) {
      this.emit('pr:create:error', error);
      throw error;
    }
  }

  private formatPRBody(body: string): string {
    return `${body}

## Checklist
- [ ] Code follows project style guidelines
- [ ] Tests have been added/updated
- [ ] Documentation has been updated
- [ ] All CI checks pass
- [ ] Ready for review

---
*Created by CAIA Autonomous Pipeline*
*Auto-merge: ${this.config.autoMerge ? 'Enabled' : 'Disabled'}*`;
  }

  async updatePRStatus(owner: string, repo: string, prNumber: number): Promise<PullRequest> {
    this.emit('pr:update:start', prNumber);
    
    try {
      const [prData, checksData, reviewsData] = await Promise.all([
        this.octokit.pulls.get({ owner, repo, pull_number: prNumber }),
        this.octokit.checks.listForRef({ owner, repo, ref: `pull/${prNumber}/head` }),
        this.octokit.pulls.listReviews({ owner, repo, pull_number: prNumber })
      ]);
      
      const pr = this.activePRs.get(prNumber) || this.createPRFromData(prData.data);
      
      pr.checks = checksData.data.check_runs.map(check => ({
        name: check.name,
        status: check.status as 'pending' | 'success' | 'failure',
        conclusion: check.conclusion || undefined,
        detailsUrl: check.details_url || undefined
      }));
      
      pr.reviews = reviewsData.data.map(review => ({
        reviewer: review.user?.login || 'unknown',
        state: review.state as 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED',
        submittedAt: new Date(review.submitted_at || Date.now())
      }));
      
      this.activePRs.set(prNumber, pr);
      this.emit('pr:update:complete', pr);
      
      return pr;
    } catch (error) {
      this.emit('pr:update:error', error);
      throw error;
    }
  }

  private createPRFromData(data: any): PullRequest {
    return {
      id: data.number,
      title: data.title,
      body: data.body || '',
      branch: data.head.ref,
      baseBranch: data.base.ref,
      commits: data.commits,
      additions: data.additions,
      deletions: data.deletions,
      status: data.state,
      checks: [],
      reviews: []
    };
  }

  async checkMergeability(pr: PullRequest): Promise<boolean> {
    if (!this.config.autoMerge) return false;
    
    const checksPass = !this.config.requireTests || 
      pr.checks.every(check => check.status === 'success');
    
    const hasApprovals = pr.reviews.filter(r => r.state === 'APPROVED').length >= this.config.requireApprovals;
    
    const noRequestedChanges = !pr.reviews.some(r => r.state === 'CHANGES_REQUESTED');
    
    return checksPass && hasApprovals && noRequestedChanges;
  }

  async mergePR(
    owner: string,
    repo: string,
    prNumber: number,
    mergeMethod: 'merge' | 'squash' | 'rebase' = 'squash'
  ): Promise<MergeResult> {
    this.emit('pr:merge:start', prNumber);
    
    try {
      const pr = this.activePRs.get(prNumber);
      if (!pr) {
        throw new Error(`PR ${prNumber} not found`);
      }
      
      const canMerge = await this.checkMergeability(pr);
      if (!canMerge && this.config.autoMerge) {
        throw new Error('PR does not meet merge requirements');
      }
      
      const { data } = await this.octokit.pulls.merge({
        owner,
        repo,
        pull_number: prNumber,
        merge_method: this.config.squashMerge ? 'squash' : mergeMethod
      });
      
      let branchDeleted = false;
      if (this.config.deleteAfterMerge && !this.config.protectedBranches.includes(pr.branch)) {
        try {
          await this.octokit.git.deleteRef({
            owner,
            repo,
            ref: `heads/${pr.branch}`
          });
          branchDeleted = true;
        } catch (error) {
          this.emit('branch:delete:error', error);
        }
      }
      
      const result: MergeResult = {
        success: true,
        mergeCommit: data.sha,
        branchDeleted
      };
      
      pr.status = 'merged';
      this.activePRs.delete(prNumber);
      this.autoMergeQueue = this.autoMergeQueue.filter(id => id !== prNumber);
      
      this.emit('pr:merge:complete', result);
      return result;
    } catch (error: any) {
      const result: MergeResult = {
        success: false,
        error: error.message,
        branchDeleted: false
      };
      
      this.emit('pr:merge:error', result);
      return result;
    }
  }

  private startAutoMergeMonitor(): void {
    setInterval(async () => {
      for (const prNumber of this.autoMergeQueue) {
        const pr = this.activePRs.get(prNumber);
        if (!pr) continue;
        
        try {
          const canMerge = await this.checkMergeability(pr);
          if (canMerge) {
            await this.mergePR('', '', prNumber);
          }
        } catch (error) {
          this.emit('autoMerge:error', { prNumber, error });
        }
      }
    }, 60000); // Check every minute
  }

  async setupBranchProtection(
    owner: string,
    repo: string,
    branch: string = 'main'
  ): Promise<void> {
    this.emit('protection:setup:start', branch);
    
    try {
      await this.octokit.repos.updateBranchProtection({
        owner,
        repo,
        branch,
        required_status_checks: {
          strict: true,
          contexts: ['continuous-integration']
        },
        enforce_admins: false,
        required_pull_request_reviews: {
          required_approving_review_count: this.config.requireApprovals,
          dismiss_stale_reviews: true
        },
        restrictions: null
      });
      
      this.emit('protection:setup:complete', branch);
    } catch (error) {
      this.emit('protection:setup:error', error);
      throw error;
    }
  }

  getActivePRs(): PullRequest[] {
    return Array.from(this.activePRs.values());
  }

  getAutoMergeQueue(): number[] {
    return [...this.autoMergeQueue];
  }

  updateConfig(updates: Partial<PRConfig>): void {
    Object.assign(this.config, updates);
    this.emit('config:updated', this.config);
    
    if (updates.autoMerge !== undefined) {
      if (updates.autoMerge && !this.config.autoMerge) {
        this.startAutoMergeMonitor();
      }
    }
  }
}