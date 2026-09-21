import { useEffect, useState } from 'react'
import { getPhotoRecord } from '../lib/db'
import { ensurePhotoBlob } from '../lib/sync'
import { toShareDataURL } from '../lib/image'

const cache = new Map<string, string>()

const keyOf = (id: string, kind: 'thumb' | 'full') => `${id}:${kind}`

/** 本地没有二进制时（例如从别的设备同步过来的照片）自动去云端取 */
async function resolveUrl(id: string, kind: 'thumb' | 'full'): Promise<string | undefined> {
  const key = keyOf(id, kind)
  const cached = cache.get(key)
  if (cached) return cached
  const rec = await getPhotoRecord(id)
  let blob = kind === 'thumb' ? rec?.thumb ?? rec?.blob : rec?.blob
  if (!blob) {
    try {
      blob = await ensurePhotoBlob(id, kind)
    } catch {
      blob = undefined
    }
  }
  if (!blob) return undefined
  const objectUrl = URL.createObjectURL(blob)
  cache.set(key, objectUrl)
  return objectUrl
}

/**
 * 懒加载照片二进制，返回可直接用于 <img src> 的 objectURL。
 * kind: thumb → 网格/地图打点；full → 大图查看
 */
export function usePhotoUrl(id: string | undefined, kind: 'thumb' | 'full' = 'thumb'): string | undefined {
  const [url, setUrl] = useState<string | undefined>(() => (id ? cache.get(keyOf(id, kind)) : undefined))

  useEffect(() => {
    if (!id) {
      setUrl(undefined)
      return
    }
    const cached = cache.get(keyOf(id, kind))
    if (cached) {
      setUrl(cached)
      return
    }
    let alive = true
    setUrl(undefined)
    resolveUrl(id, kind)
      .then((u) => {
        if (alive && u) setUrl(u)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [id, kind])

  return url
}

/**
 * 批量加载照片 objectURL（地图打点等场景）
 */
export function usePhotoUrls(ids: string[], kind: 'thumb' | 'full' = 'thumb'): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({})
  const key = ids.join(',')

  useEffect(() => {
    let alive = true
    const list = key ? key.split(',') : []
    void (async () => {
      const next: Record<string, string> = {}
      for (const id of list) {
        try {
          const u = await resolveUrl(id, kind)
          if (!alive || !u) continue
          next[id] = u
        } catch {
          // 单张失败忽略
        }
      }
      if (alive) setUrls(next)
    })()
    return () => {
      alive = false
    }
  }, [key, kind])

  return urls
}

/** 直接拿到 dataURL（用于分享导出） */
export async function photoToDataURL(id: string, maxSide = 1200): Promise<string | undefined> {
  const rec = await getPhotoRecord(id)
  const blob = rec?.blob ?? rec?.thumb ?? (await ensurePhotoBlob(id, 'full').catch(() => undefined))
  if (!blob) return undefined
  return toShareDataURL(blob, maxSide, 0.72)
}
