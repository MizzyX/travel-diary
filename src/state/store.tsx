import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  deleteMany,
  deleteRecord,
  getPhotoRecord,
  getAll,
  clearAll as clearDB,
  putMany,
  putRecord,
  supportsIDB
} from '../lib/db'
import type { PhotoRecord } from '../lib/db'
import { processImage } from '../lib/image'
import { readExif } from '../lib/exif'
import { getCurrentPos } from '../lib/location'
import { dataURLToBlob } from '../lib/backup'
import { requestSync } from '../lib/syncBus'
import { pathDistance } from '../lib/geo'
import { uid } from '../lib/utils'
import { EMPTY_DATA } from '../types'
import type {
  AppData,
  Expense,
  Journal,
  Photo,
  PlanItem,
  SyncStore,
  Tombstone,
  Track,
  Trip
} from '../types'

type NewTrip = Omit<Trip, 'id' | 'createdAt' | 'updatedAt'>
type NewPlan = Omit<PlanItem, 'id'>
type NewJournal = Omit<Journal, 'id' | 'createdAt'>
type NewExpense = Omit<Expense, 'id' | 'createdAt'>

export interface AddPhotoResult {
  added: number
  failed: { name: string; reason: string }[]
}

interface StoreApi {
  data: AppData
  ready: boolean
  error: string | null
  addTrip: (input: NewTrip) => Promise<Trip>
  updateTrip: (id: string, patch: Partial<Trip>) => Promise<void>
  deleteTrip: (id: string) => Promise<void>
  addPlan: (input: NewPlan) => Promise<void>
  updatePlan: (id: string, patch: Partial<PlanItem>) => Promise<void>
  deletePlan: (id: string) => Promise<void>
  addJournal: (input: NewJournal) => Promise<void>
  updateJournal: (id: string, patch: Partial<Journal>) => Promise<void>
  deleteJournal: (id: string) => Promise<void>
  putTrack: (track: Track) => Promise<void>
  deleteTrack: (id: string) => Promise<void>
  addPhotos: (tripId: string, files: File[], useLocation: boolean) => Promise<AddPhotoResult>
  updatePhoto: (id: string, patch: Partial<Photo>) => Promise<void>
  patchPhotos: (patches: { id: string; patch: Partial<Photo> }[]) => Promise<void>
  deletePhoto: (id: string) => Promise<void>
  addExpense: (input: NewExpense) => Promise<void>
  updateExpense: (id: string, patch: Partial<Expense>) => Promise<void>
  deleteExpense: (id: string) => Promise<void>
  importBackup: (raw: string) => Promise<{ trips: number }>
  resetAll: () => Promise<void>
  reload: () => Promise<void>
}

const StoreContext = createContext<StoreApi | null>(null)

export function useStore(): StoreApi {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore 必须在 StoreProvider 内使用')
  return ctx
}

async function loadAll(): Promise<AppData> {
  const [trips, plans, journals, tracks, expenses, photosRaw] = await Promise.all([
    getAll<Trip>('trips'),
    getAll<PlanItem>('plans'),
    getAll<Journal>('journals'),
    getAll<Track>('tracks'),
    getAll<Expense>('expenses'),
    getAll<PhotoRecord>('photos')
  ])
  const photos: Photo[] = photosRaw.map(({ blob: _blob, thumb: _thumb, ...meta }) => meta)
  return { trips, plans, journals, tracks, expenses, photos }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppData>(EMPTY_DATA)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dataRef = useRef<AppData>(EMPTY_DATA)

  /** 云端同步写库后，重新灌入内存状态 */
  const reload = useCallback(async () => {
    const next = await loadAll()
    dataRef.current = next
    setData(next)
  }, [])

  /** 删除后留痕，保证其他设备也会删掉同一条 */
  const tomb = useCallback(async (store: SyncStore, ids: string[]) => {
    if (!ids.length) return
    const now = Date.now()
    for (const id of ids) await putRecord('tombstones', { id, store, updatedAt: now } as Tombstone)
  }, [])

  useEffect(() => {
    dataRef.current = data
  }, [data])

  useEffect(() => {
    if (!supportsIDB()) {
      setError('当前浏览器不支持 IndexedDB，数据无法持久化保存')
      setReady(true)
      return
    }
    loadAll()
      .then((d) => setData(d))
      .catch((e) => setError(`数据加载失败：${(e as Error).message}`))
      .finally(() => setReady(true))
  }, [])

  const addTrip = useCallback(async (input: NewTrip) => {
    const now = Date.now()
    const trip: Trip = { ...input, id: uid('t_'), createdAt: now, updatedAt: now }
    setData((d) => ({ ...d, trips: [...d.trips, trip] }))
    await putRecord('trips', trip)
    requestSync()
    return trip
  }, [])

  const updateTrip = useCallback(async (id: string, patch: Partial<Trip>) => {
    const current = dataRef.current.trips.find((t) => t.id === id)
    if (!current) return
    const next: Trip = { ...current, ...patch, updatedAt: Date.now() }
    setData((d) => ({ ...d, trips: d.trips.map((t) => (t.id === id ? next : t)) }))
    await putRecord('trips', next)
    requestSync()
  }, [])

  const deleteTrip = useCallback(async (id: string) => {
    setData((d) => ({
      ...d,
      trips: d.trips.filter((t) => t.id !== id),
      plans: d.plans.filter((p) => p.tripId !== id),
      journals: d.journals.filter((j) => j.tripId !== id),
      tracks: d.tracks.filter((t) => t.tripId !== id),
      expenses: d.expenses.filter((e) => e.tripId !== id),
      photos: d.photos.filter((p) => p.tripId !== id)
    }))
    const allIds = await Promise.all([
      getAll<PlanItem>('plans'),
      getAll<Journal>('journals'),
      getAll<Track>('tracks'),
      getAll<Expense>('expenses'),
      getAll<Photo>('photos')
    ])
    await deleteRecord('trips', id)
    const stores: SyncStore[] = ['plans', 'journals', 'tracks', 'expenses', 'photos']
    for (const [idx, store] of stores.entries()) {
      const list = allIds[idx] as unknown as { id: string; tripId: string }[]
      const hit = list.filter((item) => item.tripId === id)
      if (!hit.length) continue
      await deleteMany(store, hit.map((i) => i.id))
      await tomb(store, hit.map((i) => i.id))
    }
    await tomb('trips', [id])
    requestSync()
  }, [tomb])

  const addPlan = useCallback(async (input: NewPlan) => {
    const item: PlanItem = { ...input, updatedAt: Date.now(), id: uid('p_') }
    setData((d) => ({ ...d, plans: [...d.plans, item] }))
    await putRecord('plans', item)
    requestSync()
  }, [])

  const updatePlan = useCallback(async (id: string, patch: Partial<PlanItem>) => {
    const current = dataRef.current.plans.find((p) => p.id === id)
    if (!current) return
    const next: PlanItem = { ...current, ...patch, updatedAt: Date.now() }
    setData((d) => ({ ...d, plans: d.plans.map((p) => (p.id === id ? next : p)) }))
    await putRecord('plans', next)
    requestSync()
  }, [])

  const deletePlan = useCallback(async (id: string) => {
    setData((d) => ({ ...d, plans: d.plans.filter((p) => p.id !== id) }))
    await deleteRecord('plans', id)
    await tomb('plans', [id])
    requestSync()
  }, [tomb])

  const addJournal = useCallback(async (input: NewJournal) => {
    const now = Date.now()
    const item: Journal = { ...input, updatedAt: now, id: uid('j_'), createdAt: now }
    setData((d) => ({ ...d, journals: [...d.journals, item] }))
    await putRecord('journals', item)
    requestSync()
  }, [])

  const updateJournal = useCallback(async (id: string, patch: Partial<Journal>) => {
    const current = dataRef.current.journals.find((j) => j.id === id)
    if (!current) return
    const next: Journal = { ...current, ...patch, updatedAt: Date.now() }
    setData((d) => ({ ...d, journals: d.journals.map((j) => (j.id === id ? next : j)) }))
    await putRecord('journals', next)
    requestSync()
  }, [])

  const deleteJournal = useCallback(async (id: string) => {
    setData((d) => ({ ...d, journals: d.journals.filter((j) => j.id !== id) }))
    await deleteRecord('journals', id)
    await tomb('journals', [id])
    requestSync()
  }, [tomb])

  const putTrack = useCallback(async (track: Track) => {
    const withDistance: Track = { ...track, updatedAt: Date.now(), distance: pathDistance(track.points) }
    setData((d) => ({
      ...d,
      tracks: d.tracks.some((t) => t.id === withDistance.id)
        ? d.tracks.map((t) => (t.id === withDistance.id ? withDistance : t))
        : [...d.tracks, withDistance]
    }))
    await putRecord('tracks', withDistance)
    requestSync()
  }, [])

  const deleteTrack = useCallback(
    async (id: string) => {
      setData((d) => ({ ...d, tracks: d.tracks.filter((t) => t.id !== id) }))
      await deleteRecord('tracks', id)
      await tomb('tracks', [id])
      requestSync()
    },
    [tomb]
  )

  const addPhotos = useCallback<StoreApi['addPhotos']>(async (tripId, files, useLocation) => {
    let fallback: { lat: number; lng: number } | undefined
    if (useLocation) {
      try {
        fallback = await getCurrentPos(6000)
      } catch {
        fallback = undefined
      }
    }
    const failed: AddPhotoResult['failed'] = []
    let added = 0

    for (const file of files) {
      try {
        const exif = await readExif(file)
        const processed = await processImage(file)
        const takenAt = exif.takenAt ?? file.lastModified ?? Date.now()
        const photo: Photo = {
          id: uid('ph_'),
          tripId,
          caption: '',
          takenAt,
          lat: exif.lat ?? fallback?.lat,
          lng: exif.lng ?? fallback?.lng,
          width: processed.width,
          height: processed.height,
          size: processed.display.size,
          fromExif: exif.lat != null && exif.lng != null,
          updatedAt: Date.now(),
          createdAt: Date.now()
        }
        const record: PhotoRecord = { ...photo, blob: processed.display, thumb: processed.thumb }
        setData((d) => ({ ...d, photos: [...d.photos, photo] }))
        await putRecord('photos', record)
        added++
      } catch (e) {
        failed.push({ name: file.name, reason: (e as Error).message || '无法读取（可能是 HEIC 等不支持的格式）' })
      }
    }
    if (added) requestSync()
    return { added, failed }
  }, [])

  const updatePhoto = useCallback(async (id: string, patch: Partial<Photo>) => {
    const current = dataRef.current.photos.find((p) => p.id === id)
    if (!current) return
    const next: Photo = { ...current, ...patch, updatedAt: Date.now() }
    setData((d) => ({ ...d, photos: d.photos.map((p) => (p.id === id ? next : p)) }))
    const rec = await getPhotoRecord(id)
    await putRecord('photos', { ...(rec ?? {}), ...next })
    requestSync()
  }, [])

  /** 批量给照片补位置（保留已有的 Blob 内容） */
  const patchPhotos = useCallback(async (patches: { id: string; patch: Partial<Photo> }[]) => {
    if (!patches.length) return
    const map = new Map(patches.map((p) => [p.id, p.patch]))
    const currentPhotos = dataRef.current.photos
    const nextList = currentPhotos.map((p) =>
      map.has(p.id) ? { ...p, ...map.get(p.id)!, updatedAt: Date.now() } : p
    )
    setData((d) => ({ ...d, photos: nextList }))
    for (const item of patches) {
      const rec = await getPhotoRecord(item.id)
      const meta = nextList.find((p) => p.id === item.id)
      if (!meta) continue
      await putRecord('photos', { ...(rec ?? {}), ...meta })
    }
    requestSync()
  }, [])

  const deletePhoto = useCallback(async (id: string) => {
    setData((d) => ({
      ...d,
      photos: d.photos.filter((p) => p.id !== id),
      trips: d.trips.map((t) => (t.coverPhotoId === id ? { ...t, coverPhotoId: undefined } : t))
    }))
    await deleteRecord('photos', id)
    await tomb('photos', [id])
    requestSync()
  }, [tomb])

  const addExpense = useCallback(async (input: NewExpense) => {
    const now = Date.now()
    const item: Expense = { ...input, updatedAt: now, id: uid('e_'), createdAt: now }
    setData((d) => ({ ...d, expenses: [...d.expenses, item] }))
    await putRecord('expenses', item)
    requestSync()
  }, [])

  const updateExpense = useCallback(async (id: string, patch: Partial<Expense>) => {
    const current = dataRef.current.expenses.find((e) => e.id === id)
    if (!current) return
    const next: Expense = { ...current, ...patch, updatedAt: Date.now() }
    setData((d) => ({ ...d, expenses: d.expenses.map((e) => (e.id === id ? next : e)) }))
    await putRecord('expenses', next)
    requestSync()
  }, [])

  const deleteExpense = useCallback(async (id: string) => {
    setData((d) => ({ ...d, expenses: d.expenses.filter((e) => e.id !== id) }))
    await deleteRecord('expenses', id)
    await tomb('expenses', [id])
    requestSync()
  }, [tomb])

  const importBackup = useCallback<StoreApi['importBackup']>(async (raw) => {
    const parsed = JSON.parse(raw) as { version?: number; data?: Partial<AppData> } | Partial<AppData>
    const payload = ('data' in parsed ? parsed.data : parsed) as Partial<AppData> | undefined
    if (!payload) throw new Error('备份文件格式不正确')
    const now = Date.now()
    /** 导入的记录统一打上新时间戳，保证会被推送到云端 */
    const stamped = <T,>(list: T[] = []): T[] => list.map((r) => ({ ...r, updatedAt: now }))
    const incoming: AppData = {
      trips: stamped(payload.trips),
      plans: stamped(payload.plans),
      journals: stamped(payload.journals),
      tracks: stamped(payload.tracks),
      expenses: stamped(payload.expenses),
      photos: stamped(payload.photos)
    }
    // 备份里可能带有 dataURL 形式的图片内容，恢复成 Blob 存进 IndexedDB
    const restoredPhotos: PhotoRecord[] = []
    for (const p of incoming.photos as (Photo & { image?: string })[]) {
      const { image, ...meta } = p
      if (!image) {
        restoredPhotos.push(meta)
        continue
      }
      try {
        const blob = await dataURLToBlob(image)
        const processed = await processImage(blob)
        restoredPhotos.push({ ...meta, blob: processed.display, thumb: processed.thumb })
      } catch {
        restoredPhotos.push(meta)
      }
    }

    const current = dataRef.current
    const diff = <T extends { id: string }>(a: T[], b: T[]): T[] => {
      const set = new Set(b.map((x) => x.id))
      return a.filter((x) => !set.has(x.id))
    }
    const merged: AppData = {
      trips: [...current.trips, ...diff(incoming.trips, current.trips)],
      plans: [...current.plans, ...diff(incoming.plans, current.plans)],
      journals: [...current.journals, ...diff(incoming.journals, current.journals)],
      tracks: [...current.tracks, ...diff(incoming.tracks, current.tracks)],
      expenses: [...current.expenses, ...diff(incoming.expenses, current.expenses)],
      photos: [...current.photos, ...diff(incoming.photos, current.photos)]
    }
    await putMany('trips', merged.trips)
    await putMany('plans', merged.plans)
    await putMany('journals', merged.journals)
    await putMany('tracks', merged.tracks)
    await putMany('expenses', merged.expenses)
    if (restoredPhotos.length) await putMany('photos', restoredPhotos)
    setData(merged)
    requestSync()
    return { trips: diff(incoming.trips, current.trips).length }
  }, [])

  const resetAll = useCallback(async () => {
    // 清空也要同步到云端：先把现有记录全部记成墓碑，再清库
    const stores: SyncStore[] = ['trips', 'plans', 'journals', 'tracks', 'expenses', 'photos']
    const now = Date.now()
    const tombs: Tombstone[] = []
    for (const store of stores) {
      for (const item of await getAll<{ id: string }>(store)) tombs.push({ id: item.id, store, updatedAt: now })
    }
    await clearDB()
    for (const t of tombs) await putRecord('tombstones', t)
    setData(EMPTY_DATA)
    requestSync()
  }, [])

  const value = useMemo<StoreApi>(
    () => ({
      data,
      ready,
      error,
      reload,
      addTrip,
      updateTrip,
      deleteTrip,
      addPlan,
      updatePlan,
      deletePlan,
      addJournal,
      updateJournal,
      deleteJournal,
      putTrack,
      deleteTrack,
      addPhotos,
      updatePhoto,
      patchPhotos,
      deletePhoto,
      addExpense,
      updateExpense,
      deleteExpense,
      importBackup,
      resetAll
    }),
    [
      data,
      ready,
      error,
      reload,
      addTrip,
      updateTrip,
      deleteTrip,
      addPlan,
      updatePlan,
      deletePlan,
      addJournal,
      updateJournal,
      deleteJournal,
      putTrack,
      deleteTrack,
      addPhotos,
      updatePhoto,
      patchPhotos,
      deletePhoto,
      addExpense,
      updateExpense,
      deleteExpense,
      importBackup,
      resetAll
    ]
  )

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}
