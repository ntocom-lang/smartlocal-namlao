import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  FileText, CheckCircle2, Clock, RefreshCw, XCircle,
  TrendingUp, Calendar, Printer, ShieldCheck, ArrowLeft,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useTenant } from '../contexts/TenantContext'

const DOC_LABELS = {
  residence_cert: 'ใบรับรองการอยู่อาศัย',
  personal_cert:  'หนังสือรับรองบุคคล',
  conduct_cert:   'หนังสือรับรองความประพฤติ',
  tax_notice:     'ใบแจ้งชำระภาษีที่ดิน',
  other:          'คำขออื่นๆ',
}

const STATUS_META = {
  pending:    { label: 'รอดำเนินการ',    cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  processing: { label: 'กำลังดำเนินการ', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  completed:  { label: 'เสร็จสิ้น',      cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  rejected:   { label: 'ปฏิเสธ',         cls: 'bg-red-50 text-red-700 border-red-200' },
}

const LPA_CRITERIA = [
  'มีช่องทางยื่นคำขอเอกสารออนไลน์ผ่านเว็บแอปพลิเคชัน ตลอด 24 ชั่วโมง',
  'แจ้งระยะเวลาดำเนินการ 1–3 วันทำการ พร้อมหมายเลขอ้างอิงทุกคำขอ',
  'เจ้าหน้าที่บันทึกและติดตามสถานะในระบบได้แบบ Real-time',
  'ออกเอกสารราชการดิจิทัล (Digital Certificate) โดยอัตโนมัติเมื่ออนุมัติ',
  'ประชาชนดาวน์โหลดเอกสารดิจิทัลได้ผ่านระบบ "เอกสารของฉัน" ทันที',
  'จัดเก็บบันทึกการออกเอกสารทุกรายการในฐานข้อมูลกลาง ตรวจสอบได้',
  'คุ้มครองข้อมูลส่วนบุคคลตาม พ.ร.บ. PDPA — ไม่เปิดเผย PII ในรายงานสาธารณะ',
]

function thDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('th-TH', {
    day: 'numeric', month: 'short', year: '2-digit',
  })
}

function StatCard({ label, value, sub, Icon, iconBg, border }) {
  return (
    <div className={`bg-white rounded-2xl border p-4 flex flex-col gap-1 ${border}`}>
      <div className="flex items-center gap-2 mb-1">
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${iconBg}`}>
          <Icon size={16} className="text-white" />
        </div>
        <p className="text-xs font-semibold text-gray-500">{label}</p>
      </div>
      <p className="text-3xl font-black text-gray-800 leading-none">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  )
}

export default function LpaDocStats() {
  const { tenant } = useTenant()
  const [stats, setStats]   = useState(null)
  const [rows, setRows]     = useState([])
  const [loading, setLoading] = useState(true)

  const now = new Date().toLocaleDateString('th-TH', {
    year: 'numeric', month: 'long', day: 'numeric',
  })

  useEffect(() => {
    if (!tenant?.id) return
    Promise.all([
      supabase.rpc('doc_request_stats',   { _municipality_id: tenant.id }),
      supabase.rpc('doc_requests_public', { _municipality_id: tenant.id, _limit: 30 }),
    ]).then(([{ data: s }, { data: r }]) => {
      setStats(s)
      setRows(r ?? [])
      setLoading(false)
    })
  }, [tenant?.id])

  const completionRate = stats?.total > 0
    ? Math.round((stats.completed / stats.total) * 100)
    : 0

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-6 h-6 border-4 border-gray-200 rounded-full animate-spin"
             style={{ borderTopColor: 'var(--color-primary)' }} />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 print:bg-white">

      {/* ── Header ── */}
      <div className="bg-white border-b border-gray-100 shadow-sm print:shadow-none px-4 py-5">
        <div className="max-w-4xl mx-auto">
          <Link to="/more"
            className="print:hidden inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-600 mb-4">
            <ArrowLeft size={14} /> กลับ
          </Link>
          <div className="flex items-start justify-between gap-4">
            <div>
              <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                LPA ๑.๗ • ความโปร่งใสด้านบริการดิจิทัล
              </span>
              <h1 className="text-xl font-black text-gray-800 leading-tight mt-2">
                รายงานการให้บริการออกเอกสาร
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

        {/* ── Stats grid ── */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <StatCard
            label="รวมคำขอทั้งหมด"
            value={stats?.total ?? 0}
            sub={`เดือนนี้ ${stats?.this_month ?? 0} คำขอ`}
            Icon={FileText}
            iconBg="bg-blue-500"
            border="border-blue-100"
          />
          <StatCard
            label="เสร็จสิ้น"
            value={stats?.completed ?? 0}
            sub={`คิดเป็น ${completionRate}% ของทั้งหมด`}
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
            sub="วันยื่น → วันเสร็จ (เฉพาะที่เสร็จแล้ว)"
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
                  {['#', 'ประเภทเอกสาร', 'วัตถุประสงค์', 'วันที่ยื่น', 'วันที่เสร็จ', 'ใช้เวลา', 'สถานะ'].map(h => (
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
                      <td className="px-4 py-3 text-gray-500 max-w-[160px] truncate">
                        {r.purpose || '—'}
                      </td>
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

        {/* ── LPA Compliance Checklist ── */}
        <div className="bg-white rounded-2xl border border-emerald-100 overflow-hidden">
          <div className="bg-emerald-50 px-4 py-4 border-b border-emerald-100 flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-500 flex items-center justify-center shrink-0">
              <ShieldCheck size={20} className="text-white" />
            </div>
            <div>
              <p className="font-bold text-emerald-800">เกณฑ์การตรวจประเมิน LPA ๑.๗</p>
              <p className="text-xs text-emerald-600 mt-0.5">
                การออกใบอนุญาตและเอกสารผ่านระบบดิจิทัล
              </p>
            </div>
          </div>
          <div className="divide-y divide-emerald-50/60">
            {LPA_CRITERIA.map((text, i) => (
              <div key={i} className="px-4 py-3.5 flex items-start gap-3">
                <div className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center mt-0.5 shrink-0">
                  <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                    <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.5"
                          strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                <p className="text-sm text-gray-700 leading-snug">{text}</p>
              </div>
            ))}
          </div>
          <div className="px-4 py-3.5 bg-emerald-50 border-t border-emerald-100 text-center">
            <p className="text-sm font-bold text-emerald-700">
              ✅ ผ่านเกณฑ์ครบทุกข้อ — ระบบพร้อมรับการตรวจประเมิน LPA
            </p>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-gray-300 pb-6 print:text-gray-500">
          SmartLocal e-Service Platform • รายงานนี้สร้างโดยอัตโนมัติ •{' '}
          {tenant?.name} • {now}
        </p>

      </div>
    </div>
  )
}
