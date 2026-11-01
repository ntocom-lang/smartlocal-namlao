import { thaiDateTimeText } from '../../lib/thaiDate'

// ชิ้นส่วนเล็กๆ ที่หน้าลงนามออนไลน์ใช้ร่วมกัน (ข้อความแจ้งผล · ป้ายสถานะ · การส่งคืน)
export function Notice({ notice, ...rest }) {
  if (!notice) return null
  const style = notice.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-700'
  return <p role={notice.ok ? 'status' : 'alert'} className={`rounded-xl border px-3.5 py-2 text-xs leading-5 ${style}`} {...rest}>{notice.text}</p>
}

const CHIP_TONES = {
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  warn: 'border-amber-200 bg-amber-50 text-amber-700',
  bad: 'border-red-200 bg-red-50 text-red-700',
  mute: 'border-gray-200 bg-gray-50 text-gray-600',
}

export function Chip({ tone = 'mute', children }) {
  return <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${CHIP_TONES[tone]}`}>{children}</span>
}

// การส่งคืนล่าสุดของใบ (last_return จาก esign_trip_status) — ค้างอยู่สีเหลือง · จบแล้วสีเทา ให้ผู้ลงนามรอบใหม่เห็นเหตุผลเดิม
export function ReturnNote({ item }) {
  if (!item) return null
  const who = [item.by_name, item.by_position].filter(Boolean).join(' · ')
  return (
    <div role="status" data-esign-return-note={item.open ? 'open' : 'past'}
      className={`space-y-0.5 rounded-xl border px-3.5 py-2.5 text-xs leading-5 ${item.open ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-gray-200 bg-gray-50 text-gray-600'}`}>
      <p className="font-bold">{item.open ? 'ใบนี้ถูกส่งคืนผู้ขอ' : 'ใบนี้เคยถูกส่งคืน'}{item.at ? ` · ${thaiDateTimeText(item.at)}` : ''}</p>
      {who && <p>โดย {who}</p>}
      <p className="break-words">เหตุผล: {item.reason}</p>
    </div>
  )
}
