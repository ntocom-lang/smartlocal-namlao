import { useCallback, useEffect, useState } from 'react'
import {
  fetchCivilStages, fetchDepartments, fetchDevPlans, fetchOpItems, fetchPlanData, fetchProgress,
} from '../lib/localPlanApi'
import {
  buildProgressRows, civilStageMap, effectiveItemSet, effectivePlans, publishedFiscalYears, summarize,
} from '../lib/localPlanProgress'
import { fiscalYearOfIso } from '../lib/localPlanView'
import { execToday, planResultMissingCount } from '../lib/executiveData'

// % ดำเนินการตามแผนรายกอง (โซน ⑤) — ใช้ตัวโหลด + ตัวคำนวณเดียวกับแท็บ "ติดตามผล" ของเมนูแผนพัฒนาท้องถิ่น
// (localPlanApi.js + localPlanProgress.js: effectiveItemSet → buildProgressRows → summarize groupBy 'department')
// ห้ามเขียน query/สูตรสายรายการ/ขั้นก่อสร้างใหม่ที่นี่ — ผู้บริหารอ่านตารางแผนได้ตาม RLS (local_plan_can_read) อยู่แล้ว
// ลำดับเดียวกับ LocalPlanModule + ProgressTab: แผนที่เมนูแสดง (is_current ไม่มีก็ฉบับล่าสุด) → ปีงบ = ปีนี้ถ้ามีฉบับประกาศ ไม่มีก็ปีล่าสุดที่ประกาศ
// ⚠️ fetchPlanData ดึงทะเบียนโครงการ + วงเงินรายปี + รายการแบบเบามาด้วย (เมนูแผนใช้ตัวเดียวกัน) — โหลดครั้งเดียวต่อการเปิดหน้า แคช 5 นาทีกันเปิดซ้ำ
// (Supabase แผนฟรี egress จำกัด) · ข้อมูลเสริมอ่านไม่ได้ (ขั้นก่อสร้าง) = ใช้เฉพาะผลที่กองกดเอง เหมือนเมนูแผน แต่ไม่ถือเป็นข้อผิดพลาด
const CACHE_TTL_MS = 5 * 60_000
const cache = new Map()

const firstError = (...results) => results.find((r) => r?.error)?.error ?? null

async function loadPlanProgress(tenantId) {
  const [plans, depts] = await Promise.all([fetchDevPlans(tenantId), fetchDepartments(tenantId)])
  if (plans.error) throw plans.error
  if (depts.error) throw depts.error
  const plan = plans.plans.find((p) => p.is_current) ?? plans.plans[0] ?? null
  if (!plan) return { state: 'no_plan' }

  const planData = await fetchPlanData(tenantId, plan.id)
  if (planData.error) throw planData.error

  const today = execToday()
  const years = publishedFiscalYears(planData.opPlans)
  const currentFy = fiscalYearOfIso(today)
  const fiscalYear = years.includes(currentFy) ? currentFy : (years[0] ?? null)
  if (!fiscalYear) return { state: 'no_published', departments: depts.departments }

  const planIds = effectivePlans(planData.opPlans, fiscalYear, { publishedOnly: true }).map((p) => p.id)
  const [itemResults, progress, civil] = await Promise.all([
    Promise.all(planIds.map((id) => fetchOpItems(tenantId, id))),
    fetchProgress(tenantId, fiscalYear),
    fetchCivilStages(tenantId, null),
  ])
  const hard = firstError(...itemResults, progress)
  if (hard) throw hard

  const items = effectiveItemSet(planData.opPlans, itemResults.flatMap((r) => r.items), fiscalYear, { publishedOnly: true })
  const yearText = String(fiscalYear)
  const civilRows = civil.rows ?? []
  const civilByRef = civilStageMap(civilRows.filter((r) => String(r.fiscal_year ?? '').trim() === yearText))
  const linkedRefs = new Set(civilRows.map((r) => r.registry_ref))
  const progressByLineage = Object.fromEntries(progress.progress.map((p) => [p.lineage_id, p]))
  const rows = buildProgressRows({ items, projects: planData.projects, progressByLineage, civilByRef, linkedRefs })
  const byDepartment = summarize(rows, { groupBy: 'department', departments: depts.departments })
  return {
    state: 'ok', fiscalYear, total: rows.length,
    groups: byDepartment.groups, totals: byDepartment.totals,
    resultMissing: planResultMissingCount(rows, { today, fiscalYear }),
    civilUnavailable: Boolean(civil.error),
    isCurrentYear: fiscalYear === currentFy,
  }
}

/**
 * @param {{ tenantId?: string, profileId?: string, enabled: boolean }} opts
 * @returns {{ status: 'idle'|'loading'|'ok'|'error', data: object|null, reload: () => void }}
 *   data.state: 'ok' (มีตัวเลข) · 'no_plan' (ยังไม่มีแผน) · 'no_published' (ยังไม่มีแผนการดำเนินงานที่ประกาศ)
 */
export function useExecPlanProgress({ tenantId, profileId, enabled }) {
  const cacheKey = tenantId && profileId ? `${tenantId}:${profileId}` : null
  const active = Boolean(enabled && cacheKey)
  const [reloadTick, setReloadTick] = useState(0)
  const [state, setState] = useState(() => {
    const hit = cacheKey && cache.get(cacheKey)
    return hit ? { key: cacheKey, status: 'ok', data: hit.data } : { key: null, status: 'idle', data: null }
  })

  useEffect(() => {
    if (!active) return undefined
    let cancelled = false
    const hit = cache.get(cacheKey)
    if (hit && Date.now() - hit.at <= CACHE_TTL_MS) {
      Promise.resolve().then(() => { if (!cancelled) setState({ key: cacheKey, status: 'ok', data: hit.data }) })
      return () => { cancelled = true }
    }
    loadPlanProgress(tenantId).then((data) => {
      if (cancelled) return
      cache.set(cacheKey, { at: Date.now(), data })
      setState({ key: cacheKey, status: 'ok', data })
    }).catch((error) => {
      if (cancelled) return
      console.error('[executive] local plan progress:', error?.message ?? error)
      setState({ key: cacheKey, status: 'error', data: null })
    })
    return () => { cancelled = true }
  }, [active, cacheKey, tenantId, reloadTick])

  const reload = useCallback(() => {
    if (cacheKey) cache.delete(cacheKey)
    setState((prev) => (prev.key === cacheKey ? { ...prev, status: 'loading' } : prev))
    setReloadTick((t) => t + 1)
  }, [cacheKey])

  if (!active) return { status: 'idle', data: null, reload }
  if (state.key !== cacheKey) return { status: 'loading', data: null, reload }
  return { status: state.status, data: state.data, reload }
}
