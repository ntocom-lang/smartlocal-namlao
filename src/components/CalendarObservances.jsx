import { useTenant } from '../contexts/TenantContext'
import { holidayName, holidayYearsCovered } from '../lib/workingDays'

// Display-only data: never feed observances into working-day/SLA calculations.
// Checked 2026-09-17: https://www.thaipbs.or.th/now/content/3498
// Store civil dates, not weekday names (the source mislabels 26 September).
// 30 July is Buddhist Lent, NOT a lunar observance day (waning 1).
const PHRA_2026 = [
  ['01-03', 'ขึ้น 15 ค่ำ เดือน 2'], ['01-11', 'แรม 8 ค่ำ เดือน 2'], ['01-18', 'แรม 15 ค่ำ เดือน 2'], ['01-26', 'ขึ้น 8 ค่ำ เดือน 3'],
  ['02-02', 'ขึ้น 15 ค่ำ เดือน 3'], ['02-10', 'แรม 8 ค่ำ เดือน 3'], ['02-16', 'แรม 14 ค่ำ เดือน 3'], ['02-24', 'ขึ้น 8 ค่ำ เดือน 4'],
  ['03-03', 'ขึ้น 15 ค่ำ เดือน 4'], ['03-11', 'แรม 8 ค่ำ เดือน 4'], ['03-18', 'แรม 15 ค่ำ เดือน 4'], ['03-26', 'ขึ้น 8 ค่ำ เดือน 5'],
  ['04-02', 'ขึ้น 15 ค่ำ เดือน 5'], ['04-10', 'แรม 8 ค่ำ เดือน 5'], ['04-16', 'แรม 14 ค่ำ เดือน 5'], ['04-24', 'ขึ้น 8 ค่ำ เดือน 6'],
  ['05-01', 'ขึ้น 15 ค่ำ เดือน 6'], ['05-09', 'แรม 8 ค่ำ เดือน 6'], ['05-16', 'แรม 15 ค่ำ เดือน 6'], ['05-24', 'ขึ้น 8 ค่ำ เดือน 7'], ['05-31', 'ขึ้น 15 ค่ำ เดือน 7'],
  ['06-08', 'แรม 8 ค่ำ เดือน 7'], ['06-14', 'แรม 14 ค่ำ เดือน 7'], ['06-22', 'ขึ้น 8 ค่ำ เดือน 8'], ['06-29', 'ขึ้น 15 ค่ำ เดือน 8'],
  ['07-07', 'แรม 8 ค่ำ เดือน 8'], ['07-14', 'แรม 15 ค่ำ เดือน 8'], ['07-22', 'ขึ้น 8 ค่ำ เดือน 8 หลัง'], ['07-29', 'ขึ้น 15 ค่ำ เดือน 8 หลัง'],
  ['08-06', 'แรม 8 ค่ำ เดือน 8 หลัง'], ['08-13', 'แรม 15 ค่ำ เดือน 8 หลัง'], ['08-21', 'ขึ้น 8 ค่ำ เดือน 9'], ['08-28', 'ขึ้น 15 ค่ำ เดือน 9'],
  ['09-05', 'แรม 8 ค่ำ เดือน 9'], ['09-11', 'แรม 14 ค่ำ เดือน 9'], ['09-19', 'ขึ้น 8 ค่ำ เดือน 10'], ['09-26', 'ขึ้น 15 ค่ำ เดือน 10'],
  ['10-04', 'แรม 8 ค่ำ เดือน 10'], ['10-11', 'แรม 15 ค่ำ เดือน 10'], ['10-19', 'ขึ้น 8 ค่ำ เดือน 11'], ['10-26', 'ขึ้น 15 ค่ำ เดือน 11'],
  ['11-03', 'แรม 8 ค่ำ เดือน 11'], ['11-09', 'แรม 14 ค่ำ เดือน 11'], ['11-17', 'ขึ้น 8 ค่ำ เดือน 12'], ['11-24', 'ขึ้น 15 ค่ำ เดือน 12'],
  ['12-02', 'แรม 8 ค่ำ เดือน 12'], ['12-09', 'แรม 15 ค่ำ เดือน 12'], ['12-17', 'ขึ้น 8 ค่ำ เดือน 1'], ['12-24', 'ขึ้น 15 ค่ำ เดือน 1'],
]
const PHRA = new Map(PHRA_2026.map(([date, lunar]) => [`2026-${date}`, lunar]))

// Common Thai observances; intentionally not an exhaustive international calendar.
const ANNUAL = {
  '01-16': 'วันครู', '02-14': 'วันวาเลนไทน์', '04-13': 'วันผู้สูงอายุแห่งชาติ',
  '04-14': 'วันครอบครัว', '05-01': 'วันแรงงานแห่งชาติ', '06-05': 'วันสิ่งแวดล้อมโลก',
  '06-26': 'วันสุนทรภู่ / วันต่อต้านยาเสพติดโลก', '07-29': 'วันภาษาไทยแห่งชาติ',
  '08-12': 'วันแม่แห่งชาติ', '08-18': 'วันวิทยาศาสตร์แห่งชาติ',
  '09-20': 'วันเยาวชนแห่งชาติ', '09-24': 'วันมหิดล', '09-28': 'วันพระราชทานธงชาติไทย',
  '12-05': 'วันพ่อแห่งชาติ', '12-25': 'วันคริสต์มาส',
}
const VARIABLE = {
  '2026-03-03': 'วันมาฆบูชา', '2026-05-31': 'วันวิสาขบูชา',
  '2026-06-08': 'วันอัฏฐมีบูชา', '2026-07-29': 'วันอาสาฬหบูชา',
  '2026-07-30': 'วันเข้าพรรษา', '2026-10-26': 'วันออกพรรษา', '2026-11-24': 'วันลอยกระทง',
}

function dayInfo(date) {
  const holiday = holidayName(date)
  const special = [ANNUAL[date.slice(5)], VARIABLE[date]].filter(Boolean)
  const [year, month, day] = date.split('-').map(Number)
  if (month === 1 && day >= 8 && day <= 14 && new Date(year, 0, day).getDay() === 6) special.unshift('วันเด็กแห่งชาติ')
  return { holiday, special: [...new Set(special)], phra: PHRA.get(date) }
}

function BuddhaIcon({ className = '' }) {
  // Local vector: consistent silhouette on Android/iOS; no font/emoji dependency.
  return <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true" className={className}>
    <circle cx="12" cy="6" r="3" />
    <path d="M12 0l1.5 2.5h-3L12 0ZM9 10h6l2 6 4 3c1 .8.5 3-1 3H4c-1.5 0-2-2.2-1-3l4-3 2-6Zm3 2-2 5h4l-2-5Z" />
  </svg>
}

export function CalendarDayMarkers({ date }) {
  useTenant() // Re-render when the existing holiday loader increments holidaysVersion.
  const { holiday, special, phra } = dayInfo(date)
  const label = [holiday && `วันหยุดราชการ: ${holiday}`, special.join(' · '), phra && `วันพระ ${phra}`].filter(Boolean).join(' · ')
  return <>
    <span className="absolute right-full mr-px top-1/2 -translate-y-1/2 flex flex-col gap-1" aria-hidden="true">
      {holiday && <span data-calendar-marker="holiday" className="block w-[5px] h-[5px] rounded-full bg-red-500" />}
      {special.length > 0 && <span data-calendar-marker="special" className="block w-[5px] h-[5px] rounded-full bg-amber-500" />}
    </span>
    {phra && <span data-calendar-marker="phra" className="absolute -right-1.5 -top-1 text-amber-700 dark:text-amber-400" aria-hidden="true"><BuddhaIcon /></span>}
    {label && <span className="sr-only"> · {label}</span>}
  </>
}

export function CalendarObservanceLegend({ year }) {
  useTenant()
  const missing = [!holidayYearsCovered().includes(year) && 'วันหยุดราชการ', year !== 2026 && 'วันพระและวันสำคัญตามจันทรคติ'].filter(Boolean)
  return <div className="mt-3 text-xs text-gray-500 dark:text-slate-400">
    <div className="flex flex-wrap gap-x-3 gap-y-2">
      <span className="inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-red-500" />วันหยุดราชการ</span>
      <span className="inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-amber-500" />วันสำคัญ</span>
      <span className="inline-flex items-center gap-1"><BuddhaIcon className="text-amber-700 dark:text-amber-400" />วันพระ</span>
    </div>
    {missing.length > 0 && <p role="status" className="mt-2">ยังไม่มีข้อมูล{missing.join(' / ')} ปี {year + 543}</p>}
  </div>
}

export function CalendarDayObservances({ date }) {
  useTenant()
  const { holiday, special, phra } = dayInfo(date)
  if (!holiday && !special.length && !phra) return null
  return <div data-calendar-observances className="mt-4 border-t border-gray-100 dark:border-white/10 pt-3 text-sm text-gray-700 dark:text-slate-300 space-y-2">
    {(holiday || special.length > 0) && <>
      <h3 className="font-semibold">วันหยุด / วันสำคัญ</h3>
      {holiday && <p className="flex items-start gap-2"><span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-red-500" /><span>{holiday}<span className="block text-xs text-gray-500">วันหยุดราชการ</span></span></p>}
      {special.filter(name => !holiday?.includes(name)).map(name => <p key={name} className="flex items-start gap-2"><span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-amber-500" /><span>{name}</span></p>)}
    </>}
    {phra && <div className="pt-1"><h3 className="font-semibold inline-flex items-center gap-1.5"><BuddhaIcon className="text-amber-700 dark:text-amber-400" />วันพระ</h3><p className="mt-1">{phra}</p></div>}
  </div>
}
