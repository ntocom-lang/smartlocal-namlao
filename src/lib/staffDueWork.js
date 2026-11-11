// ชั้นดึงข้อมูล "งานที่ถึงกำหนด" ของหน้าแรกเจ้าหน้าที่ (การ์ด "ต้องทำตอนนี้" + ป้ายเมนูแผนพัฒนา/โครงการก่อสร้าง)
// ไม่มี RPC ใหม่ ไม่มี SQL: อ่านด้วยฟังก์ชันของเมนูเดิม แล้วคำนวณฝั่ง client ด้วยตรรกะล้วนที่มีอยู่
//   แผนพัฒนา      → localPlanProgress.countDueItems (กติกาเดียวกับ Telegram วันที่ 1 — ดูหัวหมวดในไฟล์นั้น)
//   โครงการก่อสร้าง → constructionDueWork.constructionDueWork (ชุดคำเตือนเดียวกับแท็บภาพรวม)
//
// ⚠️ ผลคืนเป็น { error } เสมอเมื่อ query ใดพัง — ห้ามคืน 0 เงียบ (หน้าแรกจะขึ้น "ไม่มีงานค้าง" ทั้งที่ไม่รู้ = ไฟเขียวปลอม)
// ⚠️ ทุก query กรอง municipality_id เอง (superadmin อ่านได้ทุก อปท. — ไม่กรองจะนับปนกัน)
// ⚠️ PostgREST ตัดผลที่ 1,000 แถวเงียบๆ (NOTES ข้อ 14) → รายการแผนอ่านผ่าน fetchAll ที่ไล่ทีละหน้า
//    fetchProjects (โมดูลก่อสร้าง) มีเพดาน 500 โครงการของมันเอง — นับตามที่โมดูลเห็น เลขจึงตรงกับแท็บภาพรวม
// ⚠️ ข้อมูลหนักกว่านับ HEAD (หลายตาราง) ผู้เรียกจึงต้องหน่วงรอบรีเฟรชอย่างน้อย 5 นาที
import { supabase } from './supabase'
import { bangkokIsoDate } from './complaintReportPeriods'
import { effectivePlans, countDueItems, previousMonthBangkok } from './localPlanProgress'
import { fetchCivilStages, fetchIsManager, fetchProgress, friendlyError as planFriendlyError } from './localPlanApi'
import { projectAccess } from './constructionReport'
import { fetchProjects, friendlyError as constructionFriendlyError } from './constructionReportApi'
import { fetchLifecycleData } from './constructionLifecycleApi'
import { buildDueRows, constructionDueWork } from './constructionDueWork'
import { FINISHED_STAGES } from '../components/staff/construction/lifecycleFormat'

const PAGE = 1000

/** ไล่อ่านทีละ 1,000 แถว · build() ต้องคืน query ใหม่ทุกครั้งและมี order ที่คงที่ (แบบเดียวกับ fetchAll ใน localPlanApi.js) */
async function fetchAll(build) {
  const rows = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1)
    if (error) return { data: null, error }
    rows.push(...(data ?? []))
    if ((data ?? []).length < PAGE) return { data: rows, error: null }
  }
}

/** ตัดการรอเมื่อ signal ถูกยกเลิก (หมดเวลา/ออกจากหน้า) — ฟังก์ชันของเมนูเดิมไม่รับ signal จึงทิ้งผลที่มาช้าแทนการยกเลิกคำสั่ง */
function raceAbort(promise, signal) {
  if (!signal) return promise
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error('aborted')); return }
    const onAbort = () => reject(new Error('aborted'))
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      value => { signal.removeEventListener('abort', onAbort); resolve(value) },
      error => { signal.removeEventListener('abort', onAbort); reject(error) },
    )
  })
}

const failed = (error, message) => ({ error: error ?? new Error(message), message })

/**
 * รายการแผนการดำเนินงานที่ถึงกำหนดแต่ยังไม่บันทึกผล ณ สิ้นเดือนที่เพิ่งจบ (ตามเวลาไทย)
 *   ผู้จัดการแผน (local_plan_is_manager) → นับทุกรายการของ อปท. · คนอื่น → เฉพาะรายการของกองตัวเอง · ไม่ใช่ผู้จัดการและไม่มีกอง → 0
 *   ยังไม่มีแผนการดำเนินงานฉบับประกาศของปีงบนั้น → 0 (ไม่มีอะไรให้ติดตาม — เหมือน Telegram ที่ข้ามเป็น noPlan)
 * ⚠️ ต้องไม่ใช่ปีงบ "ปัจจุบัน" ตามปฏิทิน: ดู previousMonthBangkok (1–31 ต.ค. ยังนับปีงบที่เพิ่งปิด)
 * @returns {Promise<{ notStarted: number, pastEnd: number, monthLabel: string, error: null } | { error: Error, message: string }>}
 */
export async function fetchLocalPlanDue({ municipalityId, departmentId = null, now = new Date(), signal } = {}) {
  if (!municipalityId) return failed(null, 'ไม่พบ อปท.')
  const month = previousMonthBangkok(now)
  const zero = { notStarted: 0, pastEnd: 0, monthLabel: month.label, error: null }
  try {
    const manager = await raceAbort(fetchIsManager(municipalityId), signal)
    // fetchIsManager คืน isManager=false เมื่อพัง (ปุ่มซ่อนผิดดีกว่าปุ่มกดแล้วล้ม) แต่ที่นี่ false จะนับเฉพาะกองตัวเอง = ตัวเลขต่ำเกินจริงเงียบๆ จึงต้องถือเป็น error
    if (manager.error) return failed(manager.error, planFriendlyError(manager.error))
    if (!manager.isManager && !departmentId) return zero

    let plansQuery = supabase.from('local_op_plans').select('id, fiscal_year, kind, revision_no, status')
      .eq('municipality_id', municipalityId).eq('fiscal_year', month.fiscalYear)
    if (signal) plansQuery = plansQuery.abortSignal(signal)
    const [plansResult, progress, civil] = await raceAbort(Promise.all([
      plansQuery,
      fetchProgress(municipalityId, month.fiscalYear),
      // RPC (ไม่อ่าน civil_projects ตรง): RLS ให้ officer เห็นเฉพาะโครงการของกองตัวเอง จะนับรายการที่ผูกก่อสร้างกองอื่นผิด
      fetchCivilStages(municipalityId, month.fiscalYear),
    ]), signal)
    if (plansResult.error) return failed(plansResult.error, planFriendlyError(plansResult.error))
    if (progress.error) return failed(progress.error, planFriendlyError(progress.error))
    if (civil.error) return failed(civil.error, planFriendlyError(civil.error))

    const opPlans = plansResult.data ?? []
    const planIds = effectivePlans(opPlans, month.fiscalYear).map(p => p.id)
    if (planIds.length === 0) return zero

    const itemsResult = await raceAbort(fetchAll(() => supabase.from('local_op_plan_items')
      .select('id, op_plan_id, origin_item_id, department_id, dev_project_id, month_from, month_to, sort_order')
      .eq('municipality_id', municipalityId).in('op_plan_id', planIds).order('id')), signal)
    if (itemsResult.error) return failed(itemsResult.error, planFriendlyError(itemsResult.error))

    const progressByLineage = Object.fromEntries((progress.progress ?? []).map(row => [row.lineage_id, row.status]))
    const civilRefs = new Set((civil.rows ?? []).map(row => String(row.registry_ref)))
    const { notStarted, pastEnd } = countDueItems({
      opPlans, items: itemsResult.data, fiscalYear: month.fiscalYear, fiscalMonth: month.fiscalMonth,
      progressByLineage, civilRefs, departmentId: manager.isManager ? null : departmentId,
    })
    return { notStarted, pastEnd, monthLabel: month.label, error: null }
  } catch (error) {
    return failed(error, 'โหลดตัวเลขแผนพัฒนาไม่สำเร็จ')
  }
}

/**
 * งานโครงการก่อสร้างที่ถึงคิว (งวดรอตรวจรับ + กำหนดเลยแล้ว) ของโครงการที่ผู้ใช้คนนี้เห็น (projectAccess เดียวกับโมดูลโครงการก่อสร้าง)
 * ข้อมูลวงจรโหลดไม่สำเร็จ → error (ห้ามคำนวณจากข้อมูลว่าง: จะนับตกหล่น/เตือนผิด — ดูคอมเมนต์ alertsReady ใน LifecycleOverview)
 * @returns {Promise<{ awaitingInspection: number, overdue: number, total: number, error: null } | { error: Error, message: string }>}
 */
export async function fetchConstructionDue({ tenantId, profile, today = bangkokIsoDate(), signal } = {}) {
  if (!tenantId || !profile?.id) return failed(null, 'ไม่พบ อปท. หรือผู้ใช้')
  try {
    const list = await raceAbort(fetchProjects(tenantId, profile.id), signal)
    if (list.error) return failed(list.error, constructionFriendlyError(list.error))
    const visible = list.projects.filter(project => projectAccess({
      role: profile.role, userId: profile.id, departmentId: profile.department_id ?? null, project, listed: list.listedBy[project.id] ?? {},
    }).read && !FINISHED_STAGES.includes(project.stage))
    const life = await raceAbort(fetchLifecycleData(visible.map(project => project.id)), signal)
    if (life.error) return failed(life.error, life.message)
    return { ...constructionDueWork(buildDueRows(visible, life.byProject), today), error: null }
  } catch (error) {
    return failed(error, 'โหลดตัวเลขโครงการก่อสร้างไม่สำเร็จ')
  }
}
