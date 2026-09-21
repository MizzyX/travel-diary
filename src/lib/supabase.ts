import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getCloudConfig } from './cloudConfig'

let client: SupabaseClient | null = null
let clientKey = ''

/** 没有配置时返回 null（离线单机模式） */
export function getClient(): SupabaseClient | null {
  const cfg = getCloudConfig()
  if (!cfg) return null
  const key = `${cfg.url}|${cfg.anonKey}`
  if (client && clientKey === key) return client
  client = createClient(cfg.url, cfg.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      storageKey: 'travel-diary:auth'
    }
  })
  clientKey = key
  return client
}

/** 配置变更后丢弃旧客户端 */
export function resetClient(): void {
  client = null
  clientKey = ''
}

export async function currentUserId(): Promise<string | null> {
  const sb = getClient()
  if (!sb) return null
  const { data } = await sb.auth.getSession()
  return data.session?.user?.id ?? null
}
