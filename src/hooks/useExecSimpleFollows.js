import { useCallback, useEffect, useState } from 'react'
import { loadMyFollows } from '../lib/execFollowNudge'

// "เรื่องที่ท่านติดตาม" ของห้องผู้บริหารแบบเรียบ — exec_my_follows (RPC เดิมของ E3-2) เรียกตอนเปิดหน้า + ทุกครั้งที่ tick เปลี่ยน
// tick = ตัวนับรอบอัปเดตเอง (useExecAutoRefresh ผ่านหน้าแม่) · รอบอัปเดตเงียบ: ไม่ตั้ง 'loading' · พลาดหลังเคยได้ผล = คงรายการเดิม + stale=true
// สถานะ: idle · loading (ครั้งแรก/กดลองใหม่) · ok · error
/**
 * @param {{ tenantId?: string, enabled: boolean, tick: number }} opts
 * @returns {{ status: string, rows: object[], stale: boolean, fetchedAt: number|null, reload: () => void }}
 */
export default function useExecSimpleFollows({ tenantId, enabled, tick }) {
  const active = Boolean(enabled && tenantId)
  const [retryTick, setRetryTick] = useState(0)
  const [state, setState] = useState({ tenantId: null, status: 'idle', rows: [], stale: false, at: null })

  useEffect(() => {
    if (!active) return undefined
    let cancelled = false
    loadMyFollows(tenantId).then((rows) => {
      if (!cancelled) setState({ tenantId, status: 'ok', rows, stale: false, at: Date.now() })
    }).catch((error) => {
      if (cancelled) return
      console.error('exec_my_follows error:', error?.cause?.message ?? error?.message)
      setState((prev) => (prev.tenantId === tenantId && prev.status === 'ok' ? { ...prev, stale: true } : { tenantId, status: 'error', rows: [], stale: false, at: null }))
    })
    return () => { cancelled = true }
  }, [active, tenantId, tick, retryTick])

  const reload = useCallback(() => {
    setState((prev) => (prev.status === 'error' ? { ...prev, status: 'loading' } : prev))
    setRetryTick((t) => t + 1)
  }, [])

  if (!active) return { status: 'idle', rows: [], stale: false, fetchedAt: null, reload }
  if (state.tenantId !== tenantId) return { status: 'loading', rows: [], stale: false, fetchedAt: null, reload }
  return { status: state.status, rows: state.rows, stale: state.stale, fetchedAt: state.at, reload }
}
