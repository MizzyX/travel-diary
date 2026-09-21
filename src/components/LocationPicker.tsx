import { useState } from 'react'
import { Field } from './ui'

interface Result {
  id: string
  name: string
  lat: number
  lng: number
}

export interface PickedPlace {
  label: string
  lat?: number
  lng?: number
}

/** 用 OpenStreetMap Nominatim 搜索地点，给行程项附加坐标 */
export function LocationPicker({ value, onChange }: { value: PickedPlace; onChange: (p: PickedPlace) => void }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Result[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const search = async () => {
    if (!q.trim()) return
    setLoading(true)
    setError(null)
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=5&accept-language=zh-CN&q=${encodeURIComponent(q.trim())}`
      const res = await fetch(url, { headers: { Accept: 'application/json' } })
      if (!res.ok) throw new Error(`搜索失败（${res.status}）`)
      const json = (await res.json()) as { place_id: number; display_name: string; lat: string; lon: string }[]
      setResults(
        json.map((r) => ({
          id: String(r.place_id),
          name: r.display_name,
          lat: Number(r.lat),
          lng: Number(r.lon)
        }))
      )
      if (!json.length) setError('没有找到结果，换个关键词试试')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-2">
      <Field label="地点（可选，搜索后可带坐标显示在地图上）">
        <div className="flex gap-2">
          <input
            className="input"
            value={value.label}
            placeholder="例如：清水寺"
            onChange={(e) => onChange({ ...value, label: e.target.value, lat: undefined, lng: undefined })}
          />
        </div>
      </Field>
      <div className="flex gap-2">
        <input
          className="input"
          value={q}
          placeholder="搜索地点坐标（OpenStreetMap）"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void search()}
        />
        <button type="button" className="btn-ghost shrink-0" onClick={() => void search()} disabled={loading}>
          {loading ? '搜索中' : '搜索'}
        </button>
      </div>
      {value.lat != null && (
        <p className="text-[11px] text-brand-700">已绑定坐标 {value.lat.toFixed(5)}, {value.lng!.toFixed(5)}</p>
      )}
      {error && <p className="text-[11px] text-rose-600">{error}</p>}
      {results.length > 0 && (
        <ul className="max-h-40 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-1">
          {results.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                className="w-full rounded-lg px-2 py-1.5 text-left text-xs text-slate-600 hover:bg-slate-50"
                onClick={() => {
                  onChange({ label: value.label || r.name.split(',')[0], lat: r.lat, lng: r.lng })
                  setResults([])
                }}
              >
                {r.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
