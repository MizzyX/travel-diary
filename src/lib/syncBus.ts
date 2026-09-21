/** 极简事件总线：数据层改动后通知云端同步，避免 store 与 cloud 相互 import */

type Fn = () => void

let trigger: Fn | null = null

export function setSyncTrigger(fn: Fn | null): void {
  trigger = fn
}

/** 本地数据有变动 → 请求一次同步（内部会防抖） */
export function requestSync(): void {
  trigger?.()
}
