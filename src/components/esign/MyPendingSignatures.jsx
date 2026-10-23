import { useId, useState } from 'react'
import { FileSignature, PenLine, TriangleAlert } from 'lucide-react'
import { Notice } from './EsignBits'
import SignTripDialog from './SignTripDialog'
import { ESIGN_DECISION_LABEL, esignPendingRow } from '../../lib/esign'
import { thaiDateTimeText } from '../../lib/thaiDate'

// รายการ "ใบรอฉันลงนาม" — ใช้สองที่: การ์ด "ต้องทำตอนนี้" บนหน้าแรกเจ้าหน้าที่ (variant="home") และแถบบนสุดของหน้าการใช้รถ (variant="banner")
// กดปุ่มแล้วเปิดกล่องลงนามเดียวกับแผงในหน้ารายละเอียดทริปโดยตรง ไม่ต้องเปิดทริปก่อน:
//   ผู้มีอำนาจ (นายก/ปลัด) ที่ไม่มีสิทธิ์ยานพาหนะเต็มเปิดทริปจากรายการไม่ได้ (RLS ของ fleet_trips) แต่ลงนามช่องของตัวเองได้ผ่านที่นี่
// ข้อมูลมาจาก esign_my_pending (DB ตัดสินว่าใครถึงคิวแล้ว) · คอมโพเนนต์นี้ไม่เดาสิทธิ์เอง
//
// คอมโพเนนต์อยู่ติดจอเสมอ (ไม่ถูก unmount เมื่อรายการหมด) เพื่อให้ข้อความ "ลงนามแล้ว" ยังอยู่หลังแถวสุดท้ายหายไป
export default function MyPendingSignatures({ status, items, variant = 'home', limit, moreHint, onSigned, onRetry }) {
  const [signing, setSigning] = useState(null)
  const [notice, setNotice] = useState(null)
  // หน้ายานพาหนะเรนเดอร์เนื้อหาสองชุด (มือถือ/เดสก์ท็อป ซ่อนด้วย CSS) — id ต้องไม่ซ้ำ ไม่งั้น aria-labelledby ชี้ผิดชุด
  const titleId = useId()
  const isBanner = variant === 'banner'

  if (status === 'error') {
    return (
      <div role="alert" data-pending-sign-error
        className="flex min-h-12 flex-wrap items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        <TriangleAlert size={16} className="shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1">ตรวจรายการใบรอลงนามไม่สำเร็จ — อาจมีใบที่รอคุณอยู่</span>
        {onRetry && (
          <button type="button" onClick={onRetry} className="min-h-9 shrink-0 rounded-lg border border-amber-300 bg-white px-3 text-xs font-bold text-amber-900">ลองใหม่</button>
        )}
      </div>
    )
  }
  if (status !== 'ok' && !notice) return null

  const rows = items.map(esignPendingRow)
  const shown = limit ? rows.slice(0, limit) : rows
  if (rows.length === 0 && !notice) return null

  return (
    <section data-pending-sign={variant} aria-labelledby={titleId}
      className={isBanner ? 'space-y-2 rounded-2xl border border-amber-300 bg-amber-50 p-3' : 'space-y-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm'}>
      <div className="flex flex-wrap items-center gap-2">
        <FileSignature size={16} className={isBanner ? 'text-amber-700' : 'text-slate-500'} aria-hidden="true" />
        <h2 id={titleId} className={`text-sm font-bold ${isBanner ? 'text-amber-900' : 'text-slate-800'}`}>
          {rows.length > 0 ? 'รอลงนามของฉัน' : 'ลงนามออนไลน์'}
        </h2>
        {rows.length > 0 && (
          <span data-pending-sign-count className={`rounded-full px-2 py-0.5 text-[11px] font-black tabular-nums ${isBanner ? 'bg-amber-200 text-amber-900' : 'bg-slate-100 text-slate-700'}`}>
            {rows.length}<span className="sr-only"> ใบ</span>
          </span>
        )}
      </div>

      <Notice notice={notice} data-pending-sign-notice />

      {shown.length > 0 && (
        <ul className="space-y-2">
          {shown.map(row => (
            <li key={row.key} data-pending-sign-row data-trip-id={row.tripId} data-slot={row.slot}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-gray-200 bg-white p-3">
              <div className="min-w-0 flex-1 basis-48">
                <p className="break-words text-sm font-bold text-gray-800">{row.title}</p>
                <p className="break-words text-[11px] text-gray-500">
                  {[row.vehicleName, row.plannedDeparture ? `ออก ${thaiDateTimeText(row.plannedDeparture)}` : null].filter(Boolean).join(' · ') || 'ใบขออนุญาตใช้ยานพาหนะ (แบบ ๓)'}
                </p>
                <p className="mt-0.5 text-[11px] font-semibold text-amber-700">ช่องที่รอคุณ: {row.slotLabel}</p>
              </div>
              <button type="button" data-pending-sign-button onClick={() => setSigning(row)}
                className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl px-4 text-sm font-bold text-white" style={{ backgroundColor: 'var(--color-primary)' }}>
                <PenLine size={15} aria-hidden="true" /> {row.actionLabel}
              </button>
            </li>
          ))}
        </ul>
      )}

      {rows.length > shown.length && (
        <p data-pending-sign-more className="text-[11px] text-gray-500">แสดง {shown.length} จาก {rows.length} ใบ{moreHint ? ` · ${moreHint}` : ''}</p>
      )}

      {signing && (
        <SignTripDialog tripId={signing.tripId} slot={signing.slot} slotLabel={signing.slotLabel} summary={signing.summary}
          onClose={() => setSigning(null)}
          onSigned={result => {
            const decision = signing.slot === 'authority' ? 'approve' : 'sign'
            setSigning(null)
            setNotice({ ok: true, text: `${ESIGN_DECISION_LABEL[decision]}แล้ว${result?.stamped ? ' พร้อมแนบภาพลายเซ็น' : ''}${result?.complete ? ' — ลงนามครบทุกช่องแล้ว' : ''}` })
            onSigned?.(result)
          }} />
      )}
    </section>
  )
}
