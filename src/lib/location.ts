export interface CurrentPos {
  lat: number
  lng: number
  acc?: number
  alt?: number
}

export function geolocationSupported(): boolean {
  return typeof navigator !== 'undefined' && 'geolocation' in navigator
}

/** 获取一次当前位置（超时可容忍） */
export function getCurrentPos(timeout = 8000): Promise<CurrentPos> {
  return new Promise((resolve, reject) => {
    if (!geolocationSupported()) return reject(new Error('当前环境不支持定位'))
    navigator.geolocation.getCurrentPosition(
      (p) =>
        resolve({
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          acc: p.coords.accuracy ?? undefined,
          alt: p.coords.altitude ?? undefined
        }),
      (err) => reject(new Error(describeGeoError(err))),
      { enableHighAccuracy: true, timeout, maximumAge: 30000 }
    )
  })
}

export function describeGeoError(err: GeolocationPositionError | Error): string {
  const code = (err as GeolocationPositionError).code
  switch (code) {
    case 1:
      return '定位权限被拒绝，请在浏览器/系统设置中允许获取位置'
    case 2:
      return '暂时无法获取位置（信号弱或离线），请到开阔地带重试'
    case 3:
      return '获取位置超时，请重试'
    default:
      return err.message || '定位失败'
  }
}
