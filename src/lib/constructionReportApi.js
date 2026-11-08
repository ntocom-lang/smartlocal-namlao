// ชั้นเรียกฐานข้อมูลของโมดูลโครงการก่อสร้าง/รายงานสัปดาห์ (หน้าจอไม่เรียก supabase ตรงๆ)
// ตรรกะคำนวณอยู่ที่ constructionReport.js (pure) · สิทธิ์ตัดสินที่ฐานข้อมูล (migration 20261106100100) ปุ่มที่ซ่อนเป็นแค่ความสะดวก
//
// ⚠️ civil_projects เดิมมี SELECT USING (true) (migration 046) — ดึงรายชื่อโครงการต้องกรอง municipality_id เองเสมอ
//    และห้ามเอาชื่อบุคคลไปไว้ในตารางนั้น (ชื่อกรรมการ/ผู้ควบคุมงานอยู่ใน civil_project_people ที่ RLS แคบ)
// ⚠️ project_type เขียนเฉพาะค่าที่ CHECK ในไฟล์ migration (047) รับ — UI เดิมเขียน road_concrete/road_asphalt ซึ่งไม่อยู่ในลิสต์นั้น
//    ลักษณะผิวทาง (คสล./ลาดยาง) เก็บใน civil_project_contracts.spec.road_type แทน
import { supabase } from './supabase'
import { logAction } from './auditLog'
import { freezeSheet } from './constructionReport'
import { initialStage } from './constructionLifecycle'
import { lifecycleContractColumns, lifecycleProjectColumns, validateLifecycleForm } from './constructionContractForm'

export const PROJECT_TYPES = [
  { value: 'road', label: 'ถนน' },
  { value: 'drain', label: 'รางระบายน้ำ' },
  { value: 'bridge', label: 'สะพาน/ท่อระบายน้ำข้ามทาง' },
  { value: 'light', label: 'ไฟฟ้าสาธารณะ' },
  { value: 'waterway', label: 'ทางน้ำ/ขุดลอก' },
  { value: 'building', label: 'อาคาร/สิ่งก่อสร้าง' },
  { value: 'irrigation', label: 'ชลประทาน' },
  { value: 'water_supply', label: 'ประปา' },
  { value: 'park', label: 'สวนสาธารณะ/ภูมิทัศน์' },
  { value: 'other', label: 'อื่นๆ' },
]
// ค่าที่โมดูลเดิม (CivilProjectAdmin) เคยเขียนไว้ — แสดงชื่อให้ถูก แต่ฟอร์มใหม่ไม่เขียนค่าเหล่านี้
const LEGACY_TYPE_LABELS = {
  road_concrete: 'ถนน ค.ส.ล.', road_asphalt: 'ลาดยางแอสฟัลท์', road_slurry: 'ฉาบผิวสเลอรี่ซิล', road_gravel: 'หินคลุก',
  dredge: 'ขุดลอก', canal: 'รางน้ำ/ลำเหมือง', pipe_water: 'ท่อน้ำประปา',
}
export const projectTypeLabel = value => PROJECT_TYPES.find(t => t.value === value)?.label ?? LEGACY_TYPE_LABELS[value] ?? value ?? '—'

export const PROJECT_STATUSES = [
  { value: 'planned', label: 'วางแผน' },
  { value: 'approved', label: 'อนุมัติแล้ว' },
  { value: 'in_progress', label: 'กำลังดำเนินการ' },
  { value: 'completed', label: 'แล้วเสร็จ' },
  { value: 'suspended', label: 'ระงับ' },
  { value: 'cancelled', label: 'ยกเลิก' },
]
export const projectStatusLabel = value => PROJECT_STATUSES.find(s => s.value === value)?.label ?? value ?? '—'

export const ROAD_SURFACES = ['คสล.', 'ลาดยาง', 'คสล. และลาดยาง']

/** ข้อความผิดพลาดภาษาไทยที่เจ้าหน้าที่อ่านรู้เรื่อง (ข้อความจากตัวกระตุ้นของฐานข้อมูลเป็นภาษาไทยอยู่แล้ว) */
export function friendlyError(error) {
  if (!error) return ''
  const code = error.code
  if (code === '42501') return 'ไม่มีสิทธิ์ทำรายการนี้ — ต้องเป็นผู้สร้างโครงการ ผู้ควบคุมงานที่ถูกระบุชื่อ หัวหน้ากอง หรือผู้ดูแลระบบ'
  if (code === 'PGRST205' || code === '42P01') return 'ระบบยังไม่ได้ติดตั้งตารางของโมดูลนี้ในฐานข้อมูล — แจ้งผู้ดูแลระบบ'
  if (code === '23505') return 'มีข้อมูลซ้ำ (เช่น สัปดาห์นี้มีรายงานอยู่แล้ว) — โหลดข้อมูลล่าสุดแล้วลองใหม่'
  if (code === '23503') return 'ลบไม่ได้เพราะมีข้อมูลอื่นอ้างถึงอยู่ (เช่น โครงการที่มีรายงานแล้ว)'
  if (code === 'P0001') return error.message
  if (code === '23514') return `ข้อมูลไม่ผ่านเงื่อนไขของระบบ (${error.message})`
  return error.message || 'เกิดข้อผิดพลาด'
}

const num = value => (value === '' || value === null || value === undefined ? null : Number(value))
const text = value => {
  const s = String(value ?? '').trim()
  return s === '' ? null : s
}

const PROJECT_COLS = 'id, project_no, title, project_type, fiscal_year, status, contract_no, contractor_name, contract_amount, '
  + 'budget_amount, paid_amount, start_date, end_date, location_desc, department_id, created_by, created_at, '
  + 'stage, stage_before_hold, stage_changed_at, work_group, operator_eval_required'   // วงจรโครงการ (migration 20261108100000)

/** โครงการของ อปท. นี้ + รหัสโครงการที่ผู้ใช้ถูกระบุชื่อไว้ (ใช้ตัดสินว่าเห็นโครงการข้ามกองได้ไหม) */
export async function fetchProjects(tenantId, userId) {
  const [projects, listed] = await Promise.all([
    supabase.from('civil_projects').select(PROJECT_COLS).eq('municipality_id', tenantId)
      .order('created_at', { ascending: false }).limit(500),
    userId
      ? supabase.from('civil_project_people').select('project_id, grp').eq('profile_id', userId)
      : Promise.resolve({ data: [], error: null }),
  ])
  const error = projects.error ?? listed.error
  const listedBy = {}
  for (const row of listed.data ?? []) {
    const entry = (listedBy[row.project_id] ??= { any: true, supervisor: false })
    if (row.grp === 'supervisor') entry.supervisor = true
  }
  return { projects: projects.data ?? [], listedBy, error }
}

/** ตัวเลขล่าสุดของรายงานที่ล็อกแล้วต่อโครงการ (แสดงในรายการโครงการ) — ใช้ตัวเลขแช่แข็ง ไม่คำนวณใหม่ */
export async function fetchLatestFinals(projectIds) {
  if (!projectIds.length) return { latest: {}, error: null }
  const { data, error } = await supabase.from('civil_weekly_reports')
    .select('project_id, week_no, period_end, overall:frozen->overall, timing:frozen->timing')
    .eq('status', 'final').in('project_id', projectIds)
    .order('week_no', { ascending: false }).limit(1000)
  const latest = {}
  for (const row of data ?? []) if (!latest[row.project_id]) latest[row.project_id] = row
  return { latest, error }
}

/** ทุกอย่างของโครงการเดียว: สัญญา รายการงาน บุคคล รายงานทุกสัปดาห์ */
export async function fetchBundle(projectId) {
  const [contract, items, people, reports] = await Promise.all([
    supabase.from('civil_project_contracts').select('*').eq('project_id', projectId).maybeSingle(),
    supabase.from('civil_project_work_items').select('*').eq('project_id', projectId).order('sort_order'),
    supabase.from('civil_project_people').select('*').eq('project_id', projectId).order('sort_order'),
    supabase.from('civil_weekly_reports').select('*').eq('project_id', projectId).order('week_no'),
  ])
  return {
    contract: contract.data ?? null,
    items: items.data ?? [],
    people: people.data ?? [],
    reports: reports.data ?? [],
    error: contract.error ?? items.error ?? people.error ?? reports.error ?? null,
  }
}

/** เจ้าหน้าที่ของ อปท. นี้ ไว้เลือกเป็นผู้ควบคุมงาน/กรรมการที่มีบัญชี (ได้สิทธิ์เขียนรายงานของโครงการ) */
export async function fetchStaffChoices(tenantId) {
  const { data, error } = await supabase.from('profiles').select('id, full_name, role, department_id')
    .eq('municipality_id', tenantId).in('role', ['officer', 'staff', 'technician', 'admin']).order('full_name').limit(500)
  return { staff: (data ?? []).filter(p => p.full_name), error }
}

export async function fetchDepartments(tenantId) {
  const { data, error } = await supabase.from('departments').select('id, name, short_name, sort_order')
    .eq('municipality_id', tenantId).order('sort_order')
  return { departments: data ?? [], error }
}

// ── บันทึกโครงการ ───────────────────────────────────────────────────────

function specOf(form) {
  const sections = (form.sections ?? [])
    .map(s => ({ name: String(s.name ?? '').trim(), length_km: num(s.length_km), surface: String(s.surface ?? '').trim() }))
    .filter(s => s.name || s.length_km !== null || s.surface)
  return {
    road_type: text(form.road_type), length_km: num(form.length_km), width_m: num(form.width_m), sections,
  }
}

// อัปเดตแถวที่มีรหัส ลบแถวที่หายไป เพิ่มแถวใหม่ — ลบก่อน เพื่อให้ตัวกระตุ้นห้ามลบ (มีรายงานที่ล็อกแล้ว) ล้มก่อนแก้อย่างอื่น
async function syncRows(table, existing, next, toColumns) {
  const keep = new Set(next.filter(r => r.id).map(r => r.id))
  const removed = existing.filter(r => !keep.has(r.id)).map(r => r.id)
  if (removed.length) {
    const { error } = await supabase.from(table).delete().in('id', removed)
    if (error) return error
  }
  for (const [index, row] of next.entries()) {
    if (!row.id) continue
    const { error } = await supabase.from(table).update(toColumns(row, index)).eq('id', row.id)
    if (error) return error
  }
  const inserts = next.map((row, index) => (row.id ? null : toColumns(row, index))).filter(Boolean)
  if (inserts.length) {
    const { error } = await supabase.from(table).insert(inserts)
    if (error) return error
  }
  return null
}

/**
 * บันทึกโครงการทั้งชุด (ทะเบียน + สัญญา + รายการงาน + บุคคล) — ทำทีละขั้น ขั้นไหนล้มหยุดและคืนข้อความ
 * ข้อมูลที่บันทึกไปแล้วไม่ย้อน (กดบันทึกซ้ำได้ ทุกขั้นเขียนทับด้วยค่าเดียวกัน)
 * @returns {{ projectId?: string, error?: object }}
 */
export async function saveProject({ mode, tenantId, userId, projectId, form, items, people, existing, departmentId, editBase }) {
  // ตรวจช่องสัญญา/หลักประกัน/ระยะประกันตาม CHECK จริงก่อนแตะฐานข้อมูล — ค่าผิดไม่ถึงฐาน (ไม่เกิดโครงการครึ่งๆ กลางๆ)
  const invalid = validateLifecycleForm(form, { editBase })
  if (invalid) return { error: { message: invalid } }
  let id = projectId
  if (editBase) {
    const row = {
      title: form.title.trim(),
      project_no: text(form.project_no),
      fiscal_year: String(form.fiscal_year).trim(),
      project_type: form.project_type,
      // ไม่ส่ง status: ขั้นของโครงการกำหนดสถานะผ่าน trigger (civil_projects_stage_guard)
      // stage ส่งได้ทางเดียวคือ INSERT ตอนสร้าง (ขั้นเริ่มต้น) · แก้ไขห้ามส่ง — เปลี่ยนขั้นผ่าน RPC civil_set_project_stage เท่านั้น
      contract_no: text(form.contract_no),
      contractor_name: text(form.contractor_name),
      contract_amount: num(form.contract_amount),
      budget_amount: num(form.budget_amount),
      location_desc: text(form.location_desc),
      start_date: text(form.start_date),
      end_date: text(form.end_date),
      ...lifecycleProjectColumns(form),   // work_group, operator_eval_required (เฉพาะ editBase)
    }
    if (mode === 'create') {
      const { data, error } = await supabase.from('civil_projects')
        .insert({ ...row, stage: initialStage(form.initial_stage), municipality_id: tenantId, created_by: userId, department_id: departmentId ?? null }).select('id').single()
      if (error) return { error }
      id = data.id
    } else {
      const patch = departmentId !== undefined ? { ...row, department_id: departmentId } : row
      const { data, error } = await supabase.from('civil_projects').update(patch).eq('id', id).select('id')
      if (error) return { error }
      if (!data?.length) return { error: { code: '42501', message: 'ไม่มีสิทธิ์แก้ไขข้อมูลทะเบียนโครงการนี้' } }
    }
  }

  const contract = {
    project_id: id,
    contract_date: text(form.contract_date),
    extended_until: text(form.extended_until),
    fine_per_day: num(form.fine_per_day),
    installments_total: num(form.installments_total),
    designer_name: text(form.designer_name),
    attach_no: text(form.attach_no),
    attach_date: text(form.attach_date),
    ...lifecycleContractColumns(form),   // ช่องสัญญา/หลักประกัน/ระยะประกันของวงจรโครงการ — upsert ส่งเฉพาะคอลัมน์ที่ฟอร์มรู้จัก ไม่ทับคอลัมน์อื่น
    spec: specOf(form),
    updated_by: userId,
  }
  const contractResult = await supabase.from('civil_project_contracts').upsert(contract, { onConflict: 'project_id' })
  if (contractResult.error) return { projectId: id, error: contractResult.error }

  const itemError = await syncRows('civil_project_work_items', existing.items, items, (row, index) => ({
    project_id: id, sort_order: index + 1, name: row.name.trim(), weight_pct: num(row.weight_pct) ?? 0,
    plan_start: text(row.plan_start), plan_end: text(row.plan_end),
  }))
  if (itemError) return { projectId: id, error: itemError }

  const peopleRows = Object.entries(people).flatMap(([grp, rows]) => rows.map((row, index) => ({ ...row, grp, index })))
  const peopleError = await syncRows('civil_project_people', existing.people, peopleRows, row => ({
    project_id: id, grp: row.grp, sort_order: row.index + 1, name: String(row.name ?? '').trim(),
    position_title: String(row.position_title ?? '').trim(), duty: String(row.duty ?? '').trim(),
    profile_id: row.grp === 'contractor_rep' ? null : (row.profile_id || null),
  }))
  if (peopleError) return { projectId: id, error: peopleError }
  return { projectId: id }
}

// ── รายงานรายสัปดาห์ ────────────────────────────────────────────────────

const reportColumns = values => ({
  report_no: num(values.report_no),
  period_start: values.period_start,
  period_end: values.period_end,
  memo_no: text(values.memo_no),
  memo_date: text(values.memo_date),
  memo_to: text(values.memo_to),
  progress: values.progress ?? {},
  crew: values.crew ?? [],
  machinery: values.machinery ?? [],
  weather: values.weather ?? {},
  daily_log: values.daily_log ?? [],
  issues: values.issues ?? {},
  finance: values.finance ?? {},
})

export async function createReport(projectId, weekNo, values) {
  const { data, error } = await supabase.from('civil_weekly_reports')
    .insert({ project_id: projectId, week_no: weekNo, ...reportColumns(values) }).select('*').single()
  return { report: data, error }
}

export async function saveDraft(reportId, values) {
  const { data, error } = await supabase.from('civil_weekly_reports')
    .update(reportColumns(values)).eq('id', reportId).select('*')
  if (!error && !data?.length) return { report: null, error: { code: '42501', message: 'บันทึกไม่สำเร็จ (ไม่มีสิทธิ์ หรือรายงานถูกล็อกไปแล้ว)' } }
  return { report: data?.[0] ?? null, error }
}

/** ล็อกรายงาน: เขียนค่าล่าสุด + ตัวเลขแช่แข็งในคำสั่งเดียว (ตัวกระตุ้นตรวจความต่อเนื่องและประทับผู้ล็อก/เวลา) */
export async function finalizeReport({ report, values, sheet, project, tenantId }) {
  const { data, error } = await supabase.from('civil_weekly_reports')
    .update({ ...reportColumns(values), status: 'final', frozen: freezeSheet(sheet) }).eq('id', report.id).select('*')
  if (error) return { report: null, error }
  if (!data?.length) return { report: null, error: { code: '42501', message: 'ล็อกไม่สำเร็จ (ไม่มีสิทธิ์)' } }
  await logAction({
    action: 'finalize', resourceType: 'construction_report', resourceId: report.id, municipalityId: tenantId,
    resourceLabel: `${project.title} สัปดาห์ที่ ${report.week_no}`,
    metadata: { week_no: report.week_no, actual: sheet.overall.actual, plan: sheet.overall.plan },
  })
  return { report: data[0], error: null }
}

export async function unlockReport({ report, project, tenantId, reason }) {
  const { data, error } = await supabase.from('civil_weekly_reports')
    .update({ status: 'draft' }).eq('id', report.id).select('*')
  if (error) return { report: null, error }
  if (!data?.length) return { report: null, error: { code: '42501', message: 'ปลดล็อกไม่สำเร็จ (ไม่มีสิทธิ์)' } }
  await logAction({
    action: 'unlock', resourceType: 'construction_report', resourceId: report.id, municipalityId: tenantId,
    resourceLabel: `${project.title} สัปดาห์ที่ ${report.week_no}`,
    metadata: { week_no: report.week_no, reason: reason || null },
  })
  return { report: data[0], error: null }
}

/** แก้เฉพาะหัวบันทึกข้อความของรายงานที่ล็อกแล้ว (ที่/วันที่/เรียน) — ตัวกระตุ้นอนุญาตเฉพาะ 3 ช่องนี้ */
export async function saveMemoFields(reportId, values) {
  const { data, error } = await supabase.from('civil_weekly_reports')
    .update({ memo_no: text(values.memo_no), memo_date: text(values.memo_date), memo_to: text(values.memo_to) })
    .eq('id', reportId).select('*')
  if (!error && !data?.length) return { report: null, error: { code: '42501', message: 'บันทึกไม่สำเร็จ (ไม่มีสิทธิ์)' } }
  return { report: data?.[0] ?? null, error }
}

export async function deleteReport({ report, project, tenantId }) {
  const { data, error } = await supabase.from('civil_weekly_reports').delete().eq('id', report.id).select('id')
  if (error) return { error }
  if (!data?.length) return { error: { code: '42501', message: 'ลบไม่สำเร็จ (เฉพาะผู้ดูแลระบบเท่านั้น)' } }
  await logAction({
    action: 'delete', resourceType: 'construction_report', resourceId: report.id, municipalityId: tenantId,
    resourceLabel: `${project.title} สัปดาห์ที่ ${report.week_no}`, metadata: { week_no: report.week_no, status: report.status },
  })
  return { error: null }
}
