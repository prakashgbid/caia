export interface PullRequest {
  readonly number: number;
  readonly headRefName: string;
  readonly headRefOid: string;
  readonly baseRefName: string;
  readonly url: string;
  readonly title: string;
  readonly isDraft: boolean;
  readonly mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
  readonly labels: ReadonlyArray<{ name: string }>;
  readonly files: ReadonlyArray<{ path: string }>;
}

export const ADOPTION_BRANCH_PREFIX = 'adopt/';
export const ADOPTION_VERIFIED_LABEL = 'adoption-verified';
export const ADOPTION_FAILED_LABEL = 'adoption-failed';
export const COMMENT_MARKER = '<!-- adoption-verify -->';
