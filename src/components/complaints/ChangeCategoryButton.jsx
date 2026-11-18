import { useEffect, useMemo, useState } from 'react'
import { ArrowLeftRight, Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { notifyTelegram } from '../../lib/notifyTelegram'
import { RETURN_REASON_MAX, validateReturnReason } from '../../lib/complaintIntake'
import { categoryChangeChoices, describeCategoryChange, isFinishedForCategoryChange } from '../../lib/complaintCategoryChange'

// ปุ่ม "แก้ประเภทคำร้อง" ของแอดมิน/หัวหน้ากองที่ถือเรื่อง — กองของคำร้องเปลี่ยนตามประเภทใหม่เอง
// (ใบพิมพ์ + ช่องลงนามหัวหน้ากองตามไปด้วย) ใช้เมื่อประชาชนเลือกประเภทผิด หรือเรื่องถูกส่งผิดกอง
// ผู้ใช้เลือกประเภท + เหตุผลบรรทัดเดียว ส่วนกอง/ผู้รับผิดชอบ/สถานะ ระบบจัดให้เองตามกติกาเดียวกับคำร้องใหม่
// สิทธิ์และเงื่อนไขจริงตรวจที่ change_complaint_category() ผู้เรียกใช้ canChangeComplaintCategory() กันปุ่มโผล่ผิดที่
export default function ChangeCategoryButton({ complaint, municipalityId, role, onChanged }) {
  // แถวจาก list_complaints_for_staff อาจไม่มี municipality_id — ใช้ tenant ของหน้าเป็นค่าสำรอง (DB ตรวจหน่วยงานซ้ำเอง)
  const muniId = complaint?.municipality_id ?? municipalityId
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [categories, setCategories] = useState([])
  const [departments, setDepartments] = useState([])
  const [target, setTarget] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open || !muniId) return
    let cancelled = false
    // loading ตั้งเป็น true ตอนกดเปิด (ปุ่มข้างล่าง) — ไม่ setState ตรงใน effect
    Promise.all([
      supabase.from('complaint_categories')
        .select('value,label,department_id,is_active,is_adhoc,sort_order')
        .eq('municipality_id', muniId).order('sort_order'),
      supabase.from('departments').select('id,name').eq('municipality_id', muniId),
    ]).then(([catRes, deptRes]) => {
      if (cancelled) return
      if (catRes.error) setError('โหลดรายการประเภทไม่ได้: ' + catRes.error.message)
      setCategories(catRes.data ?? [])
      setDepartments(deptRes.data ?? [])
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [open, muniId])

  const choices = useMemo(
    () => categoryChangeChoices(categories, departments, complaint?.category, role, complaint?.department_id ?? null),
    [categories, departments, complaint?.category, complaint?.department_id, role],
  )
  const finished = isFinishedForCategoryChange(complaint)
  const picked = choices.find((item) => item.value === target)

  function close() {
    setOpen(false)
    setTarget('')
    setReason('')
    setError('')
  }

  async function submit() {
    if (!picked) { setError('กรุณาเลือกประเภทใหม่'); return }
    const invalid = validateReturnReason(reason)
    if (invalid) { setError(invalid); return }
    setSaving(true)
    const { data, error: rpcError } = await supabase.rpc('change_complaint_category', {
      p_complaint_id: complaint.id,
      p_category: picked.value,
      p_reason: reason.trim(),
    })
    setSaving(false)
    if (rpcError) {
      setError('แก้ประเภทไม่สำเร็จ: ' + rpcError.message)
      return
    }
    // ผู้รับผิดชอบคนใหม่ที่ผูก Telegram ส่วนตัวได้ข้อความทันที เหมือนตอนแอดมินมอบหมาย
    if (data?.assignee_changed && data?.assigned_to) notifyTelegram('complaint_assigned_dm', complaint.id)
    close()
    onChanged?.(complaint.id, describeCategoryChange(data))
  }

  if (!open) {
    return (
      <button type="button" onClick={() => { setLoading(true); setOpen(true) }}
        className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 transition-colors">
        <ArrowLeftRight size={13} /> แก้ประเภทคำร้อง (ย้ายกองตามประเภท)
      </button>
    )
  }

  return (
    <div className="w-full space-y-2 rounded-2xl border border-indigo-200 bg-indigo-50 p-3">
      <p className="text-xs font-semibold text-indigo-800">แก้ประเภทคำร้อง — กองที่รับผิดชอบจะเปลี่ยนตามประเภทใหม่</p>
      {loading ? (
        <p className="text-xs text-gray-500 inline-flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> กำลังโหลดรายการประเภท…</p>
      ) : (
        <select value={target} onChange={(e) => { setTarget(e.target.value); setError('') }}
          aria-label="ประเภทใหม่"
          className="w-full rounded-xl border border-indigo-200 bg-white px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-300">
          <option value="">— เลือกประเภทใหม่ —</option>
          {choices.map((item) => (
            <option key={item.value} value={item.value}>{item.label} → {item.departmentName}</option>
          ))}
        </select>
      )}
      {picked && (
        <p className="text-[11px] text-indigo-700">
          จะย้ายไป <span className="font-semibold">{picked.departmentName}</span> · ใบพิมพ์และช่องลงนามหัวหน้ากองเปลี่ยนตาม ·
          {finished
            ? ' เรื่องนี้ปิดแล้ว: สถานะและผู้รับผิดชอบคงเดิม ผู้ลงนามปลัด/นายกยังเป็นคน ณ วันปิดเรื่อง ·'
              + ' สถิติรายกอง/รายประเภทของเดือนที่ปิดเรื่องจะเปลี่ยนตาม (ยกเว้นเดือนที่ล็อกตัวเลขแล้ว) · ใบที่พิมพ์ไปแล้วไม่เปลี่ยน'
            : ' ถ้าผู้รับผิดชอบเดิมไม่ได้อยู่กองนี้ ระบบตั้งผู้รับผิดชอบประจำประเภทให้ (ไม่มี = กลับคิวแอดมิน)'}
        </p>
      )}
      {!loading && choices.length === 0 && (
        <p className="text-[11px] text-gray-500">ไม่มีประเภทอื่นที่ย้ายได้ และกองของเรื่องตรงกับประเภทอยู่แล้ว</p>
      )}
      <textarea
        rows={2}
        maxLength={RETURN_REASON_MAX}
        value={reason}
        onChange={(e) => { setReason(e.target.value); setError('') }}
        placeholder="เหตุผล เช่น ประชาชนเลือกประเภทผิด / เป็นงานของสำนักปลัด"
        className="w-full rounded-xl border border-indigo-200 bg-white px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-300"
      />
      {/* timeline อ่านได้ทั้งเจ้าหน้าที่ทุกระดับใน อปท. และผู้ยื่นเรื่อง — บอกก่อนพิมพ์ ไม่ใส่ชื่อบุคคล */}
      <p className="text-[11px] text-gray-500">
        {finished
          ? 'เหตุผลนี้บันทึกในบันทึกการใช้งานของแอดมิน ไม่แสดงในประวัติของคำร้อง'
          : 'เหตุผลนี้จะแสดงในประวัติของคำร้อง เจ้าหน้าที่และผู้ยื่นเรื่องเห็นได้ — ไม่ต้องใส่ชื่อบุคคล'}
      </p>
      {error && <p className="text-xs font-medium text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={submit} disabled={saving || loading}
          className="flex-1 inline-flex items-center justify-center gap-1 py-2 rounded-xl text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 transition-colors">
          {saving ? <Loader2 size={13} className="animate-spin" /> : <ArrowLeftRight size={13} />} ยืนยันแก้ประเภท
        </button>
        <button type="button" onClick={close} disabled={saving}
          className="flex-1 py-2 rounded-xl text-xs font-medium text-gray-600 bg-white border border-gray-200 hover:bg-gray-50 disabled:opacity-50 transition-colors">
          ยกเลิก
        </button>
      </div>
    </div>
  )
}
