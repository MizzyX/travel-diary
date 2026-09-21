export function uid(prefix = ''): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 10)
      : Math.random().toString(36).slice(2, 12)
  return `${prefix}${Date.now().toString(36)}${rand}`
}

/** yyyy-MM-dd */
export function toDateKey(d: Date | number | string = new Date()): string {
  const date = d instanceof Date ? d : new Date(d)
  const m = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${date.getFullYear()}-${m}-${day}`
}

/** HH:mm */
export function toTimeKey(d: Date | number = new Date()): string {
  const date = d instanceof Date ? d : new Date(d)
  return `${`${date.getHours()}`.padStart(2, '0')}:${`${date.getMinutes()}`.padStart(2, '0')}`
}

export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}

/** 生成旅行日期范围内的每一天（yyyy-MM-dd 数组） */
export function dateRange(start: string, end: string): string[] {
  const out: string[] = []
  if (!start || !end) return out
  const s = parseDateKey(start).getTime()
  const e = parseDateKey(end).getTime()
  if (!s || !e || e < s) return out
  for (let t = s; t <= e; t += 86400000) out.push(toDateKey(t))
  return out
}

const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

export function formatDateCN(key: string, withWeek = true): string {
  const d = parseDateKey(key)
  const base = `${d.getMonth() + 1}月${d.getDate()}日`
  return withWeek ? `${base} ${WEEK[d.getDay()]}` : base
}

export function formatDateTime(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${`${d.getHours()}`.padStart(2, '0')}:${`${d.getMinutes()}`.padStart(2, '0')}`
}

export function formatClock(ts: number): string {
  const d = new Date(ts)
  return `${`${d.getHours()}`.padStart(2, '0')}:${`${d.getMinutes()}`.padStart(2, '0')}`
}

export function daysUntil(start: string): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((parseDateKey(start).getTime() - today.getTime()) / 86400000)
}

export function tripStatus(trip: { startDate: string; endDate: string }): {
  label: string
  tone: string
  phase: 'planning' | 'ongoing' | 'done'
} {
  const today = toDateKey()
  if (trip.startDate && trip.endDate && today >= trip.startDate && today <= trip.endDate)
    return { label: '旅行中', tone: 'bg-brand-100 text-brand-700', phase: 'ongoing' }
  if (trip.startDate && today < trip.startDate) return { label: '计划中', tone: 'bg-sky-100 text-sky-700', phase: 'planning' }
  return { label: '已完成', tone: 'bg-slate-100 text-slate-500', phase: 'done' }
}

export function formatMoney(n: number, currency = 'CNY'): string {
  const symbol: Record<string, string> = { CNY: '¥', JPY: '¥', USD: '$', EUR: '€', GBP: '£', HKD: 'HK$', TWD: 'NT$', KRW: '₩', THB: '฿', SGD: 'S$', AUD: 'A$' }
  return `${symbol[currency] ?? ''}${n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h) return `${h}小时${m}分`
  if (m) return `${m}分${s}秒`
  return `${s}秒`
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}
