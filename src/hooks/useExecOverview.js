import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { EXEC_E2_RPC } from '../lib/executiveRegistry'
import { buildExecModel } from '../lib/executiveData'

// ดึงสรุปห้องผู้บริหารเฟส E2 จาก RPC เดียว executive_overview(_municipality_id, _from, _to, _keys)
// เรียก 1 ครั้งต่อช่วงเวลา (ช่วงปัจจุบัน = ทุกคีย์ที่ขึ้นจอ · ช่วงก่อนหน้า = เฉพาะ EXEC_PERIOD_KEYS สำหรับลูกศรเทียบ)
// รูปแบบแคช/ตัดคำขอซ้ำเหมือน useExecRpc: แคช 30 วิ · คำขอเดียวกันที่กำลังบินอยู่ใช้ร่วมกัน · ไม่ poll ไม่ subscribe
// (Supabase แผนฟรี egress จำกัด — ผู้ใช้กด "ลองใหม่" หรือเปลี่ยนช่วงเวลาเองเท่านั้น)
//
// สถานะ: idle (ไม่ได้เปิดใช้) · loading · ok · error (เรียกไม่สำเร็จทั้งก้อน) · forbidden (42501: บัญชีนี้ไม่มีสิทธิ์ดูสรุปห้องผู้บริหาร)
// refresh() = ดึงใหม่แบบเงียบ (ห้องผู้บริหารแบบเรียบอัปเดตเองทุก 5 นาที): ไม่ตั้ง status 'loading' จอจึงไม่กระพริบ · พลาด = คงผลเดิม + stale=true
// fetchedAt = เวลา (ms) ที่ได้ผลสำเร็จล่าสุด — หน้าแบบเรียบใช้โชว์ "ล่าสุด HH:MM" และป้าย "ยังอัปเดตไม่ได้"
// ⚠️ ผลดิบเก็บเฉพาะ { today, summaries } — summaries เป็นตัวเลขรวมล้วน (RPC ไม่คืนชื่อคน/ข้อความอิสระ/id รายเรื่อง)
const CACHE_TTL_MS = 30_000
const cache = new Map()
const inflight = new Map()

const FORBIDDEN_CODE = '42501'

/**
 * @param {{ tenantId?: string, profileId?: string, range: { from: string, to: string }, keys: string[], enabled: boolean }} opts
 *   keys ต้องคงที่ข้าม render (useMemo ที่ผู้เรียก) — เรียงแล้ว ตัดซ้ำแล้ว (execSummaryKeys)
 * @returns {{ status: string, today: string|null, summaries: object, model: object, reload: () => void, refresh: () => void, stale: boolean, fetchedAt: number|null }}
 */
export function useExecOverview({ tenantId, profileId, range, keys, enabled }) {
  const keysJson = JSON.stringify(keys ?? [])
  const key = tenantId && profileId && range ? `${tenantId}:${profileId}:${range.from}:${range.to}:${keysJson}` : null
  const active = Boolean(enabled && key && (keys?.length ?? 0) > 0)
  const [reloadTick, setReloadTick] = useState(0)
  const [state, setState] = useState(() => {
    const hit = key && cache.get(key)
    return hit ? { key, status: 'ok', data: hit.data, at: hit.at, stale: false } : { key, status: active ? 'loading' : 'idle', data: null, at: null, stale: false }
  })

  const from = range?.from
  const to = range?.to
  useEffect(() => {
    if (!active) return undefined
    let cancelled = false
    const hit = cache.get(key)
    if (hit && Date.now() - hit.at <= CACHE_TTL_MS) {
      Promise.resolve().then(() => { if (!cancelled) setState({ key, status: 'ok', data: hit.data, at: hit.at, stale: false }) })
      return () => { cancelled = true }
    }
    let request = inflight.get(key)
    if (!request) {
      request = Promise.resolve()
        .then(() => supabase.rpc(EXEC_E2_RPC, { _municipality_id: tenantId, _from: from, _to: to, _keys: JSON.parse(keysJson) }))
        .catch((error) => ({ error }))
        .finally(() => { if (inflight.get(key) === request) inflight.delete(key) })
      inflight.set(key, request)
    }
    request.then((result) => {
      if (cancelled) return
      if (result.error?.code === FORBIDDEN_CODE) {
        setState({ key, status: 'forbidden', data: null, at: null, stale: false })
        return
      }
      if (result.error || result.data == null || typeof result.data !== 'object') {
        console.error(`${EXEC_E2_RPC} error:`, result.error?.message ?? 'empty response')
        // รีเฟรชแล้วพลาด แต่เคยได้ผลมาแล้วของ key เดิม = คงผลเดิมไว้ (ไม่ให้การ์ดทั้งหน้าหายเพราะเน็ตสะดุดครั้งเดียว)
        // ดูที่ prev.data ไม่ใช่ prev.status — reload() ตั้งสถานะเป็น 'loading' (เก็บ data เดิมไว้) ก่อนยิงใหม่ทุกครั้ง
        // ถ้าเช็ก status === 'ok' เงื่อนไขนี้จะไม่มีวันเป็นจริงหลังกด "ลองใหม่" (code review #685)
        // stale = true ให้หน้าแบบเรียบบอกว่า "ยังอัปเดตไม่ได้" (ตัวเลขที่เห็นเป็นของรอบก่อน)
        setState((prev) => (prev.key === key && prev.data ? { key, status: 'ok', data: prev.data, at: prev.at, stale: true } : { key, status: 'error', data: null, at: null, stale: false }))
        return
      }
      const data = { today: typeof result.data.today === 'string' ? result.data.today : null, summaries: result.data.summaries ?? {} }
      const at = Date.now()
      cache.set(key, { at, data })
      setState({ key, status: 'ok', data, at, stale: false })
    })
    return () => { cancelled = true }
  }, [active, key, tenantId, from, to, keysJson, reloadTick])

  const reload = useCallback(() => {
    if (key) { cache.delete(key); inflight.delete(key) }
    setState((prev) => (prev.key === key ? { ...prev, key, status: 'loading' } : prev))
    setReloadTick((tick) => tick + 1)
  }, [key])

  // ดึงใหม่แบบเงียบ: ทิ้งแคชแล้วยิงใหม่ แต่ไม่แตะ status (จอไม่กระพริบเป็น loading) — ผู้เรียกคุมเงื่อนไขเวลา/แท็บที่มองเห็นเอง (useExecAutoRefresh)
  const refresh = useCallback(() => {
    if (key) { cache.delete(key); inflight.delete(key) }
    setReloadTick((tick) => tick + 1)
  }, [key])

  // เปลี่ยน อปท./บัญชี/ช่วงเวลา/คีย์ระหว่างที่ component ยังอยู่ → ห้ามแสดงค่าของ key ก่อนหน้า
  const current = state.key === key ? state : { status: active ? 'loading' : 'idle', data: null, at: null, stale: false }
  const status = active ? current.status : 'idle'
  const data = active ? current.data : null
  const summaries = data?.summaries
  const model = useMemo(() => buildExecModel(summaries), [summaries])
  return { status, today: data?.today ?? null, summaries: summaries ?? {}, model, reload, refresh, stale: active ? current.stale : false, fetchedAt: active ? current.at : null }
}
