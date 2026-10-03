// คลาสสีของศูนย์รวมข้อมูลดิจิทัลที่ต้องมี 2 ธีม (สว่าง/มืด) — รวมไว้จุดเดียวสำหรับแผงใหม่ใน "คุณภาพข้อมูล"
// ใช้ค่าชุดเดียวกับการ์ดเดิมใน DataCenterOverview.jsx (bg/border/text เหมือนกัน) เพื่อให้หน้าใหม่ไม่ดูเป็นคนละระบบ
// ต้องเป็นสตริงเต็มที่ Tailwind สแกนเจอในซอร์ส ห้ามประกอบชื่อคลาสจากชิ้นส่วนแล้วต่อกัน

export const panelCls = (isLight) =>
  isLight ? 'bg-white/95 border-slate-200 text-slate-800' : 'bg-slate-900/90 border-cyan-500/30 text-white'

export const insetCls = (isLight) =>
  isLight ? 'bg-slate-50/80 border-slate-200' : 'bg-slate-950/60 border-slate-800'

export const mutedCls = (isLight) => (isLight ? 'text-slate-500' : 'text-slate-400')

export const accentCls = (isLight) => (isLight ? 'text-sky-700' : 'text-cyan-300')

export const ghostBtnCls = (isLight) =>
  isLight
    ? 'bg-white border-slate-200 text-slate-600 hover:text-sky-700 hover:border-sky-300 hover:bg-sky-50'
    : 'bg-slate-800 border-slate-700 text-slate-300 hover:text-cyan-300 hover:border-cyan-500/40 hover:bg-slate-700'

export const primaryBtnCls =
  'text-slate-950 bg-gradient-to-r from-cyan-400 via-teal-300 to-emerald-400 hover:from-cyan-300 hover:to-emerald-300 shadow-lg shadow-cyan-500/25'

export const inputCls = (isLight) =>
  isLight
    ? 'bg-white border-slate-300 text-slate-800 focus:border-sky-500'
    : 'bg-slate-900 border-slate-700 text-slate-200 focus:border-cyan-400'

const TONES = {
  good: {
    light: 'bg-emerald-50 border-emerald-300 text-emerald-700',
    dark: 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400',
    text: { light: 'text-emerald-600', dark: 'text-emerald-400' },
    stroke: { light: '#059669', dark: '#34d399' },
    bar: { light: 'bg-emerald-500', dark: 'bg-emerald-400' },
  },
  warn: {
    light: 'bg-amber-50 border-amber-300 text-amber-700',
    dark: 'bg-amber-500/10 border-amber-500/40 text-amber-400',
    text: { light: 'text-amber-600', dark: 'text-amber-400' },
    stroke: { light: '#d97706', dark: '#fbbf24' },
    bar: { light: 'bg-amber-500', dark: 'bg-amber-400' },
  },
  bad: {
    light: 'bg-red-50 border-red-300 text-red-700',
    dark: 'bg-red-500/10 border-red-500/40 text-red-400',
    text: { light: 'text-red-600', dark: 'text-red-400' },
    stroke: { light: '#dc2626', dark: '#f87171' },
    bar: { light: 'bg-red-500', dark: 'bg-red-400' },
  },
  none: {
    light: 'bg-slate-100 border-slate-200 text-slate-500',
    dark: 'bg-slate-800 border-slate-700 text-slate-400',
    text: { light: 'text-slate-500', dark: 'text-slate-400' },
    stroke: { light: '#94a3b8', dark: '#64748b' },
    bar: { light: 'bg-slate-400', dark: 'bg-slate-500' },
  },
  info: {
    light: 'bg-sky-50 border-sky-200 text-sky-700',
    dark: 'bg-cyan-500/10 border-cyan-500/40 text-cyan-300',
    text: { light: 'text-sky-700', dark: 'text-cyan-300' },
    stroke: { light: '#0284c7', dark: '#22d3ee' },
    bar: { light: 'bg-sky-500', dark: 'bg-cyan-400' },
  },
}

const pick = (tone) => TONES[tone] ?? TONES.none

export const toneBadgeCls = (tone, isLight) => pick(tone)[isLight ? 'light' : 'dark']
export const toneTextCls = (tone, isLight) => pick(tone).text[isLight ? 'light' : 'dark']
export const toneStroke = (tone, isLight) => pick(tone).stroke[isLight ? 'light' : 'dark']
export const toneBarCls = (tone, isLight) => pick(tone).bar[isLight ? 'light' : 'dark']
