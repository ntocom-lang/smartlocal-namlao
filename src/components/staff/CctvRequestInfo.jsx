import { AlertTriangle, Video } from 'lucide-react'
import {
  CCTV_FORM_TYPE, cctvBangkokToday, cctvIncidentLabel, cctvOverwriteInfo, cctvRetentionDays, cctvRoleLabel,
} from '../../lib/cctvRequest'
import { thaiDateFromDateInput } from '../../lib/thaiDate'

function Row({ label, children }) {
  return (
    <div className="flex gap-3 text-sm">
      <dt className="w-24 shrink-0 text-xs font-semibold text-gray-400">{label}</dt>
      <dd className="min-w-0 break-words font-medium text-gray-800">{children}</dd>
    </div>
  )
}

/**
 * รายละเอียดคำขอภาพกล้องวงจรปิดบนหน้าเจ้าหน้าที่ — แทรกในใบคำขอเดิม ไม่มีเมนูใหม่
 * ขึ้นป้ายเร่งเมื่อภาพใกล้ถูกบันทึกทับ/เลยรอบแล้ว คำนวณจาก "กล้องเก็บภาพย้อนหลังกี่วัน" ที่แอดมินตั้งครั้งเดียว
 * (ไม่ได้ตั้ง = ไม่ขึ้นป้าย ไม่เดาตัวเลขให้) ป้ายเป็นการประมาณ ข้อความต้องใช้คำว่า "อาจ" เสมอ
 */
export default function CctvRequestInfo({ req, tenant }) {
  const form = req?.permit_form_data
  if (!form || form.form_type !== CCTV_FORM_TYPE) return null

  const active = req.status === 'pending' || req.status === 'processing'
  const retentionDays = cctvRetentionDays(tenant)
  const info = cctvOverwriteInfo({ incidentDate: form.incident_date, retentionDays, today: cctvBangkokToday() })
  const overwriteText = info.overwriteDate ? thaiDateFromDateInput(info.overwriteDate) : ''

  return (
    <div className="space-y-3" data-cctv-request>
      {active && info.status === 'soon' && (
        <div role="alert" data-cctv-urgent="soon" className="flex gap-2.5 rounded-2xl border border-red-200 bg-red-50 p-3.5 text-red-800">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <div className="text-sm leading-relaxed">
            <p className="font-bold">เร่ง · ภาพอาจถูกบันทึกทับภายใน {info.daysLeft} วัน</p>
            <p className="text-xs">เหตุเกิด {thaiDateFromDateInput(form.incident_date)} · กล้องเก็บภาพย้อนหลัง {retentionDays} วัน → ถึงรอบทับ {overwriteText}</p>
          </div>
        </div>
      )}
      {active && info.status === 'overwritten' && (
        <div role="alert" data-cctv-urgent="overwritten" className="flex gap-2.5 rounded-2xl border border-red-200 bg-red-50 p-3.5 text-red-800">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <div className="text-sm leading-relaxed">
            <p className="font-bold">เลยรอบเก็บภาพแล้ว · ภาพอาจไม่เหลือ</p>
            <p className="text-xs">เหตุเกิด {thaiDateFromDateInput(form.incident_date)} · กล้องเก็บภาพย้อนหลัง {retentionDays} วัน (ถึงรอบทับ {overwriteText}) ตรวจที่เครื่องบันทึกก่อน ถ้าไม่มีภาพให้ปฏิเสธพร้อมเหตุผล</p>
          </div>
        </div>
      )}

      <div className="rounded-2xl bg-gray-50 p-4 space-y-2.5">
        <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-gray-400">
          <Video size={13} /> รายละเอียดคำขอภาพกล้องวงจรปิด
        </p>
        <dl className="space-y-2">
          <Row label="เหตุการณ์">{cctvIncidentLabel(form.incident_type) || '—'}</Row>
          <Row label="วัน-เวลา">{thaiDateFromDateInput(form.incident_date)} · {form.time_from}–{form.time_to} น.</Row>
          <Row label="จุดกล้อง">{form.camera_label || '—'}</Row>
          {form.description && <Row label="รายละเอียด">{form.description}</Row>}
          <Row label="ฐานะผู้ขอ">{cctvRoleLabel(form.requester_role) || '—'}</Row>
          {form.police_ref && <Row label="ใบแจ้งความ">{form.police_ref}</Row>}
        </dl>
        <p className="border-t border-gray-200 pt-2 text-[11px] leading-relaxed text-gray-400">
          ระบบนี้เก็บเฉพาะคำขอ ไม่มีไฟล์ภาพ — ค้นภาพ ตัดสินว่าจะให้ใคร และส่งมอบนอกระบบ ตามนโยบายของหน่วยงานและความเห็น DPO
          ตรวจบัตรประชาชนตัวจริงของผู้รับก่อนส่งมอบ แล้วบันทึกชื่อผู้รับในช่องบันทึกเจ้าหน้าที่
        </p>
      </div>
    </div>
  )
}
