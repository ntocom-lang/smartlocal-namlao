import { supabase } from './supabase'

export const SIGNATORY_ROLE_LABEL = {
  department_head: 'หัวหน้ากอง/ส่วนราชการ',
  clerk: 'ปลัด',
  mayor: 'นายก',
}

export async function prepareComplaintPrint(complaintId, allowBlankSignatories = false) {
  if (!complaintId) {
    return { data: null, error: new Error('ไม่พบรหัสคำร้อง') }
  }

  const result = await supabase.rpc('prepare_complaint_print', {
    p_complaint_id: complaintId,
    p_allow_blank_signatories: allowBlankSignatories,
  })

  return {
    data: result.data ?? null,
    error: result.error ?? null,
  }
}

export function isMissingSignatoryError(error) {
  return error?.code === 'P0001' || String(error?.message ?? '').includes('ตั้งค่าผู้ลงนามไม่ครบ')
}

export function missingSignatoryLabel(roles = []) {
  return roles.map((role) => SIGNATORY_ROLE_LABEL[role] ?? role).join(', ')
}
