// ค่าร่วมของหน้าจอลงนามออนไลน์ (หน้า "ลายเซ็นของฉัน" ในโปรไฟล์ · แผงลงนามในหน้าทริป · กล่องลงนาม) — แยกจากไฟล์คอมโพเนนต์เพื่อให้ react-refresh ไม่ฟ้อง
// พื้นลายตารางหมากรุกใต้ภาพลายเซ็น: ให้เห็นว่าภาพโปร่งใส (พื้นไม่ใช่สีขาวทึบ)
export const SIGNATURE_CHECKER = {
  backgroundImage: 'linear-gradient(45deg, #eef0f3 25%, transparent 25%), linear-gradient(-45deg, #eef0f3 25%, transparent 25%), '
    + 'linear-gradient(45deg, transparent 75%, #eef0f3 75%), linear-gradient(-45deg, transparent 75%, #eef0f3 75%)',
  backgroundSize: '14px 14px',
  backgroundPosition: '0 0, 0 7px, 7px -7px, -7px 0',
}

export const PIN_INPUT_CLASS = 'w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-center text-lg tracking-[0.5em] text-gray-800 outline-none focus:border-gray-400'
export const SMALL_BUTTON_CLASS = 'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border px-3 text-xs font-semibold disabled:opacity-50'

export const isPin = value => /^[0-9]{6}$/.test(value)

export const signatureDataUrl = base64 => `data:image/png;base64,${base64}`
