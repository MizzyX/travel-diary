import { useCallback, useEffect, useState } from 'react'

export interface RateBundle {
  /** 基准币种 */
  base: string
  /** 1 单位 base = rates[X] 单位 X */
  rates: Record<string, number>
  updatedAt: number
  source: string
}

const CACHE_PREFIX = 'travel-diary/rates/'
/** 超过这个时间就后台刷新（默认 6 小时） */
const REFRESH_AFTER = 6 * 3600 * 1000

function readCache(base: string): RateBundle | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + base)
    if (!raw) return null
    const parsed = JSON.parse(raw) as RateBundle
    if (!parsed?.rates || parsed.base !== base) return null
    return parsed
  } catch {
    return null
  }
}

function writeCache(bundle: RateBundle): void {
  try {
    localStorage.setItem(CACHE_PREFIX + bundle.base, JSON.stringify(bundle))
  } catch {
    // 隐私模式下 localStorage 可能不可用，忽略
  }
}

async function fetchJSON(url: string, timeoutMs = 9000): Promise<unknown> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

/** Frankfurter（欧洲央行数据，免费无需 key） */
async function fromFrankfurter(base: string, apiBase: string, source: string): Promise<RateBundle> {
  const json = (await fetchJSON(`${apiBase}/latest?base=${encodeURIComponent(base)}`)) as {
    rates?: Record<string, number>
  }
  if (!json?.rates || !Object.keys(json.rates).length) throw new Error('汇率数据为空')
  const rates: Record<string, number> = { ...json.rates, [base]: 1 }
  return { base, rates, updatedAt: Date.now(), source }
}

/** open.er-api.com（以 USD 为基准，本地换算） */
async function fromOpenErApi(base: string): Promise<RateBundle> {
  const json = (await fetchJSON('https://open.er-api.com/v6/USD')) as {
    rates?: Record<string, number>
    time_last_update_unix?: number
  }
  if (!json?.rates) throw new Error('汇率数据为空')
  const usd = json.rates
  const denom = base === 'USD' ? 1 : usd[base]
  if (!denom) throw new Error(`暂不支持币种 ${base}`)
  const rates: Record<string, number> = { [base]: 1 }
  for (const [code, value] of Object.entries(usd)) rates[code] = value / denom
  return {
    base,
    rates,
    updatedAt: json.time_last_update_unix ? json.time_last_update_unix * 1000 : Date.now(),
    source: 'open.er-api'
  }
}

export async function fetchRates(base: string): Promise<RateBundle> {
  const steps: (() => Promise<RateBundle>)[] = [
    () => fromFrankfurter(base, 'https://api.frankfurter.dev/v1', 'frankfurter'),
    () => fromFrankfurter(base, 'https://api.frankfurter.app', 'frankfurter'),
    () => fromOpenErApi(base)
  ]
  let last: unknown = new Error('无可用汇率源')
  for (const step of steps) {
    try {
      const bundle = await step()
      writeCache(bundle)
      return bundle
    } catch (e) {
      last = e
    }
  }
  throw last instanceof Error ? last : new Error('汇率获取失败')
}

/** from → to 的汇率（1 from = rate to） */
export function rateBetween(bundle: RateBundle | null, from: string, to: string): number | undefined {
  if (!bundle) return from === to ? 1 : undefined
  if (from === to) return 1
  const a = from === bundle.base ? 1 : bundle.rates[from]
  const b = to === bundle.base ? 1 : bundle.rates[to]
  if (!a || !b || !isFinite(a) || !isFinite(b)) return undefined
  return b / a
}

export function convert(
  amount: number,
  from: string,
  to: string,
  bundle: RateBundle | null
): number | undefined {
  if (!isFinite(amount)) return undefined
  if (from === to) return amount
  const rate = rateBetween(bundle, from, to)
  return rate == null ? undefined : amount * rate
}

export interface UseRates {
  bundle: RateBundle | null
  loading: boolean
  error: string | null
  /** 上次更新时间文案，例如「今天 09:12」 */
  updatedText: string
  refresh: (force?: boolean) => Promise<void>
  rate: (from: string, to: string) => number | undefined
}

function updatedTextOf(ts: number): string {
  const d = new Date(ts)
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  const hhmm = `${`${d.getHours()}`.padStart(2, '0')}:${`${d.getMinutes()}`.padStart(2, '0')}`
  return sameDay ? `今天 ${hhmm}` : `${d.getMonth() + 1}/${d.getDate()} ${hhmm}`
}

/** 获取/缓存「当天」汇率（失败时回落到上次缓存，仍无则允许手动填汇率） */
export function useRates(base: string): UseRates {
  const [bundle, setBundle] = useState<RateBundle | null>(() => readCache(base))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(
    async (force = false) => {
      const cached = readCache(base)
      if (cached) setBundle(cached)
      if (!force && cached && Date.now() - cached.updatedAt < REFRESH_AFTER) return
      setLoading(true)
      try {
        const fresh = await fetchRates(base)
        if (fresh) setBundle(fresh)
        setError(null)
      } catch (e) {
        setError((e as Error).message || '汇率获取失败')
      } finally {
        setLoading(false)
      }
    },
    [base]
  )

  useEffect(() => {
    void refresh()
  }, [refresh])

  const rate = useCallback((from: string, to: string) => rateBetween(bundle, from, to), [bundle])

  return {
    bundle,
    loading,
    error,
    updatedText: bundle ? updatedTextOf(bundle.updatedAt) : '',
    refresh,
    rate
  }
}
