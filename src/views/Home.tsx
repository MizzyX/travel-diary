import { useMemo, useRef, useState } from 'react'
import { useStore } from '../state/store'
import { PhotoThumb } from '../components/PhotoThumb'
import { CloudButton, CloudCard } from '../components/CloudPanel'
import { Empty, Field, Modal, PageHeader } from '../components/ui'
import { useToast } from '../components/Toast'
import { buildBackup } from '../lib/backup'
import { downloadBlob, formatBytes, formatDateCN, formatMoney, daysUntil, tripStatus, toDateKey, dateRange, cx } from '../lib/utils'
import { formatDistance } from '../lib/geo'
import type { Trip } from '../types'

const today = toDateKey()

export function Home() {
  const { data, addTrip, deleteTrip, importBackup, resetAll } = useStore()
  const toast = useToast()
  const [creating, setCreating] = useState(false)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [expAll, setExpAll] = useState(true)
  const [expIds, setExpIds] = useState<string[]>([])

  const trips = useMemo(() => {
    const order = { ongoing: 0, planning: 1, done: 2 } as const
    return [...data.trips].sort((a, b) => {
      const oa = order[tripStatus(a).phase]
      const ob = order[tripStatus(b).phase]
      if (oa !== ob) return oa - ob
      return b.startDate.localeCompare(a.startDate)
    })
  }, [data.trips])

  const statsByTrip = useMemo(() => {
    const map = new Map<
      string,
      { photos: number; plans: number; distance: number; spent: number; cover?: string; days: number }
    >()
    for (const t of data.trips) {
      const photos = data.photos.filter((p) => p.tripId === t.id)
      const distance = data.tracks.filter((tr) => tr.tripId === t.id).reduce((s, tr) => s + tr.distance, 0)
      const spent = data.expenses.filter((e) => e.tripId === t.id).reduce((s, e) => s + e.amount, 0)
      const plans = data.plans.filter((p) => p.tripId === t.id).length
      const sorted = [...photos].sort((a, b) => b.takenAt - a.takenAt)
      map.set(t.id, {
        photos: photos.length,
        plans,
        distance,
        spent,
        cover: t.coverPhotoId ?? sorted[0]?.id,
        days: Math.max(1, dateRange(t.startDate, t.endDate).length)
      })
    }
    return map
  }, [data])

  const totals = useMemo(() => {
    const photos = data.photos.length
    const distance = data.tracks.reduce((s, t) => s + t.distance, 0)
    const spent = data.expenses.reduce((s, e) => s + e.amount, 0)
    return { photos, distance, spent, trips: data.trips.length }
  }, [data])

  async function handleExport(withPhotos: boolean, tripIds?: string[]) {
    setBusy(true)
    try {
      const { backup, bytes } = await buildBackup(withPhotos, 1000, tripIds)
      const text = JSON.stringify(backup)
      const single = tripIds && tripIds.length === 1 ? data.trips.find((t) => t.id === tripIds[0])?.title : undefined
      const safeTitle = single ? single.replace(/[\\/:*?"<>|]/g, '').trim() : ''
      const name = safeTitle ? `旅行日记-${safeTitle}-${today}.json` : `旅行日记备份-${today}.json`
      downloadBlob(new Blob([text], { type: 'application/json' }), name)
      toast.show(
        `已导出${safeTitle ? `「${safeTitle}」` : '全部'}备份（${formatBytes(bytes)}${withPhotos ? '，含照片' : '，不含照片'}）`,
        'ok'
      )
      setExportOpen(false)
    } catch (e) {
      toast.show(`导出失败：${(e as Error).message}`, 'err')
    } finally {
      setBusy(false)
    }
  }

  async function handleImportFile(file: File) {
    setBusy(true)
    try {
      const raw = await file.text()
      const res = await importBackup(raw)
      toast.show(`导入成功，新增 ${res.trips} 个旅行`, 'ok')
    } catch (e) {
      toast.show(`导入失败：${(e as Error).message}`, 'err')
    } finally {
      setBusy(false)
    }
  }

  async function handleSeed() {
    setBusy(true)
    try {
      const trip = await addTrip({
        title: '京都 · 大阪 五日',
        destination: '日本 关西',
        startDate: today,
        endDate: toDateKey(new Date(Date.now() + 4 * 86400000)),
        budget: 8000,
        currency: 'JPY',
        people: 2,
        notes: '示例行程：可以随意修改或删除',
        coverPhotoId: undefined
      })
      await addTrip({
        title: '川西环线自驾',
        destination: '四川',
        startDate: toDateKey(new Date(Date.now() + 30 * 86400000)),
        endDate: toDateKey(new Date(Date.now() + 37 * 86400000)),
        budget: 6000,
        currency: 'CNY',
        people: 2,
        notes: '',
        coverPhotoId: undefined
      })
      toast.show('已创建示例旅行', 'ok')
      window.location.hash = `#/trip/${trip.id}`
    } catch (e) {
      toast.show(`创建失败：${(e as Error).message}`, 'err')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="旅行日记"
        subtitle="计划 · 足迹 · 照片 · 账单，一次记完"
        right={
          <div className="flex items-center gap-2">
            <CloudButton className="btn-ghost px-2 py-1.5 text-xs" />
            <button className="btn-primary px-2.5 py-1.5 text-xs sm:px-3.5 sm:py-2 sm:text-sm" onClick={() => setCreating(true)}>
              + 新建旅行
            </button>
          </div>
        }
      />

      <div className="mb-4 grid grid-cols-4 gap-2">
        <Summary label="旅行" value={`${totals.trips}`} />
        <Summary label="照片" value={`${totals.photos}`} />
        <Summary label="里程" value={formatDistance(totals.distance)} />
        <Summary label="总花费" value={`¥${Math.round(totals.spent)}`} />
      </div>

      {trips.length === 0 ? (
        <Empty
          icon="🧳"
          text="还没有旅行，创建第一个旅行计划吧"
          action={
            <div className="mt-3 flex gap-2">
              <button className="btn-primary" onClick={() => setCreating(true)}>
                新建旅行
              </button>
              <button className="btn-ghost" disabled={busy} onClick={handleSeed}>
                生成示例
              </button>
            </div>
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {trips.map((trip) => {
            const s = statsByTrip.get(trip.id)!
            const status = tripStatus(trip)
            const left = daysUntil(trip.startDate)
            return (
              <a
                key={trip.id}
                href={`#/trip/${trip.id}`}
                className="card group overflow-hidden transition hover:shadow-lg"
              >
                <div className="relative h-36 bg-slate-100">
                  {s.cover ? (
                    <PhotoThumb photoId={s.cover} className="h-36 w-full" rounded="rounded-none" />
                  ) : (
                    <div className="flex h-full items-center justify-center bg-gradient-to-br from-brand-400 to-sky-500 text-3xl text-white/90">
                      ✈️
                    </div>
                  )}
                  <span className={cx('chip absolute left-2 top-2 bg-white/90 backdrop-blur', status.tone)}>
                    {status.label}
                    {status.phase === 'planning' && left > 0 && ` · 还有${left}天`}
                  </span>
                  <button
                    className="absolute right-2 top-2 rounded-lg bg-white/90 px-2 py-1 text-[11px] text-slate-500 opacity-0 transition group-hover:opacity-100"
                    onClick={(e) => {
                      e.preventDefault()
                      setConfirmId(trip.id)
                    }}
                  >
                    删除
                  </button>
                </div>
                <div className="p-3">
                  <h3 className="truncate text-base font-semibold text-slate-900">{trip.title}</h3>
                  <p className="mt-0.5 truncate text-xs text-slate-500">
                    📍 {trip.destination || '未填写目的地'} · {formatDateCN(trip.startDate, false)} -{' '}
                    {formatDateCN(trip.endDate, false)} · {s.days}天
                  </p>
                  <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
                    <span>📷 {s.photos}</span>
                    <span>📌 {s.plans} 项计划</span>
                    <span>🥾 {formatDistance(s.distance)}</span>
                    <span className={s.spent > trip.budget && trip.budget > 0 ? 'text-rose-600' : ''}>
                      💰 {formatMoney(s.spent, trip.currency)}
                      {trip.budget > 0 && ` / 预算 ${Math.round(trip.budget)}`}
                    </span>
                  </div>
                </div>
              </a>
            )
          })}
        </div>
      )}

      <CloudCard />

      <div className="mt-6 card p-4">
        <h3 className="mb-2 text-sm font-semibold text-slate-700">数据备份</h3>
        <p className="mb-3 text-xs text-slate-500">
          数据全部保存在这台设备的浏览器里，清理浏览器数据会丢失记录，建议定期导出备份。
        </p>
        <div className="flex flex-wrap gap-2">
          <button className="btn-ghost" disabled={busy || !data.trips.length} onClick={() => setExportOpen(true)}>
            导出备份…
          </button>
          <button className="btn-ghost" disabled={busy} onClick={() => fileRef.current?.click()}>
            导入备份
          </button>
          <button
            className="btn-danger"
            disabled={busy}
            onClick={async () => {
              if (!window.confirm('确定清空本机所有旅行数据？此操作不可恢复。')) return
              await resetAll()
              toast.show('已清空数据', 'ok')
            }}
          >
            清空数据
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void handleImportFile(f)
              e.target.value = ''
            }}
          />
        </div>
      </div>

      <Modal open={exportOpen} title="导出备份" onClose={() => setExportOpen(false)}>
        <div className="space-y-3 text-sm text-slate-600">
          <p className="text-xs text-slate-500">
            可以选择只导出某一段旅行（含它的行程、日记、足迹、账单与照片）。导入方式不变，会合并到本机数据里。
          </p>

          <label className="flex cursor-pointer items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs">
            <input type="checkbox" checked={expAll} onChange={(e) => setExpAll(e.target.checked)} />
            <span>全部旅行（{trips.length} 个）</span>
          </label>

          {!expAll && (
            <div className="max-h-64 space-y-0.5 overflow-auto rounded-xl border border-slate-200 p-1.5">
              {trips.map((t) => {
                const s = statsByTrip.get(t.id)
                const checked = expIds.includes(t.id)
                return (
                  <label
                    key={t.id}
                    className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-slate-50"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) =>
                        setExpIds((prev) => (e.target.checked ? [...prev, t.id] : prev.filter((x) => x !== t.id)))
                      }
                    />
                    <span className="min-w-0 flex-1 truncate">{t.title}</span>
                    <span className="shrink-0 text-slate-400">
                      {formatDateCN(t.startDate, false)} · 📷{s?.photos ?? 0}
                    </span>
                  </label>
                )
              })}
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            <button
              className="btn-primary"
              disabled={busy || (!expAll && !expIds.length)}
              onClick={() => handleExport(false, expAll ? undefined : expIds)}
            >
              导出（不含照片）
            </button>
            <button
              className="btn-ghost"
              disabled={busy || (!expAll && !expIds.length)}
              onClick={() => handleExport(true, expAll ? undefined : expIds)}
            >
              导出（含照片，体积较大）
            </button>
          </div>
          {!expAll && !expIds.length && <p className="text-xs text-amber-700">请至少勾选一段旅行</p>}
        </div>
      </Modal>

      <TripFormModal open={creating} onClose={() => setCreating(false)} />

      <DeleteTripDialog id={confirmId} onClose={() => setConfirmId(null)} onDelete={deleteTrip} />
    </div>
  )
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="card px-2.5 py-2">
      <div className="truncate text-sm font-semibold text-slate-900">{value}</div>
      <div className="text-[11px] text-slate-500">{label}</div>
    </div>
  )
}

function DeleteTripDialog({
  id,
  onClose,
  onDelete
}: {
  id: string | null
  onClose: () => void
  onDelete: (id: string) => Promise<void>
}) {
  const { data } = useStore()
  const trip = data.trips.find((t) => t.id === id)
  const toast = useToast()
  return (
    <Modal
      open={!!trip}
      title="删除旅行"
      onClose={onClose}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            取消
          </button>
          <button
            className="btn-danger"
            onClick={async () => {
              if (!id) return
              await onDelete(id)
              toast.show('已删除', 'ok')
              onClose()
            }}
          >
            确认删除
          </button>
        </>
      }
    >
      <p className="text-sm text-slate-600">
        将删除「{trip?.title}」及其全部行程、轨迹、照片和账单，确定继续吗？
      </p>
    </Modal>
  )
}

export function TripFormModal({ open, onClose, initial }: { open: boolean; onClose: () => void; initial?: Trip }) {
  const { addTrip, updateTrip } = useStore()
  const toast = useToast()
  const [form, setForm] = useState<{
    title: string
    destination: string
    startDate: string
    endDate: string
    people: number
    budget: number
    currency: string
    notes: string
  }>({
    title: initial?.title ?? '',
    destination: initial?.destination ?? '',
    startDate: initial?.startDate ?? today,
    endDate: initial?.endDate ?? toDateKey(new Date(Date.now() + 5 * 86400000)),
    people: initial?.people ?? 1,
    budget: initial?.budget ?? 0,
    currency: initial?.currency ?? 'CNY',
    notes: initial?.notes ?? ''
  })

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }))

  const submit = async () => {
    if (!form.title.trim()) {
      toast.show('请填写旅行名称', 'err')
      return
    }
    if (form.endDate < form.startDate) {
      toast.show('结束日期不能早于开始日期', 'err')
      return
    }
    const payload = {
      title: form.title.trim(),
      destination: form.destination.trim(),
      startDate: form.startDate,
      endDate: form.endDate,
      people: Number(form.people) || 1,
      budget: Number(form.budget) || 0,
      currency: form.currency,
      notes: form.notes
    }
    if (initial) await updateTrip(initial.id, payload)
    else await addTrip({ ...payload, coverPhotoId: undefined })
    toast.show(initial ? '已更新' : '旅行已创建', 'ok')
    onClose()
  }

  return (
    <Modal
      open={open}
      title={initial ? '编辑旅行' : '新建旅行'}
      onClose={onClose}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            取消
          </button>
          <button className="btn-primary" onClick={submit}>
            保存
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="旅行名称">
          <input className="input" value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="例如：京都赏枫五日" />
        </Field>
        <Field label="目的地">
          <input className="input" value={form.destination} onChange={(e) => set('destination', e.target.value)} placeholder="例如：日本 关西" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="出发日期">
            <input type="date" className="input" value={form.startDate} onChange={(e) => set('startDate', e.target.value)} />
          </Field>
          <Field label="返程日期">
            <input type="date" className="input" value={form.endDate} onChange={(e) => set('endDate', e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="人数">
            <input type="number" min={1} className="input" value={form.people} onChange={(e) => set('people', Number(e.target.value))} />
          </Field>
          <Field label="预算">
            <input type="number" min={0} className="input" value={form.budget} onChange={(e) => set('budget', Number(e.target.value))} />
          </Field>
          <Field label="币种">
            <select className="input" value={form.currency} onChange={(e) => set('currency', e.target.value)}>
              {['CNY', 'JPY', 'USD', 'EUR', 'HKD', 'TWD', 'KRW', 'THB', 'GBP', 'SGD', 'AUD'].map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="备注">
          <textarea className="input" rows={3} value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="同行人、注意事项…" />
        </Field>
      </div>
    </Modal>
  )
}
