import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { addDays } from '../lib/complaintReportPeriods'
import { EXEC_SCHEDULE_DAYS, execToday } from '../lib/executiveData'
import { loadPersonalEvents } from '../lib/personalEventsApi'
import { canUsePersonalEvents } from '../lib/personalEvents'

// ข้อมูลประกอบของห้องผู้บริหารที่ไม่ได้มาจาก executive_overview — โหลดครั้งเดียวตอนเปิดหน้า ไม่ poll ไม่ subscribe
// สถานะ: idle · loading · ok · error — ส่วนไหนพังขึ้น "โหลดไม่ได้" เฉพาะส่วนนั้น

/**
 * กิจกรรมที่ท่านเห็นในปฏิทิน + รายการส่วนตัวของท่าน (personal_events) ช่วงวันนี้ถึงอีก EXEC_SCHEDULE_DAYS วัน
 * กิจกรรมหน่วยงานมาจาก RPC list_events_for_staff_between (E2.1) — ห่อ list_events_for_staff ตัวเดียวกับหน้าปฏิทิน
 * (ใครเห็นอะไรชุดเดียวกัน) แต่ฐานข้อมูลกรองช่วงวันให้ และคืนแค่ id/title/event_date/end_date/event_time
 * เดิมดึง list_events_for_staff ทั้งหมด (ทุกปี + รายละเอียด/ไฟล์แนบ/ผู้รับมอบหมาย) แล้วกรองในเบราว์เซอร์ — กิน Egress แผนฟรีตามจำนวนกิจกรรมสะสม
 * รายการส่วนตัวเป็นของท่านคนเดียว (RLS) จึงยังโหลดทั้งหมดผ่าน loadPersonalEvents ตัวเดียวกับหน้าปฏิทิน แล้วกรองที่นี่
 * รายการส่วนตัวพลาด = แสดงเฉพาะกิจกรรมของหน่วยงาน (เหมือนหน้าปฏิทิน) · ตัวกิจกรรมหน่วยงานพลาด = error
 * refresh() = ดึงใหม่แบบเงียบ (ไม่ตั้ง 'loading') สำหรับห้องผู้บริหารแบบเรียบที่อัปเดตเองทุก 5 นาที · พลาดหลังเคยได้ผล = คงรายการเดิม + stale=true
 * @returns {{ status: string, events: object[], reload: () => void, refresh: () => void, stale: boolean, fetchedAt: number|null }}
 */
export function useExecSchedule({ tenantId, profileId, role, enabled }) {
  const key = tenantId && profileId ? `${tenantId}:${profileId}` : null
  const active = Boolean(enabled && key)
  const [reloadTick, setReloadTick] = useState(0)
  const [state, setState] = useState({ key: null, status: 'idle', events: [], at: null, stale: false })

  useEffect(() => {
    if (!active) return undefined
    let cancelled = false
    const today = execToday()
    const usePersonal = canUsePersonalEvents(role)
    Promise.all([
      Promise.resolve().then(() => supabase.rpc('list_events_for_staff_between', {
        p_municipality_id: tenantId, p_from: today, p_to: addDays(today, EXEC_SCHEDULE_DAYS),
      })),
      usePersonal ? loadPersonalEvents(tenantId, profileId).catch((error) => ({ rows: [], error })) : Promise.resolve({ rows: [], error: null }),
    ]).then(([org, personal]) => {
      if (cancelled) return
      if (org.error) {
        console.error('[executive] list_events_for_staff_between:', org.error.message)
        setState((prev) => (prev.key === key && prev.status === 'ok' ? { ...prev, stale: true } : { key, status: 'error', events: [], at: null, stale: false }))
        return
      }
      if (personal.error) console.error('[executive] personal_events:', personal.error.message)
      const slim = [...(org.data ?? []), ...(personal.rows ?? [])]
        .filter((ev) => ev?.event_date && (ev.end_date || ev.event_date) >= today)
        .map((ev) => ({
          id: ev.id, title: ev.title, event_date: ev.event_date, end_date: ev.end_date ?? null,
          event_time: ev.event_time ?? null, is_personal: ev.is_personal === true,
        }))
      setState({ key, status: 'ok', events: slim, at: Date.now(), stale: false })
    }).catch((error) => {
      if (cancelled) return
      console.error('[executive] schedule:', error?.message ?? error)
      setState((prev) => (prev.key === key && prev.status === 'ok' ? { ...prev, stale: true } : { key, status: 'error', events: [], at: null, stale: false }))
    })
    return () => { cancelled = true }
  }, [active, key, tenantId, profileId, role, reloadTick])

  const reload = useCallback(() => {
    setState((prev) => (prev.key === key ? { ...prev, status: 'loading' } : prev))
    setReloadTick((t) => t + 1)
  }, [key])
  // ดึงใหม่แบบเงียบ: ไม่แตะ status (จอไม่กระพริบ) — ผู้เรียกคุมเงื่อนไขเวลา/แท็บที่มองเห็นเอง (useExecAutoRefresh)
  const refresh = useCallback(() => { setReloadTick((t) => t + 1) }, [])

  if (!active) return { status: 'idle', events: [], reload, refresh, stale: false, fetchedAt: null }
  if (state.key !== key) return { status: 'loading', events: [], reload, refresh, stale: false, fetchedAt: null }
  return { status: state.status, events: state.events, reload, refresh, stale: state.stale, fetchedAt: state.at }
}

/**
 * จำนวนรีวิวสถานที่ที่เขียนในช่วงที่เลือก (kpi new_reviews) — นับด้วย count head:true ไม่ดึงเนื้อรีวิว (ไม่มีข้อความ/ชื่อผู้รีวิวผ่านมาเลย)
 * ช่วงนับตามวันปฏิทินไทย: [from 00:00, to+1 00:00) เวลา +07:00
 * @returns {{ status: string, count: number|null, reload: () => void }}
 */
export function useExecReviewCount({ tenantId, range, enabled }) {
  const from = range?.from
  const to = range?.to
  const key = tenantId && from && to ? `${tenantId}:${from}:${to}` : null
  const active = Boolean(enabled && key)
  const [reloadTick, setReloadTick] = useState(0)
  const [state, setState] = useState({ key: null, status: 'idle', count: null })

  useEffect(() => {
    if (!active) return undefined
    let cancelled = false
    Promise.resolve()
      .then(() => supabase.from('tourism_reviews').select('id', { count: 'exact', head: true })
        .eq('municipality_id', tenantId)
        .gte('created_at', `${from}T00:00:00+07:00`)
        .lt('created_at', `${addDays(to, 1)}T00:00:00+07:00`))
      .then(({ count, error }) => {
        if (cancelled) return
        if (error || typeof count !== 'number') {
          console.error('[executive] tourism_reviews count:', error?.message ?? 'no count')
          setState({ key, status: 'error', count: null })
          return
        }
        setState({ key, status: 'ok', count })
      })
      .catch((error) => {
        if (cancelled) return
        console.error('[executive] tourism_reviews count:', error?.message ?? error)
        setState({ key, status: 'error', count: null })
      })
    return () => { cancelled = true }
  }, [active, key, tenantId, from, to, reloadTick])

  const reload = useCallback(() => {
    setState((prev) => (prev.key === key ? { ...prev, status: 'loading' } : prev))
    setReloadTick((t) => t + 1)
  }, [key])

  if (!active) return { status: 'idle', count: null, reload }
  if (state.key !== key) return { status: 'loading', count: null, reload }
  return { status: state.status, count: state.count, reload }
}
