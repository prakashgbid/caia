export type Json = string | number | boolean | null | { [key: string]: Json } | Json[]

export type GroupTier = 'family' | 'neighborhood' | 'city' | 'county' | 'township' | 'state' | 'regional'
export type GroupPrivacy = 'public' | 'private' | 'invite'
export type MemberRole = 'member' | 'moderator' | 'host'
export type PublicationStatus = 'draft' | 'submitted' | 'under_review' | 'published' | 'rejected'
export type PeerReviewState = 'pending' | 'in_review' | 'approved' | 'needs_revision' | 'rejected'
export type EventKind = 'online_tournament' | 'local_meetup' | 'venue_event' | 'webinar' | 'workshop'
export type RsvpStatus = 'yes' | 'no' | 'maybe'
export type RelationshipKind = 'follow' | 'mute' | 'block'
export type OrderStatus = 'pending' | 'confirmed' | 'fulfilled' | 'cancelled' | 'refunded'
export type UserTier = 'member' | 'contributor' | 'trusted' | 'moderator' | 'admin'
export type NotificationChannel = 'in_app' | 'email' | 'push'

export interface Profile {
  id: string
  username: string
  display_name: string | null
  avatar_url: string | null
  bio: string | null
  tier: UserTier
  lifetime_points: number
  location_state: string | null
  location_city: string | null
  created_at: string
  updated_at: string
}

export interface Group {
  id: string
  name: string
  slug: string
  tier_level: GroupTier
  parent_group_id: string | null
  description: string | null
  cover_image_url: string | null
  created_by: string | null
  member_count: number
  privacy: GroupPrivacy
  created_at: string
  updated_at: string
}

export interface GroupMembership {
  id: string
  group_id: string
  user_id: string
  role: MemberRole
  joined_at: string
}

export interface Thread {
  id: string
  group_id: string | null
  author_id: string | null
  title: string
  body_md: string
  tags: string[]
  reaction_counts: Record<string, number>
  reply_count: number
  is_pinned: boolean
  is_locked: boolean
  created_at: string
  updated_at: string
}

export interface Reply {
  id: string
  thread_id: string
  parent_reply_id: string | null
  author_id: string | null
  body_md: string
  reactions: Record<string, number>
  created_at: string
  updated_at: string
}

export interface Reaction {
  id: string
  user_id: string
  target_type: 'thread' | 'reply' | 'article'
  target_id: string
  emoji: string
  created_at: string
}

export interface Article {
  id: string
  author_id: string | null
  title: string
  slug: string
  body_md: string
  excerpt: string | null
  hero_image_url: string | null
  tags: string[]
  status: PublicationStatus
  published_at: string | null
  view_count: number
  created_at: string
  updated_at: string
}

export interface ResearchPaper {
  id: string
  author_id: string | null
  title: string
  slug: string
  body_md: string
  excerpt: string | null
  hero_image_url: string | null
  tags: string[]
  status: PublicationStatus
  peer_review_state: PeerReviewState
  reviewers: string[]
  published_at: string | null
  created_at: string
  updated_at: string
}

export interface EditorialReview {
  id: string
  reviewer_id: string | null
  paper_id: string | null
  article_id: string | null
  verdict: PeerReviewState
  feedback_md: string | null
  created_at: string
}

export interface Event {
  id: string
  group_id: string | null
  created_by: string | null
  kind: EventKind
  title: string
  description: string | null
  starts_at: string
  ends_at: string
  location_text: string | null
  location_lat: number | null
  location_lng: number | null
  capacity: number | null
  rsvp_count: number
  is_cancelled: boolean
  created_at: string
  updated_at: string
}

export interface Rsvp {
  id: string
  event_id: string
  user_id: string
  status: RsvpStatus
  created_at: string
  updated_at: string
}

export interface PointsLedger {
  id: string
  user_id: string
  reason: string
  delta: number
  metadata: Json | null
  created_at: string
}

export interface Badge {
  id: string
  slug: string
  name: string
  description: string | null
  icon_url: string | null
  points_required: number | null
  created_at: string
}

export interface UserBadge {
  id: string
  user_id: string
  badge_id: string
  awarded_at: string
}

export interface TierPromotion {
  id: string
  user_id: string
  from_tier: string
  to_tier: string
  points_at_promotion: number
  promoted_at: string
}

export interface NotificationPreferences {
  id: string
  user_id: string
  channels: NotificationChannel[]
  new_reply: boolean
  new_follower: boolean
  group_activity: boolean
  event_reminder: boolean
  mention: boolean
  updated_at: string
}

export interface DeliveredNotification {
  id: string
  user_id: string
  kind: string
  title: string
  body: string | null
  action_url: string | null
  metadata: Json | null
  is_read: boolean
  read_at: string | null
  created_at: string
}

export interface UserRelationship {
  id: string
  follower_id: string
  following_id: string
  kind: RelationshipKind
  created_at: string
}

export interface MarketplaceListing {
  id: string
  seller_id: string | null
  title: string
  description: string | null
  price_cents: number
  currency: string
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface MarketplaceOrder {
  id: string
  listing_id: string | null
  buyer_id: string | null
  status: OrderStatus
  price_cents: number
  currency: string
  metadata: Json | null
  created_at: string
  updated_at: string
}

export interface PaginationParams {
  limit?: number
  offset?: number
  cursor?: string
}

export interface PaginatedResult<T> {
  data: T[]
  total: number
  hasMore: boolean
}

export type CreateProfileInput = Pick<
  Profile,
  'username' | 'display_name' | 'avatar_url' | 'bio' | 'location_state' | 'location_city'
>
export type UpdateProfileInput = Partial<CreateProfileInput>

export interface CreateGroupInput {
  name: string
  slug: string
  tier_level: GroupTier
  parent_group_id?: string
  description?: string
  cover_image_url?: string
  privacy: GroupPrivacy
}

export interface CreateThreadInput {
  group_id?: string
  title: string
  body_md: string
  tags?: string[]
}

export interface UpdateThreadInput {
  title?: string
  body_md?: string
  tags?: string[]
}

export interface CreateReplyInput {
  thread_id: string
  parent_reply_id?: string
  body_md: string
}

export interface CreateArticleInput {
  title: string
  slug: string
  body_md: string
  excerpt?: string
  hero_image_url?: string
  tags?: string[]
}

export interface UpdateArticleInput {
  title?: string
  body_md?: string
  excerpt?: string
  hero_image_url?: string
  tags?: string[]
}

export interface CreateResearchPaperInput {
  title: string
  slug: string
  body_md: string
  excerpt?: string
  hero_image_url?: string
  tags?: string[]
}

export interface CreateReviewInput {
  reviewer_id: string
  paper_id?: string
  article_id?: string
  verdict: PeerReviewState
  feedback_md?: string
}

export interface CreateEventInput {
  group_id?: string
  kind: EventKind
  title: string
  description?: string
  starts_at: string
  ends_at: string
  location_text?: string
  location_lat?: number
  location_lng?: number
  capacity?: number
}

export interface UpdateEventInput {
  title?: string
  description?: string
  starts_at?: string
  ends_at?: string
  location_text?: string
  capacity?: number
}

export interface UpdateNotificationPreferencesInput {
  channels?: NotificationChannel[]
  new_reply?: boolean
  new_follower?: boolean
  group_activity?: boolean
  event_reminder?: boolean
  mention?: boolean
}

export interface AuthResult {
  user: { id: string; email: string } | null
  session: { access_token: string; refresh_token: string } | null
  error: string | null
}

export interface SessionData {
  userId: string | null
  email: string | null
}
