import { useMemo, useState } from 'react'
import { useToast } from '../components/Toast'
import { useStore } from '../state/store'
import { buildShareHtml, prepareImages } from '../lib/exporter'
import { downloadBlob, formatBytes, formatMoney } from '../lib/utils'
import { formatDistance } from '../lib/geo'

export function ShareView({ tripId }: { tripId: string }) {
  const { data } = useStore()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [includePhotos, setIncludePhotos] = useState(true)
  const [includeExpenses, setIncludeExpenses] = useState(true)
  const [photoMaxSide, setPhotoMaxSide] = useState(1100)
  const [lastSize, setLastSize] = useState<number | null>(null)

  const subset = useMemo(
    () => ({
      trip: data.trips.find((t) => t.id === tripId)!,
      plans: data.plans.filter((p) => p.tripId === tripId),
      journals: data.journals.filter((j) => j.tripId === tripId),
      tracks: data.tracks.filter((t) => t.tripId === tripId),
      expenses: data.expenses.filter((e) => e.tripId === tripId),
      photos: data.photos
        .filter((p) => p.tripId === tripId)
        .sort((a, b) => a.takenAt - b.takenAt)
    }),
    [data, tripId]
  )

  const withCoord = subset.photos.filter((p) => p.lat != null && p.lng != null).length
  const total = subset.expenses.reduce((s, e) => s + e.amount, 0)
  const distance = subset.tracks.reduce((s, t) => s + t.distance, 0)

  const build = async () => {
    setBusy(true)
    try {
      const images = includePhotos ? await prepareImages(subset.photos, photoMaxSide) : {}
      const html = buildShareHtml(subset, images, { includePhotos, includeExpenses, photoMaxSide })
      const bytes = new Blob([html]).size
      setLastSize(bytes)
      return html
    } finally {
      setBusy(false)
    }
  }

  const download = async () => {
    const html = await build()
    if (!html) return
    downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), `${subset.trip.title}-旅行日记.html`)
    toast.show('分享页已下载，发给家人即可打开', 'ok')
  }

  const preview = async () => {
    const html = await build()
    if (!html) return
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }))
    window.open(url, '_blank')
  }

  return (
    <div className="space-y-3">
      <div className="card p-4">
        <h3 className="mb-1 text-sm font-semibold text-slate-700">分享给家人</h3>
        <p className="mb-3 text-xs text-slate-500">
          生成一个单独的网页文件（含地图、照片、行程与账单），手机或电脑双击即可查看，无需安装 App，也不需要联网登录。
        </p>
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <input type="checkbox" checked={includePhotos} onChange={(e) => setIncludePhotos(e.target.checked)} />
            包含照片
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <input type="checkbox" checked={includeExpenses} onChange={(e) => setIncludeExpenses(e.target.checked)} />
            包含消费账单
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <span className="w-24">照片清晰度</span>
            <select
              className="input max-w-[180px]"
              value={photoMaxSide}
              onChange={(e) => setPhotoMaxSide(Number(e.target.value))}
              disabled={!includePhotos}
            >
              <option value={700}>较小（适合微信发送）</option>
              <option value={1100}>标准</option>
              <option value={1600}>高清（文件更大）</option>
            </select>
          </label>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button className="btn-primary" disabled={busy} onClick={() => void download()}>
            {busy ? '生成中…' : '生成并下载分享页'}
          </button>
          <button className="btn-ghost" disabled={busy} onClick={() => void preview()}>
            新窗口预览
          </button>
        </div>
        {includePhotos && subset.photos.length > 0 && (
          <p className="mt-2 text-[11px] text-slate-400">
            将内嵌 {subset.photos.length} 张照片，建议先用「新窗口预览」确认效果。
          </p>
        )}
        {lastSize != null && <p className="mt-2 text-[11px] text-slate-400">上次生成大小：{formatBytes(lastSize)}</p>}
      </div>

      <div className="card grid grid-cols-2 gap-3 p-4 text-sm sm:grid-cols-4">
        <ShareStat label="行程条目" value={`${subset.plans.length}`} />
        <ShareStat label="随记" value={`${subset.journals.length}`} />
        <ShareStat label="照片" value={`${subset.photos.length}`} hint={`${withCoord} 张带位置`} />
        <ShareStat label="足迹" value={formatDistance(distance)} hint={`${subset.tracks.length} 条轨迹`} />
        <ShareStat label="总花费" value={formatMoney(total, subset.trip.currency)} />
      </div>

      <p className="px-1 text-[11px] leading-relaxed text-slate-400">
        说明：分享文件中地图瓦片来自 OpenStreetMap，查看时需要联网；照片以压缩后的方式内嵌在文件中，不含原始照片。若通过微信发送，建议选择「较小」清晰度。
      </p>
    </div>
  )
}

function ShareStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <div className="text-sm font-semibold text-slate-900">{value}</div>
      <div className="text-[11px] text-slate-500">{label}</div>
      {hint && <div className="text-[10px] text-slate-400">{hint}</div>}
    </div>
  )
}
