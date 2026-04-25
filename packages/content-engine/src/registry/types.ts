export type SiteId = 'poker' | 'roulette';

export type ContentType =
  | 'forum-thread'
  | 'reply'
  | 'hand-review'
  | 'spin-analysis'
  | 'poll'
  | 'tip'
  | 'meetup'
  | 'venue-review'
  | 'tournament-recap'
  | 'welcome-intro'
  | 'reaction'
  | 'article'
  | 'research-paper'
  | 'interview'
  | 'editorial-pick'
  | 'quarterly-report';

export type VoiceStyle = 'casual' | 'analytical' | 'pro-jargon' | 'storytelling' | 'dry-humor';
export type PostingCadence = 'daily' | 'weekly' | 'monthly' | 'lurker';
export type AuthorRole = 'member' | 'sme';

export interface AuthorProfile {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  city: string;
  region: string;
  voice: VoiceStyle;
  cadence: PostingCadence;
  expertiseTags: string[];
  memberSince: string;
  tier: string;
  role: AuthorRole;
  bio?: string;
  credentials?: string;
  publicationCount?: number;
  linkedinOneliner?: string;
}

export interface GeneratedItem {
  id: string;
  type: ContentType;
  site: SiteId;
  authorId: string;
  generatedAt: string;
  publishAt: string;
  validated: boolean;
  data: Record<string, unknown>;
}

export interface GeneratorOptions {
  site: SiteId;
  type: ContentType;
  count: number;
  startDate: Date;
  endDate: Date;
  seed?: number;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}
