import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type L from 'leaflet'
import { MapView } from '../components/MapView'
import type { PlanPoint } from '../components/MapView'
import { SectionTitle } from '../components/ui'
import { useToast } from '../components/Toast'
import { useStore } from '../state/store'
import { formatDistance, haversine, pathDistance, toGPX, parseGPX } from '../lib/geo'
import { downloadBlob, formatDateTime, formatDuration, uid } from '../lib/utils'
import { getCurrentPos, geolocationSupported, describeGeoError } from '../lib/location'
import type { LatLng } from '../lib/geo'
import type { Track, TrackPoint } from '../types'

const MIN_POINT_DISTANCE = 8 // 米
const MAX_ACCEPTABLE_ACCURACY = 80 // 米
/** 记录中断（手机切后台被回收 / 误刷新）时的续接缓存 */
const RESUME_KEY = 'travel-diary:tracking'

interface ResumeMark {
  trackId: string
  tripId: string
  startedAt: number
  points: TrackPoint[]
}

export function TrackView({ tripId }: { tripId: string }) {
  const { data, putTrack, deleteTrack } = useStore()
  const toast = useToast()
  const mapRef = useRef<L.Map | null>(null)
  const watchRef = useRef<number | null>(null)
  const pointsRef = useRef<TrackPoint[]>([])
  const startedRef = useRef<number>(0)
  const trackIdRef = useRef<string | null>(null)
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null)
  const [resumable, setResumable] = useState<ResumeMark | null>(null)

  const [tracking, setTracking] = useState(false)
  const [tick, setTick] = useState(0)
  const [live, setLive] = useState<{ count: number; distance: number }>({ count: 0, distance: 0 })
  const [current, setCurrent] = useState<LatLng | null>(null)
  const [accuracy, setAccuracy] = useState<number | null>(null)
  const [layers, setLayers] = useState({ tracks: true, photos: true, plans: true })
  const [focusId, setFocusId] = useState<string | null>(null)
  const gpxRef = useRef<HTMLInputElement>(null)

  const tracks = useMemo(
    () => data.tracks.filter((t) => t.tripId === tripId).sort((a, b) => b.startedAt - a.startedAt),
    [data.tracks, tripId]
  )
  const photos = useMemo(() => data.photos.filter((p) => p.tripId === tripId), [data.photos, tripId])
  const planPoints: PlanPoint[] = useMemo(
    () =>
      data.plans
        .filter((p) => p.tripId === tripId && p.lat != null && p.lng != null)
        .map((p) => ({ id: p.id, title: p.title, lat: p.lat!, lng: p.lng!, time: p.time })),
    [data.plans, tripId]
  )

  const liveTrack: Track | null = useMemo(() => {
    const pts = pointsRef.current
    if (!tracking || !pts.length) return null
    return {
      id: trackIdRef.current ?? 'live',
      tripId,
      name: '正在记录',
      startedAt: startedRef.current,
      endedAt: Date.now(),
      points: pts,
      distance: pathDistance(pts)
    }
  }, [tracking, tripId, live.count])

  // 计时刷新
  useEffect(() => {
    if (!tracking) return
    const timer = window.setInterval(() => setTick((t) => t + 1), 1000)
    return () => window.clearInterval(timer)
  }, [tracking])

  useEffect(() => {
    return () => {
      if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current)
      void wakeLockRef.current?.release()
    }
  }, [])

  // 进入页面时看看有没有上次没保存完的足迹
  useEffect(() => {
    try {
      const raw = localStorage.getItem(RESUME_KEY)
      if (!raw) {
        setResumable(null)
        return
      }
      const mark = JSON.parse(raw) as ResumeMark
      setResumable(mark.tripId === tripId && mark.points?.length ? mark : null)
    } catch {
      setResumable(null)
    }
  }, [tripId])

  /** 手机息屏会中断定位，记录期间尽量保持屏幕常亮 */
  const keepAwake = useCallback(async () => {
    try {
      const wl = (navigator as unknown as { wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> } }).wakeLock
      if (!wl) return
      wakeLockRef.current = await wl.request('screen')
    } catch {
      // 不支持或被拒绝时静默
    }
  }, [])

  const resumeTrack = async () => {
    if (!resumable) return
    const pts = resumable.points
    await putTrack({
      id: resumable.trackId,
      tripId,
      name: `足迹 ${new Date(resumable.startedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`,
      startedAt: resumable.startedAt,
      endedAt: pts[pts.length - 1].t,
      points: pts,
      distance: pathDistance(pts)
    })
    localStorage.removeItem(RESUME_KEY)
    setResumable(null)
    toast.show(`已恢复上次中断的足迹 · ${formatDistance(pathDistance(pts))}`, 'ok')
  }

  const persistPartial = useCallback(async () => {
    if (!trackIdRef.current) return
    try {
      localStorage.setItem(
        RESUME_KEY,
        JSON.stringify({
          trackId: trackIdRef.current,
          tripId,
          startedAt: startedRef.current,
          points: pointsRef.current.slice(-5000)
        } satisfies ResumeMark)
      )
    } catch {
      // 容量超限时忽略
    }
    await putTrack({
      id: trackIdRef.current,
      tripId,
      name: '足迹 ' + new Date(startedRef.current).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
      startedAt: startedRef.current,
      endedAt: Date.now(),
      points: [...pointsRef.current],
      distance: pathDistance(pointsRef.current)
    })
  }, [putTrack, tripId])

  /** 记录中每来一个点都缓存一次，保证手机被回收后还能找回 */
  const cachePoints = useCallback(() => {
    if (!trackIdRef.current) return
    try {
      localStorage.setItem(
        RESUME_KEY,
        JSON.stringify({
          trackId: trackIdRef.current,
          tripId,
          startedAt: startedRef.current,
          points: pointsRef.current.slice(-5000)
        } satisfies ResumeMark)
      )
    } catch {
      // ignore
    }
  }, [tripId])

  const startTracking = useCallback(async () => {
    if (!geolocationSupported()) {
      toast.show('当前环境不支持定位', 'err')
      return
    }
    try {
      await getCurrentPos(8000)
    } catch (e) {
      toast.show(describeGeoError(e as Error), 'err')
      return
    }
    const id = uid('tr_')
    trackIdRef.current = id
    pointsRef.current = []
    startedRef.current = Date.now()
    setLive({ count: 0, distance: 0 })
    setTracking(true)

    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const p: TrackPoint = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          t: pos.timestamp || Date.now(),
          acc: pos.coords.accuracy ?? undefined,
          alt: pos.coords.altitude ?? undefined
        }
        setCurrent({ lat: p.lat, lng: p.lng })
        setAccuracy(p.acc ?? null)
        const pts = pointsRef.current
        const last = pts[pts.length - 1]
        if (p.acc != null && p.acc > MAX_ACCEPTABLE_ACCURACY) return
        if (last) {
          const d = haversine(last, p)
          const dt = p.t - last.t
          if (d < MIN_POINT_DISTANCE && dt < 15000) return
          if (d < 1 && dt < 60000) return
        }
        pts.push(p)
        setLive({ count: pts.length, distance: pathDistance(pts) })
        cachePoints()
        if (pts.length % 10 === 0) void persistPartial()
      },
      (err) => {
        toast.show(describeGeoError(err), 'err')
        void stopTracking()
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 5000 }
    )
    void keepAwake()
    toast.show('开始记录足迹，会边走边同步到云端', 'ok')
  }, [persistPartial, toast, cachePoints, keepAwake])

  const stopTracking = useCallback(async () => {
    if (watchRef.current != null) {
      navigator.geolocation.clearWatch(watchRef.current)
      watchRef.current = null
    }
    void wakeLockRef.current?.release()
    wakeLockRef.current = null
    setTracking(false)
    const pts = pointsRef.current
    if (!pts.length) {
      toast.show('没有记录到有效的定位点', 'err')
      return
    }
    const name = `足迹 ${new Date(startedRef.current).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
    await putTrack({
      id: trackIdRef.current ?? uid('tr_'),
      tripId,
      name,
      startedAt: startedRef.current,
      endedAt: pts[pts.length - 1].t,
      points: pts,
      distance: pathDistance(pts)
    })
    pointsRef.current = []
    trackIdRef.current = null
    localStorage.removeItem(RESUME_KEY)
    setResumable(null)
    setLive({ count: 0, distance: 0 })
    toast.show(`足迹已保存并同步 · ${formatDistance(pathDistance(pts))}`, 'ok')
  }, [putTrack, toast, tripId])

  const handleGpx = async (file: File) => {
    try {
      const parsed = parseGPX(await file.text(), file.name.replace(/\.gpx$/i, ''))
      if (!parsed.length) {
        toast.show('GPX 中没有找到轨迹点', 'err')
        return
      }
      for (const seg of parsed) {
        await putTrack({
          id: uid('tr_'),
          tripId,
          name: seg.name,
          startedAt: seg.points[0].t,
          endedAt: seg.points[seg.points.length - 1].t,
          points: seg.points,
          distance: pathDistance(seg.points)
        })
      }
      toast.show(`导入成功（${parsed.length} 段轨迹）`, 'ok')
    } catch (e) {
      toast.show(`GPX 解析失败：${(e as Error).message}`, 'err')
    }
  }

  const locate = async () => {
    try {
      const pos = await getCurrentPos()
      setCurrent(pos)
      mapRef.current?.setView([pos.lat, pos.lng], 15)
    } catch (e) {
      toast.show(describeGeoError(e as Error), 'err')
    }
  }

  const focusTrack = (id: string) => {
    setFocusId(id)
    const track = tracks.find((t) => t.id === id)
    if (track && track.points.length) {
      setLayers({ tracks: true, photos: false, plans: false })
      mapRef.current?.fitBounds(track.points.map((p) => [p.lat, p.lng] as [number, number]), { padding: [30, 30] })
    }
  }

  const totalDistance = tracks.reduce((s, t) => s + t.distance, 0)
  const totalPoints = tracks.reduce((s, t) => s + t.points.length, 0)

  return (
    <div className="space-y-4">
      {resumable && (
        <div className="card border-amber-200 bg-amber-50/70 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="flex-1 text-xs text-amber-800">
              发现上次没保存完的足迹（{resumable.points.length} 个定位点 ·{' '}
              {formatDistance(pathDistance(resumable.points))}），可能是手机切后台或刷新中断的
            </p>
            <button className="btn-ghost px-2 py-1 text-xs" onClick={() => void resumeTrack()}>
              恢复保存
            </button>
            <button
              className="btn-ghost px-2 py-1 text-xs"
              onClick={() => {
                localStorage.removeItem(RESUME_KEY)
                setResumable(null)
              }}
            >
              丢弃
            </button>
          </div>
        </div>
      )}

      <div className="card p-3">
        <div className="flex flex-wrap items-center gap-2">
          {tracking ? (
            <button className="btn-danger" onClick={() => void stopTracking()}>
              ■ 停止并记录
            </button>
          ) : (
            <button className="btn-primary" onClick={() => void startTracking()}>
              🥾 开始记录足迹
            </button>
          )}
          <button className="btn-ghost" onClick={() => void locate()}>
            📍 定位到我
          </button>
          <button className="btn-ghost" onClick={() => gpxRef.current?.click()}>
            ⬆️ 导入 GPX
          </button>
          <input
            ref={gpxRef}
            type="file"
            accept=".gpx,application/gpx+xml"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void handleGpx(f)
              e.target.value = ''
            }}
          />
        </div>

        {tracking && (
          <div className="mt-3 grid grid-cols-4 gap-2 text-center">
            <LiveStat label="时长" value={formatDuration(Date.now() - startedRef.current)} />
            <LiveStat label="距离" value={formatDistance(live.distance)} />
            <LiveStat label="定位点" value={`${live.count}`} />
            <LiveStat label="精度" value={accuracy ? `±${Math.round(accuracy)}m` : '-'} />
          </div>
        )}
        <p className="mt-2 text-[11px] text-slate-400">
          {tracking
            ? '正在记录：已开启屏幕常亮，轨迹会边记边同步（息屏或彻底切到后台可能被系统暂停）。'
            : '足迹通过浏览器定位记录，需要 HTTPS 访问并授予定位权限；保存后自动同步到其他设备。'}
          <span className="hidden">{tick}</span>
        </p>
      </div>

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-2">
          <span className="text-xs font-medium text-slate-500">图层</span>
          {(
            [
              ['tracks', '轨迹'],
              ['photos', '照片'],
              ['plans', '计划点']
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex items-center gap-1 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={layers[key]}
                onChange={(e) => setLayers((l) => ({ ...l, [key]: e.target.checked }))}
              />
              {label}
            </label>
          ))}
          <span className="ml-auto text-[11px] text-slate-400">
            共 {tracks.length} 条 · {formatDistance(totalDistance)} · {totalPoints} 点
          </span>
        </div>
        <MapView
          tracks={layers.tracks ? [...tracks, ...(liveTrack ? [liveTrack] : [])] : liveTrack ? [liveTrack] : []}
          photos={layers.photos ? photos : []}
          planPoints={layers.plans ? planPoints : []}
          livePoint={tracking ? current : null}
          autoFit={!tracking}
          height={380}
          className="rounded-none border-0"
          onMapReady={(m) => (mapRef.current = m)}
        />
      </div>

      <div>
        <SectionTitle right={<span className="text-xs text-slate-400">{tracks.length} 条足迹</span>}>
          🥾 足迹列表
        </SectionTitle>
        {tracks.length === 0 ? (
          <p className="card p-6 text-center text-sm text-slate-500">还没有足迹，点击上方「开始记录足迹」试试</p>
        ) : (
          <ul className="space-y-2">
            {tracks.map((t) => (
              <li key={t.id} className={focusId === t.id ? 'card p-3 ring-2 ring-brand-300' : 'card p-3'}>
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-slate-800">{t.name}</div>
                    <div className="mt-0.5 text-[11px] text-slate-500">
                      {formatDateTime(t.startedAt)} · {formatDistance(t.distance)} · {t.points.length} 点 ·{' '}
                      {formatDuration(Math.max(0, t.endedAt - t.startedAt))}
                    </div>
                  </div>
                  <button className="btn-ghost px-2 py-1 text-xs" onClick={() => focusTrack(t.id)}>
                    查看
                  </button>
                  <button
                    className="btn-ghost px-2 py-1 text-xs"
                    onClick={() => downloadBlob(new Blob([toGPX(t)], { type: 'application/gpx+xml' }), `${t.name}.gpx`)}
                  >
                    GPX
                  </button>
                  <button
                    className="btn-ghost px-2 py-1 text-xs text-rose-600"
                    onClick={async () => {
                      await deleteTrack(t.id)
                      toast.show('已删除足迹', 'ok')
                    }}
                  >
                    删除
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <GeoPhotoHint tripId={tripId} />
    </div>
  )
}

function LiveStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-50 px-2 py-2">
      <div className="text-sm font-semibold text-slate-900">{value}</div>
      <div className="text-[11px] text-slate-500">{label}</div>
    </div>
  )
}

/** 提示：照片位置来自 EXIF；无 EXIF 时可用当前位置补齐 */
function GeoPhotoHint({ tripId }: { tripId: string }) {
  const { data, updatePhoto } = useStore()
  const toast = useToast()
  const missing = data.photos.filter((p) => p.tripId === tripId && (p.lat == null || p.lng == null))

  const fillAll = async () => {
    try {
      const pos = await getCurrentPos()
      for (const p of missing) {
        await updatePhoto(p.id, { lat: pos.lat, lng: pos.lng })
      }
      toast.show(`已为 ${missing.length} 张照片补上位置`, 'ok')
    } catch (e) {
      toast.show(describeGeoError(e as Error), 'err')
    }
  }

  if (!missing.length) return null
  return (
    <div className="card border-amber-200 bg-amber-50/70 p-3">
      <div className="flex items-center gap-2">
        <p className="flex-1 text-xs text-amber-800">
          有 {missing.length} 张照片缺少位置信息（多因拍照时未开启「位置」或未授权相册位置）
        </p>
        <button className="btn-ghost px-2 py-1 text-xs" onClick={() => void fillAll()}>
          用当前位置补齐
        </button>
      </div>
    </div>
  )
}
