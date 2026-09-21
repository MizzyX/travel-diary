import { useState } from 'react'
import type { ReactNode } from 'react'
import QRCode from 'qrcode'
import { Field, Modal } from './ui'
import { useToast } from './Toast'
import { useCloud } from '../state/cloud'
import { buildConfigLink, normalizeUrl } from '../lib/cloudConfig'
import { resetSyncState } from '../lib/sync'
import { formatDateTime } from '../lib/utils'
import sqlText from '../../supabase/schema.sql?raw'

export function CloudPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const cloud = useCloud()
  const toast = useToast()
  const [url, setUrl] = useState(() => cloud.config?.url ?? '')
  const [anonKey, setAnonKey] = useState(() => cloud.config?.anonKey ?? '')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [busy, setBusy] = useState(false)
  const [showSql, setShowSql] = useState(false)
  const [showConfig, setShowConfig] = useState(false)
  const [showQr, setShowQr] = useState(false)
  const [qr, setQr] = useState<string | null>(null)

  const run = async (fn: () => Promise<void>, ok?: string) => {
    setBusy(true)
    try {
      await fn()
      if (ok) toast.show(ok, 'ok')
    } catch (e) {
      toast.show((e as Error).message, 'err')
    } finally {
      setBusy(false)
    }
  }

  const appUrl = window.location.origin + window.location.pathname
  // 二维码里带上云端配置，手机扫码后无需再填 URL / key
  const shareUrl = cloud.config ? buildConfigLink(appUrl, cloud.config) : appUrl

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl)
      toast.show('链接已复制，发给手机打开即可（含云端配置）', 'ok')
    } catch {
      toast.show('复制失败，请手动记录下方文字', 'err')
    }
  }

  const toggleQr = async () => {
    if (showQr) {
      setShowQr(false)
      return
    }
    try {
      const dataUrl = await QRCode.toDataURL(shareUrl, { margin: 1, width: 480 })
      setQr(dataUrl)
      setShowQr(true)
    } catch {
      toast.show('二维码生成失败', 'err')
    }
  }

  const copySql = async () => {
    try {
      await navigator.clipboard.writeText(sqlText)
      toast.show('建表 SQL 已复制，去 Supabase SQL Editor 粘贴执行', 'ok')
    } catch {
      setShowSql(true)
      toast.show('复制失败，请手动展开下方 SQL 复制', 'err')
    }
  }

  return (
    <Modal open={open} title="账户与云同步" onClose={onClose} wide>
      <div className="space-y-4 text-sm text-slate-600">
        {cloud.status === 'unconfigured' && (
          <>
            <div className="rounded-xl bg-slate-50 p-3 text-xs leading-relaxed">
              开启后，你可以在手机和电脑登录<b>同一个账号</b>，行程 / 日记 / 照片 / 账单 / GPS
              足迹自动互相同步。云端使用你自己的 Supabase 免费项目，数据只属于你。
              <ol className="mt-2 list-decimal space-y-1 pl-4">
                <li>打开 supabase.com → New project（免费，选就近区域）</li>
                <li>左侧 SQL Editor → 点下面「复制建表 SQL」→ 粘贴 → Run</li>
                <li>Project Settings → API Keys → 复制 Project URL 和 Publishable key（或 Legacy anon key），填到这里</li>
                <li>
                  建议：Authentication → Sign In / Up → Email → 关掉 Confirm email（免邮件确认，注册即用）
                </li>
              </ol>
            </div>

            <Field label="Project URL">
              <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://xxxx.supabase.co" />
            </Field>
            <Field label="公开 key（anon key 或 sb_publishable_ 开头均可，不要填 secret key）">
              <input
                className="input font-mono text-xs"
                value={anonKey}
                onChange={(e) => setAnonKey(e.target.value)}
                placeholder="sb_publishable_... 或 eyJhbGciOi..."
              />
            </Field>
            <div className="flex flex-wrap gap-2">
              <button
                className="btn-primary"
                disabled={busy || !url.trim() || !anonKey.trim()}
                onClick={() =>
                  run(async () => {
                    cloud.saveConfig({ url: normalizeUrl(url), anonKey })
                  }, '云端配置已保存')
                }
              >
                保存并继续
              </button>
              <button className="btn-ghost" onClick={copySql}>
                复制建表 SQL
              </button>
              <button className="btn-ghost" onClick={() => setShowSql((v) => !v)}>
                {showSql ? '收起 SQL' : '查看 SQL'}
              </button>
            </div>
          </>
        )}

        {cloud.status !== 'unconfigured' && cloud.status === 'signed-out' && (
          <>
            <div className="rounded-xl bg-slate-50 p-3 text-xs leading-relaxed">
              用邮箱注册或登录。<b>手机和电脑用同一个邮箱</b>即可互相同步；本机已有的数据会在首次
              登录时上传到云端，不会丢。
            </div>
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 text-xs font-medium">
              <button
                type="button"
                className={mode === 'in' ? 'rounded-lg bg-white py-1.5 text-slate-800 shadow-sm' : 'rounded-lg py-1.5 text-slate-500'}
                onClick={() => setMode('in')}
              >
                登录
              </button>
              <button
                type="button"
                className={mode === 'up' ? 'rounded-lg bg-white py-1.5 text-slate-800 shadow-sm' : 'rounded-lg py-1.5 text-slate-500'}
                onClick={() => setMode('up')}
              >
                注册新账号
              </button>
            </div>
            <Field label="邮箱">
              <input
                type="email"
                autoComplete="username"
                className="input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </Field>
            <Field label="密码（至少 6 位）">
              <input
                type="password"
                autoComplete={mode === 'up' ? 'new-password' : 'current-password'}
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            <div className="flex flex-wrap gap-2">
              <button
                className="btn-primary"
                disabled={busy || !email.trim() || password.length < 6}
                onClick={() =>
                  run(
                    () => (mode === 'in' ? cloud.signIn(email, password) : cloud.signUp(email, password)),
                    mode === 'in' ? '已登录，正在同步…' : '注册成功，正在同步…'
                  )
                }
              >
                {busy ? '处理中…' : mode === 'in' ? '登录' : '注册并登录'}
              </button>
              <button className="btn-ghost" onClick={() => setShowConfig((v) => !v)}>
                {showConfig ? '收起云端配置' : '修改云端配置'}
              </button>
            </div>
            {mode === 'up' && (
              <p className="rounded-xl bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800">
                若注册后提示“需要验证邮箱”：到 Supabase 后台 <b>Authentication → Sign In / Providers → Email</b>，
                关掉 <b>Confirm email</b>，再回到这里用同一邮箱登录（不用重新注册）。
              </p>
            )}

            {showConfig && (
              <div className="space-y-3 rounded-xl border border-slate-200 p-3">
                <Field label="Project URL">
                  <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} />
                </Field>
                <Field label="anon public key">
                  <input className="input font-mono text-xs" value={anonKey} onChange={(e) => setAnonKey(e.target.value)} />
                </Field>
                {!cloud.fromEnv && (
                  <div className="flex flex-wrap gap-2">
                    <button className="btn-ghost" disabled={busy} onClick={() => run(async () => cloud.saveConfig({ url: normalizeUrl(url), anonKey }), '已保存')}>
                      保存
                    </button>
                    <button className="btn-danger" disabled={busy} onClick={() => run(async () => cloud.resetConfig(), '已断开云端')}>
                      断开云端
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {cloud.status === 'ready' && (
          <>
            <div className="flex items-center justify-between rounded-xl bg-brand-50 px-3 py-2.5 text-xs text-brand-800">
              <div className="min-w-0">
                <div className="truncate font-medium">已登录：{cloud.user?.email}</div>
                <div className="text-brand-700/80">
                  {cloud.syncing
                    ? '同步中…'
                    : cloud.lastSyncAt
                      ? `上次同步 ${formatDateTime(cloud.lastSyncAt)}`
                      : '等待首次同步'}
                </div>
              </div>
              <button className="btn-primary px-2.5 py-1.5 text-xs" disabled={busy || cloud.syncing} onClick={() => run(() => cloud.syncNow(), '同步完成')}>
                {cloud.syncing ? '同步中' : '立即同步'}
              </button>
            </div>

            <div className="rounded-xl bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
              手机和电脑登录同一账号即可互通：在手机上拍的照片、记录的 GPS 轨迹，会自动出现在电脑上。
              改动后约 2 秒自动同步，也可手动点「立即同步」。
            </div>

            {cloud.error && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                {cloud.error}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <button className="btn-ghost" disabled={busy} onClick={() => run(() => cloud.signOut(), '已退出登录')}>
                退出登录
              </button>
              <button
                className="btn-ghost"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    resetSyncState()
                    await cloud.syncNow()
                  }, '已重置同步游标并重新同步')
                }
              >
                强制全量同步
              </button>
              {!cloud.fromEnv && (
                <button className="btn-danger" disabled={busy} onClick={() => run(async () => cloud.resetConfig(), '已断开云端')}>
                  断开云端
                </button>
              )}
            </div>
          </>
        )}

        {cloud.status !== 'unconfigured' && (
          <div className="rounded-xl border border-slate-200 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 text-xs">
                <div className="font-medium text-slate-700">📱 手机扫码打开</div>
                <div className="text-slate-500">手机浏览器打开后用<b>同一邮箱</b>登录，数据自动同步</div>
              </div>
              <button className="btn-ghost shrink-0 px-2.5 py-1.5 text-xs" onClick={() => void toggleQr()}>
                {showQr ? '收起二维码' : '生成二维码'}
              </button>
            </div>
            {showQr && qr && (
              <div className="mt-3 flex flex-col items-center gap-2">
                <img src={qr} alt="扫码打开本应用" className="h-44 w-44 rounded-lg border border-slate-200 bg-white p-1" />
                <p className="break-all text-center text-[11px] text-slate-500">{appUrl}</p>
                <button className="btn-ghost px-2.5 py-1.5 text-xs" onClick={() => void copyLink()}>
                  复制带配置的链接
                </button>
                {appUrl.startsWith('https://') ? (
                  <p className="text-[11px] text-slate-500">HTTPS 已就绪：手机上可记录 GPS 足迹、拍照上传、添加到主屏幕。</p>
                ) : (
                  <p className="text-[11px] text-amber-700">
                    当前是 http 网址，手机能看数据但 GPS 定位会被浏览器拒绝。部署到 HTTPS 后扫码即可记录足迹。
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {showSql && (
          <pre className="max-h-64 overflow-auto rounded-xl bg-slate-900 p-3 text-[11px] leading-relaxed text-slate-100">
            {sqlText}
          </pre>
        )}
      </div>
    </Modal>
  )
}

/** 首页的云同步卡片 */
export function CloudCard() {
  const cloud = useCloud()
  const [open, setOpen] = useState(false)

  const summary =
    cloud.status === 'ready'
      ? `已登录 ${cloud.user?.email ?? ''} · ${cloud.syncing ? '同步中…' : cloud.lastSyncAt ? `上次同步 ${formatDateTime(cloud.lastSyncAt)}` : '等待同步'}`
      : cloud.status === 'signed-out'
        ? '已配置云端，登录后开始多设备同步'
        : '开启后手机 / 电脑登录同一账号即可自动同步（含 GPS 足迹与照片）'

  return (
    <div className="mt-6 card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-700">☁️ 账户与云同步</h3>
          <p className="mt-1 break-words text-xs text-slate-500">{summary}</p>
          {cloud.error && <p className="mt-1 text-xs text-rose-600">{cloud.error}</p>}
        </div>
        <button className="btn-ghost shrink-0 px-2.5 py-1.5 text-xs" onClick={() => setOpen(true)}>
          {cloud.status === 'ready' ? '管理' : '开启'}
        </button>
      </div>
      <CloudPanel open={open} onClose={() => setOpen(false)} />
    </div>
  )
}

/** 顶部的小同步按钮：点开云同步面板 */
export function CloudButton({ className, children }: { className?: string; children?: ReactNode }) {
  const cloud = useCloud()
  const [open, setOpen] = useState(false)
  const tone =
    cloud.status === 'ready'
      ? cloud.syncing
        ? 'text-sky-600'
        : 'text-brand-600'
      : cloud.status === 'signed-out'
        ? 'text-amber-600'
        : 'text-slate-400'

  return (
    <>
      <button className={className} onClick={() => setOpen(true)} title="账户与云同步">
        <span className={tone}>{cloud.status === 'ready' ? (cloud.syncing ? '🔄' : '☁️') : '☁️'}</span>
        {children}
      </button>
      <CloudPanel open={open} onClose={() => setOpen(false)} />
    </>
  )
}
