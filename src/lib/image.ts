/** 图片处理：缩略图生成、降采样、dataURL 导出（用于分享页） */

const CANVAS_TYPES = ['image/webp', 'image/jpeg'] as const

function pickType(): string {
  const c = document.createElement('canvas')
  for (const t of CANVAS_TYPES) {
    if (c.toDataURL(t).startsWith(`data:${t}`)) return t
  }
  return 'image/jpeg'
}

async function decode(blob: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; dispose: () => void }> {
  if ('createImageBitmap' in window) {
    // from-image：遵循 EXIF 方向，避免手机照片旋转错误
    const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' })
    return { source: bmp, width: bmp.width, height: bmp.height, dispose: () => bmp.close() }
  }
  const url = URL.createObjectURL(blob)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('图片解码失败'))
      el.src = url
    })
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, dispose: () => URL.revokeObjectURL(url) }
  } catch (e) {
    URL.revokeObjectURL(url)
    throw e
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('图片转换失败'))),
      type,
      quality
    )
  })
}

export interface Processed {
  /** 降采样后的“存档图”，用于日常浏览，控制 IndexedDB 体积 */
  display: Blob
  /** 小缩略图，用于网格 / 地图打点 */
  thumb: Blob
  width: number
  height: number
}

/**
 * 把原始照片处理为「存档 + 缩略图」两份。
 * @param keepOriginal 是否同时保留完全原始的文件（体积大，默认否）
 */
export async function processImage(
  file: Blob,
  opts: { displayMax?: number; thumbMax?: number; quality?: number } = {}
): Promise<Processed> {
  const displayMax = opts.displayMax ?? 1600
  const thumbMax = opts.thumbMax ?? 400
  const quality = opts.quality ?? 0.82
  const type = pickType()
  const { source, width, height, dispose } = await decode(file)
  try {
    const scale = Math.min(1, displayMax / Math.max(width, height))
    const dw = Math.max(1, Math.round(width * scale))
    const dh = Math.max(1, Math.round(height * scale))
    const pc = document.createElement('canvas')
    pc.width = dw
    pc.height = dh
    const pctx = pc.getContext('2d')!
    pctx.drawImage(source, 0, 0, dw, dh)

    const tScale = Math.min(1, thumbMax / Math.max(width, height))
    const tc = document.createElement('canvas')
    tc.width = Math.max(1, Math.round(width * tScale))
    tc.height = Math.max(1, Math.round(height * tScale))
    const tctx = tc.getContext('2d')!
    tctx.drawImage(source, 0, 0, tc.width, tc.height)

    const [display, thumb] = await Promise.all([
      canvasToBlob(pc, type, quality),
      canvasToBlob(tc, type, quality - 0.05)
    ])
    return { display, thumb, width, height }
  } finally {
    dispose()
  }
}

/** 生成分享用的 dataURL（压缩后体积可控） */
export async function toShareDataURL(file: Blob, maxSide = 1200, quality = 0.72): Promise<string> {
  const { source, width, height, dispose } = await decode(file)
  try {
    const scale = Math.min(1, maxSide / Math.max(width, height))
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.round(width * scale))
    c.height = Math.max(1, Math.round(height * scale))
    c.getContext('2d')!.drawImage(source, 0, 0, c.width, c.height)
    return c.toDataURL('image/jpeg', quality)
  } finally {
    dispose()
  }
}

export async function readSize(blob: Blob): Promise<{ width: number; height: number }> {
  try {
    const { width, height, dispose } = await decode(blob)
    dispose()
    return { width, height }
  } catch {
    return { width: 0, height: 0 }
  }
}
