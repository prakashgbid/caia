import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import {
  createArticle,
  submitArticle,
  getArticleBySlug,
  listPublishedArticles,
  publishArticle,
} from '../src/publications/index.js'
import { getSupabaseAdmin } from '../src/client.js'

const SUPABASE_URL = process.env['SUPABASE_URL']

const AUTHOR_ID = '00000000-0000-0000-0000-000000000030'
const createdArticleIds: string[] = []

describe('publications', () => {
  beforeAll(async () => {
    if (!SUPABASE_URL) return
    const admin = getSupabaseAdmin()
    await admin.from('profiles').upsert({
      id: AUTHOR_ID,
      username: 'pub_author',
      display_name: 'Pub Author',
      tier: 'contributor',
      lifetime_points: 200,
    })
  })

  afterEach(async () => {
    if (!SUPABASE_URL || createdArticleIds.length === 0) return
    const admin = getSupabaseAdmin()
    await admin.from('articles').delete().in('id', createdArticleIds)
    createdArticleIds.length = 0
  })

  it('createArticle creates a draft', async () => {
    if (!SUPABASE_URL) return
    const slug = `test-article-${Date.now()}`
    const article = await createArticle(AUTHOR_ID, {
      title: 'Test Article',
      slug,
      body_md: '# Hello\nThis is content.',
      tags: ['roulette'],
    })
    expect(article).not.toBeNull()
    expect(article?.status).toBe('draft')
    expect(article?.slug).toBe(slug)
    createdArticleIds.push(article!.id)
  })

  it('submitArticle changes status to submitted', async () => {
    if (!SUPABASE_URL) return
    const slug = `submit-article-${Date.now()}`
    const article = await createArticle(AUTHOR_ID, {
      title: 'Submit Article',
      slug,
      body_md: 'Content',
    })
    createdArticleIds.push(article!.id)

    const submitted = await submitArticle(article!.id, AUTHOR_ID)
    expect(submitted?.status).toBe('submitted')
  })

  it('getArticleBySlug retrieves article', async () => {
    if (!SUPABASE_URL) return
    const slug = `slug-article-${Date.now()}`
    const created = await createArticle(AUTHOR_ID, {
      title: 'Slug Article',
      slug,
      body_md: 'Content',
    })
    createdArticleIds.push(created!.id)

    const found = await getArticleBySlug(slug)
    expect(found).not.toBeNull()
    expect(found?.id).toBe(created!.id)
  })

  it('listPublishedArticles only returns published articles', async () => {
    if (!SUPABASE_URL) return
    const slug = `pub-article-${Date.now()}`
    const article = await createArticle(AUTHOR_ID, {
      title: 'Published Article',
      slug,
      body_md: 'Content',
      tags: ['test-pub-tag'],
    })
    createdArticleIds.push(article!.id)

    // Publish via admin
    await publishArticle(article!.id, AUTHOR_ID)

    const result = await listPublishedArticles({ tag: 'test-pub-tag' })
    const found = result.data.find((a) => a.id === article!.id)
    expect(found).toBeDefined()
    expect(found?.status).toBe('published')
  })

  it('listPublishedArticles does not include drafts', async () => {
    if (!SUPABASE_URL) return
    const slug = `draft-hidden-${Date.now()}`
    const article = await createArticle(AUTHOR_ID, {
      title: 'Hidden Draft',
      slug,
      body_md: 'Draft content',
      tags: ['draft-only-tag-xyz'],
    })
    createdArticleIds.push(article!.id)

    const result = await listPublishedArticles({ tag: 'draft-only-tag-xyz' })
    expect(result.data.length).toBe(0)
  })
})
