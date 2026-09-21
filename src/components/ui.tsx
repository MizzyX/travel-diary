import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { cx } from '../lib/utils'

export function PageHeader({
  title,
  subtitle,
  back,
  right
}: {
  title: string
  subtitle?: string
  back?: () => void
  right?: ReactNode
}) {
  return (
    <div className="sticky top-0 z-20 -mx-4 mb-3 border-b border-slate-200/70 bg-white/85 px-4 py-3 backdrop-blur md:mx-0 md:rounded-2xl md:border">
      <div className="flex items-center gap-2">
        {back && (
          <button onClick={back} className="btn-ghost -ml-1 px-2 py-1.5" aria-label="返回">
            ‹
          </button>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold text-slate-900">{title}</h1>
          {subtitle && <p className="truncate text-xs text-slate-500">{subtitle}</p>}
        </div>
        {right}
      </div>
    </div>
  )
}

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  wide
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', handler)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', handler)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-[1000] flex items-end justify-center bg-slate-900/40 p-0 sm:items-center sm:p-6">
      <div className="absolute inset-0" onClick={onClose} />
      <div
        className={cx(
          'relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:max-w-lg sm:rounded-2xl',
          wide && 'sm:max-w-3xl'
        )}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          <button onClick={onClose} className="btn-ghost px-2 py-1 text-slate-400" aria-label="关闭">
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-4 py-3">{footer}</div>}
      </div>
    </div>
  )
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmText = '删除',
  onCancel,
  onConfirm
}: {
  open: boolean
  title: string
  message: string
  confirmText?: string
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      footer={
        <>
          <button className="btn-ghost" onClick={onCancel}>
            取消
          </button>
          <button className="btn-danger" onClick={onConfirm}>
            {confirmText}
          </button>
        </>
      }
    >
      <p className="text-sm text-slate-600">{message}</p>
    </Modal>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
    </label>
  )
}

export function Empty({ icon = '🗺️', text, action }: { icon?: string; text: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-200 bg-white/60 px-6 py-12 text-center">
      <div className="text-3xl">{icon}</div>
      <p className="text-sm text-slate-500">{text}</p>
      {action}
    </div>
  )
}

export function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="card px-3 py-2.5">
      <div className={cx('text-lg font-semibold', tone ?? 'text-slate-900')}>{value}</div>
      <div className="text-[11px] text-slate-500">{label}</div>
    </div>
  )
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <h3 className="text-sm font-semibold text-slate-700">{children}</h3>
      {right}
    </div>
  )
}
