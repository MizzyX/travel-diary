import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import L from 'leaflet'
import { usePhotoUrls } from '../state/photoUrl'
import { boundsOf } from '../lib/geo'
import {
  TILE_SOURCES,
  getTileSource,
  loadTileSourceId,
  nextTileSourceId,
  saveTileSourceId,
  toMapCoords
} from '../lib/tiles'
import { useToast } from './Toast'
import { cx, formatClock } from '../lib/utils'
import type { LatLng } from '../lib/geo'
import type { Photo, Track } from '../types'

export interface PlanPoint {
  id: string
  title: string
  lat: number
  lng: number
  time?: string
  emoji?: string
}

interface Props {
  tracks?: Track[]
  photos?: Photo[]
  planPoints?: PlanPoint[]
  livePoint?: LatLng | null
  height?: number
  className?: string
  onMapReady?: (map: L.Map) => void
  layers?: { tracks: boolean; photos: boolean; plans: boolean }
  /** 是否在数据变化时自动缩放到全部内容（实时记录时建议关闭，避免干扰手动操作） */
  autoFit?: boolean
  children?: ReactNode
}

const COLORS = ['#10b981', '#0ea5e9', '#f59e0b', '#8b5cf6', '#ec4899', '#ef4444']

function esc(s: string): string {
  return s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c] as string)
}

export function MapView({
  tracks = [],
  photos = [],
  planPoints = [],
  livePoint = null,
  height = 340,
  className,
  onMapReady,
  layers = { tracks: true, photos: true, plans: true },
  autoFit = true,
  children
}: Props) {
  const toast = useToast()
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const overlayRef = useRef<L.LayerGroup | null>(null)
  const liveMarkerRef = useRef<L.CircleMarker | null>(null)
  const pointsRef = useRef<LatLng[]>([])
  const latestRef = useRef({ tracks, photos, planPoints, layers, livePoint })
  const [tileId, setTileId] = useState(() => loadTileSourceId())
  const tileErrRef = useRef(0)
  const switchedRef = useRef(false)
  const source = getTileSource(tileId)
  const sourceRef = useRef(source)
  sourceRef.current = source

  latestRef.current = { tracks, photos, planPoints, layers, livePoint }

  const chooseTile = (id: string) => {
    tileErrRef.current = 0
    switchedRef.current = false
    setTileId(id)
    saveTileSourceId(id)
  }

  const photoIds = useMemo(() => photos.map((p) => p.id), [photos])
  const thumbs = usePhotoUrls(photoIds, 'thumb')

  const fitKey = useMemo(
    () =>
      [
        tracks.map((t) => `${t.id}.${t.points.length}`).join('|'),
        photos.length,
        planPoints.length,
        layers.tracks ? 1 : 0,
        layers.photos ? 1 : 0,
        layers.plans ? 1 : 0
      ].join('#'),
    [tracks, photos.length, planPoints.length, layers.tracks, layers.photos, layers.plans]
  )

  // 初始化地图
  useEffect(() => {
    const el = containerRef.current
    if (!el || mapRef.current) return
    const map = L.map(el, { zoomControl: true, attributionControl: true, center: [30, 110], zoom: 4 })
    mapRef.current = map
    overlayRef.current = L.layerGroup().addTo(map)
    onMapReady?.(map)
    const ro = new ResizeObserver(() => map.invalidateSize())
    ro.observe(el)
    return () => {
      ro.disconnect()
      map.remove()
      mapRef.current = null
      overlayRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 底图瓦片：加载失败时自动切换到下一个源
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const layer = L.tileLayer(source.url, {
      attribution: source.attribution,
      maxZoom: source.maxZoom,
      subdomains: source.subdomains.length ? source.subdomains : 'abc'
    })
    layer.addTo(map)
    layer.on('tileerror', () => {
      tileErrRef.current += 1
      if (tileErrRef.current >= 4 && !switchedRef.current) {
        switchedRef.current = true
        const next = nextTileSourceId(source.id)
        if (next !== source.id) {
          saveTileSourceId(next)
          setTileId(next)
          toast.show('地图瓦片加载不出来，已自动换用其他底图', 'err')
        }
      }
    })
    layer.on('tileload', () => {
      tileErrRef.current = 0
    })
    return () => {
      layer.off()
      layer.remove()
    }
  }, [source, toast])

  // 绘制图层
  useEffect(() => {
    const map = mapRef.current
    const group = overlayRef.current
    if (!map || !group) return
    group.clearLayers()

    const pts: LatLng[] = []
    const projection = sourceRef.current.projection
    const conv = (p: LatLng): [number, number] => toMapCoords(p, projection)
    const convLatLng = (p: LatLng): LatLng => {
      const [lat, lng] = conv(p)
      return { lat, lng }
    }
    const drawnTracks = latestRef.current.layers.tracks ? tracks : []
    const drawnPhotos = latestRef.current.layers.photos ? photos : []
    const drawnPlans = latestRef.current.layers.plans ? planPoints : []

    drawnTracks.forEach((track, idx) => {
      if (track.points.length < 2) return
      const latlngs = track.points.map(conv)
      pts.push(...track.points.map(convLatLng))
      const color = COLORS[idx % COLORS.length]
      L.polyline(latlngs, { color, weight: 4, opacity: 0.85 })
        .bindTooltip(`${track.name} · ${(track.distance / 1000).toFixed(2)} km`, { sticky: true })
        .addTo(group)
      L.circleMarker(latlngs[0], { radius: 5, color: '#fff', weight: 2, fillColor: color, fillOpacity: 1 }).addTo(group)
      L.circleMarker(latlngs[latlngs.length - 1], {
        radius: 5,
        color: '#fff',
        weight: 2,
        fillColor: '#ef4444',
        fillOpacity: 1
      }).addTo(group)
    })

    for (const p of drawnPhotos) {
      if (p.lat == null || p.lng == null) continue
      const pp = convLatLng({ lat: p.lat, lng: p.lng })
      pts.push(pp)
      const url = thumbs[p.id]
      const popup =
        `<div style="width:150px">` +
        (url ? `<img src="${url}" style="width:100%;height:110px;object-fit:cover;display:block"/>` : '') +
        `<div style="padding:6px 8px;font-size:12px;color:#334155">` +
        `<div style="font-weight:600">${esc(p.caption || '照片')}</div>` +
        `<div style="color:#94a3b8">${new Date(p.takenAt).toLocaleDateString('zh-CN')} ${formatClock(p.takenAt)}</div>` +
        `</div></div>`
      L.marker([pp.lat, pp.lng], {
        icon: L.divIcon({
          className: '',
          iconSize: [32, 32],
          iconAnchor: [16, 16],
          html: `<div class="photo-pin" style="${url ? `background-image:url(${url})` : 'background:#cbd5e1'}"></div>`
        })
      })
        .bindPopup(popup, { minWidth: 150 })
        .addTo(group)
    }

    for (const p of drawnPlans) {
      const lp = convLatLng(p)
      pts.push(lp)
      L.marker([lp.lat, lp.lng], {
        icon: L.divIcon({
          className: '',
          iconSize: [28, 28],
          iconAnchor: [14, 28],
          html: `<div style="width:28px;height:28px;border-radius:9999px;background:#fff;border:2px solid #10b981;box-shadow:0 2px 6px rgba(0,0,0,.2);display:flex;align-items:center;justify-content:center;font-size:14px">${p.emoji ?? '📍'}</div>`
        })
      })
        .bindPopup(
          `<div style="padding:6px 8px;font-size:12px;min-width:120px"><b>${esc(p.title)}</b><br/><span style="color:#94a3b8">${esc(p.time ?? '')}</span></div>`
        )
        .addTo(group)
    }

    pointsRef.current = pts
  }, [tracks, photos, planPoints, thumbs, layers.tracks, layers.photos, layers.plans, source.projection])

  // 自动缩放到内容范围
  useEffect(() => {
    const map = mapRef.current
    if (!map || !autoFit) return
    const pts = pointsRef.current
    const raw = latestRef.current.livePoint
    const lp = raw ? toMapCoords(raw, sourceRef.current.projection) : null
    const bounds = boundsOf(lp ? [...pts, { lat: lp[0], lng: lp[1] }] : pts)
    if (bounds) map.fitBounds(bounds, { padding: [36, 36], maxZoom: 16 })
    else if (lp) map.setView(lp, 15)
  }, [fitKey, autoFit, source.projection])

  // 当前位置标记
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (liveMarkerRef.current) {
      liveMarkerRef.current.remove()
      liveMarkerRef.current = null
    }
    if (!livePoint) return
    const [lat, lng] = toMapCoords(livePoint, sourceRef.current.projection)
    liveMarkerRef.current = L.circleMarker([lat, lng], {
      radius: 7,
      color: '#fff',
      weight: 3,
      fillColor: '#10b981',
      fillOpacity: 1
    }).addTo(map)
  }, [livePoint, source.projection])

  return (
    <div className={cx('relative overflow-hidden rounded-2xl border border-slate-200', className)} style={{ height }}>
      <div ref={containerRef} className="h-full w-full" />
      <div className="absolute right-2 top-2 z-[500] flex overflow-hidden rounded-lg border border-slate-200 bg-white/95 text-[11px] shadow-sm">
        {TILE_SOURCES.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => chooseTile(s.id)}
            className={cx(
              'px-2 py-1 transition',
              s.id === tileId ? 'bg-brand-600 font-medium text-white' : 'text-slate-500 hover:bg-slate-50'
            )}
            title={s.id === tileId ? `当前底图：${s.label}` : `切换到${s.label}`}
          >
            {s.label}
          </button>
        ))}
      </div>
      {children}
    </div>
  )
}
