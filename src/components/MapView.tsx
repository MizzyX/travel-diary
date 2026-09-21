import { useEffect, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import L from 'leaflet'
import { usePhotoUrls } from '../state/photoUrl'
import { boundsOf } from '../lib/geo'
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
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const overlayRef = useRef<L.LayerGroup | null>(null)
  const liveMarkerRef = useRef<L.CircleMarker | null>(null)
  const pointsRef = useRef<LatLng[]>([])
  const latestRef = useRef({ tracks, photos, planPoints, layers, livePoint })

  latestRef.current = { tracks, photos, planPoints, layers, livePoint }

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
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap',
      maxZoom: 19
    }).addTo(map)
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

  // 绘制图层
  useEffect(() => {
    const map = mapRef.current
    const group = overlayRef.current
    if (!map || !group) return
    group.clearLayers()

    const pts: LatLng[] = []
    const drawnTracks = latestRef.current.layers.tracks ? tracks : []
    const drawnPhotos = latestRef.current.layers.photos ? photos : []
    const drawnPlans = latestRef.current.layers.plans ? planPoints : []

    drawnTracks.forEach((track, idx) => {
      if (track.points.length < 2) return
      const latlngs = track.points.map((p) => [p.lat, p.lng] as [number, number])
      pts.push(...track.points)
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
      pts.push({ lat: p.lat, lng: p.lng })
      const url = thumbs[p.id]
      const popup =
        `<div style="width:150px">` +
        (url ? `<img src="${url}" style="width:100%;height:110px;object-fit:cover;display:block"/>` : '') +
        `<div style="padding:6px 8px;font-size:12px;color:#334155">` +
        `<div style="font-weight:600">${esc(p.caption || '照片')}</div>` +
        `<div style="color:#94a3b8">${new Date(p.takenAt).toLocaleDateString('zh-CN')} ${formatClock(p.takenAt)}</div>` +
        `</div></div>`
      L.marker([p.lat, p.lng], {
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
      pts.push({ lat: p.lat, lng: p.lng })
      L.marker([p.lat, p.lng], {
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
  }, [tracks, photos, planPoints, thumbs, layers.tracks, layers.photos, layers.plans])

  // 自动缩放到内容范围
  useEffect(() => {
    const map = mapRef.current
    if (!map || !autoFit) return
    const pts = pointsRef.current
    const lp = latestRef.current.livePoint
    const bounds = boundsOf(lp ? [...pts, lp] : pts)
    if (bounds) map.fitBounds(bounds, { padding: [36, 36], maxZoom: 16 })
    else if (lp) map.setView([lp.lat, lp.lng], 15)
  }, [fitKey, autoFit])

  // 当前位置标记
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (liveMarkerRef.current) {
      liveMarkerRef.current.remove()
      liveMarkerRef.current = null
    }
    if (!livePoint) return
    liveMarkerRef.current = L.circleMarker([livePoint.lat, livePoint.lng], {
      radius: 7,
      color: '#fff',
      weight: 3,
      fillColor: '#10b981',
      fillOpacity: 1
    }).addTo(map)
  }, [livePoint])

  return (
    <div className={cx('relative overflow-hidden rounded-2xl border border-slate-200', className)} style={{ height }}>
      <div ref={containerRef} className="h-full w-full" />
      {children}
    </div>
  )
}
