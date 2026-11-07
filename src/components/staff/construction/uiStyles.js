// คลาส Tailwind ที่ใช้ร่วมในโมดูลโครงการก่อสร้าง (แยกจาก ui.jsx เพราะไฟล์คอมโพเนนต์ export ค่าอื่นไม่ได้ — fast refresh)
export const inp = 'w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:bg-gray-50 disabled:text-gray-500'
export const lbl = 'mb-1 block text-xs font-semibold text-gray-500'
export const btnPrimary = 'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-4 text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50'
export const btnGhost = 'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50'
export const chip = on => `min-h-9 rounded-xl border px-3 text-xs font-semibold transition-colors ${on
  ? 'border-transparent text-white'
  : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`
