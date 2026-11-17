// แท็บ "คำขอ E-Service" ในหน้าผลการประเมิน (แผงควบคุม → ความพึงพอใจ) — แผนเทียบคู่แข่ง ข้อ 1.2 (2569-11-17)
// ตัวเลขชุดเดียวกับห้องผู้บริหาร: executive_overview(['satisfaction']).eservice → exec_satisfaction_eservice (20261204100100)
// ไม่คำนวณซ้ำฝั่งเว็บ (ใบที่ผู้ยื่นถอนเอง/ใบเคาน์เตอร์ตัดสินในฐานข้อมูลที่เดียว) · ไม่มีชื่อผู้ยื่น/ความเห็นในตารางนี้
import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { BASE_DOCUMENT_TYPES, customDocumentTypes } from '../../lib/documentTypes'
import { eserviceRatingView } from '../../lib/executiveData'
import { todayBangkok } from '../../lib/documentSignatories'

// ย้อนหลัง 365 วัน (ฟังก์ชันรับได้ไม่เกิน 400 วัน)
function lastYearRange() {
  const to = todayBangkok()
  const d = new Date(`${to}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 365)
  return { from: d.toISOString().slice(0, 10), to }
}

const fmt = (v) => (v == null ? '—' : v)

export default function EserviceRatingSummary({ tenant }) {
  // ผลผูกกับ tenantId ที่โหลด — เปลี่ยน อปท. แล้วถือว่ากำลังโหลดเอง ไม่ต้อง setState ใน effect (แบบ RatingResponseRateReport)
  const [state, setState] = useState({ tenantId: null, error: null, view: null })

  useEffect(() => {
    if (!tenant?.id) return undefined
    let cancelled = false
    const tenantId = tenant.id
    const { from, to } = lastYearRange()
    const fail = () => { if (!cancelled) setState({ tenantId, error: 'โหลดสรุปคำขอ E-Service ไม่ได้', view: null }) }
    Promise.resolve(supabase.rpc('executive_overview', {
      _municipality_id: tenantId, _from: from, _to: to, _keys: ['satisfaction'],
    }))
      .then(({ data, error }) => {
        if (cancelled) return
        const sat = data?.summaries?.satisfaction
        if (error || !sat?.ok) { fail(); return }
        const view = eserviceRatingView(sat.data?.eservice ?? null)
        // ไม่มีคีย์ eservice = ฐานรุ่นเก่า · มีคีย์แต่เป็น null = ส่วนนี้คำนวณล้ม (ฐานกันไว้ไม่ให้ลากการ์ดคำร้องล้มตาม — 20261204100200)
        const reason = sat.data && Object.hasOwn(sat.data, 'eservice')
          ? 'โหลดสรุปคำขอ E-Service ไม่ได้ ลองใหม่อีกครั้ง'
          : 'ฐานข้อมูลยังไม่รองรับการประเมินคำขอ E-Service'
        setState({ tenantId, error: view.available ? null : reason, view })
      })
      .catch(fail)
    return () => { cancelled = true }
  }, [tenant?.id])

  if (state.tenantId !== tenant?.id) return <div className="flex items-center justify-center py-8"><Loader2 size={22} className="animate-spin text-gray-400" /></div>
  if (state.error) return <p className="rounded-2xl border border-gray-200 bg-white px-4 py-3 text-xs text-gray-500">{state.error}</p>

  const v = state.view
  // รวมประเภทที่ อปท. ถอดออกไปแล้วด้วย — คำขอเก่าของประเภทนั้นยังต้องมีป้ายอ่านออก
  const typeLabel = new Map([...BASE_DOCUMENT_TYPES, ...customDocumentTypes(tenant)].map((t) => [t.value, t.label]))
  return (
    <div className="space-y-3 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm" data-eservice-rating>
      <div>
        <p className="text-sm font-bold text-gray-700">คำขอ E-Service ที่ปิดในรอบ 365 วัน</p>
        <p className="text-[11px] text-gray-500">นับตามวันที่ปิดคำขอ · ไม่รวมใบที่ผู้ยื่นยกเลิกเอง · ตัวเลขชุดเดียวกับห้องผู้บริหาร</p>
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {[
          ['ปิดแล้ว', `${v.finished}`, `เสร็จ ${v.completed} · ไม่อนุมัติ ${v.rejected}`],
          ['ประเมินได้', `${v.rateable}`, 'ประชาชนยื่นเองออนไลน์'],
          ['อัตราตอบ', v.responseRate == null ? '—' : `${v.responseRate}%`, `ประเมินแล้ว ${v.ratedCnt} ใบ`],
          ['คะแนนเฉลี่ย (ใบที่เสร็จ)', `${fmt(v.completedAvg)}`, v.rejectedCnt > 0 ? `ใบไม่อนุมัติ ${fmt(v.rejectedAvg)} (${v.rejectedCnt})` : 'ใบไม่อนุมัติยังไม่มีคะแนน'],
        ].map(([label, value, sub]) => (
          <div key={label} className="rounded-xl border border-gray-100 bg-gray-50 p-3">
            <p className="text-[11px] text-gray-500">{label}</p>
            <p className="text-xl font-black text-gray-800">{value}</p>
            <p className="text-[10px] text-gray-500">{sub}</p>
          </div>
        ))}
      </div>

      {v.byType.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-xs">
            <thead>
              <tr className="text-left text-gray-500">
                <th className="py-1.5 pr-2 font-semibold">ประเภทคำขอ</th>
                <th className="py-1.5 px-2 text-right font-semibold">ปิดแล้ว</th>
                <th className="py-1.5 px-2 text-right font-semibold">ประเมินได้</th>
                <th className="py-1.5 px-2 text-right font-semibold">ประเมินแล้ว</th>
                <th className="py-1.5 pl-2 text-right font-semibold">เฉลี่ย</th>
              </tr>
            </thead>
            <tbody>
              {v.byType.map((r) => (
                <tr key={r.t ?? '__none__'} className="border-t border-gray-100">
                  <td className="py-1.5 pr-2 text-gray-700">{typeLabel.get(r.t) ?? 'ประเภทอื่น'}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums">{r.finished}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums">{r.rateable}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums">{r.cnt}{r.responseRate == null ? '' : ` (${r.responseRate}%)`}</td>
                  <td className="py-1.5 pl-2 text-right font-bold tabular-nums">{fmt(r.avg)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {v.notRateable.length > 0 && (
        <p className="text-[11px] text-gray-500">
          ประเมินไม่ได้ (ไม่อยู่ในตัวหารอัตราตอบ): {v.notRateable.map((x) => `${x.label} ${x.n} ใบ`).join(' · ')}
        </p>
      )}
      {v.undated > 0 && (
        <p className="text-[11px] text-gray-500">คำขอที่ปิดก่อนเริ่มเก็บเวลาปิด {v.undated} ใบ ไม่อยู่ในตัวเลขชุดนี้ (ผู้ยื่นยังกดประเมินได้)</p>
      )}
    </div>
  )
}
