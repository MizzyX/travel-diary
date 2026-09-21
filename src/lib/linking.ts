import type { ExpenseCategory, PlanType } from '../types'

/** 行程类型 → 消费分类 */
export const PLAN_TO_EXPENSE: Record<PlanType, ExpenseCategory> = {
  transport: 'transport',
  stay: 'stay',
  food: 'food',
  sight: 'ticket',
  shop: 'shop',
  other: 'other'
}

/** 消费分类 → 行程类型 */
export const EXPENSE_TO_PLAN: Record<ExpenseCategory, PlanType> = {
  transport: 'transport',
  stay: 'stay',
  food: 'food',
  ticket: 'sight',
  shop: 'shop',
  other: 'other'
}

/** 判断某一天是否存在「标题相同」的行程/账单（避免重复生成） */
export function hasSameTitle(list: { title?: string; note?: string; date: string }[], date: string, text: string): boolean {
  const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase()
  const target = norm(text)
  if (!target) return false
  return list.some((item) => item.date === date && norm((item.title ?? item.note ?? '') as string) === target)
}
