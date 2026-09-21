import { useMemo, useState } from 'react'
import { Field, Modal, SectionTitle } from '../components/ui'
import { LocationPicker } from '../components/LocationPicker'
import type { PickedPlace } from '../components/LocationPicker'
import { useToast } from '../components/Toast'
import { useStore } from '../state/store'
import { EXPENSE_CATEGORIES, PLAN_TYPES } from '../types'
import type { Expense, PlanItem, PlanType } from '../types'
import { EXPENSE_TO_PLAN, hasSameTitle } from '../lib/linking'
import { cx, dateRange, formatDateCN, formatMoney, toDateKey } from '../lib/utils'

export function PlanView({ tripId, startDate, endDate }: { tripId: string; startDate: string; endDate: string }) {
  const { data, addPlan, updatePlan, deletePlan } = useStore()
  const toast = useToast()
  const days = useMemo(() => dateRange(startDate, endDate), [startDate, endDate])
  const [activeDay, setActiveDay] = useState<string>(
    () => (days.includes(toDateKey()) ? toDateKey() : days[0] ?? toDateKey())
  )
  const [editing, setEditing] = useState<PlanItem | null>(null)
  const [adding, setAdding] = useState(false)
  const [fromLedger, setFromLedger] = useState(false)

  const items = useMemo(
    () =>
      data.plans
        .filter((p) => p.tripId === tripId && p.date === activeDay)
        .sort((a, b) => (a.time ?? '99:99').localeCompare(b.time ?? '99:99')),
    [data.plans, tripId, activeDay]
  )

  const allCount = data.plans.filter((p) => p.tripId === tripId).length
  const doneCount = data.plans.filter((p) => p.tripId === tripId && p.done).length

  const currency = data.trips.find((t) => t.id === tripId)?.currency ?? 'CNY'
  const expenses = useMemo(() => data.expenses.filter((e) => e.tripId === tripId), [data.expenses, tripId])
  /** 还没补全进行程的消费（同一天 + 同标题算已有行程） */
  const missingExpenses = useMemo(() => {
    const allPlans = data.plans.filter((p) => p.tripId === tripId)
    return expenses
      .filter((e) => !hasSameTitle(allPlans, e.date, e.note ?? defaultTitleOf(e)))
      .sort((a, b) => a.date.localeCompare(b.date))
  }, [data.plans, expenses, tripId])

  return (
    <div className="space-y-3">
      <div className="card p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium text-slate-500">行程日期</span>
          <span className="text-[11px] text-slate-400">
            共 {allCount} 项 · 已完成 {doneCount}
          </span>
        </div>
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {days.map((d) => {
            const n = data.plans.filter((p) => p.tripId === tripId && p.date === d).length
            return (
              <button
                key={d}
                onClick={() => setActiveDay(d)}
                className={cx(
                  'shrink-0 rounded-xl border px-3 py-1.5 text-center text-xs transition',
                  d === activeDay
                    ? 'border-brand-500 bg-brand-50 text-brand-700'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                )}
              >
                <div className="font-medium">{formatDateCN(d)}</div>
                <div className="text-[10px] text-slate-400">第{days.indexOf(d) + 1}天 · {n}项</div>
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionTitle>🗓️ {formatDateCN(activeDay)} 行程</SectionTitle>
        <div className="flex gap-2">
          <button
            className="btn-ghost px-2.5 py-1.5 text-xs"
            disabled={missingExpenses.length === 0}
            onClick={() => setFromLedger(true)}
          >
            ⇩ 从账单补全{missingExpenses.length ? `（${missingExpenses.length}）` : ''}
          </button>
          <button className="btn-primary px-2.5 py-1.5 text-xs" onClick={() => setAdding(true)}>
            + 添加行程
          </button>
        </div>
      </div>

      {items.length === 0 ? (
        <p className="card p-6 text-center text-sm text-slate-500">这一天还没有安排，点右上角添加吧</p>
      ) : (
        <ol className="relative space-y-2 pl-1">
          {items.map((item) => {
            const meta = PLAN_TYPES.find((t) => t.value === item.type)!
            return (
              <li key={item.id} className="card flex gap-3 p-3">
                <div className="w-12 shrink-0 text-center">
                  <div className={cx('chip mx-auto', meta.color)}>{meta.emoji}</div>
                  <div className="mt-1 text-[11px] font-medium text-slate-500">{item.time || '—'}</div>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start gap-2">
                    <div className={cx('min-w-0 flex-1', item.done && 'opacity-60')}>
                      <div className={cx('text-sm font-medium text-slate-800', item.done && 'line-through')}>
                        {item.title}
                      </div>
                      {item.location && <div className="mt-0.5 text-[11px] text-slate-500">📍 {item.location}</div>}
                      {item.note && <div className="mt-1 whitespace-pre-wrap text-xs text-slate-500">{item.note}</div>}
                    </div>
                    <button
                      className={cx(
                        'shrink-0 rounded-lg border px-2 py-1 text-[11px]',
                        item.done ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-500'
                      )}
                      onClick={() => void updatePlan(item.id, { done: !item.done })}
                    >
                      {item.done ? '已完成' : '标记完成'}
                    </button>
                  </div>
                  <div className="mt-2 flex gap-2 text-[11px] text-slate-400">
                    <button className="hover:text-brand-600" onClick={() => setEditing(item)}>
                      编辑
                    </button>
                    <button
                      className="hover:text-rose-600"
                      onClick={async () => {
                        await deletePlan(item.id)
                      }}
                    >
                      删除
                    </button>
                  </div>
                </div>
              </li>
            )
          })}
        </ol>
      )}

      {(adding || editing) && (
        <PlanFormModal
          tripId={tripId}
          date={activeDay}
          initial={editing ?? undefined}
          onClose={() => {
            setAdding(false)
            setEditing(null)
          }}
          onSubmit={async (payload) => {
            if (editing) await updatePlan(editing.id, payload)
            else await addPlan(payload)
          }}
        />
      )}

      {fromLedger && (
        <FromLedgerModal
          expenses={missingExpenses}
          currency={currency}
          onClose={() => setFromLedger(false)}
          onConfirm={async (rows) => {
            if (!rows.length) {
              setFromLedger(false)
              return
            }
            for (const row of rows) {
              await addPlan({
                tripId,
                date: row.date,
                title: row.title,
                type: row.type,
                done: true,
                sortOrder: 0
              })
            }
            setFromLedger(false)
            toast.show(`已补全 ${rows.length} 项行程`, 'ok')
          }}
        />
      )}
    </div>
  )
}

function defaultTitleOf(e: Expense): string {
  const meta = EXPENSE_CATEGORIES.find((c) => c.value === e.category)
  return `${meta?.emoji ?? ''}${meta?.label ?? '消费'}`
}

/** 把账单按分类反向补成一天的行程 */
function FromLedgerModal({
  expenses,
  currency,
  onClose,
  onConfirm
}: {
  expenses: Expense[]
  currency: string
  onClose: () => void
  onConfirm: (rows: { date: string; title: string; type: PlanType }[]) => void
}) {
  const [checked, setChecked] = useState<Set<string>>(new Set(expenses.map((e) => e.id)))
  const [titles, setTitles] = useState<Record<string, string>>({})

  const titleOf = (e: Expense) => titles[e.id] ?? e.note ?? defaultTitleOf(e)
  const selected = expenses.filter((e) => checked.has(e.id))

  return (
    <Modal
      open
      wide
      title="从账单补全行程"
      onClose={onClose}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            取消
          </button>
          <button
            className="btn-primary"
            disabled={!selected.length}
            onClick={() =>
              onConfirm(
                selected.map((e) => ({
                  date: e.date,
                  title: titleOf(e).trim() || defaultTitleOf(e),
                  type: EXPENSE_TO_PLAN[e.category]
                }))
              )
            }
          >
            补全 {selected.length ? `${selected.length} 项` : ''}
          </button>
        </>
      }
    >
      <div className="space-y-2">
        <div className="flex items-center justify-between text-[11px] text-slate-500">
          <span>勾选要补进行程的消费，标题可改；地点可生成后再用地图补充</span>
          <button
            className="text-brand-600"
            onClick={() =>
              setChecked(checked.size === expenses.length ? new Set() : new Set(expenses.map((e) => e.id)))
            }
          >
            {checked.size === expenses.length ? '取消全选' : '全选'}
          </button>
        </div>
        {expenses.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">账单已经全部写进行程了</p>
        ) : (
          <ul className="space-y-1.5">
            {expenses.map((e) => {
              const planType = EXPENSE_TO_PLAN[e.category]
              const planMeta = PLAN_TYPES.find((t) => t.value === planType)!
              return (
                <li key={e.id} className="flex items-center gap-2 rounded-xl border border-slate-200 px-2.5 py-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={checked.has(e.id)}
                    onChange={() =>
                      setChecked((prev) => {
                        const next = new Set(prev)
                        if (next.has(e.id)) next.delete(e.id)
                        else next.add(e.id)
                        return next
                      })
                    }
                  />
                  <span className={cx('chip shrink-0', planMeta.color)}>
                    {planMeta.emoji} {planMeta.label}
                  </span>
                  <input
                    className="input min-w-0 flex-1 py-1 text-sm"
                    value={titleOf(e)}
                    onChange={(ev) => setTitles((prev) => ({ ...prev, [e.id]: ev.target.value }))}
                  />
                  <span className="shrink-0 text-[11px] text-slate-500">
                    {formatDateCN(e.date)} · {formatMoney(e.amount, currency)}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </Modal>
  )
}

function PlanFormModal({
  tripId,
  date,
  initial,
  onClose,
  onSubmit
}: {
  tripId: string
  date: string
  initial?: PlanItem
  onClose: () => void
  onSubmit: (payload: Omit<PlanItem, 'id'>) => Promise<void>
}) {
  const toast = useToast()
  const [time, setTime] = useState(initial?.time ?? '')
  const [title, setTitle] = useState(initial?.title ?? '')
  const [type, setType] = useState<PlanType>(initial?.type ?? 'sight')
  const [place, setPlace] = useState<PickedPlace>({
    label: initial?.location ?? '',
    lat: initial?.lat,
    lng: initial?.lng
  })
  const [note, setNote] = useState(initial?.note ?? '')

  const submit = async () => {
    if (!title.trim()) {
      toast.show('请填写行程内容', 'err')
      return
    }
    await onSubmit({
      tripId,
      date,
      time: time || undefined,
      title: title.trim(),
      type,
      location: place.label || undefined,
      lat: place.lat,
      lng: place.lng,
      note: note.trim() || undefined,
      done: initial?.done ?? false,
      sortOrder: 0
    })
    toast.show(initial ? '已更新' : '已添加', 'ok')
    onClose()
  }

  return (
    <Modal
      open
      title={initial ? '编辑行程' : '添加行程'}
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
        <div className="grid grid-cols-2 gap-3">
          <Field label="时间">
            <input type="time" className="input" value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
          <Field label="类型">
            <select className="input" value={type} onChange={(e) => setType(e.target.value as PlanType)}>
              {PLAN_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.emoji} {t.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="内容">
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如：参观清水寺" />
        </Field>
        <LocationPicker value={place} onChange={setPlace} />
        <Field label="备注">
          <textarea className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="门票、预约、交通方式…" />
        </Field>
      </div>
    </Modal>
  )
}
