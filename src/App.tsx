import { useEffect, useMemo, useState } from 'react'
import { Home } from './views/Home'
import { TripDetail } from './views/TripDetail'
import { useStore } from './state/store'

export type Route = { name: 'home' } | { name: 'trip'; id: string; tab: string }

function parseHash(hash: string): Route {
  const clean = hash.replace(/^#\/?/, '')
  const [head, query] = clean.split('?')
  const segs = head.split('/').filter(Boolean)
  if (segs[0] === 'trip' && segs[1]) {
    const params = new URLSearchParams(query ?? '')
    return { name: 'trip', id: decodeURIComponent(segs[1]), tab: params.get('tab') ?? 'daily' }
  }
  return { name: 'home' }
}

export default function App() {
  const { ready, error, data } = useStore()
  const [hash, setHash] = useState(() => window.location.hash)

  useEffect(() => {
    const handler = () => setHash(window.location.hash)
    window.addEventListener('hashchange', handler)
    return () => window.removeEventListener('hashchange', handler)
  }, [])

  useEffect(() => {
    if (!hash) window.location.hash = '#/'
  }, [hash])

  const route = useMemo(() => parseHash(hash), [hash])

  const trip = route.name === 'trip' ? data.trips.find((t) => t.id === route.id) : undefined

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-500">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-brand-500" />
          正在打开旅行日记…
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto min-h-full w-full max-w-4xl px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-4 md:pb-8">
      {error && (
        <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {error}
        </div>
      )}
      {route.name === 'trip' ? (
        trip ? (
          <TripDetail trip={trip} tab={route.tab} />
        ) : (
          <div className="card p-6 text-center text-sm text-slate-500">
            旅行不存在或已被删除，
            <a className="text-brand-600 underline" href="#/">
              返回首页
            </a>
          </div>
        )
      ) : (
        <Home />
      )}
    </div>
  )
}
