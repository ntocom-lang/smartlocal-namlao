// ชั้นเรียกฐานข้อมูลของ "วงจรโครงการก่อสร้าง" (PR-C1) — หน้าจอไม่เรียก supabase ตรงๆ
// ตรรกะ/กฎอยู่ที่ constructionLifecycle.js (pure) · สิทธิ์ตัดสินที่ฐานข้อมูล (migration 20261108100200) ปุ่มที่ซ่อนเป็นแค่ความสะดวก
//
// ⚠️ ห้ามมีโค้ดใดในโมดูลนี้เขียนคอลัมน์ civil_projects.stage / stage_before_hold ตรงๆ — เปลี่ยนขั้นผ่าน RPC civil_set_project_stage
//    เท่านั้น (trigger civil_projects_stage_guard ปฏิเสธการ UPDATE ตรงอยู่แล้ว · tests/construction-lifecycle-ui.test.mjs ค้นโค้ดกันซ้ำ)
// ⚠️ ตาราง civil_project_events เขียนโดย trigger/RPC เป็นหลัก — ไฟล์นี้เพิ่มได้เฉพาะ kind 'note' (addProjectNote · ฐานประทับผู้บันทึก/เวลาเอง)
// PR-C2: งวดงาน / ขยายเวลา-แก้สัญญา / ตรวจความชำรุด / เอกสารแนบ — ค่าที่ส่งผ่าน constructionInstallmentForm.js (ตรวจ + ส่งเฉพาะช่องที่เปลี่ยน)
//   สิทธิ์ตัดสินที่ฐานข้อมูล (policy + trigger civil_manage_columns_guard) · `.select()` หลังเขียนแล้วได้แถวว่าง = RLS ไม่ให้เขียน
import { supabase } from './supabase'
import { MILESTONE_KEY_PATTERN, STAGES } from './constructionLifecycle'
import { friendlyError } from './constructionReportApi'
import { isIsoDate } from './constructionReport'
import { deleteFile, driveFileIdFromRef, isPrivateDriveRef, resolvePrivateFileUrl, uploadFile } from './driveStorage'
import {
  DOC_KIND_PATTERN, DOC_SOURCES, attachmentFileName, attachmentFolder, changePatch, defectPatch, installmentPatch, validateAttachment,
} from './constructionInstallmentForm'

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

const EMPTY = () => ({ contract: null, people: [], milestones: [], installments: [], changes: [], defects: [], documents: [], events: [] })

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

  const [contracts, people, milestones, installments, changes, defects, documents, events] = await Promise.all([
    selectAll(() => supabase.from('civil_project_contracts').select('*').in('project_id', ids).order('project_id')),
    selectAll(() => supabase.from('civil_project_people').select('project_id, grp').in('project_id', ids).order('project_id')),
    selectAll(() => supabase.from('civil_project_milestones').select('*').in('project_id', ids).order('project_id').order('key')),
    selectAll(() => supabase.from('civil_project_installments').select('*').in('project_id', ids).order('project_id').order('installment_no')),
    selectAll(() => supabase.from('civil_project_changes').select('*').in('project_id', ids).order('project_id').order('created_at')),
    selectAll(() => supabase.from('civil_project_defects').select('*').in('project_id', ids).order('project_id').order('inspected_on')),
    selectAll(() => supabase.from('civil_project_documents').select('*').in('project_id', ids).order('project_id').order('created_at')),
    selectAll(() => supabase.from('civil_project_events').select('*').in('project_id', ids).order('project_id').order('created_at', { ascending: false })),
  ])
  const error = [contracts, people, milestones, installments, changes, defects, documents, events].map(r => r.error).find(Boolean) ?? null
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
  put(documents.rows, 'documents')
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

// ── PR-C2: งวดงาน / ขยายเวลา-แก้สัญญา / ตรวจความชำรุด ───────────────────────────────

const fail = message => ({ error: { message }, message })
const NO_PERMISSION = 'บันทึกไม่สำเร็จ (ไม่มีสิทธิ์แก้ไขโครงการนี้)'

/** INSERT/UPDATE แถวลูกของโครงการ — ได้แถวว่างกลับมา = RLS ไม่ให้เขียน */
async function writeChild(table, { id = null, insertRow, patch, duplicateMessage = null }) {
  const query = id
    ? supabase.from(table).update(patch).eq('id', id)
    : supabase.from(table).insert(insertRow)
  const { data, error } = await query.select()
  if (error) return error.code === '23505' && duplicateMessage ? { error, message: duplicateMessage } : { error, message: dbMessage(error) }
  if (!data?.length) return { error: { code: '42501', message: NO_PERMISSION }, message: NO_PERMISSION }
  return { row: data[0] }
}

async function deleteChild(table, id, label) {
  if (!id) return fail('ไม่พบรายการที่จะลบ')
  const { data, error } = await supabase.from(table).delete().eq('id', id).select('id')
  if (error) return { error, message: dbMessage(error) }
  if (!data?.length) return fail(`ลบ${label}ไม่สำเร็จ (ไม่พบรายการ หรือไม่มีสิทธิ์ — ลบได้เฉพาะหัวหน้ากองหรือผู้ดูแลระบบ)`)
  return { deleted: true }
}

/**
 * บันทึกงวดงาน — original = แถวเดิม (มี id = UPDATE ส่งเฉพาะช่องที่เปลี่ยน) · ไม่มี = INSERT งวดใหม่ (ต้องมี installment_no ใน values)
 * ช่องผลตรวจรับ/ช่องที่ล็อกถูกตัดตามสิทธิ์ใน installmentPatch (ไม่ส่งช่องที่คนนี้แก้ไม่ได้)
 */
export async function saveInstallment(projectId, values, original, { manage = false } = {}) {
  if (!projectId) return fail('ไม่พบโครงการ')
  const parsed = installmentPatch(values, original?.id ? original : null, { manage })
  if (parsed.error) return fail(parsed.error)
  if (original?.id) return writeChild('civil_project_installments', { id: original.id, patch: parsed.patch })
  const no = Number(values?.installment_no ?? original?.installment_no)
  if (!Number.isInteger(no) || no < 1) return fail('เลขงวดต้องเป็นจำนวนเต็มตั้งแต่ 1')
  return writeChild('civil_project_installments', {
    insertRow: { project_id: projectId, installment_no: no, ...parsed.patch },
    duplicateMessage: `งวดที่ ${no} มีอยู่แล้ว — โหลดข้อมูลล่าสุดแล้วลองใหม่`,
  })
}
export const deleteInstallment = id => deleteChild('civil_project_installments', id, 'งวด')

/** ขยายเวลา / งดลดค่าปรับ / แก้สัญญา — ผลพิจารณาบันทึกได้เฉพาะผู้จัดการ (ตัดตามสิทธิ์ใน changePatch) */
export async function saveChange(projectId, values, original, { manage = false } = {}) {
  if (!projectId) return fail('ไม่พบโครงการ')
  const parsed = changePatch(values, original?.id ? original : null, { manage })
  if (parsed.error) return fail(parsed.error)
  return writeChild('civil_project_changes', original?.id
    ? { id: original.id, patch: parsed.patch }
    : { insertRow: { project_id: projectId, ...parsed.patch } })
}
export const deleteChange = id => deleteChild('civil_project_changes', id, 'รายการ')

export async function saveDefect(projectId, values, original) {
  if (!projectId) return fail('ไม่พบโครงการ')
  const parsed = defectPatch(values, original?.id ? original : null)
  if (parsed.error) return fail(parsed.error)
  return writeChild('civil_project_defects', original?.id
    ? { id: original.id, patch: parsed.patch }
    : { insertRow: { project_id: projectId, ...parsed.patch } })
}
export const deleteDefect = id => deleteChild('civil_project_defects', id, 'ผลตรวจ')

// ── เอกสารแนบ ────────────────────────────────────────────────────────────────

/** ผู้ใช้ปัจจุบัน (อ่านจาก session ในเครื่อง ไม่ยิงเครือข่าย) — ใช้ตัดสินว่าลบเอกสารที่ตัวเองแนบได้ไหม · ฐานข้อมูลตรวจซ้ำที่ policy */
export async function currentUserId() {
  const { data } = await supabase.auth.getSession()
  return data?.session?.user?.id ?? null
}

/**
 * แนบเอกสาร: มีไฟล์ → อัปโหลดขึ้น Drive (bucket private org-documents · โฟลเดอร์ไม่มีชื่อบุคคล) แล้วบันทึกแถวอ้างไฟล์
 *   ไม่มีไฟล์ก็บันทึกได้ (จดเลขที่เอกสาร e-GP/e-LAAS อย่างเดียว) แต่ต้องมีไฟล์หรือเลขที่อย่างน้อย 1 อย่าง
 *   INSERT ล้มหลังอัปโหลด → ลบไฟล์คืน (ไม่ทิ้งไฟล์ลอยบน Drive)
 */
export async function addDocument({ project, file = null, docKind, title, refNo = null, refDate = null, installmentNo = null, stage = null, source = 'other' } = {}) {
  if (!project?.id) return fail('ไม่พบโครงการ')
  const cleanTitle = String(title ?? '').trim()
  if (!cleanTitle) return fail('กรอกชื่อเอกสาร')
  if (cleanTitle.length > 300) return fail('ชื่อเอกสารยาวเกิน 300 ตัวอักษร')
  if (!DOC_KIND_PATTERN.test(String(docKind ?? ''))) return fail('ชนิดเอกสารไม่ถูกต้อง')
  if (!DOC_SOURCES.includes(source)) return fail('ที่มาของเอกสารไม่ถูกต้อง')
  if (stage !== null && !STAGES.includes(stage)) return fail('ขั้นของเอกสารไม่ถูกต้อง')
  const ref = text(refNo)
  if (ref !== null && ref.length > 200) return fail('เลขที่เอกสารยาวเกิน 200 ตัวอักษร')
  const date = text(refDate)
  if (date !== null && !isIsoDate(date)) return fail('วันที่ของเอกสารไม่ถูกต้อง')
  const no = installmentNo === null || installmentNo === undefined || installmentNo === '' ? null : Number(installmentNo)
  if (no !== null && (!Number.isInteger(no) || no < 1)) return fail('เลขงวดไม่ถูกต้อง')
  if (!file && ref === null) return fail('แนบไฟล์ หรือกรอกเลขที่เอกสารอย่างน้อย 1 อย่าง')

  let fileRef = null
  let fileId = null
  if (file) {
    const invalid = validateAttachment(file)
    if (invalid) return fail(invalid)
    const ext = String(file.name ?? '').split('.').pop()
    const upload = await uploadFile('org-documents', file, {
      subject: `civil/${project.id}`,
      folder: attachmentFolder(project),
      filename: attachmentFileName({ docKind, installmentNo: no, ext }),
    })
    if (upload.error || !upload.url) return { error: upload.error ?? new Error('อัปโหลดไม่สำเร็จ'), message: `อัปโหลดไฟล์ไม่สำเร็จ: ${upload.error?.message ?? 'ไม่ทราบสาเหตุ'}` }
    fileRef = upload.url
    fileId = upload.fileId
  }

  const result = await writeChild('civil_project_documents', {
    insertRow: {
      project_id: project.id, stage, doc_kind: docKind, source, installment_no: no, title: cleanTitle, ref_no: ref, ref_date: date,
      file_ref: fileRef, mime_type: file ? (file.type || null) : null, size_bytes: file ? file.size : null,
    },
  })
  if (result.error && fileId) {
    const undo = await deleteFile(fileId).catch(e => ({ error: e }))
    if (undo?.error) console.warn('คืนไฟล์ที่อัปโหลดไม่สำเร็จ (ไฟล์ค้างบน Drive)', undo.error)
  }
  return result
}

/** ลบเอกสาร: ลบแถวก่อน (ตัวจริง) แล้วย้ายไฟล์ลงถังขยะ Drive แบบ best effort — ล้มแค่เตือนใน console */
export async function deleteDocument(doc) {
  const result = await deleteChild('civil_project_documents', doc?.id, 'เอกสาร')
  if (result.error) return result
  if (isPrivateDriveRef(doc.file_ref)) {
    const gone = await deleteFile(driveFileIdFromRef(doc.file_ref)).catch(e => ({ error: e }))
    if (gone?.error) console.warn('ย้ายไฟล์ลงถังขยะ Drive ไม่สำเร็จ (แถวเอกสารลบแล้ว)', gone.error)
  }
  return result
}

/**
 * เปิดไฟล์เอกสาร — https เปิดตรง (noopener) · drive: ต้องแลกเป็น blob ผ่าน Edge Function (ใช้เวลา)
 *   เปิดหน้าต่างเปล่า "ทันที" ก่อน await (เบราว์เซอร์มือถือบล็อก popup ที่เปิดหลังรอ) แล้วค่อยตั้งปลายทาง · เปิดไม่ได้ปิดหน้าต่างเปล่าทิ้ง
 */
export async function openDocument(doc) {
  const ref = doc?.file_ref
  if (!ref) return fail('เอกสารนี้ไม่มีไฟล์ให้เปิด')
  if (/^https?:\/\//i.test(ref)) {
    window.open(ref, '_blank', 'noopener,noreferrer')
    return { opened: true }
  }
  if (!isPrivateDriveRef(ref)) return fail('เอกสารนี้ไม่มีไฟล์ให้เปิด')
  const win = window.open('', '_blank')
  if (!win) return fail('เบราว์เซอร์บล็อกหน้าต่างใหม่ — อนุญาต pop-up ของเว็บนี้แล้วลองใหม่')
  try { win.opener = null } catch { /* ข้ามไม่ได้ก็ไม่เป็นไร — ปลายทางเป็น blob ของเราเอง */ }
  const { url, error } = await resolvePrivateFileUrl(driveFileIdFromRef(ref))
  if (error || !url) {
    win.close()
    return { error: error ?? new Error('เปิดไฟล์ไม่สำเร็จ'), message: `เปิดไฟล์ไม่สำเร็จ: ${error?.message ?? 'ไม่ทราบสาเหตุ'}` }
  }
  win.location.href = url
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
  return { opened: true }
}

// ── ประวัติ ───────────────────────────────────────────────────────────────────

/** เพิ่มบันทึกข้อความในประวัติโครงการ (kind 'note' เท่านั้น — ฐานประทับผู้บันทึกและเวลา ช่อง detail ถูกล้าง) */
export async function addProjectNote(projectId, reason) {
  const body = text(reason)
  if (!projectId || body === null) return fail('ไม่มีข้อความที่จะบันทึก')
  const { error } = await supabase.from('civil_project_events').insert({ project_id: projectId, kind: 'note', reason: body.slice(0, 4000) })
  return error ? { error, message: dbMessage(error) } : { saved: true }
}

/** บันทึกประวัติแบบ "ล้มได้" — งานหลักสำเร็จแล้ว ประวัติบันทึกไม่ได้ก็ไม่ให้ขึ้น error ใหญ่ (แค่เตือนใน console) */
export async function recordHistory(projectId, reason) {
  try {
    const result = await addProjectNote(projectId, reason)
    if (result.error) console.warn('บันทึกประวัติโครงการไม่สำเร็จ', result.message)
  } catch (error) {
    console.warn('บันทึกประวัติโครงการไม่สำเร็จ', error)
  }
}
