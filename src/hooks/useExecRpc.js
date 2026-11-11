import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { projectComplaintRows, projectDocRows } from '../lib/executiveData'

// ดึงข้อมูลห้องผู้บริหารจาก RPC — แต่ละส่วนของหน้าเรียกแยกกัน ส่วนไหนพังส่วนอื่นไม่กระทบ (ดู status/reload)
//
// ทำไมไม่ใช้ useHomeRpc: RPC ของคำขอ (doc_requests_public_fy) คืนคอลัมน์ purpose ซึ่งเป็นข้อความที่ผู้ยื่นพิมพ์เอง
// useHomeRpc เก็บผลดิบลงแคชในหน่วยความจำ ห้องนี้ห้ามเก็บ purpose ลง state/แคชเลย (PDPA) จึงกรองคอลัมน์ "ก่อนเก็บ"
// ที่นี่ (PROJECTIONS) — รูปแบบแคช/ตัดคำขอซ้ำเหมือน useHomeRpc: ไม่ poll ไม่ subscribe (Supabase แผนฟรี egress จำกัด)
const CACHE_TTL_MS = 30_000
const cache = new Map()
const inflight = new Map()

// ตัวกรองคอลัมน์รายเรื่องก่อนเก็บ — RPC ที่ไม่อยู่ในนี้เก็บผลทั้งก้อน (สถิติรวม/ยอดนับ ไม่มีข้อมูลรายคน)
const PROJECTIONS = Object.freeze({
  doc_requests_public_fy: projectDocRows,
  complaints_public_fy: projectComplaintRows,
})

/**
 * @param {{ rpc: string, args: object, tenantId?: string, profileId?: string, enabled: boolean }} opts
 * @returns {{ status: 'idle'|'loading'|'ok'|'error', data: any, reload: () => void, refresh: () => void, stale: boolean, fetchedAt: number|null }}
 *   idle = ไม่ได้เปิดใช้ · reload = ทิ้งแคชแล้วดึงใหม่ (ปุ่ม "ลองใหม่")
 *   refresh = ดึงใหม่แบบเงียบ (ไม่ตั้ง 'loading' จอไม่กระพริบ — ห้องผู้บริหารแบบเรียบอัปเดตเองทุก 5 นาที) · พลาด = คงผลเดิม + stale=true
 */
export function useExecRpc({ rpc, args, tenantId, profileId, enabled }) {
  const argsJson = JSON.stringify(args ?? {})
  const key = tenantId && profileId ? `${rpc}:${tenantId}:${profileId}:${argsJson}` : null
  const active = Boolean(enabled && key)
  const [reloadTick, setReloadTick] = useState(0)
  const [state, setState] = useState(() => {
    const hit = key && cache.get(key)
    return hit ? { key, status: 'ok', data: hit.data, at: hit.at, stale: false } : { key, status: active ? 'loading' : 'idle', data: null, at: null, stale: false }
  })

  useEffect(() => {
    if (!active) return undefined
    let cancelled = false
    const hit = cache.get(key)
    if (hit && Date.now() - hit.at <= CACHE_TTL_MS) {
      // แคชยังสด: ค่าเริ่มต้นของ state ถูกตั้งไว้แล้วถ้ามาจาก mount แต่ถ้าเปลี่ยนช่วงเวลา key ใหม่ต้องอ่านจากแคชด้วย
      Promise.resolve().then(() => { if (!cancelled) setState({ key, status: 'ok', data: hit.data, at: hit.at, stale: false }) })
      return () => { cancelled = true }
    }
    let request = inflight.get(key)
    if (!request) {
      request = Promise.resolve().then(() => supabase.rpc(rpc, JSON.parse(argsJson)))
        .catch((error) => ({ error }))
        .finally(() => { if (inflight.get(key) === request) inflight.delete(key) })
      inflight.set(key, request)
    }
    request.then((result) => {
      if (cancelled) return
      if (result.error || result.data == null) {
        console.error(`${rpc} error:`, result.error?.message ?? 'empty response')
        // เคยได้ผลของ key เดิมแล้ว = คงผลเดิมไว้ (ดูที่ prev.data ไม่ใช่ prev.status — reload() ตั้งสถานะ 'loading' โดยเก็บ data เดิมไว้ก่อนยิงใหม่)
        // ทำให้ตัวเลขที่เคยโชว์ไม่หายเพราะเน็ตสะดุดครั้งเดียว · stale = true ให้ผู้เรียกบอกว่า "ยังอัปเดตไม่ได้"
        setState((prev) => (prev.key === key && prev.data != null ? { key, status: 'ok', data: prev.data, at: prev.at, stale: true } : { key, status: 'error', data: null, at: null, stale: false }))
        return
      }
      const project = PROJECTIONS[rpc]
      const data = project ? project(result.data) : result.data
      const at = Date.now()
      cache.set(key, { at, data })
      setState({ key, status: 'ok', data, at, stale: false })
    })
    return () => { cancelled = true }
  }, [active, rpc, key, argsJson, reloadTick])

  const reload = useCallback(() => {
    if (key) { cache.delete(key); inflight.delete(key) }
    setState((prev) => (prev.key === key ? { ...prev, key, status: 'loading' } : prev))
    setReloadTick((tick) => tick + 1)
  }, [key])

  // ดึงใหม่แบบเงียบ: ทิ้งแคชแล้วยิงใหม่ ไม่แตะ status — ผู้เรียกคุมเงื่อนไขเวลา/แท็บที่มองเห็นเอง (useExecAutoRefresh)
  const refresh = useCallback(() => {
    if (key) { cache.delete(key); inflight.delete(key) }
    setReloadTick((tick) => tick + 1)
  }, [key])

  // เปลี่ยน อปท./บัญชี/ช่วงเวลาระหว่างที่ component ยังอยู่ → ห้ามแสดงค่าของ key ก่อนหน้า
  if (state.key !== key) return { status: active ? 'loading' : 'idle', data: null, reload, refresh, stale: false, fetchedAt: null }
  return {
    status: active ? state.status : 'idle', data: active ? state.data : null, reload, refresh,
    stale: active ? state.stale : false, fetchedAt: active ? state.at : null,
  }
}
