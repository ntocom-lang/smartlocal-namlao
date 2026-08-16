import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  ClipboardList, CheckCircle2, RefreshCw, XCircle, Inbox,
  TrendingUp, Printer, ArrowLeft,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useTenant } from '../contexts/TenantContext'

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

// ครอบคลุมทั้ง 8 ค่าที่ constraint จริงบน production อนุญาต (ตรวจกับ pg_constraint ก่อนเขียน
// ไม่ใช่แค่ 5 ค่าตามไฟล์ 002_create_complaints.sql เดิม — new/done/closed ยังมีข้อมูลจริงค้างอยู่)
// จัดกลุ่มภาพให้ตรงกับ 4 bucket ที่ RPC complaint_stats คืนมา (open/in_progress/resolved/rejected)
const STATUS_META = {
  new:         { label: 'รอรับเรื่อง',      cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  pending:     { label: 'รอรับเรื่อง',      cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  received:    { label: 'รับเรื่องแล้ว',    cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  in_progress: { label: 'กำลังดำเนินการ', cls: 'bg-sky-50 text-sky-700 border-sky-200' },
  done:        { label: 'เสร็จสิ้น',       cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  closed:      { label: 'เสร็จสิ้น',       cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  completed:   { label: 'เสร็จสิ้น',       cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  rejected:    { label: 'ยกเลิก/ไม่รับ',   cls: 'bg-red-50 text-red-700 border-red-200' },
}

function thDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('th-TH', {
    day: 'numeric', month: 'short', year: '2-digit',
  })
}

function StatCard({ label, value, sub, Icon, iconBg, border }) {
  // ค่า 0 ให้ตัวเลขจางลง ตัวที่มีนัยสำคัญ (>0) เด่นขึ้น — ช่วยกวาดสายตาหาจุดที่ต้องสนใจได้เร็วกว่า
  const isZero = value === 0
  return (
    <div className={`bg-white rounded-2xl border p-4 flex flex-col gap-1 ${border}`}>
      <div className="flex items-center gap-2 mb-1">
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${iconBg} ${isZero ? 'opacity-50' : ''}`}>
          <Icon size={16} className="text-white" />
        </div>
        <p className="text-xs font-semibold text-gray-500">{label}</p>
      </div>
      <p className={`text-3xl font-black leading-none ${isZero ? 'text-gray-300' : 'text-gray-800'}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  )
}

function CompletionRing({ percent, size = 132, stroke = 13 }) {
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const dash = (Math.min(100, Math.max(0, percent)) / 100) * circumference
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#eef2f7" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--color-primary)" strokeWidth={stroke}
          strokeDasharray={`${dash} ${circumference}`} strokeLinecap="round"
          className="transition-all duration-700 ease-out" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-black text-gray-800 leading-none">{percent}%</span>
        <span className="text-[11px] font-semibold text-gray-400 mt-1">เสร็จสิ้น</span>
      </div>
    </div>
  )
}

export default function ComplaintStats() {
  const { tenant } = useTenant()
  const [stats, setStats]         = useState(null)
  const [rows, setRows]           = useState([])
  const [categoryLabels, setCategoryLabels] = useState({})
  const [loading, setLoading]     = useState(true)

  const now = new Date().toLocaleDateString('th-TH', {
    year: 'numeric', month: 'long', day: 'numeric',
  })

  useEffect(() => {
    if (!tenant?.id) return
    Promise.all([
      supabase.rpc('complaint_stats',  { _municipality_id: tenant.id }),
      supabase.rpc('complaints_public', { _municipality_id: tenant.id, _limit: 30 }),
      supabase.from('complaint_categories').select('value, label').eq('municipality_id', tenant.id).eq('is_active', true),
    ]).then(([{ data: s }, { data: r }, { data: cats }]) => {
      setStats(s)
      setRows(r ?? [])
      const map = {}
      ;(cats ?? []).forEach(c => { map[c.value] = c.label })
      setCategoryLabels(map)
    })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [tenant?.id])

  const completionRate = stats?.total > 0
    ? Math.round((stats.resolved / stats.total) * 100)
    : 0

  function categoryLabel(value) {
    return categoryLabels[value] ?? FALLBACK_CATEGORY_LABELS[value] ?? value
  }

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
                รายงานการจัดการเรื่องร้องเรียน/แจ้งซ่อม
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

      <div className="max-w-4xl mx-auto px-4 py-6 space-y-5">

        {/* ── Hero: อัตราเสร็จสิ้น + ตัวเลขหลัก ── */}
        <div className="bg-white rounded-2xl border border-gray-100 p-5 md:p-6">
          <div className="flex flex-col sm:flex-row items-center gap-6 sm:gap-8">
            <CompletionRing percent={completionRate} />
            <div className="w-full grid grid-cols-2 gap-5 sm:gap-8 sm:border-l sm:border-gray-100 sm:pl-8">
              <div>
                <p className="text-xs font-semibold text-gray-500 flex items-center gap-1.5">
                  <ClipboardList size={14} className="text-blue-500" /> เรื่องร้องเรียนทั้งหมด
                </p>
                <p className="text-3xl font-black text-gray-800 mt-1.5 leading-none">{stats?.total ?? 0}</p>
                <p className="text-xs text-gray-400 mt-1.5">+{stats?.this_month ?? 0} เรื่องใหม่เดือนนี้</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-500 flex items-center gap-1.5">
                  <CheckCircle2 size={14} className="text-emerald-500" /> เสร็จสิ้นแล้ว
                </p>
                <p className="text-3xl font-black text-emerald-600 mt-1.5 leading-none">{stats?.resolved ?? 0}</p>
                <p className="text-xs text-gray-400 mt-1.5">จากทั้งหมด {stats?.total ?? 0} เรื่อง</p>
              </div>
            </div>
          </div>
        </div>

        {/* ── สถานะอื่นๆ ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard
            label="กำลังดำเนินการ"
            value={stats?.in_progress ?? 0}
            Icon={RefreshCw}
            iconBg="bg-sky-400"
            border="border-sky-100"
          />
          <StatCard
            label="รอรับเรื่อง / รับเรื่องแล้ว"
            value={stats?.open ?? 0}
            Icon={Inbox}
            iconBg="bg-amber-400"
            border="border-amber-100"
          />
          <StatCard
            label="ระยะเวลาเฉลี่ย"
            value={stats?.avg_days != null ? `${stats.avg_days} วัน` : '—'}
            sub="วันแจ้ง → วันปิดเรื่อง"
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

        {/* ── Recent complaints ── */}
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <div className="px-4 py-3.5 border-b border-gray-100">
            <p className="font-bold text-gray-800">
              รายการเรื่องร้องเรียนล่าสุด ({rows.length} รายการ)
            </p>
            <p className="text-xs text-gray-400 mt-0.5">
              ข้อมูลส่วนบุคคลของผู้แจ้ง (ชื่อ/เบอร์โทร/รายละเอียด/พิกัด) ถูกปกปิดตาม พ.ร.บ. คุ้มครองข้อมูลส่วนบุคคล พ.ศ. ๒๕๖๒
            </p>
          </div>

          {/* PC table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  {['#', 'หมายเลขอ้างอิง', 'ประเภทเรื่อง', 'วันที่แจ้ง', 'วันที่ปิดเรื่อง', 'ใช้เวลา', 'สถานะ'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-sm text-gray-400">
                      ยังไม่มีข้อมูลเรื่องร้องเรียน
                    </td>
                  </tr>
                ) : rows.map((r, i) => {
                  const sm = STATUS_META[r.status] ?? STATUS_META.pending
                  return (
                    <tr key={r.ref_id + i} className="hover:bg-gray-50/70 transition-colors">
                      <td className="px-4 py-3 text-xs text-gray-400 tabular-nums">{rows.length - i}</td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-600 whitespace-nowrap">{r.ref_id}</td>
                      <td className="px-4 py-3 font-medium text-gray-800">
                        {categoryLabel(r.category)}
                      </td>
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap tabular-nums">
                        {thDate(r.created_at)}
                      </td>
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap tabular-nums">
                        {thDate(r.closed_at)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {r.days_taken != null
                          ? <span className="text-xs font-bold text-gray-700">{r.days_taken} วัน</span>
                          : <span className="text-xs text-gray-300">—</span>
                        }
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex text-xs font-semibold px-2.5 py-1 rounded-full border ${sm.cls}`}>
                          {sm.label}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile list */}
          <div className="md:hidden divide-y divide-gray-50">
            {rows.length === 0 ? (
              <p className="text-center text-sm text-gray-400 py-10">ยังไม่มีข้อมูล</p>
            ) : rows.map((r, i) => {
              const sm = STATUS_META[r.status] ?? STATUS_META.pending
              return (
                <div key={r.ref_id + i} className="px-4 py-3.5 flex items-start gap-3">
                  <div className="w-7 h-7 rounded-lg bg-gray-100 flex items-center justify-center shrink-0 mt-0.5">
                    <span className="text-xs text-gray-400 font-bold tabular-nums">{rows.length - i}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800">
                      {categoryLabel(r.category)}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5 font-mono">{r.ref_id} • แจ้ง {thDate(r.created_at)}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${sm.cls}`}>
                      {sm.label}
                    </span>
                    {r.days_taken != null && (
                      <span className="text-xs text-gray-400">{r.days_taken} วัน</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-gray-300 pb-6 mb-20 md:mb-0 print:text-gray-500">
          SmartLocal e-Service Platform • รายงานนี้สร้างโดยอัตโนมัติ •{' '}
          {tenant?.name} • {now}
        </p>

      </div>
    </div>
  )
}
