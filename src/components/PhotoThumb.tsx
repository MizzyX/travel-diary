import { usePhotoUrl } from '../state/photoUrl'
import { cx } from '../lib/utils'

export function PhotoThumb({
  photoId,
  alt = '',
  className,
  kind = 'thumb',
  rounded = 'rounded-xl'
}: {
  photoId?: string
  alt?: string
  className?: string
  kind?: 'thumb' | 'full'
  rounded?: string
}) {
  const url = usePhotoUrl(photoId, kind)
  return (
    <div
      className={cx(
        'flex h-full w-full items-center justify-center bg-slate-100 text-xs text-slate-400',
        rounded,
        className
      )}
    >
      {url ? (
        <img src={url} alt={alt} className={cx('h-full w-full object-cover', rounded)} loading="lazy" />
      ) : (
        <span>{photoId ? '加载中' : '无照片'}</span>
      )}
    </div>
  )
}
