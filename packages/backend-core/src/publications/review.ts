import { getSupabaseClient } from '../client.js'
import type { EditorialReview, CreateReviewInput } from '../types.js'

export async function createReview(
  reviewerId: string,
  input: Omit<CreateReviewInput, 'reviewer_id'>,
): Promise<EditorialReview | null> {
  const sb = getSupabaseClient()
  const { data, error } = await sb
    .from('editorial_reviews')
    .insert({
      reviewer_id: reviewerId,
      paper_id: input.paper_id ?? null,
      article_id: input.article_id ?? null,
      verdict: input.verdict,
      feedback_md: input.feedback_md ?? null,
    })
    .select()
    .single()

  if (error ?? !data) return null
  return data as EditorialReview
}

export async function listReviews(
  paperId?: string,
  articleId?: string,
): Promise<EditorialReview[]> {
  const sb = getSupabaseClient()

  let query = sb.from('editorial_reviews').select('*').order('created_at', { ascending: false })

  if (paperId) {
    query = query.eq('paper_id', paperId)
  } else if (articleId) {
    query = query.eq('article_id', articleId)
  }

  const { data, error } = await query

  if (error) return []
  return (data ?? []) as EditorialReview[]
}
