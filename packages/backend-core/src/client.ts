import { createClient, SupabaseClient } from '@supabase/supabase-js'

let _client: SupabaseClient | null = null
let _adminClient: SupabaseClient | null = null

export function getSupabaseClient(): SupabaseClient {
  if (!_client) {
    const url = process.env['SUPABASE_URL']
    const key = process.env['SUPABASE_ANON_KEY']
    if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY must be set')
    _client = createClient(url, key, {
      auth: { persistSession: false },
      global: { fetch: globalThis.fetch },
    })
  }
  return _client
}

export function getSupabaseAdmin(): SupabaseClient {
  if (!_adminClient) {
    const url = process.env['SUPABASE_URL']
    const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
    if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
    _adminClient = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { fetch: globalThis.fetch },
    })
  }
  return _adminClient
}

export function createBrowserClient(): SupabaseClient {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'] ?? process.env['SUPABASE_URL']
  const key = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] ?? process.env['SUPABASE_ANON_KEY']
  if (!url || !key) throw new Error('Supabase env vars missing')
  return createClient(url, key)
}

/** Reset cached clients — useful in tests */
export function resetClients(): void {
  _client = null
  _adminClient = null
}
