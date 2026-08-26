import { useState, useEffect, useMemo, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  ClipboardList, CheckCircle2, RefreshCw, XCircle, Inbox,
  TrendingUp, Printer, ArrowLeft,
} from 'lucide-react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, LabelList, AreaChart, Area, PieChart, Pie, Cell,
} from 'recharts'
import { supabase } from '../lib/supabase'
import { useTenant } from '../contexts/TenantContext'
import { useVisibleRefresh } from '../hooks/useVisibleRefresh'

// ดึงมาใช้คำนวณกราฟสรุปทั้งหมด (สถานะ/หมวดหมู่/แนวโน้มรายเดือน) — คำร้องเรียนสะสมของ อปท.
// ทั่วไปไม่เกินหลักพัน จึงพอเป็น "ทั้งหมด" ในทางปฏิบัติ ถ้าเกิน limit จะมีหมายเหตุแจ้งผู้ใช้ (ดู isTruncated ด้านล่าง)
const AGGREGATE_LIMIT = 1000

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
  tax: 'ภาษีและค่าธรรมเนียม', tree: 'ตัดต้นไม้', water_supply: 'สนับสนุนน้ำอุปโภค',
  animals: 'สุนัขจรจัด', phone_complaint: 'ร้องเรียนเสียง', other: 'อื่นๆ',
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
  const tenantId = tenant?.id
  const [stats, setStats]         = useState(null)
  const [rows, setRows]           = useState([])
  const [categoryLabels, setCategoryLabels] = useState({})
  const [loading, setLoading]     = useState(true)

  const now = new Date().toLocaleDateString('th-TH', {
    year: 'numeric', month: 'long', day: 'numeric',
  })

  const loadStats = useCallback(() => {
    if (!tenantId) return Promise.resolve()
    return Promise.all([
      supabase.rpc('complaint_stats',  { _municipality_id: tenantId }),
      supabase.rpc('complaints_public', { _municipality_id: tenantId, _limit: AGGREGATE_LIMIT }),
    ]).then(([{ data: s }, { data: r }]) => {
      setStats(s)
      setRows(r ?? [])
    }).catch(() => {})
  }, [tenantId])

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

  const completionRate = stats?.total > 0
    ? Math.round((stats.resolved / stats.total) * 100)
    : 0

  function categoryLabel(value) {
    return categoryLabels[value] ?? FALLBACK_CATEGORY_LABELS[value] ?? value
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
    // categoryLabel ไม่ต้องอยู่ใน deps — พฤติกรรมขึ้นกับ categoryLabels (มีอยู่แล้ว) เท่านั้น
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, categoryLabels])

  // แนวโน้มรายเดือน — 6 เดือนล่าสุด นับจากเดือนปัจจุบันย้อนหลัง (รวมเดือนที่มี 0 เรื่องด้วย ไม่ข้าม
  // ไม่งั้นเส้นจะกระโดดผิดสัดส่วนเวลา)
  const monthlyTrend = useMemo(() => {
    const nowDate = new Date()
    const buckets = []
    for (let i = 5; i >= 0; i--) {
      const d = new Date(nowDate.getFullYear(), nowDate.getMonth() - i, 1)
      buckets.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: MONTH_SHORT_TH[d.getMonth()], count: 0 })
    }
    const byKey = Object.fromEntries(buckets.map(b => [b.key, b]))
    rows.forEach(r => {
      const d = new Date(r.created_at)
      const key = `${d.getFullYear()}-${d.getMonth()}`
      if (byKey[key]) byKey[key].count += 1
    })
    return buckets
  }, [rows])

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
      <div className="bg-white border-b border-gray-100 shadow-sm print:shadow-none px-4 py-5">
        <div className="max-w-4xl mx-auto">
          <Link to="/reports"
            className="print:hidden inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-600 mb-4">
            <ArrowLeft size={14} /> กลับ
          </Link>
          <div className="flex items-start justify-between gap-4">
            <div>
              <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                ความโปร่งใสด้านการจัดการเรื่องร้องเรียน
              </span>
              <h1 className="text-xl font-black text-gray-800 leading-tight mt-2">
                รายงานการจัดการเรื่องร้องเรียน/ร้องทุกข์
              </h1>
              <p className="text-sm text-gray-500 mt-0.5">{tenant?.name ?? 'หน่วยงาน'}</p>
              <p className="text-xs text-gray-400 mt-1">ข้อมูล ณ วันที่ {now}</p>
            </div>
            <button
              onClick={() => window.print()}
              className="print:hidden flex items-center gap-2 text-sm font-semibold text-gray-600 hover:text-gray-800 border border-gray-200 rounded-xl px-3 py-2 transition-colors shrink-0">
              <Printer size={15} /> พิมพ์
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-4 space-y-3">

        {/* ── Stats grid ── */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 sm:gap-3">
          <StatCard
            label="รวมเรื่องทั้งหมด"
            value={stats?.total ?? 0}
            sub={`เดือนนี้ ${stats?.this_month ?? 0} เรื่อง`}
            Icon={ClipboardList}
            iconBg="bg-blue-500"
            border="border-blue-100"
          />
          <StatCard
            label="เสร็จสิ้น"
            value={stats?.resolved ?? 0}
            sub={`คิดเป็น ${completionRate}% ของทั้งหมด`}
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
            sub="วันแจ้ง → วันปิดเรื่อง (เฉพาะที่เสร็จแล้ว)"
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
                  <p className="text-xl font-black text-gray-800 leading-none">{completionRate}%</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">เสร็จสิ้นแล้ว</p>
                </div>
              </div>
            )}

            {/* legend — ค่าจริงยืนอยู่ตรงนี้เสมอ ไม่ต้อง hover ถึงจะเห็น (เสี้ยวแคบๆ ใส่ตัวเลขในตัวเองไม่พอ) */}
            <div className="grid grid-cols-2 gap-x-3 gap-y-2 w-full">
              {PIPELINE_STAGES.map(stage => {
                const value = stats?.[stage.key] ?? 0
                const share = stats?.total > 0 ? Math.round((value / stats.total) * 100) : 0
                return (
                  <div key={stage.key} className="flex items-start gap-2">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0 mt-1" style={{ backgroundColor: stage.dot }} />
                    <div className="min-w-0">
                      <p className="text-xs text-gray-500 leading-tight truncate">{stage.label}</p>
                      <p className="text-sm font-bold text-gray-800 leading-tight">{value} <span className="text-xs font-normal text-gray-400">({share}%)</span></p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* ── หมวดหมู่ยอดนิยม + แนวโน้มรายเดือน ── */}
        {stats?.total > 0 && (
          <div className="grid md:grid-cols-2 gap-3">

            {/* Compare magnitude → bar, single hue (var(--color-primary)) — ไม่ใช้สีแยกตามหมวด
                เพราะแต่ละหมวดแยกกันด้วยตำแหน่ง/label อยู่แล้ว ไม่ต้องพึ่งสีบอก identity ซ้ำ */}
            <div className="bg-white rounded-2xl border border-gray-100 p-3 md:p-4">
              <p className="text-sm font-bold text-gray-700 mb-1">หมวดหมู่ยอดนิยม</p>
              {isTruncated && (
                <p className="text-[10px] text-gray-400 mb-1.5">จากข้อมูล {rows.length.toLocaleString('th-TH')} รายการล่าสุด (ทั้งหมด {stats.total.toLocaleString('th-TH')} รายการ)</p>
              )}
              <ResponsiveContainer width="100%" height={Math.max(120, categoryBreakdown.length * 26 + 12)}>
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
            <div className="bg-white rounded-2xl border border-gray-100 p-3 md:p-4">
              <p className="text-sm font-bold text-gray-700 mb-1">แนวโน้มจำนวนคำร้อง</p>
              <p className="text-[10px] text-gray-400 mb-1.5">6 เดือนล่าสุด</p>
              <ResponsiveContainer width="100%" height={160}>
                <AreaChart data={monthlyTrend} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.12} />
                      <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="#e5e7eb" />
                  <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: '#c3c2b7' }} tick={{ fontSize: 11, fill: '#898781' }} />
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

          </div>
        )}

        {/* Footer */}
        <p className="text-center text-xs text-gray-300 pb-6 mb-20 md:mb-0 print:text-gray-500">
          SmartLocal e-Service Platform • รายงานนี้สร้างโดยอัตโนมัติ •{' '}
          {tenant?.name} • {now}
        </p>

      </div>
    </div>
  )
}
