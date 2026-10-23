// ชิ้นส่วนเล็กๆ ที่หน้าลงนามออนไลน์ใช้ร่วมกัน (ข้อความแจ้งผล · ป้ายสถานะ)
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
