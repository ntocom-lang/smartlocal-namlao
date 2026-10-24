// เรียก RPC ขั้นตอนคำร้องของผู้รับผิดชอบ/ผู้ร้อง — กติกาอยู่ที่ complaintWorkflow.js และฝั่ง DB
import { supabase } from './supabase'
import { notifyTelegram } from './notifyTelegram'
import { compressImage } from './imageUtils'
import { uploadFile } from './driveStorage'
import { complaintFileName, complaintFolderPath } from './driveFolders'

export async function startComplaintWork(complaintId) {
  const { error } = await supabase.rpc('start_complaint_work', { p_complaint_id: complaintId })
  if (!error) notifyTelegram('complaint_status_updated', complaintId)
  return { error }
}

/**
 * ขึ้นทะเบียนรอดำเนินการ (ทีละเรื่องหรือหลายเรื่อง) — กติกาอยู่ที่ park_complaints() ใน DB
 * ไม่ยิง Telegram/push: เป็นการจัดคิวภายใน กลุ่ม Telegram ไม่ต้องทำอะไรต่อ (ชุดหลายสิบเรื่องจะท่วมกลุ่ม)
 * ผู้ร้องเห็นสถานะใหม่ที่หน้าติดตามเรื่อง/คำร้องของฉันเอง
 * @returns {Promise<{ result: { parked: number, skipped: Array<{ id: string, code: string }> } | null, error: Error | null }>}
 */
export async function parkComplaints(ids, reason, note = '') {
  const { data, error } = await supabase.rpc('park_complaints', {
    p_complaint_ids: ids,
    p_reason: reason,
    p_note: String(note ?? '').trim() || null,
  })
  return { result: error ? null : (data ?? null), error }
}

/** นำเรื่องที่ขึ้นทะเบียนไว้กลับเข้าคิวงาน (received + เริ่มนับกำหนดเสร็จใหม่) — แจ้งกลุ่ม Telegram เหมือนรับเรื่องใหม่ */
export async function unparkComplaint(complaintId) {
  const { error } = await supabase.rpc('unpark_complaint', { p_complaint_id: complaintId })
  if (!error) notifyTelegram('complaint_status_updated', complaintId)
  return { error }
}

/**
 * หมวดที่เปิด allow_parking — แยกจากคิวรีหมวดหลักโดยเจตนา: ถ้าหน้าเว็บ deploy ก่อน apply migration
 * (คอลัมน์ยังไม่มี) คิวรีนี้พลาดแล้วได้ {} = ไม่แสดงปุ่ม แทนที่จะพาคิวรีหมวดหลักพังทั้งหน้า (ชื่อหมวดหาย)
 * @returns {Promise<Record<string, boolean>>} รหัสหมวด → true
 */
export async function fetchParkingCategories(municipalityId) {
  if (!municipalityId) return {}
  try {
    const { data, error } = await supabase
      .from('complaint_categories')
      .select('value, allow_parking')
      .eq('municipality_id', municipalityId)
    if (error) return {}
    return Object.fromEntries((data ?? []).filter((row) => row.allow_parking === true).map((row) => [row.value, true]))
  } catch {
    return {}
  }
}

/**
 * กด "ดำเนินการแล้ว": อัปโหลดรูป (ถ้ามี) → RPC finish_complaint → แจ้งผู้ร้อง + Telegram
 * @param {object} p
 * @param {object} p.complaint แถวคำร้อง (ใช้ id, ref_no, created_at, work_photos)
 * @param {{lat:number,lng:number}|null} p.pin หมุดจุดที่ดำเนินการ
 * @param {File[]} [p.files] รูปผลงาน (ไม่บังคับ)
 * @param {string} [p.note]
 * @param {string} [p.categoryLabel]
 * @param {string} [p.tenantSlug]
 */
export async function finishComplaint({ complaint, pin, files = [], note = '', categoryLabel = '', tenantSlug }) {
  const urls = []
  const already = Array.isArray(complaint.work_photos) ? complaint.work_photos.length : 0
  for (const [i, file] of files.entries()) {
    const ext = (file.name?.split('.').pop() || 'jpg').toLowerCase()
    const compressed = await compressImage(file, 1200)
    const folder = complaint.ref_no
      ? complaintFolderPath({ refNo: complaint.ref_no, categoryLabel, createdAt: complaint.created_at })
      : undefined
    const filename = complaint.ref_no
      ? complaintFileName({ refNo: complaint.ref_no, kind: 'work', index: already + i + 1, ext })
      : `work_${Date.now()}_${i}.${ext}`
    const { url, error } = await uploadFile('complaint-attachments', compressed, {
      subject: complaint.id, folder, filename, municipality: tenantSlug,
    })
    // อัปโหลดไม่ผ่าน = หยุดทั้งหมด ไม่ปิดงานไปทั้งที่รูปหาย (ผู้ใช้เลือกแนบเองแปลว่าต้องการเก็บไว้)
    if (error || !url) return { error: new Error('อัปโหลดรูปไม่สำเร็จ กรุณาลองใหม่: ' + (error?.message ?? '')) }
    urls.push(url)
  }

  const { error } = await supabase.rpc('finish_complaint', {
    p_complaint_id: complaint.id,
    p_latitude: pin?.lat ?? null,
    p_longitude: pin?.lng ?? null,
    p_note: note?.trim() || null,
    p_work_photos: urls,
  })
  if (error) return { error }

  // แจ้งผู้ร้อง: ส่งแค่เลขคำร้อง send-push หาเจ้าของและประกอบข้อความเอง — list_complaints_for_staff
  // ตัด user_id ทิ้งสำหรับ officer/staff (PDPA) เดิมเช็ก complaint.user_id ผู้ร้องจึงไม่ได้แจ้งเตือน
  // เมื่อ officer/staff ปิดงานจากตาราง
  supabase.functions.invoke('send-push', {
    body: { complaint_id: complaint.id, kind: 'complaint_finished' },
  }).catch(() => {})
  notifyTelegram('complaint_status_updated', complaint.id)
  return { error: null, workPhotos: urls }
}

export async function reopenComplaint(complaintId, reason) {
  const { data, error } = await supabase.rpc('reopen_complaint', {
    p_complaint_id: complaintId,
    p_reason: String(reason ?? '').trim(),
  })
  if (!error) notifyTelegram('complaint_reopened', complaintId)
  return { status: data ?? null, error }
}

/** ส่ง undefined = ไม่แก้ช่องนั้น */
export async function editComplaintText(complaintId, { subject, detail, technicianNote } = {}) {
  const { error } = await supabase.rpc('edit_complaint_text', {
    p_complaint_id: complaintId,
    p_subject: subject === undefined ? null : subject,
    p_detail: detail === undefined ? null : detail,
    p_technician_note: technicianNote === undefined ? null : technicianNote,
  })
  return { error }
}

export async function fetchTextRevisions(complaintId) {
  const { data, error } = await supabase
    .from('complaint_text_revisions')
    .select('id, field, old_value, new_value, edited_by_name, edited_role, edited_at')
    .eq('complaint_id', complaintId)
    .order('edited_at', { ascending: true })
  return { data: data ?? [], error }
}
