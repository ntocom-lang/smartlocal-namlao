import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fiscalYearOfIso } from '../lib/localPlanView'

// ข้อมูลตั้งต้นของ "กำหนดตามระเบียบ" ของแผนพัฒนาท้องถิ่น ในห้องผู้บริหารแบบเรียบ — อ่านเฉพาะคอลัมน์ที่ใช้ 3 ตาราง (viewer/ปลัดอ่านได้ตาม RLS local_plan_can_read)
//   local_dev_plans (แผนพัฒนาที่ใช้อยู่) · local_op_plans (แผนการดำเนินงานฉบับหลักของปีงบนี้) · local_plan_evaluations (ผลติดตามและประเมินผลของปีงบที่เพิ่งจบ)
// ไม่มี SQL/RPC ใหม่ · ตัวคำนวณวัน/ข้อความอยู่ใน src/lib/execSimpleInsights.js (ใช้สูตรของเมนูแผนพัฒนาเดิม)
// ทุก query กรอง municipality_id เอง (superadmin อ่านได้ทุก อปท. — ไม่กรองจะปนกัน)
// throttle 30 นาที ตาม tick ของหน้าแม่ (ข้อมูลนี้เปลี่ยนเป็นวัน/สัปดาห์) · tick ถี่กว่านี้ข้าม · ไม่มี interval ของตัวเอง
// ดึงพลาดหลังเคยได้ผล = คงข้อมูลเดิม (stale) · ดึงพลาดครั้งแรก = status 'error' (หน้าจอบอกตรงๆ ไม่ซ่อนเงียบ)
export const PLAN_DEADLINES_MIN_MS = 30 * 60 * 1000

async function load(tenantId, fiscalYear) {
  const dev = await supabase.from('local_dev_plans').select('id, year_from, year_to, status, is_current')
    .eq('municipality_id', tenantId).eq('is_current', true).maybeSingle()
  if (dev.error) throw dev.error
  const devPlan = dev.data ?? null
  // ไม่มีแผนพัฒนาที่ใช้อยู่ = อปท. นี้ไม่ได้ใช้เมนูแผนพัฒนา ไม่ต้องถามต่อ (ประหยัด egress)
  if (!devPlan) return { devPlan: null, opPlan: null, evaluation: null }
  const [op, evaluation] = await Promise.all([
    supabase.from('local_op_plans').select('fiscal_year, kind, status, basis, basis_on, extended_due_on, published_on')
      .eq('municipality_id', tenantId).eq('dev_plan_id', devPlan.id).eq('fiscal_year', fiscalYear).eq('kind', 'main').maybeSingle(),
    supabase.from('local_plan_evaluations').select('fiscal_year, reported_to_exec_on, presented_on, announced_on')
      .eq('municipality_id', tenantId).eq('fiscal_year', fiscalYear - 1).maybeSingle(),
  ])
  if (op.error) throw op.error
  if (evaluation.error) throw evaluation.error
  return { devPlan, opPlan: op.data ?? null, evaluation: evaluation.data ?? null }
}

/**
 * @param {{ tenantId?: string, today: string, enabled: boolean, tick: number }} opts  today = YYYY-MM-DD เวลาไทย
 * @returns {{ status: 'idle'|'loading'|'ok'|'error', devPlan: object|null, opPlan: object|null, evaluation: object|null, stale: boolean, reload: () => void }}
 *   evaluation: null = อ่านได้แต่ไม่มีแถวของปีงบที่ประเมิน (ยังไม่ทำ) · status ไม่ใช่ 'ok' = ยังไม่รู้
 */
export default function useExecPlanDeadlines({ tenantId, today, enabled, tick }) {
  const fiscalYear = fiscalYearOfIso(today)
  const active = Boolean(enabled && tenantId && fiscalYear)
  const key = active ? `${tenantId}:${fiscalYear}` : null
  const [retryTick, setRetryTick] = useState(0)
  const [state, setState] = useState({ key: null, status: 'idle', data: null, stale: false })
  // เวลาที่ได้ผลสำเร็จล่าสุดต่อ key + รอบที่กำลังดึง (กันดึงซ้อน / StrictMode)
  const lastRef = useRef({ key: null, at: 0, running: false, force: false })

  useEffect(() => {
    if (!key) return undefined
    const last = lastRef.current
    if (last.key !== key) { last.key = key; last.at = 0; last.running = false; last.force = false }
    if (last.running) return undefined
    if (!last.force && Date.now() - last.at < PLAN_DEADLINES_MIN_MS) return undefined
    last.force = false
    last.running = true
    let cancelled = false
    load(tenantId, fiscalYear).then((data) => {
      if (cancelled) return
      last.running = false
      last.at = Date.now()
      setState({ key, status: 'ok', data, stale: false })
    }).catch((error) => {
      if (cancelled) return
      last.running = false
      console.error('[executive] plan deadlines:', error?.message ?? error)
      setState((prev) => (prev.key === key && prev.status === 'ok' ? { ...prev, stale: true } : { key, status: 'error', data: null, stale: false }))
    })
    return () => { cancelled = true; last.running = false }
  }, [key, tenantId, fiscalYear, tick, retryTick])

  const reload = useCallback(() => {
    lastRef.current.force = true
    setState((prev) => (prev.status === 'error' ? { ...prev, status: 'loading' } : prev))
    setRetryTick((t) => t + 1)
  }, [])

  if (!key) return { status: 'idle', devPlan: null, opPlan: null, evaluation: null, stale: false, reload }
  if (state.key !== key) return { status: 'loading', devPlan: null, opPlan: null, evaluation: null, stale: false, reload }
  return { status: state.status, devPlan: state.data?.devPlan ?? null, opPlan: state.data?.opPlan ?? null, evaluation: state.data?.evaluation ?? null, stale: state.stale, reload }
}
