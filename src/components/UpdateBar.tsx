/// <reference types="vite/client" />
import { useEffect, useState } from 'react'

/** 注册 Service Worker，并在有新版本时提示一键刷新 */
export function UpdateBar() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null)

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      navigator.serviceWorker
        .register('./sw.js')
        .then((reg) => {
          if (cancelled) return
          if (reg.waiting) setWaiting(reg.waiting)
          reg.addEventListener('updatefound', () => {
            const worker = reg.installing
            if (!worker) return
            worker.addEventListener('statechange', () => {
              if (worker.state === 'installed' && navigator.serviceWorker.controller) setWaiting(worker)
            })
          })
        })
        .catch(() => {
          // 不支持或有误时静默失败，不影响正常使用
        })
    }, 1000)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [])

  if (!waiting) return null

  const apply = () => {
    let done = false
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!done) {
        done = true
        window.location.reload()
      }
    })
    waiting.postMessage({ type: 'SKIP_WAITING' })
    setWaiting(null)
  }

  return (
    <div className="fixed inset-x-0 top-2 z-[1300] mx-auto w-[calc(100%-2rem)] max-w-md rounded-xl bg-slate-900 px-3 py-2 text-xs text-white shadow-lg">
      <div className="flex items-center gap-2">
        <span className="flex-1">发现新版本，已下载完成</span>
        <button className="rounded-lg bg-brand-500 px-2 py-1 font-medium" onClick={apply}>
          立即更新
        </button>
      </div>
    </div>
  )
}
