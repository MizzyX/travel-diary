/**
 * 极简 EXIF 解析器（仅 JPEG / APP1）
 * 目的：读取手机照片自带的拍摄时间与 GPS 坐标，用于自动归档到轨迹与日程。
 */
export interface ExifInfo {
  takenAt?: number
  lat?: number
  lng?: number
  alt?: number
}

function readJpegSegments(buf: ArrayBuffer): { data: DataView; start: number } | null {
  const view = new DataView(buf)
  if (view.byteLength < 4) return null
  if (view.getUint16(0) !== 0xffd8) return null // 非 JPEG
  let offset = 2
  while (offset + 4 <= view.byteLength) {
    if (view.getUint8(offset) !== 0xff) {
      offset++
      continue
    }
    const marker = view.getUint16(offset)
    if (marker === 0xffda) break // 进入图像数据
    const size = view.getUint16(offset + 2)
    if (marker === 0xffe1) {
      const start = offset + 4
      if (view.getUint32(start) === 0x45786966 /* Exif */ && view.getUint16(start + 4) === 0) {
        return { data: view, start: start + 6 }
      }
    }
    if (size < 2) break
    offset += 2 + size
  }
  return null
}

function dmsToDecimal(dms: number[], ref: string): number {
  if (dms.length < 3) return NaN
  const dec = dms[0] + dms[1] / 60 + dms[2] / 3600
  return ref === 'S' || ref === 'W' ? -dec : dec
}

function parseDate(s: string): number | undefined {
  // '2024:08:12 09:31:24'
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(s)
  if (!m) return undefined
  const t = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime()
  return isFinite(t) ? t : undefined
}

interface IfdEntry {
  tag: number
  type: number
  count: number
  valueOffset: number
}

const UNIT_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 }

export function parseExif(buf: ArrayBuffer): ExifInfo {
  const found = readJpegSegments(buf)
  const out: ExifInfo = {}
  if (!found) return out
  const { data: view, start: tiff } = found
  if (tiff + 8 > view.byteLength) return out

  const little = view.getUint16(tiff) === 0x4949
  const u16 = (o: number) => view.getUint16(o, little)
  const u32 = (o: number) => view.getUint32(o, little)
  const i32 = (o: number) => view.getInt32(o, little)

  const readRationals = (entry: IfdEntry): number[] => {
    const res: number[] = []
    for (let i = 0; i < entry.count; i++) {
      const base = entry.valueOffset + i * 8
      if (base + 8 > view.byteLength) break
      const num = u32(base)
      const den = u32(base + 4)
      res.push(den === 0 ? 0 : num / den)
    }
    return res
  }

  const readString = (entry: IfdEntry): string => {
    if (entry.count <= 4) {
      let s = ''
      const base = entry.valueOffset
      for (let i = 0; i < entry.count; i++) s += String.fromCharCode(view.getUint8(base + i))
      return s
    }
    let s = ''
    const base = entry.valueOffset
    for (let i = 0; i < entry.count - 1; i++) s += String.fromCharCode(view.getUint8(base + i))
    return s
  }

  const readIfd = (offset: number): Map<number, IfdEntry> => {
    const map = new Map<number, IfdEntry>()
    const base = tiff + offset
    if (base + 2 > view.byteLength) return map
    const count = u16(base)
    for (let i = 0; i < count; i++) {
      const entryBase = base + 2 + i * 12
      if (entryBase + 12 > view.byteLength) break
      const tag = u16(entryBase)
      const type = u16(entryBase + 2)
      const cnt = u32(entryBase + 4)
      const size = (UNIT_SIZE[type] ?? 1) * cnt
      const valueOffset = size <= 4 ? entryBase + 8 : tiff + u32(entryBase + 8)
      map.set(tag, { tag, type, count: cnt, valueOffset })
    }
    return map
  }

  const ifd0 = readIfd(u32(tiff + 4))
  if (!ifd0.size) return out

  const exifPtr = ifd0.get(0x8769)
  if (exifPtr) {
    const exif = readIfd(exifPtr.count ? u32(exifPtr.valueOffset) : exifPtr.valueOffset)
    const dt = exif.get(0x9003) ?? exif.get(0x9004) ?? ifd0.get(0x0132)
    if (dt) out.takenAt = parseDate(readString(dt))
  }

  const gpsPtr = ifd0.get(0x8825)
  if (gpsPtr) {
    const gps = readIfd(gpsPtr.count ? u32(gpsPtr.valueOffset) : gpsPtr.valueOffset)
    const latEntry = gps.get(2)
    const lngEntry = gps.get(4)
    if (latEntry && lngEntry) {
      const latRef = gps.get(1) ? String.fromCharCode(view.getUint8(gps.get(1)!.valueOffset)) : 'N'
      const lngRef = gps.get(3) ? String.fromCharCode(view.getUint8(gps.get(3)!.valueOffset)) : 'E'
      const lat = dmsToDecimal(readRationals(latEntry), latRef)
      const lng = dmsToDecimal(readRationals(lngEntry), lngRef)
      if (isFinite(lat) && isFinite(lng)) {
        out.lat = lat
        out.lng = lng
      }
    }
    const altEntry = gps.get(6)
    if (altEntry) {
      const alt = readRationals(altEntry)[0]
      if (isFinite(alt) && Math.abs(alt) < 20000) out.alt = alt
    }
  }
  void i32
  return out
}

export async function readExif(file: Blob): Promise<ExifInfo> {
  try {
    const buf = await file.slice(0, 128 * 1024).arrayBuffer()
    return parseExif(buf)
  } catch {
    return {}
  }
}
