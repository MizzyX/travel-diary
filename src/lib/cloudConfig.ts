/** 云端配置：优先读构建期环境变量，其次读本机 localStorage（应用内填写） */

const KEY = 'travel-diary:cloud-config'

export interface CloudConfig {
  url: string
  anonKey: string
}

function env(): Record<string, string | undefined> {
  return (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {}
}

export function getCloudConfig(): CloudConfig | null {
  const e = env()
  const envUrl = e.VITE_SUPABASE_URL?.trim()
  const envKey = e.VITE_SUPABASE_ANON_KEY?.trim()
  if (envUrl && envKey) return { url: envUrl, anonKey: envKey }
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<CloudConfig>
    if (parsed.url && parsed.anonKey) return { url: normalizeUrl(String(parsed.url)), anonKey: String(parsed.anonKey).trim() }
  } catch {
    // 忽略解析错误
  }
  return null
}

export function saveCloudConfig(config: CloudConfig): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ url: config.url.trim(), anonKey: config.anonKey.trim() }))
  } catch {
    // 无痕模式下可能写不了，忽略
  }
}

export function clearCloudConfig(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // ignore
  }
}

/** 用环境变量配置时不允许在应用内修改 */
export function configFromEnv(): boolean {
  const e = env()
  return !!(e.VITE_SUPABASE_URL && e.VITE_SUPABASE_ANON_KEY)
}

/**
 * 把云端配置编码进网址（?cfg=base64），手机扫码打开即可自动配置，只需输入账号密码。
 * 内含的是公开 key（anon / publishable），本来就会出现在前端代码里，可安全传递。
 */
export function buildConfigLink(baseUrl: string, config: CloudConfig): string {
  const payload = btoa(JSON.stringify({ u: config.url, k: config.anonKey }))
  return `${baseUrl}?cfg=${encodeURIComponent(payload)}`
}

/** 启动时消费 ?cfg= 参数：写入本地配置并从地址栏移除，避免留在历史记录里 */
export function consumeConfigFromUrl(): CloudConfig | null {
  try {
    const u = new URL(window.location.href)
    const raw = u.searchParams.get('cfg')
    if (!raw) return null
    const parsed = JSON.parse(atob(decodeURIComponent(raw))) as { u?: string; k?: string }
    if (!parsed.u || !parsed.k) return null
    const cfg: CloudConfig = { url: normalizeUrl(String(parsed.u)), anonKey: String(parsed.k).trim() }
    saveCloudConfig(cfg)
    u.searchParams.delete('cfg')
    window.history.replaceState({}, '', u.toString())
    return cfg
  } catch {
    return null
  }
}

export function normalizeUrl(raw: string): string {
  // 去掉首尾空白、包裹的引号
  let v = raw.trim().replace(/^["'\s]+|["'\s]+$/g, '')
  if (!v) return ''
  if (!/^https?:\/\//.test(v)) v = `https://${v}`
  try {
    // 只保留协议+主机+端口，多余路径（如 /auth/v1、/rest/v1）会导致 Invalid path 错误
    return new URL(v).origin
  } catch {
    return v.replace(/\/+$/, '')
  }
}
