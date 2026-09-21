/**
 * 同步引擎：本地 IndexedDB 为唯一真源，云端只做「记录级最后写入胜出」的镜像。
 * - 拉：增量取 updated_at > 上次游标的行 → 与本地比对时间戳 → 新的覆盖旧的
 * - 推：本地 updatedAt > 上次推送游标的行 → upsert；删除写墓碑
 * - 照片：元数据同上，二进制走 Storage，按需下载
 */
import { deleteRecord, getAll, getPhotoRecord, getTombstones, putRecord } from './db'
import { currentUserId, getClient } from './supabase'
import { SYNC_STORES } from '../types'
import type { StoreName, Tombstone } from '../types'

const CURSOR_KEY = 'travel-diary:sync-cursor'
const UPLOADED_KEY = 'travel-diary:uploaded-photos'
const BUCKET = 'photos'
const PAGE_SIZE = 1000
const CHUNK = 200

interface Cursor {
  pull: number
  push: number
}

export interface SyncResult {
  pushed: number
  pulled: number
  photosUploaded: number
  at: number
}

interface RemoteRow {
  id: string
  store: string
  data: Record<string, unknown>
  updated_at: number
  deleted: boolean
}

function readCursor(): Cursor {
  try {
    const raw = localStorage.getItem(CURSOR_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Cursor>
      return { pull: Number(parsed.pull) || 0, push: Number(parsed.push) || 0 }
    }
  } catch {
    // ignore
  }
  return { pull: 0, push: 0 }
}

function writeCursor(cursor: Cursor): void {
  try {
    localStorage.setItem(CURSOR_KEY, JSON.stringify(cursor))
  } catch {
    // ignore
  }
}

/** 换账号 / 重置同步时清掉游标与已上传记录 */
export function resetSyncState(): void {
  try {
    localStorage.removeItem(CURSOR_KEY)
    localStorage.removeItem(UPLOADED_KEY)
  } catch {
    // ignore
  }
}

function uploadedIds(): Set<string> {
  try {
    const raw = localStorage.getItem(UPLOADED_KEY)
    if (!raw) return new Set()
    return new Set(JSON.parse(raw) as string[])
  } catch {
    return new Set()
  }
}

function markUploaded(ids: string[]): void {
  if (!ids.length) return
  const set = uploadedIds()
  for (const id of ids) set.add(id)
  try {
    localStorage.setItem(UPLOADED_KEY, JSON.stringify([...set].slice(-5000)))
  } catch {
    // ignore
  }
}

export function isUploaded(id: string): boolean {
  return uploadedIds().has(id)
}

function stamp(rec: Record<string, unknown>): number {
  const u = rec.updatedAt
  if (typeof u === 'number' && u > 0) return u
  const c = (rec.createdAt ?? rec.startedAt ?? 0) as number
  return typeof c === 'number' ? c : 0
}

function stripBinary(rec: Record<string, unknown>): Record<string, unknown> {
  const { blob: _b, thumb: _t, ...rest } = rec
  return rest
}

const keyOf = (store: string, id: string) => `${store}:${id}`

async function pullChanges(userId: string, cursor: Cursor): Promise<{ pulled: number; maxTs: number }> {
  const sb = getClient()!
  let from = cursor.pull
  let pulled = 0
  let maxTs = cursor.pull

  // 本地索引：一次读齐，避免逐条查库
  const index = new Map<string, { rec: Record<string, unknown>; ts: number }>()
  for (const store of SYNC_STORES) {
    const list = await getAll<Record<string, unknown>>(store)
    for (const rec of list) index.set(keyOf(store, String(rec.id)), { rec, ts: stamp(rec) })
  }
  const tombs = new Map<string, Tombstone>()
  for (const t of await getTombstones()) tombs.set(keyOf(t.store, t.id), t)

  for (;;) {
    const { data, error } = await sb
      .from('diary_records')
      .select('id,store,data,updated_at,deleted')
      .eq('user_id', userId)
      .gt('updated_at', from)
      .order('updated_at', { ascending: true })
      .limit(PAGE_SIZE)
    if (error) throw new Error(`拉取失败：${error.message}`)
    const rows = (data ?? []) as RemoteRow[]
    if (!rows.length) break

    for (const row of rows) {
      const key = keyOf(row.store, row.id)
      const local = index.get(key)
      const tomb = tombs.get(key)

      if (row.deleted) {
        if (local && local.ts <= row.updated_at) {
          await deleteRecord(row.store as StoreName, row.id)
          await putRecord('tombstones', { id: row.id, store: row.store, updatedAt: row.updated_at } as Tombstone)
          index.delete(key)
          pulled++
        }
        continue
      }
      // 本地删得更晚：等推送阶段把墓碑写上去，这里不复活
      if (tomb && tomb.updatedAt >= row.updated_at) continue
      if (!local || local.ts < row.updated_at) {
        const rec: Record<string, unknown> = { ...(row.data ?? {}), updatedAt: row.updated_at }
        if (row.store === 'photos') {
          const existing = await getPhotoRecord(row.id)
          // 保留本机已有的二进制，别把图覆盖没了
          await putRecord('photos', { ...(existing ?? {}), ...rec })
          markUploaded([row.id])
        } else {
          await putRecord(row.store as StoreName, rec)
        }
        index.set(key, { rec, ts: row.updated_at })
        tombs.delete(key)
        pulled++
      }
    }

    const batchMax = rows.reduce((m, r) => Math.max(m, r.updated_at), from)
    maxTs = Math.max(maxTs, batchMax)
    from = batchMax
    if (rows.length < PAGE_SIZE) break
  }

  return { pulled, maxTs }
}

async function pushChanges(
  userId: string,
  cursor: Cursor
): Promise<{ pushed: number; photoIds: string[]; deletedPhotoIds: string[] }> {
  const sb = getClient()!
  const rows: Record<string, unknown>[] = []
  const photoIds: string[] = []
  const deletedPhotoIds: string[] = []

  for (const store of SYNC_STORES) {
    const list = await getAll<Record<string, unknown>>(store)
    for (const rec of list) {
      const ts = stamp(rec)
      if (cursor.push && ts <= cursor.push) continue
      rows.push({
        user_id: userId,
        store,
        id: String(rec.id),
        data: stripBinary(rec),
        updated_at: ts,
        deleted: false
      })
      if (store === 'photos') photoIds.push(String(rec.id))
    }
  }

  for (const t of await getTombstones()) {
    if (cursor.push && t.updatedAt <= cursor.push) continue
    rows.push({ user_id: userId, store: t.store, id: t.id, data: {}, updated_at: t.updatedAt, deleted: true })
    if (t.store === 'photos') deletedPhotoIds.push(t.id)
  }

  if (!rows.length) return { pushed: 0, photoIds: [], deletedPhotoIds }

  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await sb
      .from('diary_records')
      .upsert(rows.slice(i, i + CHUNK), { onConflict: 'user_id,store,id' })
    if (error) throw new Error(`上传失败：${error.message}`)
  }
  return { pushed: rows.length, photoIds, deletedPhotoIds }
}

/** 照片被删除时，把云端图片文件也清掉 */
async function deleteRemotePhotos(userId: string, ids: string[]): Promise<void> {
  if (!ids.length) return
  const sb = getClient()!
  const paths = ids.flatMap((id) => [`${userId}/${id}.jpg`, `${userId}/${id}.thumb.jpg`])
  try {
    await sb.storage.from(BUCKET).remove(paths)
  } catch {
    // ignore
  }
  const set = uploadedIds()
  for (const id of ids) set.delete(id)
  try {
    localStorage.setItem(UPLOADED_KEY, JSON.stringify([...set]))
  } catch {
    // ignore
  }
}

async function uploadPhotoBlobs(userId: string, ids: string[]): Promise<number> {
  const sb = getClient()!
  const done = uploadedIds()
  let count = 0
  for (const id of ids) {
    if (done.has(id)) continue
    const rec = await getPhotoRecord(id)
    const blob = rec?.blob ?? rec?.thumb
    if (!blob) continue
    const opts = { upsert: true, contentType: blob.type || 'image/jpeg' }
    try {
      const full = await sb.storage.from(BUCKET).upload(`${userId}/${id}.jpg`, blob, opts)
      if (full.error) throw full.error
      if (rec?.thumb) {
        await sb.storage.from(BUCKET).upload(`${userId}/${id}.thumb.jpg`, rec.thumb, opts)
      }
      markUploaded([id])
      count++
    } catch {
      // 单张失败不阻塞整体同步
    }
  }
  return count
}

/** 本地没有二进制时，从云端下拉并缓存进 IndexedDB */
export async function ensurePhotoBlob(id: string, kind: 'thumb' | 'full'): Promise<Blob | undefined> {
  const rec = await getPhotoRecord(id)
  const local = kind === 'thumb' ? rec?.thumb ?? rec?.blob : rec?.blob
  if (local) return local

  const sb = getClient()
  if (!sb) return undefined
  const userId = await currentUserId()
  if (!userId) return undefined

  const paths = kind === 'thumb' ? [`${userId}/${id}.thumb.jpg`, `${userId}/${id}.jpg`] : [`${userId}/${id}.jpg`]
  for (const path of paths) {
    const { data, error } = await sb.storage.from(BUCKET).download(path)
    if (error || !data) continue
    const blob = data as Blob
    const field = kind === 'thumb' ? { thumb: blob } : { blob }
    await putRecord('photos', { ...(rec ?? {}), id, ...field })
    return blob
  }
  return undefined
}

export function photoPublicUrl(id: string, kind: 'thumb' | 'full'): string | undefined {
  const sb = getClient()
  if (!sb) return undefined
  const raw = localStorage.getItem('travel-diary:auth')
  const uidFromStorage = (() => {
    try {
      const parsed = raw ? JSON.parse(raw) : null
      const user = parsed?.user ?? parsed?.currentSession?.user
      return user?.id as string | undefined
    } catch {
      return undefined
    }
  })()
  if (!uidFromStorage) return undefined
  const path = kind === 'thumb' ? `${uidFromStorage}/${id}.thumb.jpg` : `${uidFromStorage}/${id}.jpg`
  return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
}

/** 执行一次完整同步；未配置 / 未登录时返回 null */
export async function runSync(): Promise<SyncResult | null> {
  const sb = getClient()
  if (!sb) return null
  const userId = await currentUserId()
  if (!userId) return null

  const cursor = readCursor()
  const { pulled, maxTs } = await pullChanges(userId, cursor)
  const { pushed, photoIds, deletedPhotoIds } = await pushChanges(userId, cursor)
  const photosUploaded = await uploadPhotoBlobs(userId, photoIds)
  await deleteRemotePhotos(userId, deletedPhotoIds)

  writeCursor({ pull: Math.max(cursor.pull, maxTs), push: Date.now() })
  return { pushed, pulled, photosUploaded, at: Date.now() }
}
