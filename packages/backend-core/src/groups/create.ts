import { getSupabaseClient } from '../client.js'
import type { Group, CreateGroupInput } from '../types.js'

export async function createGroup(
  userId: string,
  input: CreateGroupInput,
): Promise<Group | null> {
  const sb = getSupabaseClient()

  const { data: group, error: groupError } = await sb
    .from('groups')
    .insert({
      name: input.name,
      slug: input.slug.toLowerCase(),
      tier_level: input.tier_level,
      parent_group_id: input.parent_group_id ?? null,
      description: input.description ?? null,
      cover_image_url: input.cover_image_url ?? null,
      created_by: userId,
      privacy: input.privacy,
    })
    .select()
    .single()

  if (groupError ?? !group) return null

  // Auto-join creator as host
  await sb.from('group_memberships').insert({
    group_id: group.id,
    user_id: userId,
    role: 'host',
  })

  return group as Group
}
