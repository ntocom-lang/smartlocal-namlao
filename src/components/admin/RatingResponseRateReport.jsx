// รายงาน "อัตราตอบรายเดือน" ของแบบประเมินความพึงพอใจคำร้อง — แท็บใน SatisfactionAdmin (AdminDashboard.jsx)
// คำนวณฝั่งหน้าเว็บจากตารางเดิม (complaints / satisfaction_ratings / complaint_categories / profiles) ไม่มี SQL ใหม่ ไม่มีช่องกรอก
// ตรรกะนับอยู่ที่ src/lib/complaintRatingResponseRate.js (มีเทสต์) · ใบพิมพ์ที่ src/lib/ratingResponseRatePrint.js
//
// ⚠️ PDPA: complaints เลือกเฉพาะ id/status/closed_at/category/user_id/rating — ไม่ดึงชื่อ เบอร์ ที่อยู่ รายละเอียด
//    profiles เลือกเฉพาะ id/role (ใช้แยกกลุ่มผู้ยื่น ไม่แสดงรายบุคคล)
import { useEffect, useMemo, useState } from 'react'
import { Download, Loader2, Printer } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import {
  avgText, buildMonthlyResponseRate, cellText, responseRateCsv, submittersText, thaiDateTimeText, thaiIsoDate,
} from '../../lib/complaintRatingResponseRate'
import { RESPONSE_RATE_NOTES, buildRatingResponseRateHtml, openRatingResponseRatePrintWindow } from '../../lib/ratingResponseRatePrint'

const PAGE = 1000
const ID_CHUNK = 200

// ดึงทีละ 1000 แถวจนหมด (PostgREST จำกัดต่อคำขอ) — เรียงด้วย id ให้หน้าไม่ซ้ำ/ไม่ตกหล่นระหว่างแบ่งหน้า
async function fetchAll(makeQuery) {
  const rows = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await makeQuery().order('id').range(from, from + PAGE - 1)
    if (error) throw error
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE) break
  }
  return rows
}

// บทบาทของผู้ยื่น — คืน { roleById, partial } · query พังบางชุด/ทั้งก้อน → partial = true (ผู้ยื่นที่หาไม่เจอตกเป็น "ไม่ทราบ" ไม่ใช่ error)
async function fetchRoles(userIds) {
  const roleById = new Map()
  let partial = false
  for (let i = 0; i < userIds.length; i += ID_CHUNK) {
    const { data, error } = await supabase.from('profiles').select('id, role').in('id', userIds.slice(i, i + ID_CHUNK))
    if (error) { partial = true; continue }
    for (const p of data ?? []) roleById.set(p.id, p.role)
  }
  // RLS ของ profiles ("admins read all profiles") ให้เฉพาะ admin/viewer/council/superadmin อ่านบัญชีคนอื่นใน อปท.
  // officer/staff ได้แถวกลับมาไม่ครบ "โดยไม่มี error" — ต้องนับเองว่าขาดกี่คน ไม่งั้นเสียงผู้รับบริการตัวจริงเป็น 0 เงียบๆ
  const missing = userIds.filter(id => !roleById.has(id)).length
  if (missing > 0) partial = true
  return { roleById, partial, missing }
}

const thCls = 'px-3 py-2 text-xs font-bold text-white text-center align-bottom'
const tdCls = 'px-3 py-2 text-xs text-gray-700 text-center align-top whitespace-nowrap'

function ScoreCell({ cell, strong = false }) {
  return (
    <td className={`${tdCls} ${strong ? 'font-bold bg-emerald-50 text-emerald-900' : ''}`}>
      {cellText(cell)}
      {cell.n > 0 && <span className="block text-[10px] font-normal text-gray-400">เฉลี่ย {avgText(cell.avg)}</span>}
    </td>
  )
}

function Row({ label, r, total = false }) {
  return (
    <tr className={total ? 'bg-slate-100 font-bold border-t-2 border-slate-300' : 'border-b border-gray-100'}>
      <td className={`${tdCls} font-bold text-left text-gray-800`}>{label}</td>
      <td className={tdCls}>
        {r.closed}
        <span className="block text-[10px] font-normal text-gray-400">{submittersText(r.submitters)}</span>
      </td>
      <ScoreCell cell={r.verified} />
      <ScoreCell cell={r.via_link} />
      <ScoreCell cell={r.proxy} />
      <ScoreCell cell={r.linked_anon} />
      <td className={tdCls}>{cellText(r.anyRated)}</td>
      <ScoreCell cell={r.genuine} strong />
      <td className={tdCls}>
        {r.general.n > 0 ? r.general.n : '–'}
        {r.general.n > 0 && <span className="block text-[10px] font-normal text-gray-400">เฉลี่ย {avgText(r.general.avg)}</span>}
      </td>
    </tr>
  )
}

export default function RatingResponseRateReport({ tenant }) {
  // ผลเก็บคู่กับ tenantId ที่โหลดมา — เปลี่ยน อปท. แล้วผลเก่าถือว่า "กำลังโหลด" ทันที โดยไม่ต้อง setState ตอนเริ่ม effect
  const [state, setState] = useState({ tenantId: null, error: null, data: null })

  useEffect(() => {
    if (!tenant?.id) return undefined
    let cancelled = false
    const tenantId = tenant.id
    ;(async () => {
      try {
        const [complaints, ratings, categories] = await Promise.all([
          fetchAll(() => supabase.from('complaints')
            .select('id, status, closed_at, category, user_id, rating')
            .eq('municipality_id', tenant.id)
            .not('closed_at', 'is', null)),
          fetchAll(() => supabase.from('satisfaction_ratings')
            .select('id, complaint_id, rating, is_verified, via_link, rated_by_proxy, created_at')
            .eq('municipality_id', tenant.id)),
          supabase.from('complaint_categories').select('value, is_adhoc').eq('municipality_id', tenant.id),
        ])
        if (categories.error) throw categories.error
        const userIds = [...new Set(complaints.map(c => c.user_id).filter(Boolean))]
        const { roleById, partial, missing } = await fetchRoles(userIds)
        if (cancelled) return
        setState({
          tenantId,
          error: null,
          data: {
            complaints, ratings, roleById, rolesPartial: partial, rolesMissing: missing,
            adhocValues: (categories.data ?? []).filter(c => c.is_adhoc).map(c => c.value),
            loadedAt: Date.now(),
          },
        })
      } catch (error) {
        if (!cancelled) setState({ tenantId, error, data: null })
      }
    })()
    return () => { cancelled = true }
  }, [tenant?.id])

  const loading = state.tenantId !== tenant?.id
  const data = loading ? null : state.data
  const result = useMemo(() => (data
    ? buildMonthlyResponseRate({ complaints: data.complaints, ratings: data.ratings, adhocValues: data.adhocValues, roleById: data.roleById, now: data.loadedAt })
    : null), [data])

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 size={28} className="animate-spin text-gray-400" /></div>
  if (state.error || !data) {
    return (
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-red-100 text-sm text-red-600">
        โหลดข้อมูลไม่สำเร็จ ลองรีเฟรชหน้าอีกครั้ง
      </div>
    )
  }

  const asOfText = thaiDateTimeText(data.loadedAt)
  const rowsNewestFirst = [...result.months].reverse()

  function handlePrint() {
    const ok = openRatingResponseRatePrintWindow(buildRatingResponseRateHtml({ result, tenant, asOfText }))
    if (!ok) window.alert('เบราว์เซอร์บล็อกหน้าต่างพิมพ์ กรุณาอนุญาตป๊อปอัปของเว็บนี้แล้วกดพิมพ์อีกครั้ง')
  }

  function handleCsv() {
    const csv = responseRateCsv(result, { orgName: tenant?.name ?? '', asOfText: `${asOfText} น.` })
    const link = document.createElement('a')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
    link.href = url
    link.download = `อัตราตอบประเมินคำร้อง_${tenant?.slug ?? tenant?.id}_${thaiIsoDate(data.loadedAt)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-gray-500">
          ข้อมูล ณ วันที่ <span className="font-semibold text-gray-700">{asOfText} น.</span>
          {' '}· นับคำร้องที่ปิดแล้วตามเดือนที่ปิดเรื่อง ไม่รวมหมวดเฉพาะกิจ
        </p>
        <div className="flex gap-2">
          <button onClick={handleCsv}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition-colors"
            style={{ color: '#1a3a5c', borderColor: '#1a3a5c', backgroundColor: '#fff' }}>
            <Download size={14} /> ดาวน์โหลด CSV
          </button>
          <button onClick={handlePrint}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-white shadow-sm transition-colors"
            style={{ backgroundColor: '#1a3a5c' }}>
            <Printer size={14} /> พิมพ์
          </button>
        </div>
      </div>

      {data.rolesPartial && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          แยกกลุ่มผู้ยื่นได้ไม่ครบ (อ่านบทบาทของบัญชี{data.rolesMissing > 0 ? ` ${data.rolesMissing} บัญชี` : 'บางส่วน'}ไม่ได้) — เรื่องเหล่านั้นถูกนับเป็น "ไม่ทราบ" จึงไม่ถูกนับเป็นเสียงผู้รับบริการตัวจริง
          {' '}ตัวเลขที่จะนำไปอ้างอิงควรเปิดด้วยบัญชีผู้ดูแลระบบ (admin) ของ อปท.
        </div>
      )}

      {/* ตารางเลื่อนแนวนอนในกล่องของตัวเอง — หน้าไม่ล้นบนมือถือ */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] border-collapse">
            <thead>
              <tr style={{ backgroundColor: '#1a3a5c' }}>
                <th className={`${thCls} text-left`}>เดือนที่ปิดเรื่อง</th>
                <th className={thCls}>ปิดแล้ว (เรื่อง)<span className="block text-[10px] font-normal opacity-80">แยกตามผู้ยื่น</span></th>
                <th className={thCls}>ผู้ยื่นเอง</th>
                <th className={thCls}>ผ่านลิงก์</th>
                <th className={thCls}>สท. บันทึกแทน</th>
                <th className={thCls}>เลขอ้างอิง</th>
                <th className={thCls}>มีคะแนน ≥ 1 ช่อง</th>
                <th className={`${thCls} bg-emerald-700`}>เสียงผู้รับบริการตัวจริง</th>
                <th className={thCls}>ประเมินภาพรวม<span className="block text-[10px] font-normal opacity-80">ไม่ผูกคำร้อง (ครั้ง)</span></th>
              </tr>
            </thead>
            <tbody>
              {rowsNewestFirst.length === 0 && (
                <tr><td colSpan={9} className="px-3 py-10 text-center text-sm text-gray-400">ยังไม่มีคำร้องที่ปิดแล้ว</td></tr>
              )}
              {rowsNewestFirst.map(m => <Row key={m.key} label={m.label} r={m} />)}
              {rowsNewestFirst.length > 0 && <Row label="รวมทั้งหมด" r={result.total} total />}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
        <p className="text-xs font-bold text-gray-600 mb-1.5">หมายเหตุการนับ</p>
        <ul className="list-disc pl-5 space-y-1 text-[11px] text-gray-500 leading-relaxed">
          {RESPONSE_RATE_NOTES.map(n => <li key={n}>{n}</li>)}
        </ul>
      </div>
    </div>
  )
}
