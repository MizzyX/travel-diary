import { useMemo, useState } from 'react'
import { Empty, Field, Modal } from '../components/ui'
import { useToast } from '../components/Toast'
import { useStore } from '../state/store'
import { CURRENCIES, EXPENSE_CATEGORIES, PLAN_TYPES } from '../types'
import type { Expense, ExpenseCategory, PlanItem } from '../types'
import { useRates } from '../lib/currency'
import { PLAN_TO_EXPENSE, hasSameTitle } from '../lib/linking'
import { cx, dateRange, formatDateCN, formatMoney, toDateKey } from '../lib/utils'

export function LedgerView({
  tripId,
  startDate,
  endDate,
  budget,
  currency,
  people
}: {
  tripId: string
  startDate: string
  endDate: string
  budget: number
  currency: string
  people: number
}) {
  const { data, addExpense, updateExpense, deleteExpense } = useStore()
  const toast = useToast()
  const rates = useRates(currency)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<Expense | null>(null)
  const [fromPlan, setFromPlan] = useState(false)

  const expenses = useMemo(
    () =>
      data.expenses
        .filter((e) => e.tripId === tripId)
        .sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : b.date.localeCompare(a.date))),
    [data.expenses, tripId]
  )

  const plans = useMemo(() => data.plans.filter((p) => p.tripId === tripId), [data.plans, tripId])
  /** 还没对应账单的行程（同一天 + 同标题算已生成） */
  const missingPlans = useMemo(
    () => plans.filter((p) => !hasSameTitle(expenses, p.date, p.title)),
    [plans, expenses]
  )

  const total = expenses.reduce((s, e) => s + e.amount, 0)
  const days = useMemo(() => dateRange(startDate, endDate), [startDate, endDate])
  const avgPerDay = days.length ? total / days.length : 0

  const byCategory = useMemo(() => {
    const map = new Map<ExpenseCategory, number>()
    for (const e of expenses) map.set(e.category, (map.get(e.category) ?? 0) + e.amount)
    return EXPENSE_CATEGORIES.map((c) => ({ ...c, value: map.get(c.value) ?? 0 })).filter((c) => c.value > 0)
  }, [expenses])

  const grouped = useMemo(() => {
    const map = new Map<string, Expense[]>()
    for (const e of expenses) {
      if (!map.has(e.date)) map.set(e.date, [])
      map.get(e.date)!.push(e)
    }
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]))
  }, [expenses])

  const maxDaily = useMemo(() => {
    return Math.max(1, ...days.map((d) => expenses.filter((e) => e.date === d).reduce((s, e) => s + e.amount, 0)))
  }, [days, expenses])

  const over = budget > 0 && total > budget
  const percent = budget > 0 ? Math.min(100, (total / budget) * 100) : 0
  const foreignCurrencies = Array.from(
    new Set(expenses.map((e) => e.currency).filter((c): c is string => !!c && c !== currency))
  ).slice(0, 3)

  return (
    <div className="space-y-3">
      <div className="card p-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <div className="text-xs text-slate-500">总花费</div>
            <div className={cx('text-2xl font-semibold', over ? 'text-rose-600' : 'text-slate-900')}>
              {formatMoney(total, currency)}
            </div>
          </div>
          <div className="text-right text-[11px] text-slate-500">
            <div>日均 {formatMoney(avgPerDay, currency)}</div>
            <div>人均 {formatMoney(people > 0 ? total / people : total, currency)}</div>
          </div>
        </div>
        {budget > 0 && (
          <div className="mt-3">
            <div className="mb-1 flex justify-between text-[11px] text-slate-500">
              <span>预算 {formatMoney(budget, currency)}</span>
              <span className={over ? 'text-rose-600' : ''}>
                {over ? `超出 ${formatMoney(total - budget, currency)}` : `剩余 ${formatMoney(budget - total, currency)}`}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
              <div className={cx('h-full rounded-full', over ? 'bg-rose-500' : 'bg-brand-500')} style={{ width: `${percent}%` }} />
            </div>
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-100 pt-2 text-[11px] text-slate-400">
          <span>💱 本位币 {currency}</span>
          {rates.bundle ? (
            <span>
              汇率更新于 {rates.updatedText}（{rates.bundle.source}）
            </span>
          ) : (
            <span className="text-amber-600">{rates.loading ? '正在获取汇率…' : '汇率暂不可用，付款时可手填'}</span>
          )}
          <button className="text-brand-600 disabled:opacity-50" disabled={rates.loading} onClick={() => void rates.refresh(true)}>
            {rates.loading ? '刷新中…' : '刷新汇率'}
          </button>
          {foreignCurrencies.map((c) => {
            const r = rates.rate(c, currency)
            return (
              <span key={c}>
                1 {c} = {r ? r.toFixed(4) : '?'} {currency}
              </span>
            )
          })}
        </div>
      </div>

      {byCategory.length > 0 && (
        <div className="card p-4">
          <h3 className="mb-3 text-sm font-semibold text-slate-700">分类占比</h3>
          <div className="flex flex-wrap items-center gap-4">
            <Donut slices={byCategory.map((c) => ({ value: c.value, color: c.hex }))} />
            <ul className="flex-1 space-y-1.5">
              {byCategory.map((c) => (
                <li key={c.value} className="flex items-center gap-2 text-xs text-slate-600">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: c.hex }} />
                  <span className="flex-1">
                    {c.emoji} {c.label}
                  </span>
                  <span className="text-slate-400">{Math.round((c.value / total) * 100)}%</span>
                  <span className="w-20 text-right font-medium text-slate-800">{formatMoney(c.value, currency)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {days.length > 0 && (
        <div className="card p-4">
          <h3 className="mb-3 text-sm font-semibold text-slate-700">每日花费</h3>
          <div className="flex h-28 items-end gap-1.5">
            {days.map((d) => {
              const sum = expenses.filter((e) => e.date === d).reduce((s, e) => s + e.amount, 0)
              return (
                <div key={d} className="flex flex-1 flex-col items-center gap-1">
                  <div className="flex h-20 w-full items-end">
                    <div
                      className="w-full rounded-t-md bg-brand-400"
                      style={{ height: `${Math.max(2, (sum / maxDaily) * 100)}%` }}
                      title={`${d} ${formatMoney(sum, currency)}`}
                    />
                  </div>
                  <span className="text-[10px] text-slate-400">{Number(d.slice(8, 10))}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-700">💰 账单明细</h3>
        <div className="flex gap-2">
          <button
            className="btn-ghost px-2.5 py-1.5 text-xs"
            disabled={missingPlans.length === 0}
            onClick={() => setFromPlan(true)}
          >
            ⇩ 从行程生成{missingPlans.length ? `（${missingPlans.length}）` : ''}
          </button>
          <button className="btn-primary px-2.5 py-1.5 text-xs" onClick={() => setAdding(true)}>
            + 记一笔
          </button>
        </div>
      </div>

      {grouped.length === 0 ? (
        <Empty icon="🧾" text="还没有消费记录" />
      ) : (
        <div className="space-y-3">
          {grouped.map(([date, list]) => {
            const sum = list.reduce((s, e) => s + e.amount, 0)
            return (
              <div key={date} className="card overflow-hidden">
                <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/60 px-3 py-2">
                  <span className="text-xs font-medium text-slate-600">{formatDateCN(date)}</span>
                  <span className="text-xs font-semibold text-slate-800">{formatMoney(sum, currency)}</span>
                </div>
                <ul className="divide-y divide-slate-100">
                  {list.map((e) => {
                    const meta = EXPENSE_CATEGORIES.find((c) => c.value === e.category)!
                    const foreign = !!e.currency && e.currency !== currency
                    return (
                      <li key={e.id} className="flex items-center gap-2 px-3 py-2">
                        <span className={cx('chip shrink-0', meta.color)}>
                          {meta.emoji} {meta.label}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm text-slate-700">{e.note || '消费'}</div>
                          {(foreign || e.payment) && (
                            <div className="flex gap-2 text-[11px] text-slate-400">
                              {foreign && (
                                <span>
                                  实付 {formatMoney(e.amountSource ?? e.amount, e.currency!)}
                                  {e.rate ? ` · 汇率 ${e.rate.toFixed(4)}` : ''}
                                </span>
                              )}
                              {e.payment && <span>{e.payment}</span>}
                            </div>
                          )}
                        </div>
                        <span className="shrink-0 text-sm font-medium text-slate-800">{formatMoney(e.amount, currency)}</span>
                        <button className="shrink-0 text-[11px] text-slate-400 hover:text-brand-600" onClick={() => setEditing(e)}>
                          编辑
                        </button>
                        <button
                          className="shrink-0 text-[11px] text-slate-400 hover:text-rose-600"
                          onClick={async () => {
                            await deleteExpense(e.id)
                            toast.show('已删除', 'ok')
                          }}
                        >
                          删除
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )
          })}
        </div>
      )}

      {(adding || editing) && (
        <ExpenseModal
          tripId={tripId}
          currency={currency}
          defaultDate={toDateKey()}
          initial={editing ?? undefined}
          getRate={rates.rate}
          updatedText={rates.updatedText}
          onClose={() => {
            setAdding(false)
            setEditing(null)
          }}
          onSubmit={async (payload) => {
            if (editing) await updateExpense(editing.id, payload)
            else await addExpense(payload)
            toast.show(editing ? '已更新' : '已记账', 'ok')
          }}
        />
      )}

      {fromPlan && (
        <FromPlanModal
          plans={missingPlans}
          currency={currency}
          onClose={() => setFromPlan(false)}
          onConfirm={async (rows) => {
            if (!rows.length) {
              setFromPlan(false)
              return
            }
            for (const row of rows) {
              await addExpense({
                tripId,
                date: row.date,
                category: row.category,
                amount: row.amount,
                note: row.note
              })
            }
            setFromPlan(false)
            toast.show(`已生成 ${rows.length} 条账单`, 'ok')
          }}
        />
      )}
    </div>
  )
}

function Donut({ slices, size = 96 }: { slices: { value: number; color: string }[]; size?: number }) {
  const total = slices.reduce((s, x) => s + x.value, 0) || 1
  const radius = size / 2 - 8
  const circumference = 2 * Math.PI * radius
  let offset = 0
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0 -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#f1f5f9" strokeWidth={12} />
      {slices.map((s, i) => {
        const len = (s.value / total) * circumference
        const el = (
          <circle
            key={i}
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={s.color}
            strokeWidth={12}
            strokeDasharray={`${len} ${circumference - len}`}
            strokeDashoffset={-offset}
          />
        )
        offset += len
        return el
      })}
    </svg>
  )
}

function ExpenseModal({
  tripId,
  currency,
  defaultDate,
  initial,
  getRate,
  updatedText,
  onClose,
  onSubmit
}: {
  tripId: string
  currency: string
  defaultDate: string
  initial?: Expense
  /** 1 单位支付币种 = ? 本位币 */
  getRate: (from: string, to: string) => number | undefined
  updatedText: string
  onClose: () => void
  onSubmit: (payload: Omit<Expense, 'id' | 'createdAt'>) => Promise<void>
}) {
  const toast = useToast()
  const [date, setDate] = useState(initial?.date ?? defaultDate)
  const [category, setCategory] = useState<ExpenseCategory>(initial?.category ?? 'food')
  const [paidCurrency, setPaidCurrency] = useState<string>(initial?.currency ?? currency)
  const [amount, setAmount] = useState<string>(initial ? String(initial.amountSource ?? initial.amount) : '')
  const [manualRate, setManualRate] = useState<string>(initial?.rate ? String(initial.rate) : '')
  const [note, setNote] = useState(initial?.note ?? '')
  const [payment, setPayment] = useState(initial?.payment ?? '')

  const foreign = paidCurrency !== currency
  const autoRate = foreign ? getRate(paidCurrency, currency) : 1
  const effectiveRate = Number(manualRate) > 0 ? Number(manualRate) : autoRate
  const source = Number(amount)
  const target = foreign ? (effectiveRate ? (source || 0) * effectiveRate : undefined) : source

  const submit = async () => {
    const value = Number(amount)
    if (!isFinite(value) || value <= 0) {
      toast.show('请输入金额', 'err')
      return
    }
    if (foreign && !effectiveRate) {
      toast.show('没有该币种的汇率，请手动填写汇率', 'err')
      return
    }
    await onSubmit({
      tripId,
      date,
      category,
      amount: foreign && target != null ? Number(target.toFixed(2)) : value,
      note: note.trim() || undefined,
      payment: payment.trim() || undefined,
      currency: foreign ? paidCurrency : undefined,
      amountSource: foreign ? value : undefined,
      rate: foreign ? effectiveRate : undefined
    })
    onClose()
  }

  return (
    <Modal
      open
      title={initial ? '编辑账单' : '记一笔'}
      onClose={onClose}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            取消
          </button>
          <button className="btn-primary" onClick={() => void submit()}>
            保存
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="日期">
          <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="分类">
          <div className="grid grid-cols-3 gap-2">
            {EXPENSE_CATEGORIES.map((c) => (
              <button
                key={c.value}
                type="button"
                onClick={() => setCategory(c.value)}
                className={cx(
                  'rounded-xl border px-2 py-2 text-xs transition',
                  category === c.value ? `border-transparent ${c.color}` : 'border-slate-200 text-slate-600'
                )}
              >
                {c.emoji} {c.label}
              </button>
            ))}
          </div>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="支付币种">
            <select className="input" value={paidCurrency} onChange={(e) => setPaidCurrency(e.target.value)}>
              {Array.from(new Set([currency, ...CURRENCIES])).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
          <Field label={`金额（${paidCurrency}）`}>
            <input
              type="number"
              inputMode="decimal"
              className="input"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
            />
          </Field>
        </div>
        {foreign && (
          <div className="space-y-2 rounded-xl bg-slate-50 p-3">
            <Field label={`当日汇率（1 ${paidCurrency} = ? ${currency}）`}>
              <input
                type="number"
                inputMode="decimal"
                step="0.000001"
                className="input"
                value={manualRate || (autoRate ? String(Number(autoRate.toFixed(6))) : '')}
                onChange={(e) => setManualRate(e.target.value)}
                placeholder={autoRate ? String(Number(autoRate.toFixed(6))) : '手动输入汇率'}
              />
            </Field>
            <p className="text-[11px] text-slate-500">
              {autoRate ? (
                <>按{updatedText || '当天'}汇率自动生成，可手动改 </>
              ) : (
                <>离线时没有自动汇率，手动填一个汇率即可 </>
              )}
              {target != null && source > 0 && (
                <>
                  · 折合 <b>{formatMoney(Number(target.toFixed(2)), currency)}</b>
                </>
              )}
            </p>
          </div>
        )}
        <Field label="备注">
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="例如：清水寺门票" />
        </Field>
        <Field label="支付方式（可选）">
          <input className="input" value={payment} onChange={(e) => setPayment(e.target.value)} placeholder="现金 / 支付宝 / 信用卡" />
        </Field>
      </div>
    </Modal>
  )
}

/** 把还没记账的行程一键补成账单 */
function FromPlanModal({
  plans,
  currency,
  onClose,
  onConfirm
}: {
  plans: PlanItem[]
  currency: string
  onClose: () => void
  onConfirm: (rows: { date: string; category: ExpenseCategory; amount: number; note: string }[]) => void
}) {
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [amounts, setAmounts] = useState<Record<string, string>>({})

  const toggle = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selected = plans.filter((p) => checked.has(p.id) && Number(amounts[p.id]) > 0)
  const sum = selected.reduce((s, p) => s + Number(amounts[p.id]), 0)

  const confirm = () => {
    onConfirm(
      selected.map((p) => ({
        date: p.date,
        category: PLAN_TO_EXPENSE[p.type],
        amount: Number(amounts[p.id]),
        note: p.title
      }))
    )
  }

  return (
    <Modal
      open
      wide
      title="从行程生成账单"
      onClose={onClose}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            取消
          </button>
          <button className="btn-primary" disabled={!selected.length} onClick={confirm}>
            生成 {selected.length ? `${selected.length} 条` : ''}
          </button>
        </>
      }
    >
      <div className="space-y-2">
        <div className="flex items-center justify-between text-[11px] text-slate-500">
          <span>
            勾选行程并填写金额（{currency}），会按类型自动映射到餐饮/交通/门票等分类
          </span>
          <button
            className="text-brand-600"
            onClick={() => setChecked(checked.size === plans.length ? new Set() : new Set(plans.map((p) => p.id)))}
          >
            {checked.size === plans.length ? '取消全选' : '全选'}
          </button>
        </div>
        {plans.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">行程已经全部记过账了</p>
        ) : (
          <ul className="space-y-1.5">
            {plans.map((p) => {
              const meta = PLAN_TYPES.find((t) => t.value === p.type)!
              return (
                <li key={p.id} className="flex items-center gap-2 rounded-xl border border-slate-200 px-2.5 py-2">
                  <input type="checkbox" className="h-4 w-4" checked={checked.has(p.id)} onChange={() => toggle(p.id)} />
                  <span className={cx('chip shrink-0', meta.color)}>
                    {meta.emoji} {meta.label}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-slate-700">{p.title}</div>
                    <div className="text-[11px] text-slate-400">
                      {formatDateCN(p.date)}
                      {p.time ? ` ${p.time}` : ''}
                    </div>
                  </div>
                  <input
                    type="number"
                    inputMode="decimal"
                    className="input w-24 shrink-0 py-1 text-right text-sm"
                    placeholder="金额"
                    value={amounts[p.id] ?? ''}
                    onChange={(e) => setAmounts((prev) => ({ ...prev, [p.id]: e.target.value }))}
                  />
                </li>
              )
            })}
          </ul>
        )}
        {selected.length > 0 && (
          <p className="text-right text-xs text-slate-500">
            合计 <b>{formatMoney(sum, currency)}</b>
          </p>
        )}
      </div>
    </Modal>
  )
}
