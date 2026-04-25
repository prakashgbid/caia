import { getSupabaseClient, getSupabaseAdmin } from '../client.js'
import type {
  Article,
  CreateArticleInput,
  UpdateArticleInput,
  PaginationParams,
  PaginatedResult,
} from '../types.js'

export async function createArticle(
  userId: string,
  input: CreateArticleInput,
): Promise<Article | null> {
  const sb = getSupabaseClient()
  const { data, error } = await sb
    .from('articles')
    .insert({
      author_id: userId,
      title: input.title,
      slug: input.slug,
      body_md: input.body_md,
      excerpt: input.excerpt ?? null,
      hero_image_url: input.hero_image_url ?? null,
      tags: input.tags ?? [],
      status: 'draft',
    })
    .select()
    .single()

  if (error ?? !data) return null
  return data as Article
}

export async function updateArticle(
  articleId: string,
  userId: string,
  input: UpdateArticleInput,
): Promise<Article | null> {
  const sb = getSupabaseClient()
  const { data, error } = await sb
    .from('articles')
    .update(input)
    .eq('id', articleId)
    .eq('author_id', userId)
    .select()
    .single()

  if (error ?? !data) return null
  return data as Article
}

export async function submitArticle(
  articleId: string,
  userId: string,
): Promise<Article | null> {
  const sb = getSupabaseClient()
  const { data, error } = await sb
    .from('articles')
    .update({ status: 'submitted' })
    .eq('id', articleId)
    .eq('author_id', userId)
    .select()
    .single()

  if (error ?? !data) return null
  return data as Article
}

export async function publishArticle(
  articleId: string,
  _adminUserId: string,
): Promise<Article | null> {
  // Publish uses service role — bypasses RLS, admin-only action
  const sb = getSupabaseAdmin()
  const { data, error } = await sb
    .from('articles')
    .update({ status: 'published', published_at: new Date().toISOString() })
    .eq('id', articleId)
    .select()
    .single()

  if (error ?? !data) return null
  return data as Article
}

export async function getArticle(articleId: string): Promise<Article | null> {
  const sb = getSupabaseClient()
  const { data, error } = await sb
    .from('articles')
    .select('*')
    .eq('id', articleId)
    .single()

  if (error ?? !data) return null
  return data as Article
}

export async function getArticleBySlug(slug: string): Promise<Article | null> {
  const sb = getSupabaseClient()
  const { data, error } = await sb
    .from('articles')
    .select('*')
    .eq('slug', slug)
    .single()

  if (error ?? !data) return null
  return data as Article
}

export async function listPublishedArticles(
  filter: { tag?: string; authorId?: string } = {},
  params: PaginationParams = {},
): Promise<PaginatedResult<Article>> {
  const sb = getSupabaseClient()
  const limit = params.limit ?? 50
  const offset = params.offset ?? 0

  let query = sb
    .from('articles')
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
    data: (data ?? []) as Article[],
    total,
    hasMore: offset + limit < total,
  }
}
