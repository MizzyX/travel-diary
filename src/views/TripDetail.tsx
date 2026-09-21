import { useState } from 'react'
import { PageHeader } from '../components/ui'
import { CloudButton } from '../components/CloudPanel'
import { PhotoThumb } from '../components/PhotoThumb'
import { DailyView } from './DailyView'
import { PlanView } from './PlanView'
import { TrackView } from './TrackView'
import { AlbumView } from './AlbumView'
import { LedgerView } from './LedgerView'
import { ShareView } from './ShareView'
import { TripFormModal } from './Home'
import { cx, daysUntil, formatDateCN, tripStatus } from '../lib/utils'
import type { Trip } from '../types'

const TABS = [
  { key: 'daily', label: '日记', emoji: '📖' },
  { key: 'plan', label: '行程', emoji: '🗓️' },
  { key: 'track', label: '足迹', emoji: '🥾' },
  { key: 'album', label: '相册', emoji: '📷' },
  { key: 'ledger', label: '账单', emoji: '💰' },
  { key: 'share', label: '分享', emoji: '🔗' }
] as const

export function TripDetail({ trip, tab }: { trip: Trip; tab: string }) {
  const [editing, setEditing] = useState(false)
  const status = tripStatus(trip)

  const go = (key: string) => {
    window.location.hash = `#/trip/${trip.id}?tab=${key}`
  }

  return (
    <div>
      <PageHeader
        title={trip.title}
        subtitle={`${trip.destination || '未填写目的地'} · ${formatDateCN(trip.startDate, false)} - ${formatDateCN(trip.endDate, false)}`}
        back={() => {
          window.location.hash = '#/'
        }}
        right={
          <div className="flex items-center gap-2">
            <CloudButton className="btn-ghost px-2 py-1.5 text-xs" />
            <button className="btn-ghost px-2.5 py-1.5 text-xs" onClick={() => setEditing(true)}>
              编辑
            </button>
          </div>
        }
      />

      <div className="mb-3 flex items-center gap-2">
        <span className={cx('chip', status.tone)}>{status.label}</span>
        {status.phase === 'planning' && daysUntil(trip.startDate) > 0 && (
          <span className="chip bg-slate-100 text-slate-600">还有 {daysUntil(trip.startDate)} 天出发</span>
        )}
        {trip.budget > 0 && <span className="chip bg-slate-100 text-slate-600">预算 {trip.budget} {trip.currency}</span>}
        {trip.people > 1 && <span className="chip bg-slate-100 text-slate-600">{trip.people} 人</span>}
      </div>

      {trip.notes && (
        <div className="card mb-3 p-3 text-xs leading-relaxed text-slate-600">
          <span className="mr-1 text-slate-400">备注：</span>
          {trip.notes}
        </div>
      )}
      {trip.coverPhotoId && <PhotoThumb photoId={trip.coverPhotoId} className="mb-3 h-40 w-full" />}

      <nav className="sticky top-[52px] z-10 -mx-4 mb-3 hidden gap-1 overflow-x-auto border-b border-slate-200/70 bg-white/90 px-4 py-2 backdrop-blur md:mx-0 md:flex md:rounded-2xl md:border">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => go(t.key)}
            className={cx(
              'shrink-0 rounded-xl px-3 py-1.5 text-xs transition',
              tab === t.key ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100'
            )}
          >
            {t.emoji} {t.label}
          </button>
        ))}
      </nav>

      {/* 手机端底部导航栏 */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => go(t.key)}
            className={cx(
              'flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] transition active:bg-slate-100',
              tab === t.key ? 'text-brand-600' : 'text-slate-500'
            )}
          >
            <span className="text-base leading-none">{t.emoji}</span>
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'daily' && (
        <DailyView tripId={trip.id} startDate={trip.startDate} endDate={trip.endDate} currency={trip.currency} />
      )}
      {tab === 'plan' && <PlanView tripId={trip.id} startDate={trip.startDate} endDate={trip.endDate} />}
      {tab === 'track' && <TrackView tripId={trip.id} />}
      {tab === 'album' && <AlbumView tripId={trip.id} startDate={trip.startDate} endDate={trip.endDate} />}
      {tab === 'ledger' && (
        <LedgerView
          tripId={trip.id}
          startDate={trip.startDate}
          endDate={trip.endDate}
          budget={trip.budget}
          currency={trip.currency}
          people={trip.people}
        />
      )}
      {tab === 'share' && <ShareView tripId={trip.id} />}

      {editing && <TripFormModal open onClose={() => setEditing(false)} initial={trip} />}
    </div>
  )
}
