import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

interface ToastItem {
  id: number
  text: string
  tone: 'ok' | 'err' | 'info'
}

interface ToastApi {
  show: (text: string, tone?: ToastItem['tone']) => void
}

const ToastContext = createContext<ToastApi | null>(null)

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast 必须在 ToastProvider 内使用')
  return ctx
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])

  const show = useCallback((text: string, tone: ToastItem['tone'] = 'info') => {
    const id = Date.now() + Math.random()
    setItems((list) => [...list, { id, text, tone }])
    window.setTimeout(() => setItems((list) => list.filter((i) => i.id !== id)), 3200)
  }, [])

  const api = useMemo(() => ({ show }), [show])

  const toneClass = (tone: ToastItem['tone']) =>
    tone === 'ok'
      ? 'bg-brand-600'
      : tone === 'err'
        ? 'bg-rose-600'
        : 'bg-slate-800'

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[1200] flex flex-col items-center gap-2 px-4 md:bottom-6">
        {items.map((i) => (
          <div
            key={i.id}
            className={`${toneClass(i.tone)} max-w-[92vw] rounded-xl px-4 py-2.5 text-sm text-white shadow-lg animate-[fadeIn_.2s_ease]`}
          >
            {i.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
