import { EXPENSE_CATEGORIES, PLAN_TYPES } from '../types'
import type { Expense, Journal, Photo, PlanItem, Track, Trip } from '../types'
import { photoToDataURL } from '../state/photoUrl'
import { dateRange, formatDateCN } from './utils'

export interface ShareOptions {
  includePhotos: boolean
  includeExpenses: boolean
  photoMaxSide: number
  author?: string
}

export interface ShareInput {
  trip: Trip
  plans: PlanItem[]
  journals: Journal[]
  tracks: Track[]
  expenses: Expense[]
  photos: Photo[]
}

interface SharePhotoPayload {
  src?: string
  caption: string
  time: string
  lat?: number
  lng?: number
}

interface SharePayload {
  trip: Trip
  days: {
    date: string
    label: string
    plans: { time?: string; type: string; emoji: string; title: string; note?: string; location?: string }[]
    journals: { time?: string; text: string }[]
    photos: SharePhotoPayload[]
  }[]
  tracks: { name: string; distance: number; points: [number, number][] }[]
  expenses: { date: string; category: string; emoji: string; label: string; amount: number; note?: string }[]
  total: number
  stats: { days: number; photos: number; distance: number; people: number }
  generatedAt: string
  author?: string
}

export async function prepareImages(photos: Photo[], maxSide: number): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const p of photos) {
    try {
      const url = await photoToDataURL(p.id, maxSide)
      if (url) out[p.id] = url
    } catch {
      // 跳过无法读取的照片
    }
  }
  return out
}

function buildPayload(input: ShareInput, images: Record<string, string>): SharePayload {
  const { trip, plans, journals, tracks, expenses, photos } = input
  const days = dateRange(trip.startDate, trip.endDate)
  const extraPhotoDays = Array.from(new Set(photos.map((p) => new Date(p.takenAt).toISOString().slice(0, 10))))
    .filter((d) => !days.includes(d))
    .sort()

  const allDays = [...days, ...extraPhotoDays].sort()

  const payload: SharePayload = {
    trip,
    days: allDays.map((date) => {
      const dayPlans = plans
        .filter((p) => p.date === date)
        .sort((a, b) => (a.time ?? '99:99').localeCompare(b.time ?? '99:99'))
        .map((p) => {
          const meta = PLAN_TYPES.find((t) => t.value === p.type)!
          return {
            time: p.time,
            type: meta.label,
            emoji: meta.emoji,
            title: p.title,
            note: p.note,
            location: p.location
          }
        })
      const dayJournals = journals
        .filter((j) => j.date === date)
        .sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''))
        .map((j) => ({ time: j.time, text: j.text }))
      const dayPhotos = photos
        .filter((p) => new Date(p.takenAt).toISOString().slice(0, 10) === date)
        .sort((a, b) => a.takenAt - b.takenAt)
        .map((p) => ({
          src: images[p.id],
          caption: p.caption,
          time: new Date(p.takenAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
          lat: p.lat,
          lng: p.lng
        }))
      return { date, label: formatDateCN(date), plans: dayPlans, journals: dayJournals, photos: dayPhotos }
    }),
    tracks: tracks.map((t) => ({
      name: t.name,
      distance: t.distance,
      points: t.points.map((p) => [p.lat, p.lng] as [number, number])
    })),
    expenses: expenses
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((e) => {
        const meta = EXPENSE_CATEGORIES.find((c) => c.value === e.category)!
        return {
          date: e.date,
          category: meta.value,
          emoji: meta.emoji,
          label: meta.label,
          amount: e.amount,
          note: e.note
        }
      }),
    total: expenses.reduce((s, e) => s + e.amount, 0),
    stats: {
      days: Math.max(1, days.length),
      photos: photos.length,
      distance: tracks.reduce((s, t) => s + t.distance, 0),
      people: trip.people
    },
    generatedAt: new Date().toLocaleString('zh-CN'),
    author: input.trip.title
  }
  return payload
}

const VIEWER_SCRIPT = String.raw`
(function () {
  var raw = document.getElementById('td-data').textContent;
  var d = JSON.parse(raw);
  var esc = function (s) { return String(s == null ? '' : s).replace(/[<>&"]/g, function (c) { return ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]; }); };
  var $ = function (id) { return document.getElementById(id); };

  // 头部
  $('td-title').textContent = d.trip.title || '旅行日记';
  $('td-sub').textContent = [d.trip.destination, d.trip.startDate + ' 至 ' + d.trip.endDate].filter(Boolean).join(' · ');
  if (d.trip.notes) { $('td-notes').textContent = d.trip.notes; } else { $('td-notes').style.display = 'none'; }

  var firstPhoto = null;
  d.days.forEach(function (day) { firstPhoto = firstPhoto || (day.photos.find(function (p) { return !!p.src; }) || null); });
  if (firstPhoto && firstPhoto.src) { $('td-cover').style.backgroundImage = 'url(' + firstPhoto.src + ')'; }

  $('td-stats').innerHTML = [
    ['天数', d.stats.days],
    ['照片', d.stats.photos],
    ['里程', (d.stats.distance / 1000).toFixed(1) + ' km'],
    ['花费', d.trip.currency === 'CNY' ? '¥' : d.trip.currency + ' ' + Math.round(d.total).toLocaleString('zh-CN')],
    ['人数', d.stats.people]
  ].map(function (x) { return '<div class="stat"><b>' + esc(x[1]) + '</b><span>' + esc(x[0]) + '</span></div>'; }).join('');

  // 按天内容
  var html = '';
  d.days.forEach(function (day) {
    var parts = '';
    day.plans.forEach(function (p) {
      parts += '<div class="row"><span class="t">' + esc(p.time || '') + '</span><span class="tag">' + p.emoji + ' ' + esc(p.type) + '</span><span class="txt' + '">' + esc(p.title) + (p.location ? ' <i>@' + esc(p.location) + '</i>' : '') + '</span></div>';
    });
    day.journals.forEach(function (j) {
      parts += '<div class="note"><span class="t">' + esc(j.time || '') + '</span><p>' + esc(j.text) + '</p></div>';
    });
    var photos = day.photos.filter(function (p) { return !!p.src; });
    if (photos.length) {
      parts += '<div class="grid">' + photos.map(function (p) {
        return '<figure><img loading="lazy" src="' + p.src + '" alt="' + esc(p.caption) + '"/><figcaption>' + esc(p.time) + (p.caption ? ' · ' + esc(p.caption) : '') + '</figcaption></figure>';
      }).join('') + '</div>';
    }
    if (!parts) return;
    html += '<section class="day"><h3>' + esc(day.label) + '</h3>' + parts + '</section>';
  });
  $('td-days').innerHTML = html || '<p class="empty">暂无行程内容</p>';

  // 消费
  if (d.expenses.length) {
    var byCat = {};
    d.expenses.forEach(function (e) { byCat[e.category] = (byCat[e.category] || 0) + e.amount; });
    var rows = Object.keys(byCat).map(function (k) {
      var sample = d.expenses.find(function (e) { return e.category === k; });
      return { k: k, emoji: sample.emoji, label: sample.label, value: byCat[k] };
    }).sort(function (a, b) { return b.value - a.value; });
    var max = rows[0].value || 1;
    $('td-money-list').innerHTML = rows.map(function (r) {
      return '<li><span class="l">' + r.emoji + ' ' + esc(r.label) + '</span><span class="bar"><i style="width:' + Math.round(r.value / max * 100) + '%"></i></span><span class="v">' + Math.round(r.value).toLocaleString('zh-CN') + '</span></li>';
    }).join('');
    $('td-money-total').textContent = Math.round(d.total).toLocaleString('zh-CN');
    $('td-money').style.display = '';
  }

  $('td-generated').textContent = '由「旅行日记」生成于 ' + d.generatedAt;

  // 地图
  var mapPoints = [];
  d.tracks.forEach(function (t) {
    t.points.forEach(function (p) { mapPoints.push(p); });
  });
  d.days.forEach(function (day) {
    day.photos.forEach(function (p) { if (p.lat != null && p.lng != null) { mapPoints.push([p.lat, p.lng]); } });
  });
  if (typeof L === 'undefined' || !mapPoints.length) {
    $('td-map').style.display = 'none';
    return;
  }
  try {
    var map = L.map('map', { scrollWheelZoom: false }).setView(mapPoints[0], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap', maxZoom: 19 }).addTo(map);
    d.tracks.forEach(function (t, i) {
      if (t.points.length < 2) return;
      L.polyline(t.points, { color: '#10b981', weight: 4, opacity: .85 }).addTo(map).bindTooltip(t.name + ' · ' + (t.distance / 1000).toFixed(2) + ' km', { sticky: true });
    });
    d.days.forEach(function (day) {
      day.photos.forEach(function (p) {
        if (p.lat == null || p.lng == null || !p.src) return;
        var icon = L.divIcon({ className: '', iconSize: [32, 32], iconAnchor: [16, 16], html: '<div class="pin" style="background-image:url(' + p.src + ')"></div>' });
        L.marker([p.lat, p.lng], { icon: icon }).addTo(map).bindPopup('<img src="' + p.src + '" style="width:100%;display:block"/><div style="padding:4px 6px;font-size:12px">' + esc(p.caption || day.date) + '</div>');
      });
    });
    map.fitBounds(mapPoints, { padding: [30, 30], maxZoom: 15 });
  } catch (e) {
    $('td-map').style.display = 'none';
  }
})();
`

const VIEWER_STYLE = String.raw`
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif; color: #1e293b; background: #f1f5f9; }
.wrap { max-width: 760px; margin: 0 auto; padding: 0 14px 40px; }
.hero { position: relative; padding: 34px 20px 22px; color: #fff; background: linear-gradient(135deg, #10b981, #0ea5e9); }
.hero .bg { position: absolute; inset: 0; background-size: cover; background-position: center; opacity: .35; }
.hero .inner { position: relative; }
.hero h1 { margin: 0 0 6px; font-size: 24px; letter-spacing: .5px; }
.hero p { margin: 0; opacity: .92; font-size: 13px; }
.hero .notes { margin-top: 10px; padding: 8px 10px; border-radius: 10px; background: rgba(255,255,255,.18); font-size: 12.5px; line-height: 1.6; }
.stats { display: flex; gap: 8px; margin-top: 14px; flex-wrap: wrap; }
.stat { flex: 1; min-width: 62px; padding: 8px 6px; border-radius: 12px; background: rgba(255,255,255,.2); text-align: center; }
.stat b { display: block; font-size: 15px; }
.stat span { font-size: 11px; opacity: .85; }
.card { margin-top: 14px; padding: 14px; border-radius: 16px; background: #fff; box-shadow: 0 1px 2px rgba(16,24,40,.05), 0 8px 24px -14px rgba(16,24,40,.2); }
.card h2 { margin: 0 0 10px; font-size: 14px; color: #334155; }
.day + .day { margin-top: 18px; border-top: 1px dashed #e2e8f0; padding-top: 14px; }
.day h3 { margin: 0 0 8px; font-size: 13px; color: #0f766e; }
.row { display: flex; gap: 8px; align-items: baseline; padding: 5px 0; font-size: 13.5px; }
.row .t { width: 42px; flex: none; color: #94a3b8; font-size: 12px; }
.row .tag { flex: none; padding: 1px 8px; border-radius: 999px; background: #ecfdf5; color: #047857; font-size: 11.5px; }
.row .txt { flex: 1; }
.row i { color: #94a3b8; font-style: normal; font-size: 12px; }
.note { display: flex; gap: 8px; padding: 8px 10px; margin: 6px 0; border-radius: 12px; background: #f8fafc; }
.note .t { color: #94a3b8; font-size: 12px; flex: none; }
.note p { margin: 0; font-size: 13.5px; line-height: 1.65; white-space: pre-wrap; }
.grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; margin-top: 8px; }
figure { margin: 0; position: relative; }
figure img { width: 100%; aspect-ratio: 1/1; object-fit: cover; display: block; border-radius: 8px; background: #e2e8f0; }
figure:nth-child(3n+1) { grid-column: span 1; }
figcaption { position: absolute; left: 4px; bottom: 4px; right: 4px; font-size: 10.5px; color: #fff; text-shadow: 0 1px 3px rgba(0,0,0,.6); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.empty { color: #94a3b8; font-size: 13px; text-align: center; padding: 20px 0; }
ul { list-style: none; margin: 0; padding: 0; }
li { display: flex; align-items: center; gap: 8px; padding: 5px 0; font-size: 13px; }
li .l { width: 66px; flex: none; }
li .bar { flex: 1; height: 8px; border-radius: 999px; background: #f1f5f9; overflow: hidden; }
li .bar i { display: block; height: 100%; border-radius: 999px; background: linear-gradient(90deg, #34d399, #10b981); }
li .v { width: 70px; text-align: right; font-variant-numeric: tabular-nums; }
#map { height: 300px; border-radius: 12px; background: #e2e8f0; }
.pin { width: 32px; height: 32px; border-radius: 999px; border: 2px solid #fff; box-shadow: 0 2px 6px rgba(0,0,0,.3); background-size: cover; background-position: center; }
footer { text-align: center; color: #94a3b8; font-size: 12px; padding: 18px 0 0; }
`

export function buildShareHtml(input: ShareInput, images: Record<string, string>, options: ShareOptions): string {
  const payload = buildPayload(input, images)
  if (!options.includePhotos) {
    for (const day of payload.days) day.photos = []
  }
  if (!options.includeExpenses) {
    payload.expenses = []
  }
  const data = JSON.stringify(payload).replace(/<\//g, '<\\/')

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>分享 · 旅行日记</title>
<style>${VIEWER_STYLE}</style>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
</head>
<body>
<div class="wrap">
  <header class="hero">
    <div class="bg" id="td-cover"></div>
    <div class="inner">
      <h1 id="td-title"></h1>
      <p id="td-sub"></p>
      <div class="notes" id="td-notes"></div>
      <div class="stats" id="td-stats"></div>
    </div>
  </header>

  <section class="card" id="td-map-card">
    <h2>🗺️ 足迹地图</h2>
    <div id="map"></div>
  </section>

  <section class="card">
    <h2>📖 行程日记</h2>
    <div id="td-days"></div>
  </section>

  <section class="card" id="td-money" style="display:none">
    <h2>💰 花费统计（总计 <span id="td-money-total"></span> ）</h2>
    <ul id="td-money-list"></ul>
  </section>

  <footer id="td-generated"></footer>
</div>
<script type="application/json" id="td-data">${data}</script>
<script>${VIEWER_SCRIPT}</script>
</body>
</html>`
}
