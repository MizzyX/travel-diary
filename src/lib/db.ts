import type { Photo, StoreName, Tombstone } from '../types'

const DB_NAME = 'travel-diary'
const DB_VERSION = 2

/** photos 记录里除了元数据，还带有 blob（原图）与 thumb（缩略图）两个二进制字段 */
export interface PhotoRecord extends Photo {
  blob?: Blob
  thumb?: Blob
}

const STORES: StoreName[] = ['trips', 'plans', 'journals', 'tracks', 'expenses', 'photos', 'tombstones']

let dbPromise: Promise<IDBDatabase> | null = null

export function supportsIDB(): boolean {
  return typeof indexedDB !== 'undefined'
}

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

async function tx<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDB()
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode)
    const req = fn(t.objectStore(store))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export function getAll<T>(store: StoreName): Promise<T[]> {
  return tx(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>)
}

export function getRecord<T>(store: StoreName, id: string): Promise<T | undefined> {
  return tx(store, 'readonly', (s) => s.get(id) as IDBRequest<T | undefined>)
}

export function putRecord<T>(store: StoreName, value: T): Promise<IDBValidKey> {
  return tx(store, 'readwrite', (s) => s.put(value as unknown as object) as IDBRequest<IDBValidKey>)
}

export function putMany(store: StoreName, values: unknown[]): Promise<void> {
  return tx(store, 'readwrite', (s) => {
    for (const v of values) s.put(v as object)
    return s.getAllKeys() as unknown as IDBRequest<void>
  }).then(() => undefined)
}

export function deleteRecord(store: StoreName, id: string): Promise<void> {
  return tx(store, 'readwrite', (s) => {
    s.delete(id)
    return s.getAllKeys() as unknown as IDBRequest<undefined>
  }).then(() => undefined)
}

export function deleteMany(store: StoreName, ids: string[]): Promise<void> {
  if (!ids.length) return Promise.resolve()
  return tx(store, 'readwrite', (s) => {
    for (const id of ids) s.delete(id)
    return s.getAllKeys() as unknown as IDBRequest<undefined>
  }).then(() => undefined)
}

export function getTombstones(): Promise<Tombstone[]> {
  return getAll<Tombstone>('tombstones')
}

export async function clearAll(): Promise<void> {
  for (const store of STORES) {
    await tx(store, 'readwrite', (s) => {
      s.clear()
      return s.getAllKeys() as unknown as IDBRequest<undefined>
    })
  }
}

/** 读取照片记录（含二进制） */
export function getPhotoRecord(id: string): Promise<PhotoRecord | undefined> {
  return getRecord<PhotoRecord>('photos', id)
}
