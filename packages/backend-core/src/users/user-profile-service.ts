import { getSupabaseClient } from '../client.js'
import type {
  Profile,
  UpdateProfileInput,
  PaginationParams,
  PaginatedResult,
} from '../types.js'

export class UserProfileService {
  private get sb() {
    return getSupabaseClient()
  }

  async getProfile(userId: string): Promise<Profile | null> {
    const { data, error } = await this.sb
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()

    if (error ?? !data) return null
    return data as Profile
  }

  async getProfileByUsername(username: string): Promise<Profile | null> {
    const { data, error } = await this.sb
      .from('profiles')
      .select('*')
      .ilike('username', username)
      .single()

    if (error ?? !data) return null
    return data as Profile
  }

  async updateProfile(userId: string, input: UpdateProfileInput): Promise<Profile | null> {
    const { data, error } = await this.sb
      .from('profiles')
      .update(input)
      .eq('id', userId)
      .select()
      .single()

    if (error ?? !data) return null
    return data as Profile
  }

  async listProfiles(params: PaginationParams = {}): Promise<PaginatedResult<Profile>> {
    const limit = params.limit ?? 50
    const offset = params.offset ?? 0

    const { data, error, count } = await this.sb
      .from('profiles')
      .select('*', { count: 'exact' })
      .range(offset, offset + limit - 1)
      .order('created_at', { ascending: false })

    if (error) return { data: [], total: 0, hasMore: false }

    const total = count ?? 0
    return {
      data: (data ?? []) as Profile[],
      total,
      hasMore: offset + limit < total,
    }
  }

  async searchProfiles(query: string, limit = 20): Promise<Profile[]> {
    const pattern = `%${query}%`

    const { data, error } = await this.sb
      .from('profiles')
      .select('*')
      .or(`username.ilike.${pattern},display_name.ilike.${pattern}`)
      .limit(limit)
      .order('lifetime_points', { ascending: false })

    if (error) return []
    return (data ?? []) as Profile[]
  }
}

export const userProfileService = new UserProfileService()
