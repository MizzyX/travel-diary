import { useMemo, useState } from 'react'
import { Field, Modal } from '../components/ui'
import { PhotoThumb } from '../components/PhotoThumb'
import { useToast } from '../components/Toast'
import { useStore } from '../state/store'
import { EXPENSE_CATEGORIES, PLAN_TYPES } from '../types'
import type { Journal, Photo, PlanItem } from '../types'
import { cx, dateRange, formatDateCN, formatMoney, toDateKey, toTimeKey } from '../lib/utils'
import { formatDistance } from '../lib/geo'
import { getCurrentPos } from '../lib/location'

type EntryKind = 'plan' | 'photo' | 'journal' | 'expense'
interface Entry {
  key: string
  kind: EntryKind
  time?: string
  sortKey: string
  payload: PlanItem | Photo | Journal | { id: string; amount: number; category: string; note?: string; date: string }
}

export function DailyView({
  tripId,
  startDate,
  endDate,
  currency
}: {
  tripId: string
  startDate: string
  endDate: string
  currency: string
}) {
  const { data, deleteJournal, deletePhoto } = useStore()
  const days = useMemo(() => dateRange(startDate, endDate), [startDate, endDate])
  const [activeDay, setActiveDay] = useState(() => (days.includes(toDateKey()) ? toDateKey() : days[0] ?? toDateKey()))
  const [writing, setWriting] = useState(false)
  const [editJournal, setEditJournal] = useState<Journal | null>(null)
  const [viewer, setViewer] = useState<Photo | null>(null)

  const dayPhotos = data.photos.filter((p) => p.tripId === tripId && toDateKey(p.takenAt) === activeDay)
  const dayPlans = data.plans.filter((p) => p.tripId === tripId && p.date === activeDay)
  const dayJournals = data.journals.filter((j) => j.tripId === tripId && j.date === activeDay)
  const dayExpenses = data.expenses.filter((e) => e.tripId === tripId && e.date === activeDay)
  const dayDistance = data.tracks
    .filter((t) => t.tripId === tripId && t.points.some((p) => toDateKey(p.t) === activeDay))
    .reduce((sum, t) => {
      const pts = t.points.filter((p) => toDateKey(p.t) === activeDay)
      let d = 0
      for (let i = 1; i < pts.length; i++) d += haversineLocal(pts[i - 1], pts[i])
      return sum + d
    }, 0)
  const daySpent = dayExpenses.reduce((s, e) => s + e.amount, 0)

  const entries: Entry[] = useMemo(() => {
    const list: Entry[] = []
    for (const p of dayPlans)
      list.push({ key: `plan-${p.id}`, kind: 'plan', time: p.time, sortKey: p.time ?? '99:99', payload: p })
    for (const p of dayPhotos)
      list.push({ key: `photo-${p.id}`, kind: 'photo', time: toTimeKey(p.takenAt), sortKey: toTimeKey(p.takenAt), payload: p })
    for (const j of dayJournals)
      list.push({ key: `journal-${j.id}`, kind: 'journal', time: j.time, sortKey: j.time ?? toTimeKey(j.createdAt), payload: j })
    for (const e of dayExpenses)
      list.push({ key: `expense-${e.id}`, kind: 'expense', sortKey: 'zz', payload: e })
    return list.sort((a, b) => a.sortKey.localeCompare(b.sortKey))
  }, [dayPlans, dayPhotos, dayJournals, dayExpenses])

  return (
    <div className="space-y-3">
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {days.map((d) => {
          const count =
            data.photos.filter((p) => p.tripId === tripId && toDateKey(p.takenAt) === d).length +
            data.journals.filter((j) => j.tripId === tripId && j.date === d).length
          return (
            <button
              key={d}
              onClick={() => setActiveDay(d)}
              className={cx(
                'shrink-0 rounded-xl border px-3 py-1.5 text-xs transition',
                d === activeDay
                  ? 'border-brand-500 bg-brand-50 text-brand-700'
                  : 'border-slate-200 bg-white text-slate-600'
              )}
            >
              {formatDateCN(d)}
              {count > 0 && <span className="ml-1 text-[10px] text-slate-400">{count}</span>}
            </button>
          )
        })}
      </div>

      <div className="card grid grid-cols-4 gap-2 p-3 text-center">
        <MiniStat label="照片" value={`${dayPhotos.length}`} />
        <MiniStat label="随记" value={`${dayJournals.length}`} />
        <MiniStat label="里程" value={formatDistance(dayDistance)} />
        <MiniStat label="花费" value={formatMoney(daySpent, currency)} />
      </div>

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">{formatDateCN(activeDay)} 的日记</h3>
        <button className="btn-primary px-2.5 py-1.5 text-xs" onClick={() => setWriting(true)}>
          ✍️ 写点什么
        </button>
      </div>

      {entries.length === 0 ? (
        <p className="card p-6 text-center text-sm text-slate-500">这一天还没有记录，写段文字或上传照片吧</p>
      ) : (
        <ol className="space-y-2">
          {entries.map((entry) => (
            <TimelineRow
              key={entry.key}
              entry={entry}
              currency={currency}
              onViewPhoto={setViewer}
              onDeletePhoto={deletePhoto}
              onEditJournal={setEditJournal}
              onDeleteJournal={deleteJournal}
            />
          ))}
        </ol>
      )}

      {(writing || editJournal) && (
        <JournalModal
          tripId={tripId}
          date={activeDay}
          initial={editJournal ?? undefined}
          onClose={() => {
            setWriting(false)
            setEditJournal(null)
          }}
        />
      )}

      {viewer && <PhotoViewer photo={viewer} onClose={() => setViewer(null)} />}
    </div>
  )
}

function haversineLocal(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371008.8
  const rad = (d: number) => (d * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="truncate text-sm font-semibold text-slate-900">{value}</div>
      <div className="text-[11px] text-slate-500">{label}</div>
    </div>
  )
}

function TimelineRow({
  entry,
  currency,
  onViewPhoto,
  onDeletePhoto,
  onEditJournal,
  onDeleteJournal
}: {
  entry: Entry
  currency: string
  onViewPhoto: (p: Photo) => void
  onDeletePhoto: (id: string) => Promise<void>
  onEditJournal: (j: Journal) => void
  onDeleteJournal: (id: string) => Promise<void>
}) {
  if (entry.kind === 'plan') {
    const p = entry.payload as PlanItem
    const meta = PLAN_TYPES.find((t) => t.value === p.type)!
    return (
      <li className="card flex items-center gap-2 px-3 py-2">
        <span className="w-10 shrink-0 text-[11px] text-slate-400">{entry.time ?? ''}</span>
        <span className={cx('chip shrink-0', meta.color)}>
          {meta.emoji} {meta.label}
        </span>
        <span className={cx('truncate text-sm text-slate-700', p.done && 'text-slate-400 line-through')}>{p.title}</span>
      </li>
    )
  }

  if (entry.kind === 'photo') {
    const p = entry.payload as Photo
    return (
      <li className="card overflow-hidden">
        <div className="flex items-center gap-2 px-3 pt-2 text-[11px] text-slate-400">
          <span>{entry.time}</span>
          <span>📷 照片</span>
          {p.lat != null && <span>· 已记录位置</span>}
          <span className="ml-auto flex gap-2">
            <button className="hover:text-rose-600" onClick={() => void onDeletePhoto(p.id)}>
              删除
            </button>
          </span>
        </div>
        <button className="mt-1 block w-full" onClick={() => onViewPhoto(p)}>
          <PhotoThumb photoId={p.id} className="max-h-80 w-full" rounded="rounded-none" alt={p.caption} />
        </button>
        {p.caption && <p className="px-3 py-2 text-sm text-slate-700">{p.caption}</p>}
      </li>
    )
  }

  if (entry.kind === 'journal') {
    const j = entry.payload as Journal
    return (
      <li className="card px-3 py-2.5">
        <div className="mb-1 flex items-center gap-2 text-[11px] text-slate-400">
          <span>{entry.time}</span>
          <span>✍️ 随记</span>
          {j.lat != null && <span>· 📍位置</span>}
          <span className="ml-auto flex gap-2">
            <button className="hover:text-brand-600" onClick={() => onEditJournal(j)}>
              编辑
            </button>
            <button className="hover:text-rose-600" onClick={() => void onDeleteJournal(j.id)}>
              删除
            </button>
          </span>
        </div>
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{j.text}</p>
      </li>
    )
  }

  const e = entry.payload as { id: string; amount: number; category: string; note?: string }
  const meta = EXPENSE_CATEGORIES.find((c) => c.value === e.category)!
  return (
    <li className="card flex items-center gap-2 px-3 py-2">
      <span className="w-10 shrink-0 text-[11px] text-slate-400">💰</span>
      <span className={cx('chip shrink-0', meta.color)}>
        {meta.emoji} {meta.label}
      </span>
      <span className="truncate text-sm text-slate-600">{e.note ?? ''}</span>
      <span className="ml-auto shrink-0 text-sm font-medium text-slate-800">{formatMoney(e.amount, currency)}</span>
    </li>
  )
}

function JournalModal({
  tripId,
  date,
  initial,
  onClose
}: {
  tripId: string
  date: string
  initial?: Journal
  onClose: () => void
}) {
  const { addJournal, updateJournal } = useStore()
  const toast = useToast()
  const [time, setTime] = useState(initial?.time ?? toTimeKey())
  const [text, setText] = useState(initial?.text ?? '')
  const [withLocation, setWithLocation] = useState(initial?.lat != null)
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (!text.trim()) {
      toast.show('写点内容吧', 'err')
      return
    }
    setSaving(true)
    try {
      let pos: { lat: number; lng: number } | undefined
      if (withLocation) {
        try {
          pos = await getCurrentPos(6000)
        } catch {
          pos = undefined
        }
      }
      const payload = {
        tripId,
        date,
        time: time || undefined,
        text: text.trim(),
        lat: pos?.lat ?? initial?.lat,
        lng: pos?.lng ?? initial?.lng
      }
      if (initial) await updateJournal(initial.id, payload)
      else await addJournal(payload)
      toast.show('已保存', 'ok')
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      title={initial ? '编辑随记' : '写随记'}
      onClose={onClose}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            取消
          </button>
          <button className="btn-primary" disabled={saving} onClick={() => void save()}>
            {saving ? '保存中' : '保存'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="时间">
          <input type="time" className="input" value={time} onChange={(e) => setTime(e.target.value)} />
        </Field>
        <Field label="此刻的感受">
          <textarea
            className="input"
            rows={6}
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="今天走过哪里、看到什么、吃到什么…"
          />
        </Field>
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <input type="checkbox" checked={withLocation} onChange={(e) => setWithLocation(e.target.checked)} />
          同时记录当前位置
        </label>
      </div>
    </Modal>
  )
}

export function PhotoViewer({ photo, onClose }: { photo: Photo; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[1100] flex flex-col bg-black/90" onClick={onClose}>
      <div className="flex items-center justify-between p-3 text-sm text-white/80">
        <span>{new Date(photo.takenAt).toLocaleString('zh-CN')}</span>
        <button className="rounded-lg px-2 py-1" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="flex flex-1 items-center justify-center overflow-hidden px-2 pb-6">
        <PhotoThumb photoId={photo.id} kind="full" className="max-h-full max-w-full object-contain" rounded="" />
      </div>
      {photo.caption && <p className="px-4 pb-6 text-center text-sm text-white/80">{photo.caption}</p>}
    </div>
  )
}
