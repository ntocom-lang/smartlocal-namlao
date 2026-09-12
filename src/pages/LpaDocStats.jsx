import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  FileText, CheckCircle2, Clock, RefreshCw, XCircle,
  TrendingUp, Printer, ArrowLeft,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useTenant } from '../contexts/TenantContext'
import FiscalYearPicker from '../components/common/FiscalYearPicker'
import { FY_ALL, useFiscalYearParam, fiscalPeriodParts } from '../lib/fiscalYearParam'
import { fiscalYearBounds } from '../lib/fiscalYear'

const DOC_LABELS = {
  residence_cert: 'ใบรับรองการอยู่อาศัย',
  personal_cert:  'หนังสือรับรองบุคคล',
  tax_notice:       'ค่าธรรมเนียม/ภาษี',
  waste_collection: 'ค่าธรรมเนียมขยะ',
  waste_collection_request: 'ขอรับบริการเก็บขนขยะมูลฝอย',
  waste_collection_cancel:  'ขอยกเลิกการเก็บขนขยะมูลฝอย',
  water_supply_request:     'ขออนุญาตใช้น้ำประปา',
  public_assistance_request: 'ขอรับการช่วยเหลือประชาชน',
  asset_borrow_request: 'ขอยืมพัสดุ/ครุภัณฑ์',
  patient_transport_request: 'ขออนุเคราะห์รถรับ-ส่งผู้ป่วย',
  building_permit:  'ขออนุญาตก่อสร้างบ้าน',
}

const STATUS_META = {
  pending:    { label: 'รอดำเนินการ',    cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  processing: { label: 'กำลังดำเนินการ', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  completed:  { label: 'เสร็จสิ้น',      cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  rejected:   { label: 'ปฏิเสธ',         cls: 'bg-red-50 text-red-700 border-red-200' },
}

function thDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('th-TH', {
    day: 'numeric', month: 'short', year: '2-digit',
  })
}

// ขนาดชุดนี้ยกมาจาก ComplaintStats ให้รายงานสาธารณะ 2 หน้าหน้าตาเท่ากันบนมือถือ
// ของเดิม p-4 + ไอคอน 32px + ตัวเลข 30px ทำให้จอ 390px เห็นการ์ดแค่ 4 ใบจาก 6 ใบ
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

export default function LpaDocStats() {
  const { tenant } = useTenant()
  const [stats, setStats]   = useState(null)
  const [rows, setRows]     = useState([])
  const [loading, setLoading] = useState(true)

  const { value: fiscalYear, setValue: setFiscalYear, options: fiscalOptions } = useFiscalYearParam()
  // memo ตามค่าปีงบ — object range ที่ hook สร้างใหม่ทุกรอบ render จะทำให้ useEffect ยิงซ้ำไม่หยุด
  const fiscalRange = useMemo(
    () => (fiscalYear === FY_ALL ? null : fiscalYearBounds(fiscalYear)),
    [fiscalYear],
  )
  const isPastFiscalYear = fiscalYear !== FY_ALL && fiscalYear < fiscalOptions[0]

  // แยก main/range เพื่อซ่อนวงเล็บช่วงวันที่บนจอมือถือ (ดูเหตุผลที่ fiscalPeriodParts)
  const fiscalPeriod = fiscalPeriodParts(fiscalYear)

  const now = new Date().toLocaleDateString('th-TH', {
    year: 'numeric', month: 'long', day: 'numeric',
  })

  useEffect(() => {
    if (!tenant?.id) return
    const calls = fiscalRange
      ? [
          supabase.rpc('doc_request_stats_fy', {
            _municipality_id: tenant.id, _from: fiscalRange.from, _to: fiscalRange.to,
          }),
          supabase.rpc('doc_requests_public_fy', {
            _municipality_id: tenant.id, _limit: 30,
            _from: fiscalRange.from, _to: fiscalRange.to,
          }),
        ]
      : [
          supabase.rpc('doc_request_stats',   { _municipality_id: tenant.id }),
          supabase.rpc('doc_requests_public', { _municipality_id: tenant.id, _limit: 30 }),
        ]
    Promise.all(calls).then(([{ data: s }, { data: r }]) => {
      setStats(s)
      setRows(r ?? [])
    })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [tenant?.id, fiscalRange])

  const completionRate = stats?.total > 0
    ? Math.round((stats.completed / stats.total) * 100)
    : 0

  // doc_requests_public() คืน purpose เฉพาะเจ้าหน้าที่ของเทศบาลนั้น (ข้อความที่ประชาชนพิมพ์เอง
  // ฟอร์ม "สอบถามยอดชำระ" ใช้ฟิลด์นี้เป็นช่องบังคับกรอกด้วย ดู migration 20260830160000)
  // ผู้ชมทั่วไปจึงได้ NULL ทุกแถว — ซ่อนคอลัมน์ไปเลยดีกว่าโชว์แถบว่างยาวทั้งตาราง
  const showPurpose = rows.some(r => r.purpose)
  const tableCols = showPurpose ? 7 : 6

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
              จากพื้นที่ 358px บนจอ 390px จนหัวเรื่องตกเป็น 3 บรรทัด (ชุดเดียวกับ ComplaintStats) */}
          <div className="print:hidden flex items-center justify-between gap-3 mb-3">
            <Link to="/more"
              className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-600">
              <ArrowLeft size={14} /> กลับ
            </Link>
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1.5 text-sm font-semibold text-gray-600 hover:text-gray-800 border border-gray-200 rounded-xl px-3 py-1.5 transition-colors shrink-0">
              <Printer size={15} /> พิมพ์
            </button>
          </div>

          <span className="inline-block text-[10px] sm:text-xs font-bold px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
            ความโปร่งใสด้านบริการดิจิทัล
          </span>
          <h1 className="text-lg sm:text-xl font-black text-gray-800 leading-tight mt-2">
            รายงานสถิติข้อมูลการขอรับบริการผ่านช่องทางออนไลน์ (e-Service)
          </h1>
          <p className="text-[13px] sm:text-sm font-semibold text-gray-600 mt-1 leading-snug">
            ด้านการออกเอกสาร/ใบรับรองดิจิทัล{' '}
            {/* ปีงบต้องไม่แตกกลางคำ — จอ 390px เคยดัน "2569" ลงไปยืนเดี่ยวบรรทัดใหม่ */}
            <span className="whitespace-nowrap">— {fiscalPeriod.main}</span>
            {/* ช่วงวันที่ซ้ำกับ dropdown ปีงบที่อยู่ใต้ลงมา จอเล็กจึงตัดออก แต่ใบที่พิมพ์ต้องมีเสมอ */}
            <span className="hidden sm:inline print:inline">{fiscalPeriod.range}</span>
          </p>
          {/* ชื่อหน่วยงานกับวันที่ข้อมูลรวมเป็นบรรทัดเดียว — เดิมแยก 2 บรรทัดโดยไม่ได้ข้อมูลเพิ่ม */}
          <p className="text-xs sm:text-sm text-gray-500 mt-1 leading-snug">
            <span className="whitespace-nowrap">{tenant?.name ?? 'หน่วยงาน'}</span>
            <span className="text-gray-300"> · </span>
            <span className="text-gray-400 whitespace-nowrap">ข้อมูล ณ วันที่ {now}</span>
          </p>

          <div className="print:hidden mt-3">
            <FiscalYearPicker id="fy-doc-stats" value={fiscalYear} options={fiscalOptions} onChange={setFiscalYear} />
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6 space-y-5">

        {/* ── Stats grid ── */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 sm:gap-3">
          <StatCard
            label={fiscalRange ? 'รวมคำขอในปีงบนี้' : 'รวมคำขอทั้งหมด'}
            value={stats?.total ?? 0}
            sub={isPastFiscalYear
              ? `1 ต.ค. ${fiscalYear - 1} – 30 ก.ย. ${fiscalYear}`
              : `เดือนนี้ ${stats?.this_month ?? 0} คำขอ`}
            Icon={FileText}
            iconBg="bg-blue-500"
            border="border-blue-100"
          />
          <StatCard
            label="เสร็จสิ้น"
            value={stats?.completed ?? 0}
            sub={`${completionRate}% ของทั้งหมด`}
            Icon={CheckCircle2}
            iconBg="bg-emerald-500"
            border="border-emerald-100"
          />
          <StatCard
            label="กำลังดำเนินการ"
            value={stats?.processing ?? 0}
            Icon={RefreshCw}
            iconBg="bg-sky-400"
            border="border-sky-100"
          />
          <StatCard
            label="รอดำเนินการ"
            value={stats?.pending ?? 0}
            Icon={Clock}
            iconBg="bg-amber-400"
            border="border-amber-100"
          />
          <StatCard
            label="ระยะเวลาเฉลี่ย"
            value={stats?.avg_days != null ? `${stats.avg_days} วัน` : '—'}
            sub="ยื่น → เสร็จ (เฉพาะที่เสร็จ)"
            Icon={TrendingUp}
            iconBg="bg-purple-500"
            border="border-purple-100"
          />
          <StatCard
            label="ปฏิเสธ / ยกเลิก"
            value={stats?.rejected ?? 0}
            Icon={XCircle}
            iconBg="bg-red-400"
            border="border-red-100"
          />
        </div>

        {/* ── Completion bar ── */}
        <div className="bg-white rounded-2xl border border-gray-100 p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-bold text-gray-700">อัตราการเสร็จสิ้น</p>
            <p className="text-sm font-black text-emerald-600">{completionRate}%</p>
          </div>
          <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{ width: `${completionRate}%`, backgroundColor: 'var(--color-primary)' }}
            />
          </div>
          <p className="text-xs text-gray-400 mt-2 text-right">
            เสร็จสิ้น {stats?.completed ?? 0} จาก {stats?.total ?? 0} คำขอ
          </p>
        </div>

        {/* ── Recent requests ── */}
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <div className="px-4 py-3.5 border-b border-gray-100">
            <p className="font-bold text-gray-800">
              รายการคำขอเอกสาร ({rows.length} รายการล่าสุด)
            </p>
            <p className="text-xs text-gray-400 mt-0.5">
              ข้อมูลส่วนบุคคลถูกปกปิดตาม พ.ร.บ. คุ้มครองข้อมูลส่วนบุคคล พ.ศ. ๒๕๖๒
            </p>
          </div>

          {/* PC table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  {['#', 'ประเภทเอกสาร', ...(showPurpose ? ['วัตถุประสงค์'] : []), 'วันที่ยื่น', 'วันที่เสร็จ', 'ใช้เวลา', 'สถานะ'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={tableCols} className="px-4 py-12 text-center text-sm text-gray-400">
                      ยังไม่มีข้อมูลคำขอเอกสาร
                    </td>
                  </tr>
                ) : rows.map((r, i) => {
                  const sm = STATUS_META[r.status] ?? STATUS_META.pending
                  return (
                    <tr key={r.ref_id + i} className="hover:bg-gray-50/70 transition-colors">
                      <td className="px-4 py-3 text-xs text-gray-400 tabular-nums">{rows.length - i}</td>
                      <td className="px-4 py-3 font-medium text-gray-800">
                        {DOC_LABELS[r.doc_type] ?? r.doc_type}
                      </td>
                      {showPurpose && (
                        <td className="px-4 py-3 text-gray-500 max-w-[160px] truncate">
                          {r.purpose || '—'}
                        </td>
                      )}
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap tabular-nums">
                        {thDate(r.created_at)}
                      </td>
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap tabular-nums">
                        {thDate(r.issued_at)}
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
                      {DOC_LABELS[r.doc_type] ?? r.doc_type}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">ยื่น {thDate(r.created_at)}</p>
                    {r.purpose && (
                      <p className="text-xs text-gray-500 mt-0.5 truncate">{r.purpose}</p>
                    )}
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
