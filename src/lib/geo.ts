import type { Track, TrackPoint } from '../types'

const R = 6371008.8 // 地球平均半径（米）

const rad = (d: number) => (d * Math.PI) / 180

export function haversine(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

export function pathDistance(points: TrackPoint[]): number {
  let sum = 0
  for (let i = 1; i < points.length; i++) sum += haversine(points[i - 1], points[i])
  return sum
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`
  return `${(meters / 1000).toFixed(2)} km`
}

export type LatLng = { lat: number; lng: number }

export function boundsOf(points: LatLng[]): [[number, number], [number, number]] | null {
  if (!points.length) return null
  let minLat = 90
  let maxLat = -90
  let minLng = 180
  let maxLng = -180
  for (const p of points) {
    minLat = Math.min(minLat, p.lat)
    maxLat = Math.max(maxLat, p.lat)
    minLng = Math.min(minLng, p.lng)
    maxLng = Math.max(maxLng, p.lng)
  }
  return [
    [minLat, minLng],
    [maxLat, maxLng]
  ]
}

export function centerOf(points: LatLng[]): LatLng | null {
  const b = boundsOf(points)
  if (!b) return null
  return { lat: (b[0][0] + b[1][0]) / 2, lng: (b[0][1] + b[1][1]) / 2 }
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c] as string)
}

/** 把多条轨迹的采样点按时间排序，便于二分查找 */
export function flattenPoints(tracks: { points: TrackPoint[] }[]): TrackPoint[] {
  const all: TrackPoint[] = []
  for (const t of tracks) all.push(...t.points)
  all.sort((a, b) => a.t - b.t)
  return all
}

/** 找到与给定时间最接近的轨迹点 */
export function nearestPointByTime(points: TrackPoint[], time: number): { point: TrackPoint; deltaMs: number } | null {
  if (!points.length) return null
  let lo = 0
  let hi = points.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (points[mid].t < time) lo = mid + 1
    else hi = mid
  }
  const candidates = [points[lo], points[Math.max(0, lo - 1)]].filter(Boolean)
  let best = candidates[0]
  let bestDelta = Math.abs(best.t - time)
  for (const c of candidates) {
    const delta = Math.abs(c.t - time)
    if (delta < bestDelta) {
      best = c
      bestDelta = delta
    }
  }
  return { point: best, deltaMs: bestDelta }
}

export interface PhotoPositionMatch {
  photoId: string
  lat: number
  lng: number
  deltaMs: number
}

/**
 * 按拍摄时间把照片贴到足迹轨迹点上（给没有 EXIF 位置的照片补<｜hy_place▁holder▁no▁813｜>位置）
 * @param toleranceMs 允许的最大时间差，默认 30 分钟；传 Infinity 表示不限制
 */
export function matchPhotosToTracks<T extends { id: string; takenAt: number; lat?: number; lng?: number }>(
  photos: T[],
  tracks: { points: TrackPoint[] }[],
  toleranceMs = 30 * 60 * 1000
): PhotoPositionMatch[] {
  const points = flattenPoints(tracks)
  if (!points.length) return []
  const out: PhotoPositionMatch[] = []
  for (const p of photos) {
    if (p.lat != null && p.lng != null) continue
    const found = nearestPointByTime(points, p.takenAt)
    if (!found) continue
    if (found.deltaMs > toleranceMs) continue
    out.push({ photoId: p.id, lat: found.point.lat, lng: found.point.lng, deltaMs: found.deltaMs })
  }
  return out
}

/** 导出 GPX 1.1 */
export function toGPX(track: Track): string {
  const pts = track.points
    .map(
      (p) =>
        `    <trkpt lat="${p.lat}" lon="${p.lng}">` +
        (p.alt != null ? `<ele>${p.alt}</ele>` : '') +
        `<time>${new Date(p.t).toISOString()}</time>` +
        (p.acc != null ? `<accuracy>${p.acc}</accuracy>` : '') +
        `</trkpt>`
    )
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="旅行日记 Travel Diary" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${escapeXml(track.name)}</name><time>${new Date(track.startedAt).toISOString()}</time></metadata>
  <trk>
    <name>${escapeXml(track.name)}</name>
    <trkseg>
${pts}
    </trkseg>
  </trk>
</gpx>
`
}

/** 解析 GPX（支持多段 trk / rte） */
export function parseGPX(xml: string, fallbackName = '导入的轨迹'): { name: string; points: TrackPoint[] }[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.querySelector('parsererror')) throw new Error('GPX 解析失败')
  const out: { name: string; points: TrackPoint[] }[] = []

  const trks = Array.from(doc.querySelectorAll('trk'))
  for (const trk of trks) {
    const name = trk.querySelector('name')?.textContent?.trim() || fallbackName
    const points: TrackPoint[] = []
    for (const seg of Array.from(trk.querySelectorAll('trkseg'))) {
      for (const p of Array.from(seg.querySelectorAll('trkpt'))) {
        const lat = Number(p.getAttribute('lat'))
        const lng = Number(p.getAttribute('lon'))
        if (!isFinite(lat) || !isFinite(lng)) continue
        const timeEl = p.querySelector('time')?.textContent
        const eleEl = p.querySelector('ele')?.textContent
        const t = timeEl ? new Date(timeEl).getTime() : Date.now()
        const alt = eleEl ? Number(eleEl) : undefined
        points.push({ lat, lng, t: isFinite(t) ? t : Date.now(), alt: isFinite(alt as number) ? alt : undefined })
      }
    }
    if (points.length) out.push({ name, points })
  }
  return out
}
