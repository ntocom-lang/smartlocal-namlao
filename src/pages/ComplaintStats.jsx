import { useState, useEffect, useMemo, useCallback, useRef, useSyncExternalStore } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  ClipboardList, CheckCircle2, RefreshCw, XCircle, Inbox,
  TrendingUp, Printer, ArrowLeft, CalendarDays,
} from 'lucide-react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, LabelList, AreaChart, Area, PieChart, Pie, Cell,
} from 'recharts'
import { supabase } from '../lib/supabase'
import { categoryNameOf } from '../lib/complaintCategoryLabels.js'
import { useTenant } from '../contexts/TenantContext'
import { useVisibleRefresh } from '../hooks/useVisibleRefresh'
import FiscalYearPicker from '../components/common/FiscalYearPicker'
import { FY_ALL, useFiscalYearParam, fiscalPeriodParts } from '../lib/fiscalYearParam'
import { FISCAL_MONTHS_TH, fiscalYearBounds } from '../lib/fiscalYear'
import {
  formatPercent, lastFullMonth, parseMonthParam, recentMonthOptions, summarizeMonth,
} from '../lib/complaintMonthlySummary.js'
import { buildComplaintMonthlyHtml } from '../lib/complaintMonthlyPrint.js'
import ComplaintMonthlyInfographic from '../components/reports/ComplaintMonthlyInfographic'

// ดึงมาใช้คำนวณกราฟสรุปทั้งหมด (สถานะ/หมวดหมู่/แนวโน้มรายเดือน) — คำร้องเรียนสะสมของ อปท.
// ทั่วไปไม่เกินหลักพัน จึงพอเป็น "ทั้งหมด" ในทางปฏิบัติ ถ้าเกิน limit จะมีหมายเหตุแจ้งผู้ใช้ (ดู isTruncated ด้านล่าง)
const AGGREGATE_LIMIT = 1000

// หมวดเดียวที่ฟอร์มมีรายการ "ลักษณะปัญหา" ให้เลือก (ไฟฟ้าสาธารณะ) — ต้องตรงกับรายการอนุญาตในฟังก์ชันฐานข้อมูล
// complaint_issue_breakdown_fy ถ้าเพิ่มหมวดใหม่ต้องเพิ่มทั้งฟอร์ม ฟังก์ชัน SQL และที่นี่ (เทสต์เทียบ SQL กับฟอร์มให้)
const ISSUE_BREAKDOWN_CATEGORY = 'light'

// สีสถานะ — ใช้ชุดเดียวกับ badge สถานะที่หน้าอื่นในระบบใช้ (amber/sky/emerald/red) ไม่สร้างชุดสีใหม่แยกเฉพาะกราฟ
// (ตาม dataviz skill: status color เป็น design-system parameter ที่ยึดของเดิมที่ระบบมีอยู่แล้ว)
const PIPELINE_STAGES = [
  { key: 'open',        label: 'รอรับเรื่อง / รับเรื่องแล้ว', dot: '#f59e0b', bar: '#fbbf24' },
  { key: 'in_progress', label: 'กำลังดำเนินการ',            dot: '#0ea5e9', bar: '#38bdf8' },
  { key: 'resolved',    label: 'เสร็จสิ้น',                  dot: '#10b981', bar: '#34d399' },
  { key: 'rejected',    label: 'ยกเลิก / ไม่รับเรื่อง',       dot: '#ef4444', bar: '#f87171' },
]

const MONTH_SHORT_TH = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.']

// สำรองไว้กรณีเทศบาลยังไม่ตั้งค่า complaint_categories ของตัวเอง (ตรงกับ DEFAULT_CATEGORIES ใน ComplaintCategory.jsx)
const FALLBACK_CATEGORY_LABELS = {
  light: 'ไฟฟ้าสาธารณะ', drain: 'ท่อระบายน้ำ', manhole: 'ฝาท่อระบายน้ำ',
  trash: 'ขยะ / ความสะอาด', waste_water: 'น้ำเสีย', suction: 'ดูดสิ่งปฏิกูล',
  canal: 'ลอกคลอง', road: 'ถนน / ทางเท้า', noise: 'แจ้งเหตุรำคาญ',
  flood: 'น้ำท่วม / ระบายน้ำ', building: 'ตรวจสอบอาคาร', mosquito: 'พ่นยุง',
  disease: 'ควบคุมโรคติดต่อ', pollution: 'กลิ่น / ควัน / มลพิษ',
  grievance: 'แจ้งเรื่องร้องทุกข์ร้องเรียน', corruption: 'แจ้งการทุจริต',
  tax: 'ภาษีและค่าธรรมเนียม', tree: 'ต้นไม้/สวนสาธารณะ', water_supply: 'สนับสนุนน้ำอุปโภค',
  animals: 'สุนัขจรจัด', phone_complaint: 'ร้องเรียนเสียง', other: 'อื่นๆ',
}

// เปิดหน้าต่างพิมพ์ใบสรุปรายเดือน — เปิดก่อนแล้วค่อยเขียน HTML ลงไป (เบราว์เซอร์มือถือไม่บล็อก pop-up)
// แล้วรอฟอนต์ราชการโหลดก่อนสั่งพิมพ์ แบบเดียวกับ StaffPerformanceModule / FleetReport
function openPrintWindow(html) {
  const win = window.open('', '_blank', 'width=900,height=1000')
  if (!win) {
    alert('เบราว์เซอร์ปิดกั้นหน้าต่างพิมพ์ กรุณาอนุญาต pop-up แล้วลองใหม่')
    return
  }
  win.document.open()
  win.document.write(html)
  win.document.close()
  setTimeout(async () => {
    try {
      if (win.document.fonts?.ready) {
        await Promise.race([win.document.fonts.ready, new Promise(resolve => setTimeout(resolve, 1200))])
      }
    } catch { /* โหลดฟอนต์ไม่ทันก็พิมพ์ด้วยฟอนต์บนเครื่อง */ }
    win.focus()
    win.print()
  }, 200)
}

// จอแคบกว่า md (768px) — ใช้เฉพาะกับสิ่งที่สั่งผ่าน CSS ไม่ได้ เช่น prop ของ recharts
// (เลย์เอาต์ที่เหลือใช้ md: ของ Tailwind ตามปกติ ไม่ต้องพึ่ง JS)
// useSyncExternalStore ไม่ใช่ useState+useEffect เพราะ matchMedia เป็น external store อยู่แล้ว
// และการ setState ใน effect ทำให้เกิด cascading render (eslint react-hooks/set-state-in-effect)
const NARROW_QUERY = '(max-width: 767px)'

function subscribeNarrow(onStoreChange) {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
  const mq = window.matchMedia(NARROW_QUERY)
  mq.addEventListener('change', onStoreChange)
  return () => mq.removeEventListener('change', onStoreChange)
}

function isNarrowNow() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia(NARROW_QUERY).matches
}

// snapshot ฝั่ง server เป็น false — ถ้าไม่มี window ให้ถือว่าจอกว้างไว้ก่อน (ค่าเดิมของหน้านี้)
function useIsNarrow() {
  return useSyncExternalStore(subscribeNarrow, isNarrowNow, () => false)
}

function StatCard({ label, value, sub, Icon, iconBg, border }) {
  return (
    <div className={`bg-white rounded-lg sm:rounded-2xl border p-2 sm:p-4 flex flex-col ${border}`}>
      <div className="flex items-center gap-1 sm:gap-2">
        <div className={`w-5 h-5 sm:w-7.5 sm:h-7.5 rounded-md sm:rounded-xl flex items-center justify-center shrink-0 ${iconBg}`}>
          <Icon size={11} className="text-white sm:w-[15px] sm:h-[15px]" aria-hidden="true" />
        </div>
        <p className="text-[10px] sm:text-xs font-semibold text-gray-500 leading-3 sm:leading-4 truncate">{label}</p>
      </div>
      <p className="mt-1 sm:mt-2 text-xl sm:text-[28px] font-black text-gray-800 leading-none">{value}</p>
      {sub && <p className="mt-0.5 sm:mt-1 text-[9px] sm:text-xs text-gray-400 leading-3 sm:leading-3.5 line-clamp-2">{sub}</p>}
    </div>
  )
}

export default function ComplaintStats() {
  const { tenant } = useTenant()
  const isNarrow = useIsNarrow()
  const tenantId = tenant?.id
  const [stats, setStats]         = useState(null)
  // ยอดแยกตามลักษณะปัญหาของหมวดไฟฟ้า (เฉพาะโหมดรายเดือน) — มาจากฟังก์ชันที่กรองรายการอนุญาตฝั่งฐานข้อมูลแล้ว
  const [issueRows, setIssueRows] = useState(null)
  const [rows, setRows]           = useState([])
  const [categoryLabels, setCategoryLabels] = useState({})
  const [loading, setLoading]     = useState(true)

  const { value: fiscalYear, setValue: setFiscalYear, options: fiscalOptions } = useFiscalYearParam()
  // useFiscalYearParam() สร้าง object range ใหม่ทุกรอบ render — ต้อง memo ตามค่าปีงบ
  // ไม่งั้น loadStats เปลี่ยน identity ทุกรอบ แล้ว useEffect/useVisibleRefresh ยิงซ้ำไม่หยุด
  const fiscalRange = useMemo(
    () => (fiscalYear === FY_ALL ? null : fiscalYearBounds(fiscalYear)),
    [fiscalYear],
  )

  // โหมดรายเดือน (?m=2569-04) — ใช้ RPC ชุด _fy เดิมโดยส่งช่วงวันที่ของเดือนเดียว ไม่มี migration
  // ค่า m ที่ผิดรูปแบบ/เป็นอนาคต/ไกลเกิน parseMonthParam คืน null → ตกกลับโหมดปีงบ ไม่ใช่หน้าพัง
  // deps เป็นสตริง ไม่ใช่ searchParams ทั้งก้อน: เปลี่ยนปีงบ (fy) แล้วช่วงเดือนต้องไม่ถูกสร้างใหม่จนยิง RPC ซ้ำ
  const [searchParams, setSearchParams] = useSearchParams()
  const monthParam = searchParams.get('m')
  const selectedMonth = useMemo(() => parseMonthParam(monthParam), [monthParam])
  const activeRange = useMemo(
    () => (selectedMonth ? { from: selectedMonth.from, to: selectedMonth.to } : fiscalRange),
    [selectedMonth, fiscalRange],
  )
  const monthOptions = useMemo(() => recentMonthOptions(), [])

  // ตัวเลขที่อยู่บนจอต้องเป็นของช่วงเวลาที่เลือกอยู่เสมอ — สลับโหมด/ช่วงแล้วยังไม่ทันโหลดให้แสดงตัวหมุน
  // ไม่ใช่เลขเดิมใต้หัวข้อใหม่ (ปีงบ → "เมษายน 2569" จะเห็นยอดทั้งปีผิดหัวข้อ)
  const rangeKey = activeRange ? `${activeRange.from}_${activeRange.to}` : 'all'
  const [loadedKey, setLoadedKey] = useState(null)
  const settled = loadedKey === rangeKey
  const latestRangeKey = useRef(rangeKey)
  useEffect(() => { latestRangeKey.current = rangeKey }, [rangeKey])

  // replace: true — เปลี่ยนช่วงเวลาไม่ควรถมประวัติเบราว์เซอร์ ปุ่ม back ต้องกลับไปหน้าก่อนหน้า
  function setMonthParam(key) {
    const params = new URLSearchParams(searchParams)
    if (key) params.set('m', key)
    else params.delete('m')
    setSearchParams(params, { replace: true })
  }

  const now = new Date().toLocaleDateString('th-TH', {
    year: 'numeric', month: 'long', day: 'numeric',
  })

  // ปีงบที่เลือกเป็นตัวกำหนดว่าจะยิง RPC ตัวไหน — ตัว _fy รับช่วงวันที่และนับฝั่ง DB
  // (ไม่กรองฝั่ง client จาก rows เพราะ rows ถูกตัดที่ AGGREGATE_LIMIT ปีงบเก่าจะหายไปเงียบๆ)
  const loadStats = useCallback(() => {
    if (!tenantId) return Promise.resolve()
    const calls = activeRange
      ? [
          supabase.rpc('complaint_stats_fy', {
            _municipality_id: tenantId, _from: activeRange.from, _to: activeRange.to,
          }),
          supabase.rpc('complaints_public_fy', {
            _municipality_id: tenantId, _limit: AGGREGATE_LIMIT,
            _from: activeRange.from, _to: activeRange.to,
          }),
          // รายการย่อยใต้หมวดใช้แค่ภาพสรุปรายเดือน โหมดปีงบไม่ยิง · ถ้าฟังก์ชันยังไม่มีบนฐานข้อมูลนั้น/ผิดพลาด
          // ได้ data เป็น null แล้วภาพก็แค่ไม่มีรายการย่อย (ไม่ทำให้ทั้งหน้าพัง)
          ...(selectedMonth ? [supabase.rpc('complaint_issue_breakdown_fy', {
            _municipality_id: tenantId, _category: ISSUE_BREAKDOWN_CATEGORY,
            _from: activeRange.from, _to: activeRange.to,
          })] : []),
        ]
      : [
          supabase.rpc('complaint_stats',   { _municipality_id: tenantId }),
          supabase.rpc('complaints_public', { _municipality_id: tenantId, _limit: AGGREGATE_LIMIT }),
        ]
    return Promise.all(calls).then(([{ data: s }, { data: r }, issues]) => {
      // คำตอบของช่วงเวลาที่ผู้ใช้เปลี่ยนไปแล้วมาถึงช้า ต้องทิ้ง ไม่งั้นเลขของเดือนเก่าไปอยู่ใต้หัวข้อเดือนใหม่
      if (latestRangeKey.current !== rangeKey) return
      setStats(s)
      setRows(r ?? [])
      setIssueRows(Array.isArray(issues?.data) ? issues.data : null)
      setLoadedKey(rangeKey)
    }).catch(() => {})
  }, [tenantId, activeRange, rangeKey, selectedMonth])

  // ป้ายชื่อหมวดหมู่แยกออกจากรอบรีเฟรช — แอดมินแก้ปีละครั้ง ไม่ต้องดึงซ้ำทุกนาที
  useEffect(() => {
    if (!tenantId) return
    supabase.from('complaint_categories').select('value, label')
      .eq('municipality_id', tenantId).eq('is_active', true)
      .then(({ data: cats }) => {
        const map = {}
        ;(cats ?? []).forEach(c => { map[c.value] = c.label })
        setCategoryLabels(map)
      })
      .catch(() => {})
  }, [tenantId])

  useEffect(() => { loadStats().finally(() => setLoading(false)) }, [loadStats])

  // รอบช้ากว่า widget หน้าแรก — complaints_public ดึงได้ถึง AGGREGATE_LIMIT แถวต่อครั้ง
  // ถ้าเปิดหน้านี้ค้างไว้ทั้งวันที่ 60 วิ จะเป็นการดึงหลักพันแถวทุกนาทีโดยไม่มีอะไรเปลี่ยน
  useVisibleRefresh(loadStats, { intervalMs: 180_000, enabled: !!tenantId })

  // ร้อยละบนจอ — โหมดรายเดือนใช้ทศนิยม 1 ตำแหน่งให้ตรงกับข้อความสรุปและใบพิมพ์
  // (ไม่งั้นหน้าเดียวกันขึ้น "ร้อยละ 66.7" ในข้อความ แต่ "67%" ที่การ์ด) · โหมดปีงบคงจำนวนเต็มเหมือนเดิม
  function sharePercent(part, whole) {
    if (!(whole > 0)) return '0'
    const percent = (part / whole) * 100
    return selectedMonth ? formatPercent(Math.round(percent * 10) / 10) : String(Math.round(percent))
  }
  const completionText = sharePercent(stats?.resolved ?? 0, stats?.total ?? 0)

  // ปีงบที่เลือกจบไปแล้วหรือยัง (ใช้ตัดสินว่าจะโชว์ "เดือนนี้" หรือช่วงวันที่ของปีงบ)
  const isPastFiscalYear = fiscalYear !== FY_ALL && fiscalYear < fiscalOptions[0]

  // แยก main/range เพื่อซ่อนวงเล็บช่วงวันที่บนจอมือถือ (ดูเหตุผลที่ fiscalPeriodParts)
  const fiscalPeriod = fiscalPeriodParts(fiscalYear)

  // หน้าสถิติสาธารณะ — ประชาชนเห็น ชื่อหมวดที่ไม่มีทั้งในฐานข้อมูลและตาราง fallback ต้องไม่หลุดเป็นรหัส (water_repair)
  // useCallback: ใบสรุปรายเดือนรับฟังก์ชันนี้ไปใช้ใน useMemo ด้วย
  const categoryLabel = useCallback(
    value => categoryNameOf({ ...FALLBACK_CATEGORY_LABELS, ...categoryLabels }, value),
    [categoryLabels],
  )

  // ใบสรุปประจำเดือน — คำนวณล้วนจากตัวเลขที่ RPC สาธารณะคืนมา (ไม่มีชื่อ เบอร์ ที่อยู่ หรือพิกัด)
  const monthlySummary = useMemo(
    () => (selectedMonth && settled
      ? summarizeMonth({
        stats, rows, labelOf: categoryLabel, tenantName: tenant?.name ?? 'หน่วยงาน', period: selectedMonth,
        issueBreakdown: issueRows ? { category: ISSUE_BREAKDOWN_CATEGORY, rows: issueRows } : null,
      })
      : null),
    [selectedMonth, settled, stats, rows, issueRows, categoryLabel, tenant?.name],
  )

  // ป้ายช่วงเวลาของหัวรายงาน/ข้อความไม่มีข้อมูล — โหมดรายเดือนใช้เดือนที่เลือกแทนปีงบ
  const periodMain = selectedMonth ? `เดือน${selectedMonth.label}` : fiscalPeriod.main
  const monthRangeText = selectedMonth ? `1 – ${Number(selectedMonth.to.slice(8))} ${selectedMonth.label}` : ''
  const periodRange = selectedMonth ? ` (${monthRangeText})` : fiscalPeriod.range

  function printMonthly() {
    if (!monthlySummary) return
    openPrintWindow(buildComplaintMonthlyHtml({ tenant, summary: monthlySummary }))
  }

  // rows ดึงมาสูงสุด AGGREGATE_LIMIT รายการ (เรียงใหม่→เก่า) ใช้คำนวณกราฟหมวดหมู่/แนวโน้มรายเดือน
  const isTruncated = stats?.total > rows.length

  // ข้อมูลสำหรับ donut สถานะ — ตัด stage ที่ค่า 0 ออก (Pie แสดง slice 0% ไม่มีประโยชน์ ทั้งยังกันสัดส่วน
  // มุมพัง) percent ผูกไว้ในนี้เลยให้ Tooltip ใช้ตรงๆ ไม่ต้องคำนวณซ้ำ
  const pipelineData = PIPELINE_STAGES
    .map(stage => ({ ...stage, value: stats?.[stage.key] ?? 0 }))
    .filter(stage => stage.value > 0)
    .map(stage => ({ ...stage, percent: stats?.total > 0 ? stage.value / stats.total : 0 }))

  // หมวดหมู่ยอดนิยม — top 6 + พับที่เหลือรวมเป็น "อื่นๆ" (ตาม series ladder ของ dataviz skill
  // ไม่ยัดทุกหมวดขึ้นกราฟเดียว อ่านยาก) เรียงมาก→น้อย ใช้ single hue เพราะเป็นการเทียบขนาด ไม่ใช่ identity
  const categoryBreakdown = useMemo(() => {
    const counts = {}
    rows.forEach(r => { counts[r.category] = (counts[r.category] ?? 0) + 1 })
    const sorted = Object.entries(counts)
      .map(([value, count]) => ({ label: categoryLabel(value), count }))
      .sort((a, b) => b.count - a.count)
    const top = sorted.slice(0, 6)
    const restTotal = sorted.slice(6).reduce((sum, c) => sum + c.count, 0)
    if (restTotal > 0) top.push({ label: 'อื่นๆ', count: restTotal })
    // axisLabel = ตัดสั้นไว้ไม่ให้ล้นแกน Y (ป้ายยาวเช่น "แจ้งเรื่องร้องทุกข์ร้องเรียน" ถูกตัดตกขอบมาก่อน)
    // ชื่อเต็มยังอยู่ใน label เดิม โชว์ผ่าน tooltip ตอน hover แทน ไม่มีข้อมูลหายไปจริง
    return top.map(c => ({ ...c, axisLabel: c.label.length > 10 ? c.label.slice(0, 9) + '…' : c.label }))
  }, [rows, categoryLabel])

  // แท่งฝั่งมือถือคิดความยาวเทียบหมวดที่มากที่สุด (ไม่ใช่เทียบยอดรวม) ให้เห็นความต่างชัดเท่ากราฟ
  const maxCategoryCount = categoryBreakdown.reduce((m, c) => Math.max(m, c.count), 0)

  // แนวโน้มรายเดือน (รวมเดือนที่มี 0 เรื่องด้วย ไม่ข้าม ไม่งั้นเส้นจะกระโดดผิดสัดส่วนเวลา)
  //   เลือกปีงบ → 12 เดือนของปีงบนั้น เรียง ต.ค.→ก.ย. ตามที่ อปท. อ่านรายงานกัน
  //   "ทุกปีงบประมาณ" → 6 เดือนล่าสุดแบบเดิม (ไม่มีขอบเขตปีให้ยึด)
  const monthlyTrend = useMemo(() => {
    const buckets = []
    if (fiscalRange) {
      FISCAL_MONTHS_TH.forEach(({ label, month }) => {
        // ต.ค.–ธ.ค. อยู่ในปีปฏิทินก่อนหน้า (startCE) ที่เหลืออยู่ในปีที่ปีงบสิ้นสุด (endCE)
        const year = month >= 10 ? fiscalRange.startCE : fiscalRange.endCE
        buckets.push({ key: `${year}-${month - 1}`, label, count: 0 })
      })
    } else {
      const nowDate = new Date()
      for (let i = 5; i >= 0; i--) {
        const d = new Date(nowDate.getFullYear(), nowDate.getMonth() - i, 1)
        buckets.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: MONTH_SHORT_TH[d.getMonth()], count: 0 })
      }
    }
    const byKey = Object.fromEntries(buckets.map(b => [b.key, b]))
    rows.forEach(r => {
      const d = new Date(r.created_at)
      const key = `${d.getFullYear()}-${d.getMonth()}`
      if (byKey[key]) byKey[key].count += 1
    })
    return buckets
  }, [rows, fiscalRange])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-6 h-6 border-4 border-gray-200 rounded-full animate-spin"
             style={{ borderTopColor: 'var(--color-primary)' }} />
      </div>
    )
  }

  return (
    <div className="min-h-screen print:bg-white" style={{ backgroundColor: '#eef2f7' }}>

      {/* ── Header ── */}
      <div className="bg-white border-b border-gray-100 shadow-sm print:shadow-none px-4 py-4 sm:py-5">
        <div className="max-w-4xl mx-auto">
          {/* "กลับ" กับ "พิมพ์" อยู่แถวเดียวกัน — ปุ่มพิมพ์ที่เคยยืนข้างหัวเรื่องบีบ h1 เหลือ 249px
              จากพื้นที่ 358px บนจอ 390px จนหัวเรื่องตกเป็น 3 บรรทัด ย้ายมาแถวนี้แล้วได้เต็มความกว้าง */}
          <div className="print:hidden flex items-center justify-between gap-3 mb-3">
            <Link to="/reports"
              className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-600">
              <ArrowLeft size={14} /> กลับ
            </Link>
            {/* โหมดรายเดือนพิมพ์ใบสรุป A4 หน้าเดียว (ไม่ใช่ตัวหน้าเว็บทั้งหน้า) */}
            <button
              onClick={selectedMonth ? printMonthly : () => window.print()}
              disabled={!settled}
              className="flex items-center gap-1.5 text-sm font-semibold text-gray-600 hover:text-gray-800 border border-gray-200 rounded-xl px-3 py-1.5 transition-colors shrink-0 disabled:opacity-50">
              <Printer size={15} /> {selectedMonth ? 'พิมพ์สรุปรายเดือน (A4)' : 'พิมพ์'}
            </button>
          </div>

          <span className="inline-block text-[10px] sm:text-xs font-bold px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
            ความโปร่งใสด้านการจัดการเรื่องร้องเรียน
          </span>
          <h1 className="text-lg sm:text-xl font-black text-gray-800 leading-tight mt-2">
            รายงานสถิติข้อมูลการขอรับบริการผ่านช่องทางออนไลน์ (e-Service)
          </h1>
          <p className="text-[13px] sm:text-sm font-semibold text-gray-600 mt-1 leading-snug">
            ด้านการจัดการเรื่องร้องเรียน/ร้องทุกข์{' '}
            {/* ปีงบต้องไม่แตกกลางคำ — จอ 390px เคยดัน "2569" ลงไปยืนเดี่ยวบรรทัดใหม่ */}
            <span className="whitespace-nowrap">— {periodMain}</span>
            {/* ช่วงวันที่ซ้ำกับ dropdown ปีงบที่อยู่ใต้ลงมา จอเล็กจึงตัดออก แต่ใบที่พิมพ์ต้องมีเสมอ */}
            <span className="hidden sm:inline print:inline">{periodRange}</span>
          </p>
          {/* ชื่อหน่วยงานกับวันที่ข้อมูลรวมเป็นบรรทัดเดียว — เดิมแยก 2 บรรทัดโดยไม่ได้ข้อมูลเพิ่ม */}
          <p className="text-xs sm:text-sm text-gray-500 mt-1 leading-snug">
            <span className="whitespace-nowrap">{tenant?.name ?? 'หน่วยงาน'}</span>
            <span className="text-gray-300"> · </span>
            <span className="text-gray-400 whitespace-nowrap">ข้อมูล ณ วันที่ {now}</span>
          </p>

          {/* ตัวกรองช่วงเวลา — ซ่อนตอนพิมพ์ เพราะช่วงเวลาที่เลือกพิมพ์ติดไปกับหัวรายงานอยู่แล้ว
              ปีงบประมาณ = หลักฐาน ITA (ค่าตั้งต้น) · รายเดือน = สรุปแบบที่เทศบาลนครยะลาเผยแพร่ทุกเดือน */}
          <div className="print:hidden mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            <div role="group" aria-label="ช่วงเวลาของรายงาน"
              className="inline-flex rounded-xl border border-gray-200 bg-gray-50 p-0.5 text-sm font-bold">
              {[
                { label: 'ปีงบประมาณ', active: !selectedMonth, onSelect: () => setMonthParam(null) },
                { label: 'รายเดือน', active: !!selectedMonth, onSelect: () => setMonthParam(lastFullMonth().key) },
              ].map(option => (
                <button key={option.label} type="button" aria-pressed={option.active} onClick={option.onSelect}
                  className={`min-h-11 px-3.5 rounded-[10px] transition-colors ${option.active
                    ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                  {option.label}
                </button>
              ))}
            </div>
            {selectedMonth ? (
              <div className="flex items-center gap-2">
                <label htmlFor="month-picker" className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 shrink-0">
                  <CalendarDays size={14} aria-hidden="true" /> เดือน
                </label>
                <select id="month-picker" value={selectedMonth.key} onChange={e => setMonthParam(e.target.value)}
                  className="text-sm font-bold text-gray-800 bg-white border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-offset-0"
                  style={{ '--tw-ring-color': 'var(--color-primary)' }}>
                  {monthOptions.map(option => (
                    <option key={option.key} value={option.key}>{option.label}</option>
                  ))}
                </select>
              </div>
            ) : (
              <FiscalYearPicker value={fiscalYear} options={fiscalOptions} onChange={setFiscalYear} />
            )}
          </div>
        </div>
      </div>

      {/* สลับเดือน/ปีงบแล้วรอข้อมูลใหม่: คงหัวรายงานกับตัวเลือกไว้ แสดงตัวหมุนเฉพาะส่วนเนื้อหา
          (เดิมทั้งหน้าถูกแทนด้วยตัวหมุน ตัวเลือกหายกลางทาง โฟกัสคีย์บอร์ดหลุด และห้ามพิมพ์ใบของช่วงเก่าใต้หัวข้อใหม่) */}
      {!settled ? (
        <div className="flex items-center justify-center min-h-[40vh]" role="status" aria-label="กำลังโหลดข้อมูล">
          <div className="w-6 h-6 border-4 border-gray-200 rounded-full animate-spin"
               style={{ borderTopColor: 'var(--color-primary)' }} />
        </div>
      ) : (
      <div className="max-w-4xl mx-auto px-4 py-4 space-y-3">

        {/* ภาพสรุปสำหรับเผยแพร่ (ดาวน์โหลด PNG/แชร์) — วาดจากยอดรวมชุดเดียวกับข้อความด้านล่าง
            อยู่บนสุดเพราะเป็นของที่เจ้าหน้าที่มาเอาไปแชร์ทุกเดือน (เดิมอยู่หลังข้อความสรุป ต้องเลื่อนหาปุ่ม) */}
        {monthlySummary && (
          <ComplaintMonthlyInfographic summary={monthlySummary} tenantName={tenant?.name ?? 'หน่วยงาน'} />
        )}

        {/* ── สรุปประจำเดือน (โหมดรายเดือนเท่านั้น) — ข้อความจากแม่แบบตายตัว มีแต่ตัวเลข ไม่ประเมินผลงานตัวเอง
             หมายเหตุใต้ข้อความบอกวันที่ของข้อมูล เพราะร้อยละแล้วเสร็จนับจากสถานะปัจจุบัน ไม่ใช่ ณ สิ้นเดือน ── */}
        {monthlySummary && (
          <div className="bg-white rounded-2xl border border-gray-100 p-3 md:p-4">
            <p className="text-sm font-bold text-gray-700 mb-1">สรุปประจำ{periodMain}</p>
            {/* แยกทีละประโยค (ไม่ต่อเป็นก้อนเดียว) — ภาษาไทยไม่มีจุดคั่น ประโยคต่อกันอ่านไม่ออกว่าจบตรงไหน */}
            <div className="space-y-1">
              {monthlySummary.sentences.map(sentence => (
                <p key={sentence} className="text-sm text-gray-700 leading-relaxed">{sentence}</p>
              ))}
            </div>
            {monthlySummary.notes.length > 0 && (
              <ul className="mt-2 space-y-0.5">
                {monthlySummary.notes.map(note => (
                  <li key={note} className="text-xs text-gray-500 leading-snug">{note}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* ── Stats grid ── */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 sm:gap-3">
          <StatCard
            label={selectedMonth ? 'รวมเรื่องที่รับในเดือน' : fiscalRange ? 'รวมเรื่องในปีงบนี้' : 'รวมเรื่องทั้งหมด'}
            value={stats?.total ?? 0}
            // ปีงบที่ปิดไปแล้วไม่มี "เดือนนี้" อยู่ในช่วง จะขึ้น 0 เสมอ — โชว์ช่วงวันที่แทนจะตรงกว่า
            sub={selectedMonth
              ? (monthlySummary?.isCurrentMonth ? 'เดือนนี้ยังไม่สิ้นสุด' : monthRangeText)
              : isPastFiscalYear
                ? `1 ต.ค. ${fiscalYear - 1} – 30 ก.ย. ${fiscalYear}`
                : `เดือนนี้ ${stats?.this_month ?? 0} เรื่อง`}
            Icon={ClipboardList}
            iconBg="bg-blue-500"
            border="border-blue-100"
          />
          <StatCard
            label="เสร็จสิ้น"
            value={stats?.resolved ?? 0}
            sub={`${completionText}% ของทั้งหมด`}
            Icon={CheckCircle2}
            iconBg="bg-emerald-500"
            border="border-emerald-100"
          />
          <StatCard
            label="กำลังดำเนินการ"
            value={stats?.in_progress ?? 0}
            Icon={RefreshCw}
            iconBg="bg-sky-400"
            border="border-sky-100"
          />
          <StatCard
            label="รอรับ / รับเรื่องแล้ว"
            value={stats?.open ?? 0}
            Icon={Inbox}
            iconBg="bg-amber-400"
            border="border-amber-100"
          />
          <StatCard
            label="ระยะเวลาเฉลี่ย"
            value={stats?.avg_days != null ? `${stats.avg_days} วัน` : '—'}
            sub="แจ้ง → ดำเนินการแล้ว (เฉพาะที่เสร็จ)"
            Icon={TrendingUp}
            iconBg="bg-purple-500"
            border="border-purple-100"
          />
          <StatCard
            label="ยกเลิก / ไม่รับเรื่อง"
            value={stats?.rejected ?? 0}
            Icon={XCircle}
            iconBg="bg-red-400"
            border="border-red-100"
          />
        </div>

        {/* ── Status: ภาพรวมสถานะทั้งหมดเป็นวงกลม (part-to-whole, ≤6 segments — donut ใช้ได้ตาม
             dataviz skill เฉพาะกรณีนี้ ต่างจากอีก 2 กราฟถัดไปที่เป็นการเทียบขนาด/แนวโน้ม ไม่เหมาะกับวงกลม) ── */}
        <div className="bg-white rounded-2xl border border-gray-100 p-3 md:p-4">
          <p className="text-sm font-bold text-gray-700 mb-2">ภาพรวมสถานะคำร้อง</p>

          <div className="flex flex-col md:flex-row items-center gap-3">
            {!stats?.total ? (
              <div className="w-40 h-40 rounded-full border-13 border-gray-100 shrink-0" />
            ) : (
              <div className="relative w-full max-w-40 shrink-0">
                <ResponsiveContainer width="100%" height={160}>
                  <PieChart>
                    <Pie data={pipelineData} dataKey="value" nameKey="label"
                      innerRadius={46} outerRadius={72} paddingAngle={2} startAngle={90} endAngle={-270}
                      stroke="#fff" strokeWidth={2}>
                      {pipelineData.map(stage => <Cell key={stage.key} fill={stage.bar} />)}
                    </Pie>
                    <Tooltip formatter={(value, _name, item) => [`${value} เรื่อง (${Math.round(item.payload.percent * 100)}%)`, item.payload.label]}
                      contentStyle={{ borderRadius: 12, border: '1px solid #f3f4f6', fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
                {/* ตัวเลขหัวเรื่องอยู่กลางวงกลม — ใช้พื้นที่ตรงกลางที่ donut เว้นว่างไว้ให้เกิดประโยชน์ */}
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <p className="text-xl font-black text-gray-800 leading-none">{completionText}%</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">เสร็จสิ้นแล้ว</p>
                </div>
              </div>
            )}

            {/* legend — ค่าจริงยืนอยู่ตรงนี้เสมอ ไม่ต้อง hover ถึงจะเห็น (เสี้ยวแคบๆ ใส่ตัวเลขในตัวเองไม่พอ) */}
            <div className="grid grid-cols-2 gap-x-3 gap-y-2 w-full">
              {PIPELINE_STAGES.map(stage => {
                const value = stats?.[stage.key] ?? 0
                const share = sharePercent(value, stats?.total ?? 0)
                return (
                  <div key={stage.key} className="flex items-start gap-2">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0 mt-1" style={{ backgroundColor: stage.dot }} />
                    <div className="min-w-0">
                      <p className="text-xs text-gray-500 leading-tight">{stage.label}</p>
                      <p className="text-sm font-bold text-gray-800 leading-tight">{value} <span className="text-xs font-normal text-gray-400">({share}%)</span></p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* ปีงบที่ไม่มีคำร้องเลยต้องบอกให้ชัดว่า "ไม่มีเรื่อง" ไม่ใช่ปล่อยหน้าว่างจนดูเหมือนโหลดพัง */}
        {!stats?.total && (
          <p className="bg-white rounded-2xl border border-gray-100 p-4 text-center text-sm text-gray-400">
            ไม่มีคำร้องใน{periodMain}
          </p>
        )}

        {/* ── หมวดหมู่ยอดนิยม + แนวโน้มรายเดือน (โหมดรายเดือนไม่มีกราฟแนวโน้ม: เดือนเดียวจะมีจุดเดียว) ── */}
        {stats?.total > 0 && (
          <div className={`grid gap-3 ${selectedMonth ? '' : 'md:grid-cols-2'}`}>

            {/* Compare magnitude → bar, single hue (var(--color-primary)) — ไม่ใช้สีแยกตามหมวด
                เพราะแต่ละหมวดแยกกันด้วยตำแหน่ง/label อยู่แล้ว ไม่ต้องพึ่งสีบอก identity ซ้ำ */}
            <div className="bg-white rounded-2xl border border-gray-100 p-3 md:p-4">
              <p className="text-sm font-bold text-gray-700 mb-1">หมวดหมู่ยอดนิยม</p>
              {isTruncated && (
                <p className="text-[10px] text-gray-400 mb-1.5">จากข้อมูล {rows.length.toLocaleString('th-TH')} รายการล่าสุด (ทั้งหมด {stats.total.toLocaleString('th-TH')} รายการ)</p>
              )}
              {/* จอแคบใช้แท่งแบบ HTML — ชื่อหมวดเต็มไม่ถูกตัด เพราะบนมือถือไม่มี hover ให้เปิด tooltip
                  ดูชื่อเต็ม ป้ายแกน Y ของ recharts ที่ตัดเหลือ 9 ตัวอักษรจึงเท่ากับข้อมูลหายจริง
                  (เช่น "กลิ่นเหม…" กับ "ไฟฟ้าสาธา…" ที่วัดได้บนจอ 390px) */}
              <ul className="md:hidden space-y-2 mt-1">
                {categoryBreakdown.map((c, i) => (
                  /* หมวดที่ถูกพับรวมชื่อ "อื่นๆ" อาจซ้ำกับหมวดจริงที่ชื่อเดียวกัน — ใส่ลำดับกัน key ชน */
                  <li key={`${c.label}-${i}`}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-xs text-gray-600 leading-snug">{c.label}</span>
                      <span className="text-xs font-bold text-gray-800 shrink-0">{c.count}</span>
                    </div>
                    <div className="mt-1 h-2 rounded-full bg-gray-100 overflow-hidden">
                      <div className="h-full rounded-full"
                        style={{
                          width: `${maxCategoryCount > 0 ? (c.count / maxCategoryCount) * 100 : 0}%`,
                          backgroundColor: 'var(--color-primary)',
                        }} />
                    </div>
                  </li>
                ))}
              </ul>

              <ResponsiveContainer width="100%" height={Math.max(120, categoryBreakdown.length * 26 + 12)}
                className="hidden md:block">
                <BarChart data={categoryBreakdown} layout="vertical" margin={{ top: 2, right: 26, bottom: 2, left: 0 }}>
                  <CartesianGrid horizontal={false} stroke="#e5e7eb" />
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="axisLabel" width={90} tickLine={false} axisLine={false}
                    tick={{ fontSize: 11, fill: '#52514e' }} />
                  <Tooltip cursor={{ fill: '#f9fafb' }} formatter={(value) => [`${value} เรื่อง`, null]}
                    labelFormatter={(_, payload) => payload?.[0]?.payload?.label}
                    contentStyle={{ borderRadius: 12, border: '1px solid #f3f4f6', fontSize: 12 }} labelStyle={{ fontWeight: 700 }} />
                  <Bar dataKey="count" fill="var(--color-primary)" radius={[0, 4, 4, 0]} barSize={14}>
                    <LabelList dataKey="count" position="right" style={{ fontSize: 11, fontWeight: 700, fill: '#374151' }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Trend over time → area, single series, sequential hue */}
            {!selectedMonth && (
            <div className="bg-white rounded-2xl border border-gray-100 p-3 md:p-4">
              <p className="text-sm font-bold text-gray-700 mb-1">แนวโน้มจำนวนคำร้อง</p>
              <p className="text-[10px] text-gray-400 mb-1.5">
                {fiscalRange ? `รายเดือน ปีงบประมาณ ${fiscalYear} (ต.ค.–ก.ย.)` : '6 เดือนล่าสุด'}
              </p>
              <ResponsiveContainer width="100%" height={160}>
                <AreaChart data={monthlyTrend} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.12} />
                      <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="#e5e7eb" />
                  {/* จอแคบใส่ป้าย 12 เดือนไม่พอ recharts จะหล่นเดือนทิ้งเองแบบไม่สม่ำเสมอ
                      (เคยหล่น เม.ย. กับ ส.ค. ทิ้งจนอ่านช่วงเวลาผิด) — บังคับเว้นเดือนเว้นเดือนแทน
                      จุดข้อมูลยังครบ 12 เดือนเหมือนเดิม หายแค่ป้ายกำกับ */}
                  <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: '#c3c2b7' }}
                    interval={isNarrow && fiscalRange ? 1 : 'preserveEnd'}
                    tick={{ fontSize: isNarrow ? 10 : 11, fill: '#898781' }} />
                  <YAxis allowDecimals={false} width={24} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#898781' }} />
                  <Tooltip cursor={{ stroke: '#c3c2b7', strokeWidth: 1 }} formatter={(value) => [`${value} เรื่อง`, null]}
                    contentStyle={{ borderRadius: 12, border: '1px solid #f3f4f6', fontSize: 12 }} labelStyle={{ fontWeight: 700 }} />
                  <Area type="monotone" dataKey="count" stroke="var(--color-primary)" strokeWidth={2}
                    fill="url(#trendFill)"
                    dot={{ r: 4, fill: 'var(--color-primary)', stroke: '#fff', strokeWidth: 2 }}
                    activeDot={{ r: 5, fill: 'var(--color-primary)', stroke: '#fff', strokeWidth: 2 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            )}

          </div>
        )}

        {/* Footer */}
        <p className="text-center text-xs text-gray-300 pb-6 mb-20 md:mb-0 print:text-gray-500">
          SmartLocal e-Service Platform • รายงานนี้สร้างโดยอัตโนมัติ •{' '}
          {tenant?.name} • {now}
        </p>

      </div>
      )}
    </div>
  )
}
