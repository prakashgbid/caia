import { getSupabaseClient, getSupabaseAdmin } from '../client.js'
import type {
  ResearchPaper,
  CreateResearchPaperInput,
  PeerReviewState,
  PaginationParams,
  PaginatedResult,
} from '../types.js'

export async function createResearchPaper(
  userId: string,
  input: CreateResearchPaperInput,
): Promise<ResearchPaper | null> {
  const sb = getSupabaseClient()
  const { data, error } = await sb
    .from('research_papers')
    .insert({
      author_id: userId,
      title: input.title,
      slug: input.slug,
      body_md: input.body_md,
      excerpt: input.excerpt ?? null,
      hero_image_url: input.hero_image_url ?? null,
      tags: input.tags ?? [],
      status: 'draft',
      peer_review_state: 'pending',
    })
    .select()
    .single()

  if (error ?? !data) return null
  return data as ResearchPaper
}

export async function updateResearchPaper(
  paperId: string,
  userId: string,
  input: Partial<CreateResearchPaperInput>,
): Promise<ResearchPaper | null> {
  const sb = getSupabaseClient()
  const { data, error } = await sb
    .from('research_papers')
    .update(input)
    .eq('id', paperId)
    .eq('author_id', userId)
    .select()
    .single()

  if (error ?? !data) return null
  return data as ResearchPaper
}

export async function submitResearchPaper(
  paperId: string,
  userId: string,
): Promise<ResearchPaper | null> {
  const sb = getSupabaseClient()
  const { data, error } = await sb
    .from('research_papers')
    .update({ status: 'submitted' })
    .eq('id', paperId)
    .eq('author_id', userId)
    .select()
    .single()

  if (error ?? !data) return null
  return data as ResearchPaper
}

export async function updatePeerReviewState(
  paperId: string,
  newState: PeerReviewState,
): Promise<ResearchPaper | null> {
  // State transitions managed by reviewers/admin via service role
  const sb = getSupabaseAdmin()
  const { data, error } = await sb
    .from('research_papers')
    .update({ peer_review_state: newState })
    .eq('id', paperId)
    .select()
    .single()

  if (error ?? !data) return null
  return data as ResearchPaper
}

export async function publishResearchPaper(
  paperId: string,
): Promise<ResearchPaper | null> {
  const sb = getSupabaseAdmin()
  const { data, error } = await sb
    .from('research_papers')
    .update({ status: 'published', published_at: new Date().toISOString() })
    .eq('id', paperId)
    .select()
    .single()

  if (error ?? !data) return null
  return data as ResearchPaper
}

export async function getResearchPaper(paperId: string): Promise<ResearchPaper | null> {
  const sb = getSupabaseClient()
  const { data, error } = await sb
    .from('research_papers')
    .select('*')
    .eq('id', paperId)
    .single()

  if (error ?? !data) return null
  return data as ResearchPaper
}

export async function getResearchPaperBySlug(slug: string): Promise<ResearchPaper | null> {
  const sb = getSupabaseClient()
  const { data, error } = await sb
    .from('research_papers')
    .select('*')
    .eq('slug', slug)
    .single()

  if (error ?? !data) return null
  return data as ResearchPaper
}

export async function listPublishedResearchPapers(
  filter: { tag?: string; authorId?: string } = {},
  params: PaginationParams = {},
): Promise<PaginatedResult<ResearchPaper>> {
  const sb = getSupabaseClient()
  const limit = params.limit ?? 50
  const offset = params.offset ?? 0

  let query = sb
    .from('research_papers')
    .select('*', { count: 'exact' })
    .eq('status', 'published')
    .range(offset, offset + limit - 1)
    .order('published_at', { ascending: false })

  if (filter.tag) {
    query = query.contains('tags', [filter.tag])
  }

  if (filter.authorId) {
    query = query.eq('author_id', filter.authorId)
  }

  const { data, error, count } = await query

  if (error) return { data: [], total: 0, hasMore: false }

  const total = count ?? 0
  return {
    data: (data ?? []) as ResearchPaper[],
    total,
    hasMore: offset + limit < total,
  }
}
