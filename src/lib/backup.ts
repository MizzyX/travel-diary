import { getAll } from './db'
import type { PhotoRecord } from './db'
import { toShareDataURL } from './image'
import type { AppData, Expense, Journal, Photo, PlanItem, Track, Trip } from '../types'

export interface BackupPhoto extends Photo {
  /** dataURL 形式的图片内容（可选） */
  image?: string
}

export interface BackupFile {
  app: 'travel-diary'
  version: 1
  exportedAt: string
  /** 只导出部分旅行时记录范围，便于识别 */
  scope?: 'all' | 'trips'
  tripIds?: string[]
  data: {
    trips: Trip[]
    plans: PlanItem[]
    journals: Journal[]
    tracks: Track[]
    expenses: Expense[]
    photos: BackupPhoto[]
  }
}

/**
 * 生成备份。tripIds 为空/不传 = 全量导出；传入则只导出这些旅行及其关联数据。
 */
export async function buildBackup(
  includePhotos: boolean,
  photoMaxSide = 1000,
  tripIds?: string[]
): Promise<{ backup: BackupFile; bytes: number }> {
  const [tripsAll, plansAll, journalsAll, tracksAll, expensesAll, photosRaw] = await Promise.all([
    getAll<Trip>('trips'),
    getAll<PlanItem>('plans'),
    getAll<Journal>('journals'),
    getAll<Track>('tracks'),
    getAll<Expense>('expenses'),
    getAll<PhotoRecord>('photos')
  ])

  const only = tripIds && tripIds.length ? new Set(tripIds) : null
  const inScope = <T extends { tripId: string }>(rows: T[]): T[] => (only ? rows.filter((r) => only.has(r.tripId)) : rows)
  const trips = only ? tripsAll.filter((t) => only.has(t.id)) : tripsAll
  const plans = inScope(plansAll)
  const journals = inScope(journalsAll)
  const tracks = inScope(tracksAll)
  const expenses = inScope(expensesAll)
  const photosRawScoped = only ? photosRaw.filter((p) => only.has(p.tripId)) : photosRaw

  const photos: BackupPhoto[] = []
  for (const rec of photosRawScoped) {
    const { blob, thumb, ...meta } = rec
    if (includePhotos) {
      const source = thumb ?? blob
      if (source) {
        try {
          meta.size = source.size
          photos.push({ ...meta, image: await toShareDataURL(source, photoMaxSide, 0.75) })
          continue
        } catch {
          // 忽略单张失败
        }
      }
    }
    photos.push(meta)
  }

  const backup: BackupFile = {
    app: 'travel-diary',
    version: 1,
    exportedAt: new Date().toISOString(),
    scope: only ? 'trips' : 'all',
    tripIds: only ? [...only] : undefined,
    data: { trips, plans, journals, tracks, expenses, photos }
  }
  const text = JSON.stringify(backup)
  return { backup, bytes: new Blob([text]).size }
}

export async function dataURLToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl)
  return res.blob()
}

export function isBackupFile(raw: unknown): raw is BackupFile {
  const b = raw as BackupFile
  return !!b && b.app === 'travel-diary' && !!b.data
}

export type { AppData }
