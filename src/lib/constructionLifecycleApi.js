// ชั้นเรียกฐานข้อมูลของ "วงจรโครงการก่อสร้าง" (PR-C1) — หน้าจอไม่เรียก supabase ตรงๆ
// ตรรกะ/กฎอยู่ที่ constructionLifecycle.js (pure) · สิทธิ์ตัดสินที่ฐานข้อมูล (migration 20261108100200) ปุ่มที่ซ่อนเป็นแค่ความสะดวก
//
// ⚠️ ห้ามมีโค้ดใดในโมดูลนี้เขียนคอลัมน์ civil_projects.stage / stage_before_hold ตรงๆ — เปลี่ยนขั้นผ่าน RPC civil_set_project_stage
//    เท่านั้น (trigger civil_projects_stage_guard ปฏิเสธการ UPDATE ตรงอยู่แล้ว · tests/construction-lifecycle-ui.test.mjs ค้นโค้ดกันซ้ำ)
// ⚠️ ตาราง civil_project_events เขียนโดย trigger/RPC ล้วน ไฟล์นี้ "อ่านอย่างเดียว"
import { supabase } from './supabase'
import { MILESTONE_KEY_PATTERN, STAGES } from './constructionLifecycle'
import { friendlyError } from './constructionReportApi'

const PAGE = 1000
const MAX_PAGES = 10

/** ข้อความภาษาไทยจากฐานข้อมูล (RAISE EXCEPTION ใน RPC/trigger) แสดงตรงๆ · ที่เหลือผ่าน friendlyError
 *  friendlyError เดิมแทนที่ 42501 ด้วยข้อความรวม ซึ่งบังข้อความเฉพาะเรื่อง เช่น "การเปลี่ยนขั้นนี้ต้องให้หัวหน้ากอง…" */
export function dbMessage(error) {
  if (!error) return ''
  if (error.code === 'PGRST202' || error.code === '42883') return 'ระบบยังไม่ได้ติดตั้งฟังก์ชันวงจรโครงการในฐานข้อมูล — แจ้งผู้ดูแลระบบ'
  if (/[฀-๿]/.test(String(error.message ?? ''))) return error.message
  return friendlyError(error)
}

const text = value => {
  const s = String(value ?? '').trim()
  return s === '' ? null : s
}

// ดึงทีละหน้า 1,000 แถว (เพดานแถวต่อคำสั่งของ PostgREST) — ตารางละ "ชุดคำสั่ง" เดียวกันทุกโครงการ ไม่วนทีละโครงการ
async function selectAll(build) {
  const rows = []
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await build().range(page * PAGE, page * PAGE + PAGE - 1)
    if (error) return { rows: [], error }
    rows.push(...(data ?? []))
    if ((data ?? []).length < PAGE) break
  }
  return { rows, error: null }
}

const EMPTY = () => ({ contract: null, people: [], milestones: [], installments: [], changes: [], defects: [], events: [] })

/**
 * ข้อมูลวงจรของโครงการที่ให้มา — ตารางละ 1 คำสั่ง (`.in('project_id', ids)`) แล้วแยกตามโครงการ
 *   contract + people (เฉพาะ project_id/grp ไว้นับคณะกรรมการ ไม่ดึงชื่อบุคคล) ต้องมีด้วย: คำเตือนของโครงการทุกข้อใช้ข้อมูลสัญญา/จำนวนกรรมการ
 *   ถ้าไม่ดึง คำเตือนในภาพรวมจะผิด (เช่น "กรรมการราคากลาง 0 คน" ทั้งที่มี)
 * @returns {{ byProject: Record<string, ReturnType<typeof EMPTY>>, error: object|null, message: string }}
 */
export async function fetchLifecycleData(projectIds) {
  const ids = [...new Set((projectIds ?? []).filter(Boolean))]
  const byProject = Object.fromEntries(ids.map(id => [id, EMPTY()]))
  if (!ids.length) return { byProject, error: null, message: '' }

  const [contracts, people, milestones, installments, changes, defects, events] = await Promise.all([
    selectAll(() => supabase.from('civil_project_contracts').select('*').in('project_id', ids).order('project_id')),
    selectAll(() => supabase.from('civil_project_people').select('project_id, grp').in('project_id', ids).order('project_id')),
    selectAll(() => supabase.from('civil_project_milestones').select('*').in('project_id', ids).order('project_id').order('key')),
    selectAll(() => supabase.from('civil_project_installments').select('*').in('project_id', ids).order('project_id').order('installment_no')),
    selectAll(() => supabase.from('civil_project_changes').select('*').in('project_id', ids).order('project_id').order('created_at')),
    selectAll(() => supabase.from('civil_project_defects').select('*').in('project_id', ids).order('project_id').order('inspected_on')),
    selectAll(() => supabase.from('civil_project_events').select('*').in('project_id', ids).order('project_id').order('created_at', { ascending: false })),
  ])
  const error = [contracts, people, milestones, installments, changes, defects, events].map(r => r.error).find(Boolean) ?? null
  if (error) return { byProject, error, message: friendlyError(error) }

  const put = (rows, field) => {
    for (const row of rows) {
      const slot = byProject[row.project_id]
      if (!slot) continue
      if (field === 'contract') slot.contract = row
      else slot[field].push(row)
    }
  }
  put(contracts.rows, 'contract')
  put(people.rows, 'people')
  put(milestones.rows, 'milestones')
  put(installments.rows, 'installments')
  put(changes.rows, 'changes')
  put(defects.rows, 'defects')
  put(events.rows, 'events')
  return { byProject, error: null, message: '' }
}

/**
 * เปลี่ยนขั้นโครงการ — ผ่าน RPC civil_set_project_stage เท่านั้น (ตรวจสิทธิ์/ลำดับขั้น/เหตุผล + บันทึกประวัติที่ฐานข้อมูล)
 * @returns {{ stage?: string, error?: object, message?: string }}
 */
export async function setProjectStage({ projectId, stage, reason = null, refNo = null, refDate = null }) {
  if (!projectId) return { error: { message: 'ไม่พบโครงการ' }, message: 'ไม่พบโครงการ' }
  if (!STAGES.includes(stage)) {
    const message = `ไม่รู้จักขั้นโครงการ "${stage ?? '<NULL>'}"`
    return { error: { message }, message }
  }
  const { data, error } = await supabase.rpc('civil_set_project_stage', {
    p_project_id: projectId,
    p_stage: stage,
    p_reason: text(reason),
    p_ref_no: text(refNo),
    p_ref_date: text(refDate),
  })
  if (error) return { error, message: dbMessage(error) }
  return { stage: data ?? stage }
}

const MILESTONE_COLUMNS = ['done_on', 'ref_no', 'ref_date', 'amount', 'link', 'note']

/** ค่าจากฟอร์ม → แถวจุดตรวจ (ค่าว่าง = null) · คืนข้อความผิดพลาดแทนการส่งค่าที่ฐานข้อมูลปฏิเสธอยู่แล้ว */
export function milestoneRow(values) {
  const row = {}
  for (const column of MILESTONE_COLUMNS) row[column] = text(values?.[column])
  if (row.amount !== null) {
    const n = Number(String(row.amount).replace(/,/g, ''))
    if (!Number.isFinite(n)) return { error: 'ยอดเงินต้องเป็นตัวเลข' }
    row.amount = n
  }
  if (row.link !== null && !(/^https?:\/\//i.test(row.link) && row.link.length <= 1000)) return { error: 'ลิงก์ต้องขึ้นต้นด้วย http:// หรือ https://' }
  if (row.ref_no !== null && row.ref_no.length > 200) return { error: 'เลขที่หนังสือยาวเกิน 200 ตัวอักษร' }
  if (row.note !== null && row.note.length > 4000) return { error: 'หมายเหตุยาวเกิน 4,000 ตัวอักษร' }
  if (MILESTONE_COLUMNS.every(column => row[column] === null)) return { error: 'กรอกอย่างน้อย 1 ช่อง — หรือกด "ล้างค่า" ถ้าต้องการลบรายการนี้' }
  return { row }
}

/** บันทึกจุดตรวจ (1 คีย์ = 1 แถวต่อโครงการ) · trigger ประทับ created_by/updated_by/เวลาให้เอง จึงไม่ส่งช่องเหล่านั้น */
export async function saveMilestone(projectId, key, values) {
  if (!projectId) return { error: { message: 'ไม่พบโครงการ' }, message: 'ไม่พบโครงการ' }
  if (!MILESTONE_KEY_PATTERN.test(String(key ?? ''))) return { error: { message: 'คีย์จุดตรวจไม่ถูกต้อง' }, message: 'คีย์จุดตรวจไม่ถูกต้อง' }
  const parsed = milestoneRow(values)
  if (parsed.error) return { error: { message: parsed.error }, message: parsed.error }
  const { data, error } = await supabase.from('civil_project_milestones')
    .upsert({ project_id: projectId, key, ...parsed.row }, { onConflict: 'project_id,key' }).select()
  if (error) return { error, message: dbMessage(error) }
  if (!data?.length) {
    const message = 'บันทึกไม่สำเร็จ (ไม่มีสิทธิ์แก้ไขโครงการนี้)'
    return { error: { code: '42501', message }, message }
  }
  return { milestone: data[0] }
}

/** ล้างค่าจุดตรวจ = ลบแถว (ประวัติการเปลี่ยนขั้นไม่เกี่ยว) */
export async function clearMilestone(projectId, key) {
  if (!projectId) return { error: { message: 'ไม่พบโครงการ' }, message: 'ไม่พบโครงการ' }
  if (!MILESTONE_KEY_PATTERN.test(String(key ?? ''))) return { error: { message: 'คีย์จุดตรวจไม่ถูกต้อง' }, message: 'คีย์จุดตรวจไม่ถูกต้อง' }
  const { data, error } = await supabase.from('civil_project_milestones')
    .delete().eq('project_id', projectId).eq('key', key).select('id')
  if (error) return { error, message: dbMessage(error) }
  if (!data?.length) {
    const message = 'ล้างค่าไม่สำเร็จ (ไม่พบรายการ หรือไม่มีสิทธิ์) — โหลดข้อมูลล่าสุดแล้วลองใหม่'
    return { error: { message }, message }
  }
  return { cleared: true }
}
