import { PERMIT_STAGES, permitExpiryInfo, stageIndex, stageLabel, thaiShortDate } from '../lib/buildingPermitStage'

// ส่วนแสดงผลความคืบหน้าใบอนุญาตก่อสร้างแบบอ่านอย่างเดียว — ใช้ร่วมหน้าประชาชน (MyDocRequests) และกรอบเจ้าหน้าที่
// (components/staff/BuildingPermitStagePanel) · แยกไฟล์ไว้ตรงกลาง ไม่ให้หน้าประชาชนดึงโค้ดฝั่งเจ้าหน้าที่ (RPC) ติดไปด้วย

const TONE_CLS = {
  ok:      'text-emerald-700 bg-emerald-50',
  soon:    'text-amber-800 bg-amber-50',
  expired: 'text-red-700 bg-red-50',
}

// แถบ 6 ช่อง: ขั้นที่ผ่านแล้ว = เขียว · ขั้นปัจจุบัน = ม่วง · ที่เหลือ = เทา (แคบพอสำหรับมือถือ 360px)
export function PermitStepper({ stage }) {
  const current = Math.max(0, stageIndex(stage))
  return (
    <div>
      <div role="img" aria-label={`ขั้นที่ ${current + 1} จาก ${PERMIT_STAGES.length}: ${stageLabel(stage)}`}
        className="flex gap-1">
        {PERMIT_STAGES.map((s, i) => (
          <span key={s.label} data-permit-step={i}
            className={`h-2 flex-1 rounded-full ${i < current ? 'bg-emerald-400' : i === current ? 'bg-violet-600' : 'bg-gray-200'}`} />
        ))}
      </div>
      <p className="mt-1.5 text-sm font-bold text-gray-800">
        <span className="text-violet-700">{stageLabel(stage)}</span>
        <span className="ml-1.5 text-[11px] font-medium text-gray-400">ขั้นที่ {current + 1}/{PERMIT_STAGES.length}</span>
      </p>
    </div>
  )
}

// เลขที่ใบอนุญาต + ข้อความวันหมดอายุ — ไม่มีข้อมูลก็ไม่แสดงอะไร
export function PermitNumberAndExpiry({ req }) {
  const expiry = permitExpiryInfo(req.permit_expires_on)
  if (!req.permit_no && !expiry && !req.permit_issued_on) return null
  return (
    <div className="space-y-1.5">
      {req.permit_no && (
        <p className="text-sm font-semibold text-gray-800">ใบอนุญาตเลขที่ {req.permit_no}</p>
      )}
      {req.permit_issued_on && (
        <p className="text-xs text-gray-500">ออกเมื่อ {thaiShortDate(req.permit_issued_on)}</p>
      )}
      {expiry && (
        <p data-permit-expiry={expiry.tone}
          className={`rounded-xl px-3 py-2 text-sm font-semibold ${TONE_CLS[expiry.tone]}`}>
          {expiry.text}
        </p>
      )}
    </div>
  )
}
