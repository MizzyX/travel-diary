import { useMemo, useRef, useState } from 'react'
import { Empty, Field, Modal } from '../components/ui'
import { PhotoThumb } from '../components/PhotoThumb'
import { PhotoViewer } from './DailyView'
import { useToast } from '../components/Toast'
import { useStore } from '../state/store'
import { cx, dateRange, formatBytes, formatClock, formatDateCN, toDateKey } from '../lib/utils'
import { matchPhotosToTracks } from '../lib/geo'
import type { PhotoPositionMatch } from '../lib/geo'
import type { Photo } from '../types'

export function AlbumView({
  tripId,
  startDate,
  endDate
}: {
  tripId: string
  startDate: string
  endDate: string
}) {
  const { data, addPhotos, updatePhoto, patchPhotos, deletePhoto, updateTrip } = useStore()
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<number | null>(null)
  const [day, setDay] = useState<string>('')
  const [viewer, setViewer] = useState<Photo | null>(null)
  const [editing, setEditing] = useState<Photo | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [dragOver, setDragOver] = useState(false)
  const [tolerance, setTolerance] = useState(30)
  const [matched, setMatched] = useState<PhotoPositionMatch[] | null>(null)
  const [matching, setMatching] = useState(false)

  const photos = useMemo(
    () =>
      data.photos
        .filter((p) => p.tripId === tripId)
        .sort((a, b) => b.takenAt - a.takenAt),
    [data.photos, tripId]
  )

  const days = useMemo(() => {
    const set = new Set(photos.map((p) => toDateKey(p.takenAt)))
    return Array.from(set).sort((a, b) => b.localeCompare(a))
  }, [photos])

  const visible = day ? photos.filter((p) => toDateKey(p.takenAt) === day) : photos
  const tripDays = useMemo(() => new Set(dateRange(startDate, endDate)), [startDate, endDate])
  const outOfRange = photos.filter((p) => tripDays.size > 0 && !tripDays.has(toDateKey(p.takenAt))).length

  const tracks = useMemo(() => data.tracks.filter((t) => t.tripId === tripId), [data.tracks, tripId])
  const trackPoints = tracks.reduce((s, t) => s + t.points.length, 0)
  const photosWithoutGeo = photos.filter((p) => p.lat == null || p.lng == null)

  const runMatch = () => {
    if (!trackPoints) {
      toast.show('还没有足迹记录，先去「足迹」开始记录一段路线', 'err')
      return
    }
    if (!photosWithoutGeo.length) {
      toast.show('所有照片都已经有位置了', 'info')
      return
    }
    setMatching(true)
    try {
      const toleranceMs = tolerance === 0 ? Number.POSITIVE_INFINITY : tolerance * 60 * 1000
      const list = matchPhotosToTracks(photosWithoutGeo, tracks, toleranceMs)
      setMatched(list)
      if (!list.length) toast.show('没有找到时间上能对上的照片，可以把容差调大', 'err')
    } finally {
      setMatching(false)
    }
  }

  const applyMatch = async () => {
    if (!matched?.length) return
    const count = matched.length
    await patchPhotos(matched.map((m) => ({ id: m.photoId, patch: { lat: m.lat, lng: m.lng } })))
    setMatched(null)
    toast.show(`已为 ${count} 张照片补上位置`, 'ok')
  }

  const handleFiles = async (files: File[]) => {
    const images = files.filter((f) => f.type.startsWith('image/'))
    if (!images.length) {
      toast.show('请选择图片文件', 'err')
      return
    }
    setBusy(images.length)
    try {
      const res = await addPhotos(tripId, images, true)
      if (res.added) toast.show(`已导入 ${res.added} 张照片`, 'ok')
      if (res.failed.length) {
        toast.show(`${res.failed.length} 张失败：${res.failed[0].name}（${res.failed[0].reason}）`, 'err')
      }
      setBusy(null)
    } catch (e) {
      setBusy(null)
      toast.show(`导入失败：${(e as Error).message}`, 'err')
    }
  }

  const deleteSelected = async () => {
    if (!selected.size) return
    if (!window.confirm(`确定删除选中的 ${selected.size} 张照片？`)) return
    for (const id of selected) await deletePhoto(id)
    setSelected(new Set())
    toast.show('已删除', 'ok')
  }

  const setCover = async (photoId: string) => {
    await updateTrip(tripId, { coverPhotoId: photoId })
    toast.show('已设为封面', 'ok')
  }

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          void handleFiles(Array.from(e.dataTransfer.files))
        }}
        className={cx(
          'card flex flex-col items-center gap-2 border-dashed p-5 text-center transition',
          dragOver && 'border-brand-500 bg-brand-50'
        )}
      >
        <div className="text-2xl">📸</div>
        <p className="text-sm text-slate-600">把手机拍的照片同步进来</p>
        <p className="text-[11px] text-slate-400">
          支持 JPEG / PNG / WebP；读取照片自带的拍摄时间与 GPS，自动归到对应日期与地图位置
        </p>
        <div className="mt-1 flex gap-2">
          <button className="btn-primary" onClick={() => fileRef.current?.click()} disabled={!!busy}>
            选择照片
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? [])
              if (files.length) void handleFiles(files)
              e.target.value = ''
            }}
          />
        </div>
        {busy != null && (
          <div className="mt-2 flex items-center gap-2">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-brand-500" />
            <p className="text-[11px] text-slate-400">正在处理 {busy} 张照片…</p>
          </div>
        )}
      </div>

      <div className="card p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-slate-700">🧩 足迹自动配对位置</h3>
            <p className="text-[11px] text-slate-400">
              照片没有 GPS 也没关系：按拍摄时间把它贴到最近的足迹轨迹点上
            </p>
          </div>
          <button
            className="btn-ghost px-2.5 py-1.5 text-xs"
            disabled={matching || !trackPoints || !photosWithoutGeo.length}
            onClick={runMatch}
          >
            {matching ? '配对中…' : `配对位置${photosWithoutGeo.length ? `（${photosWithoutGeo.length} 张待配对）` : ''}`}
          </button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
          <span>轨迹点 {trackPoints} 个 · 已带位置 {photos.length - photosWithoutGeo.length} 张</span>
          <span className="ml-auto flex items-center gap-1">
            时间容差
            <select
              className="input w-28 py-1"
              value={tolerance}
              onChange={(e) => setTolerance(Number(e.target.value))}
            >
              <option value={10}>10 分钟</option>
              <option value={30}>30 分钟</option>
              <option value={60}>60 分钟</option>
              <option value={0}>不限制</option>
            </select>
          </span>
        </div>
      </div>

      {outOfRange > 0 && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
          有 {outOfRange} 张照片的拍摄时间不在行程日期内，仍会显示在相册里，可在分享时选择包含范围。
        </p>
      )}

      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        <FilterChip active={!day} onClick={() => setDay('')} label={`全部 ${photos.length}`} />
        {days.map((d) => (
          <FilterChip
            key={d}
            active={day === d}
            onClick={() => setDay(d)}
            label={`${formatDateCN(d, false)} · ${photos.filter((p) => toDateKey(p.takenAt) === d).length}`}
          />
        ))}
      </div>

      {selected.size > 0 && (
        <div className="card flex items-center gap-2 p-2">
          <span className="text-xs text-slate-600">已选 {selected.size} 张</span>
          <button className="btn-danger ml-auto px-2 py-1 text-xs" onClick={() => void deleteSelected()}>
            删除所选
          </button>
          <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setSelected(new Set())}>
            取消选择
          </button>
        </div>
      )}

      {visible.length === 0 ? (
        <Empty icon="🖼️" text="还没有照片，把今天的照片导进来吧" />
      ) : (
        <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
          {visible.map((p) => (
            <div
              key={p.id}
              className={cx(
                'group relative aspect-square overflow-hidden rounded-xl bg-slate-100',
                selected.has(p.id) && 'ring-2 ring-brand-500'
              )}
            >
              <button className="h-full w-full" onClick={() => (selected.size ? toggle(selected, setSelected, p.id) : setViewer(p))}>
                <PhotoThumb photoId={p.id} rounded="" className="aspect-square w-full" />
              </button>
              <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-1.5">
                <div className="truncate text-[10px] text-white">
                  {formatClock(p.takenAt)}
                  {p.lat != null && ' · 📍'}
                </div>
                {p.caption && <div className="truncate text-[10px] text-white/80">{p.caption}</div>}
              </div>
              <div className="absolute right-1 top-1 flex gap-1 opacity-0 transition group-hover:opacity-100">
                <button
                  className="rounded-md bg-white/90 px-1.5 py-0.5 text-[10px] text-slate-600"
                  onClick={() => setEditing(p)}
                >
                  编辑
                </button>
                <button
                  className="rounded-md bg-white/90 px-1.5 py-0.5 text-[10px] text-brand-700"
                  onClick={() => void setCover(p.id)}
                >
                  封面
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <PhotoEditModal
          photo={editing}
          onClose={() => setEditing(null)}
          onSave={async (patch) => {
            await updatePhoto(editing.id, patch)
            toast.show('已更新', 'ok')
            setEditing(null)
          }}
        />
      )}
      {viewer && <PhotoViewer photo={viewer} onClose={() => setViewer(null)} />}

      {matched && (
        <PhotoMatchModal
          matches={matched}
          tolerance={tolerance}
          onClose={() => setMatched(null)}
          onApply={() => void applyMatch()}
        />
      )}
    </div>
  )
}

function PhotoMatchModal({
  matches,
  tolerance,
  onClose,
  onApply
}: {
  matches: PhotoPositionMatch[]
  tolerance: number
  onClose: () => void
  onApply: () => void
}) {
  const { data } = useStore()
  const photoOf = (id: string) => data.photos.find((p) => p.id === id)
  const deltaText = (ms: number) => {
    const sec = Math.round(ms / 1000)
    if (sec < 60) return `${sec} 秒`
    return `${Math.round(sec / 60)} 分钟`
  }
  return (
    <Modal
      open
      wide
      title={`配对结果（${matches.length} 张）`}
      onClose={onClose}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            取消
          </button>
          <button className="btn-primary" onClick={onApply}>
            写入这 {matches.length} 张的位置
          </button>
        </>
      }
    >
      <div className="space-y-2">
        <p className="text-[11px] text-slate-500">
          按拍摄时间与最近足迹点相差不超过 {tolerance === 0 ? '任意时长（取最近点）' : `${tolerance} 分钟`} 匹配：
        </p>
        <ul className="space-y-1.5">
          {matches.map((m) => {
            const photo = photoOf(m.photoId)
            return (
              <li key={m.photoId} className="flex items-center gap-2 rounded-xl border border-slate-200 p-2">
                <PhotoThumb photoId={m.photoId} className="h-10 w-10 shrink-0" />
                <div className="min-w-0 flex-1 text-xs text-slate-600">
                  <div className="truncate">
                    {photo ? formatDateCN(toDateKey(photo.takenAt)) : ''} {photo ? formatClock(photo.takenAt) : ''}
                  </div>
                  <div className="truncate text-[11px] text-slate-400">
                    与轨迹点相差 {deltaText(m.deltaMs)} · {m.lat.toFixed(5)}, {m.lng.toFixed(5)}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    </Modal>
  )
}

function toggle(set: Set<string>, apply: (s: Set<string>) => void, id: string) {
  const next = new Set(set)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  apply(next)
}

function FilterChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={cx(
        'shrink-0 rounded-full border px-2.5 py-1 text-[11px] transition',
        active ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-200 bg-white text-slate-500'
      )}
    >
      {label}
    </button>
  )
}

function PhotoEditModal({
  photo,
  onClose,
  onSave
}: {
  photo: Photo
  onClose: () => void
  onSave: (patch: Partial<Photo>) => Promise<void>
}) {
  const [caption, setCaption] = useState(photo.caption)
  const [time, setTime] = useState(new Date(photo.takenAt).toISOString().slice(0, 16))

  return (
    <Modal
      open
      title="编辑照片信息"
      onClose={onClose}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            取消
          </button>
          <button
            className="btn-primary"
            onClick={() =>
              void onSave({
                caption: caption.trim(),
                takenAt: time ? new Date(time).getTime() : photo.takenAt
              })
            }
          >
            保存
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <PhotoThumb photoId={photo.id} className="max-h-56 w-full" />
        <Field label="说明">
          <input className="input" value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="写句照片说明" />
        </Field>
        <Field label="拍摄时间">
          <input type="datetime-local" className="input" value={time} onChange={(e) => setTime(e.target.value)} />
        </Field>
        <p className="text-[11px] text-slate-400">
          {photo.width}×{photo.height} · {formatBytes(photo.size)} ·{' '}
          {photo.lat != null ? `位置 ${photo.lat.toFixed(5)}, ${photo.lng!.toFixed(5)}` : '无位置信息'}
        </p>
      </div>
    </Modal>
  )
}
