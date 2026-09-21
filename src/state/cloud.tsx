import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { User } from '@supabase/supabase-js'
import { getClient, resetClient } from '../lib/supabase'
import type { CloudConfig } from '../lib/cloudConfig'
import { clearCloudConfig, configFromEnv, consumeConfigFromUrl, getCloudConfig, saveCloudConfig } from '../lib/cloudConfig'
import { resetSyncState, runSync } from '../lib/sync'
import { setSyncTrigger } from '../lib/syncBus'
import { useStore } from './store'

export type CloudStatus = 'unconfigured' | 'signed-out' | 'ready'

interface CloudApi {
  config: CloudConfig | null
  fromEnv: boolean
  user: User | null
  status: CloudStatus
  syncing: boolean
  lastSyncAt: number | null
  error: string | null
  saveConfig: (config: CloudConfig) => void
  resetConfig: () => void
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  syncNow: () => Promise<void>
}

const CloudContext = createContext<CloudApi | null>(null)

export function useCloud(): CloudApi {
  const ctx = useContext(CloudContext)
  if (!ctx) throw new Error('useCloud 必须在 CloudProvider 内使用')
  return ctx
}

const AUTO_SYNC_INTERVAL = 60_000

export function CloudProvider({ children }: { children: ReactNode }) {
  const { reload } = useStore()
  const [config, setConfig] = useState<CloudConfig | null>(() => getCloudConfig())
  const [user, setUser] = useState<User | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const timerRef = useRef<number | null>(null)
  const userRef = useRef<User | null>(null)

  useEffect(() => {
    userRef.current = user
  }, [user])

  // 扫码/链接带来的 ?cfg= 配置：首次进入时自动接管
  useEffect(() => {
    if (configFromEnv()) return
    const imported = consumeConfigFromUrl()
    if (!imported) return
    resetClient()
    resetSyncState()
    setConfig(imported)
  }, [])

  const doSync = useCallback(async () => {
    if (!userRef.current) return
    setSyncing(true)
    setError(null)
    try {
      const res = await runSync()
      if (res) {
        setLastSyncAt(res.at)
        if (res.pulled > 0) await reload()
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSyncing(false)
    }
  }, [reload])

  // 本地有改动 → 2.5s 防抖后同步
  useEffect(() => {
    let t: number | undefined
    setSyncTrigger(() => {
      window.clearTimeout(t)
      t = window.setTimeout(() => void doSync(), 2500)
    })
    return () => {
      window.clearTimeout(t)
      setSyncTrigger(null)
    }
  }, [doSync])

  // 读取登录态
  useEffect(() => {
    const sb = getClient()
    if (!sb) {
      setUser(null)
      return
    }
    let alive = true
    void sb.auth.getSession().then(({ data }) => {
      if (alive) setUser(data.session?.user ?? null)
    })
    const { data: sub } = sb.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })
    return () => {
      alive = false
      sub.subscription.unsubscribe()
    }
  }, [config])

  // 登录后：立即同步 + 定时同步 + 回到前台/恢复网络时同步
  useEffect(() => {
    if (!user) return
    void doSync()
    const timer = window.setInterval(() => void doSync(), AUTO_SYNC_INTERVAL)
    timerRef.current = timer
    const onWake = () => {
      if (document.visibilityState === 'visible') void doSync()
    }
    document.addEventListener('visibilitychange', onWake)
    window.addEventListener('online', onWake)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onWake)
      window.removeEventListener('online', onWake)
    }
  }, [user, doSync])

  const saveConfig = useCallback((next: CloudConfig) => {
    saveCloudConfig(next)
    resetClient()
    resetSyncState()
    setConfig(getCloudConfig())
    setLastSyncAt(null)
  }, [])

  const resetConfig = useCallback(() => {
    clearCloudConfig()
    resetClient()
    resetSyncState()
    setConfig(getCloudConfig())
    setUser(null)
    setLastSyncAt(null)
  }, [])

  const auth = async (mode: 'in' | 'up', email: string, password: string) => {
    const sb = getClient()
    if (!sb) throw new Error('还没有填写云端配置')
    setError(null)
    const call =
      mode === 'in'
        ? sb.auth.signInWithPassword({ email: email.trim(), password })
        : sb.auth.signUp({ email: email.trim(), password })
    const { data, error: err } = await call
    if (err) throw new Error(describeAuthError(err.message))
    if (!data.session) {
      throw new Error('账号已创建，但云端要求验证邮箱：请到邮箱点确认链接，或在 Supabase 后台关闭 Confirm email 后直接点「登录」')
    }
    setUser(data.session.user)
    await reload()
  }

  const value = useMemo<CloudApi>(
    () => ({
      config,
      fromEnv: configFromEnv(),
      user,
      status: !config ? 'unconfigured' : user ? 'ready' : 'signed-out',
      syncing,
      lastSyncAt,
      error,
      saveConfig,
      resetConfig,
      signIn: (email, password) => auth('in', email, password),
      signUp: (email, password) => auth('up', email, password),
      signOut: async () => {
        const sb = getClient()
        if (sb) await sb.auth.signOut()
        setUser(null)
        setLastSyncAt(null)
        await reload()
      },
      syncNow: doSync
    }),
    [config, user, syncing, lastSyncAt, error, saveConfig, resetConfig, doSync, reload]
  )

  return <CloudContext.Provider value={value}>{children}</CloudContext.Provider>
}

function describeAuthError(message: string): string {
  if (/Invalid login credentials/i.test(message)) return '邮箱或密码不正确（若从未注册过，请切到「注册新账号」）'
  if (/Email not confirmed/i.test(message)) return '邮箱未验证，请到邮箱点确认链接，或在 Supabase 后台关闭邮箱确认'
  if (/rate limit|For security purposes|over_email_send_rate_limit/i.test(message))
    return '发送太频繁：Supabase 免费版邮件每小时有限额，稍等几分钟再试，或直接关闭 Confirm email'
  if (/signups not allowed|Signups not allowed|Email signups are disabled/i.test(message))
    return '该项目关闭了邮箱注册：Authentication → Sign In / Providers → Email 打开 Enable email provider'
  if (/User already registered/i.test(message)) return '该邮箱已注册，请直接登录'
  if (/Password should be at least/i.test(message)) return '密码至少 6 位'
  if (/failed to fetch|NetworkError/i.test(message)) return '连不上云端，检查网址/key 或网络'
  return message
}
