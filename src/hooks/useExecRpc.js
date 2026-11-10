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
 * @returns {{ status: 'idle'|'loading'|'ok'|'error', data: any, reload: () => void }}
 *   idle = ไม่ได้เปิดใช้ · reload = ทิ้งแคชแล้วดึงใหม่ (ปุ่ม "ลองใหม่")
 */
export function useExecRpc({ rpc, args, tenantId, profileId, enabled }) {
  const argsJson = JSON.stringify(args ?? {})
  const key = tenantId && profileId ? `${rpc}:${tenantId}:${profileId}:${argsJson}` : null
  const active = Boolean(enabled && key)
  const [reloadTick, setReloadTick] = useState(0)
  const [state, setState] = useState(() => {
    const hit = key && cache.get(key)
    return hit ? { key, status: 'ok', data: hit.data } : { key, status: active ? 'loading' : 'idle', data: null }
  })

  useEffect(() => {
    if (!active) return undefined
    let cancelled = false
    const hit = cache.get(key)
    if (hit && Date.now() - hit.at <= CACHE_TTL_MS) {
      // แคชยังสด: ค่าเริ่มต้นของ state ถูกตั้งไว้แล้วถ้ามาจาก mount แต่ถ้าเปลี่ยนช่วงเวลา key ใหม่ต้องอ่านจากแคชด้วย
      Promise.resolve().then(() => { if (!cancelled) setState({ key, status: 'ok', data: hit.data }) })
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
        setState((prev) => (prev.key === key && prev.status === 'ok' ? prev : { key, status: 'error', data: null }))
        return
      }
      const project = PROJECTIONS[rpc]
      const data = project ? project(result.data) : result.data
      cache.set(key, { at: Date.now(), data })
      setState({ key, status: 'ok', data })
    })
    return () => { cancelled = true }
  }, [active, rpc, key, argsJson, reloadTick])

  const reload = useCallback(() => {
    if (key) { cache.delete(key); inflight.delete(key) }
    setState((prev) => (prev.key === key ? { key, status: 'loading', data: prev.data } : prev))
    setReloadTick((tick) => tick + 1)
  }, [key])

  // เปลี่ยน อปท./บัญชี/ช่วงเวลาระหว่างที่ component ยังอยู่ → ห้ามแสดงค่าของ key ก่อนหน้า
  if (state.key !== key) return { status: active ? 'loading' : 'idle', data: null, reload }
  return { status: active ? state.status : 'idle', data: active ? state.data : null, reload }
}
