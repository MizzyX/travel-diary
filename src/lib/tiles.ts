import type { LatLng } from './geo'

export type TileProjection = 'wgs84' | 'gcj02'

export interface TileSource {
  id: string
  label: string
  url: string
  /** 只有部分瓦片源需要子域，其余传空数组 */
  subdomains: string[]
  attribution: string
  maxZoom: number
  /** gcj02 的源（如高德）需要把 WGS-84 的 GPS 坐标纠偏后再画上去 */
  projection: TileProjection
}

/**
 * 多个可选底图。国内网络常无法访问 tile.openstreetmap.org，
 * 因此默认使用可达性更好的 CARTO，并在加载失败时自动回退。
 */
export const TILE_SOURCES: TileSource[] = [
  {
    id: 'carto',
    label: '简洁',
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    subdomains: ['a', 'b', 'c', 'd'],
    attribution: '&copy; OpenStreetMap &copy; CARTO',
    maxZoom: 20,
    projection: 'wgs84'
  },
  {
    id: 'osmde',
    label: '标准',
    url: 'https://tile.openstreetmap.de/{z}/{x}/{y}.png',
    subdomains: [],
    attribution: '&copy; OpenStreetMap DE',
    maxZoom: 19,
    projection: 'wgs84'
  },
  {
    id: 'osm',
    label: 'OSM',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    subdomains: ['a', 'b', 'c'],
    attribution: '&copy; OpenStreetMap',
    maxZoom: 19,
    projection: 'wgs84'
  },
  {
    id: 'amap',
    label: '高德',
    url: 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
    subdomains: ['1', '2', '3', '4'],
    attribution: '&copy; 高德地图',
    maxZoom: 18,
    projection: 'gcj02'
  }
]

const KEY = 'travel-diary:tile-source'

export function getTileSource(id: string): TileSource {
  return TILE_SOURCES.find((s) => s.id === id) ?? TILE_SOURCES[0]
}

export function loadTileSourceId(): string {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved && TILE_SOURCES.some((s) => s.id === saved)) return saved
  } catch {
    // ignore
  }
  return TILE_SOURCES[0].id
}

export function saveTileSourceId(id: string): void {
  try {
    localStorage.setItem(KEY, id)
  } catch {
    // ignore
  }
}

/** 当前源加载失败时，按顺序换下一个 */
export function nextTileSourceId(id: string): string {
  const i = TILE_SOURCES.findIndex((s) => s.id === id)
  return TILE_SOURCES[(i + 1) % TILE_SOURCES.length].id
}

/* ---------------- WGS-84 → GCJ-02（火星坐标）纠偏 ---------------- */

const A = 6378245.0
const EE = 0.00669342162296594323
const PI = Math.PI

function outOfChina(lat: number, lng: number): boolean {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271
}

function transformLat(x: number, y: number): number {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x))
  ret += ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) / 3.0
  ret += ((20.0 * Math.sin(y * PI) + 40.0 * Math.sin((y / 3.0) * PI)) * 2.0) / 3.0
  ret += ((160.0 * Math.sin((y / 12.0) * PI) + 320 * Math.sin((y * PI) / 30.0)) * 2.0) / 3.0
  return ret
}

function transformLng(x: number, y: number): number {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x))
  ret += ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) / 3.0
  ret += ((20.0 * Math.sin(x * PI) + 40.0 * Math.sin((x / 3.0) * PI)) * 2.0) / 3.0
  ret += ((150.0 * Math.sin((x / 12.0) * PI) + 300.0 * Math.sin((x / 30.0) * PI)) * 2.0) / 3.0
  return ret
}

export function wgs84ToGcj02(p: LatLng): LatLng {
  if (outOfChina(p.lat, p.lng)) return { lat: p.lat, lng: p.lng }
  const dLat = transformLat(p.lng - 105.0, p.lat - 35.0)
  const dLng = transformLng(p.lng - 105.0, p.lat - 35.0)
  const radLat = (p.lat / 180.0) * PI
  let magic = Math.sin(radLat)
  magic = 1 - EE * magic * magic
  const sqrtMagic = Math.sqrt(magic)
  const mLat = (dLat * 180.0) / (((A * (1 - EE)) / (magic * sqrtMagic)) * PI)
  const mLng = (dLng * 180.0) / ((A / sqrtMagic) * Math.cos(radLat) * PI)
  return { lat: p.lat + mLat, lng: p.lng + mLng }
}

/** 按底图的坐标系把点转换成可直接绘制的 [lat, lng] */
export function toMapCoords(p: LatLng, projection: TileProjection): [number, number] {
  const q = projection === 'gcj02' ? wgs84ToGcj02(p) : p
  return [q.lat, q.lng]
}
