export interface Trip {
  id: string
  title: string
  destination: string
  /** yyyy-MM-dd */
  startDate: string
  /** yyyy-MM-dd */
  endDate: string
  coverPhotoId?: string
  budget: number
  currency: string
  people: number
  notes: string
  createdAt: number
  updatedAt: number
}

export type PlanType = 'transport' | 'stay' | 'food' | 'sight' | 'shop' | 'other'

export interface PlanItem {
  id: string
  tripId: string
  /** yyyy-MM-dd */
  date: string
  /** HH:mm */
  time?: string
  title: string
  type: PlanType
  location?: string
  note?: string
  lat?: number
  lng?: number
  done: boolean
  sortOrder: number
  /** 最后修改时间（多端同步用，老数据可能没有） */
  updatedAt?: number
}

export interface Journal {
  id: string
  tripId: string
  /** yyyy-MM-dd */
  date: string
  /** HH:mm */
  time?: string
  text: string
  lat?: number
  lng?: number
  createdAt: number
  updatedAt?: number
}

export interface TrackPoint {
  lat: number
  lng: number
  /** 时间戳 ms */
  t: number
  /** 精度 m */
  acc?: number
  /** 海拔 m */
  alt?: number
}

export interface Track {
  id: string
  tripId: string
  name: string
  startedAt: number
  endedAt: number
  points: TrackPoint[]
  /** 米 */
  distance: number
  updatedAt?: number
}

export interface Photo {
  id: string
  tripId: string
  caption: string
  takenAt: number
  lat?: number
  lng?: number
  width?: number
  height?: number
  /** 原图字节数 */
  size: number
  /** 是否携带 EXIF 位置信息 */
  fromExif?: boolean
  createdAt: number
  updatedAt?: number
}

export type ExpenseCategory = 'transport' | 'stay' | 'food' | 'ticket' | 'shop' | 'other'

export interface Expense {
  id: string
  tripId: string
  /** yyyy-MM-dd */
  date: string
  category: ExpenseCategory
  /** 记账本位币（旅行币种）金额 */
  amount: number
  note?: string
  payment?: string
  /** 实际支付币种（与本位币不同时才有意义） */
  currency?: string
  /** 实际支付币种的原金额 */
  amountSource?: number
  /** 记账时使用的汇率：1 currency = rate 本位币 */
  rate?: number
  createdAt: number
  updatedAt?: number
}

/** 参与同步的业务表 */
export const SYNC_STORES = ['trips', 'plans', 'journals', 'tracks', 'expenses', 'photos'] as const
export type SyncStore = (typeof SYNC_STORES)[number]

/** 删除墓碑：本地删掉一条记录后要留痕，否则同步时会被其他端“复活” */
export interface Tombstone {
  id: string
  store: SyncStore
  updatedAt: number
}

export type StoreName = SyncStore | 'tombstones'

export interface AppData {
  trips: Trip[]
  plans: PlanItem[]
  journals: Journal[]
  tracks: Track[]
  expenses: Expense[]
  photos: Photo[]
}

export const EMPTY_DATA: AppData = {
  trips: [],
  plans: [],
  journals: [],
  tracks: [],
  expenses: [],
  photos: []
}

export const PLAN_TYPES: { value: PlanType; label: string; emoji: string; color: string }[] = [
  { value: 'transport', label: '交通', emoji: '🚆', color: 'bg-sky-100 text-sky-700' },
  { value: 'stay', label: '住宿', emoji: '🏨', color: 'bg-violet-100 text-violet-700' },
  { value: 'food', label: '餐饮', emoji: '🍜', color: 'bg-amber-100 text-amber-700' },
  { value: 'sight', label: '景点', emoji: '🏞️', color: 'bg-emerald-100 text-emerald-700' },
  { value: 'shop', label: '购物', emoji: '🛍️', color: 'bg-pink-100 text-pink-700' },
  { value: 'other', label: '其他', emoji: '📌', color: 'bg-slate-100 text-slate-600' }
]

export const EXPENSE_CATEGORIES: {
  value: ExpenseCategory
  label: string
  emoji: string
  color: string
  hex: string
}[] = [
  { value: 'transport', label: '交通', emoji: '🚆', color: 'bg-sky-100 text-sky-700', hex: '#0ea5e9' },
  { value: 'stay', label: '住宿', emoji: '🏨', color: 'bg-violet-100 text-violet-700', hex: '#8b5cf6' },
  { value: 'food', label: '餐饮', emoji: '🍜', color: 'bg-amber-100 text-amber-700', hex: '#f59e0b' },
  { value: 'ticket', label: '门票', emoji: '🎫', color: 'bg-emerald-100 text-emerald-700', hex: '#10b981' },
  { value: 'shop', label: '购物', emoji: '🛍️', color: 'bg-pink-100 text-pink-700', hex: '#ec4899' },
  { value: 'other', label: '其他', emoji: '📌', color: 'bg-slate-100 text-slate-600', hex: '#64748b' }
]

export const CURRENCIES = ['CNY', 'JPY', 'USD', 'EUR', 'HKD', 'TWD', 'KRW', 'THB', 'GBP', 'SGD', 'AUD']
