import { useState } from 'react'
import { Loader2, ChevronRight, FileCheck2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { thaiDateTimeText } from '../../lib/thaiDate'
import { PERMIT_STAGES, nextStage, stageAllowsPermitFields, stageLabel } from '../../lib/buildingPermitStage'
import { PermitStepper, PermitNumberAndExpiry } from '../BuildingPermitProgress'

// กรอบ "ความคืบหน้าใบอนุญาตก่อสร้าง" ในรายละเอียดคำขอ (เจ้าหน้าที่) (ส่วนแสดงผลอ่านอย่างเดียวอยู่ที่ components/BuildingPermitProgress.jsx ใช้ร่วมกับหน้าประชาชน)
//
// ขั้นย่อยนี้แค่แจ้งความคืบหน้า ไม่ใช่การตัดสินอนุญาต และไม่เปลี่ยน status หลักของคำขอ
// แก้ได้ทางเดียวคือ RPC set_building_permit_stage (ตรวจสิทธิ์ + ลง audit_logs ในฐานข้อมูล) — ห้าม .update() ตรง
// เพราะ trigger กันแก้ 6 คอลัมน์นี้จาก API · error.message จาก RPC เป็นภาษาไทยพร้อมแสดงได้เลย
// เลขที่/วันออก/วันหมดอายุเจ้าหน้าที่กรอกตามใบจริง ห้ามตั้งค่าเริ่มต้นให้ (อายุใบขึ้นกับประเภท/เงื่อนไขในใบ)

const inputCls = 'w-full min-h-11 border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-violet-200'

export default function BuildingPermitStagePanel({ req, canEdit = false, onChanged }) {
  const stage = req.permit_stage ?? null
  const next = nextStage(stage)
  const [picking, setPicking] = useState(false)
  const [form, setForm] = useState(null) // null = ปิดฟอร์ม · { stage } = กำลังกรอกเลขที่/วันที่ของขั้นนั้น
  const [permitNo, setPermitNo] = useState('')
  const [issuedOn, setIssuedOn] = useState('')
  const [expiresOn, setExpiresOn] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function openForm(targetKey) {
    setPermitNo(req.permit_no ?? '')
    setIssuedOn(req.permit_issued_on ?? '')
    setExpiresOn(req.permit_expires_on ?? '')
    setError('')
    setForm({ stage: targetKey })
  }

  function closeAll() {
    setForm(null)
    setPicking(false)
    setError('')
  }

  async function save(targetKey, fields) {
    setBusy(true)
    setError('')
    const withFields = stageAllowsPermitFields(targetKey)
    const args = {
      p_request_id: req.id,
      p_stage: targetKey,
      p_permit_no: withFields ? (fields?.permitNo?.trim() || null) : null,
      p_issued_on: withFields ? (fields?.issuedOn || null) : null,
      p_expires_on: withFields ? (fields?.expiresOn || null) : null,
    }
    const { data, error: rpcError } = await supabase.rpc('set_building_permit_stage', args)
    setBusy(false)
    if (rpcError) { setError(rpcError.message); return }
    const patch = {
      permit_stage: targetKey,
      permit_no: args.p_permit_no,
      permit_issued_on: args.p_issued_on,
      permit_expires_on: args.p_expires_on,
    }
    // changed = false → ไม่มีอะไรเปลี่ยนในฐานข้อมูล จึงไม่แตะเวลาอัปเดตล่าสุด
    if (data?.changed) patch.permit_stage_at = new Date().toISOString()
    onChanged?.(patch)
    closeAll()
  }

  function handleAdvance() {
    if (!next) return
    if (stageAllowsPermitFields(next.key)) openForm(next.key)
    else save(next.key)
  }

  function handlePick(value) {
    if (!value) return
    const targetKey = value === 'start' ? null : value
    if (targetKey === stage && !stageAllowsPermitFields(targetKey)) { setPicking(false); return }
    if (stageAllowsPermitFields(targetKey)) { setPicking(false); openForm(targetKey); return }
    // ย้อนไปก่อนออกใบ = ฐานข้อมูลล้างเลขที่/วันที่ทั้งหมด (ค่าเดิมยังอยู่ในประวัติ audit) ต้องให้ยืนยันก่อน
    if (stageAllowsPermitFields(stage)
      && !window.confirm(`ย้อนเป็น "${stageLabel(targetKey)}"?\n\nเลขที่ใบอนุญาต วันที่ออก และวันหมดอายุที่บันทึกไว้จะถูกล้างออก (ประวัติการแก้ไขยังเก็บไว้)`)) {
      return
    }
    setPicking(false)
    save(targetKey)
  }

  const updatedText = req.permit_stage_at ? thaiDateTimeText(req.permit_stage_at) : ''

  return (
    <div data-permit-stage-panel className="rounded-2xl border border-violet-100 bg-violet-50/40 p-4 space-y-3">
      <p className="text-[11px] font-bold uppercase tracking-wider text-violet-500">ความคืบหน้าใบอนุญาตก่อสร้าง</p>

      <PermitStepper stage={stage} />
      {updatedText && <p className="text-[11px] text-gray-400">อัปเดตล่าสุด {updatedText}</p>}

      <PermitNumberAndExpiry req={req} />

      {canEdit && !form && (
        <div className="space-y-2">
          {next && (
            <button type="button" onClick={handleAdvance} disabled={busy}
              className="flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white transition-all active:scale-[0.98] disabled:opacity-50">
              {busy ? <Loader2 size={16} className="animate-spin" /> : <ChevronRight size={16} />}
              เลื่อนเป็น: {next.label}
            </button>
          )}
          {picking ? (
            <div className="flex items-center gap-2">
              <select value="" onChange={e => handlePick(e.target.value)} disabled={busy}
                aria-label="เลือกขั้นที่ต้องการแก้" className={inputCls}>
                <option value="">เลือกขั้น…</option>
                {PERMIT_STAGES.map(s => (
                  <option key={s.label} value={s.key ?? 'start'}>
                    {s.label}{s.key === stage ? (stageAllowsPermitFields(s.key) ? ' (ขั้นปัจจุบัน · แก้เลขที่/วันที่)' : ' (ขั้นปัจจุบัน)') : ''}
                  </option>
                ))}
              </select>
              <button type="button" onClick={() => setPicking(false)}
                className="min-h-11 shrink-0 rounded-xl px-3 text-sm font-semibold text-gray-500 hover:bg-gray-100">
                ยกเลิก
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => { setError(''); setPicking(true) }}
              className="min-h-11 w-full text-center text-xs font-semibold text-violet-700 underline underline-offset-2">
              แก้ขั้น (กดผิด/ย้อนขั้น)
            </button>
          )}
        </div>
      )}

      {canEdit && form && (
        <div className="space-y-3 rounded-xl border border-violet-200 bg-white p-3">
          <p className="flex items-center gap-1.5 text-sm font-bold text-gray-800">
            <FileCheck2 size={15} className="text-violet-600" /> {stageLabel(form.stage)}
          </p>
          <p className="text-xs leading-relaxed text-gray-500">กรอกตามที่พิมพ์ในใบอนุญาต (ไม่บังคับ)</p>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-gray-600">เลขที่ใบอนุญาต</span>
            <input type="text" value={permitNo} onChange={e => setPermitNo(e.target.value)} maxLength={60}
              placeholder="เช่น 12/2569" className={inputCls} />
          </label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-gray-600">วันที่ออก</span>
              <input type="date" value={issuedOn} onChange={e => setIssuedOn(e.target.value)} className={inputCls} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-gray-600">วันหมดอายุ (วันสุดท้ายที่ใช้ได้)</span>
              <input type="date" value={expiresOn} onChange={e => setExpiresOn(e.target.value)} className={inputCls} />
            </label>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={closeAll} disabled={busy}
              className="min-h-11 flex-1 rounded-xl border border-gray-200 bg-white text-sm font-semibold text-gray-600 hover:bg-gray-50">
              ยกเลิก
            </button>
            <button type="button" disabled={busy}
              onClick={() => save(form.stage, { permitNo, issuedOn, expiresOn })}
              className="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-violet-600 text-sm font-semibold text-white disabled:opacity-50">
              {busy ? <Loader2 size={15} className="animate-spin" /> : 'บันทึก'}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" data-permit-stage-error className="rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</p>
      )}
    </div>
  )
}
