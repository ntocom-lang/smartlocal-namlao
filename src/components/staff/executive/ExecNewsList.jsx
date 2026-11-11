import { useCallback, useEffect, useMemo, useState } from 'react'
import { Layers, Megaphone, RefreshCw } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { thaiShortDate } from '../../../lib/complaintReportPeriods'
import { execNf } from '../../../lib/executiveData'
import ComplaintNewsDialog from '../../complaints/ComplaintNewsDialog'
import ComplaintNewsBatchDialog from '../../complaints/ComplaintNewsBatchDialog'
import { groupNewsCandidates } from '../../../lib/complaintNewsImage'
import { LoadingLine, SectionError } from './ExecParts'

// แผง "เรื่องที่ดำเนินการแล้ว · ทำภาพข่าว" ของห้องผู้บริหาร — เปิดจากปุ่มพับ/กางแล้วถึงโหลดข้อมูล (lazy)
// ข้อมูลมาจาก RPC exec_complaint_news_items เท่านั้น (ผ่านด่าน exec_assert_viewer ฝั่งฐานข้อมูล):
//   ไม่อ่านตาราง complaints/complaint_timeline ตรง (RLS ไม่ให้ viewer อ่าน + PDPA)
//   ไม่มีชื่อผู้ร้อง/รายละเอียดเรื่อง/รูปผู้แจ้ง · ไม่มีปุ่มอนุมัติ · ไม่มีลิงก์เข้าไปแก้เรื่อง (กติกาห้องผู้บริหาร)
// ฐานข้อมูลคัดแล้วว่าไม่ใช่หมวดอ่อนไหว/เฉพาะกิจ/กลิ่น · ปุ่ม "ภาพข่าว" เปิดกล่องเดียวกับหน้าเจ้าหน้าที่ แบบ source="exec"
// ปุ่ม "ภาพข่าวรวม": เรื่องหมวดเดียวกัน เสร็จวันเดียวกัน รวมเป็นภาพเดียว (กล่องจัดกลุ่มให้ · รายละเอียดรายเรื่องโหลดผ่าน RPC exec_complaint_news_detail)
//   รายการไม่มีรหัสหมวด จึงจัดกลุ่มด้วยชื่อหมวด (cat_label) + วันปิดงาน
// ชื่อคลาส Tailwind เขียนเต็มทุกตัว (ห้ามต่อสตริง)

const SHOWABLE_CODES = new Set(['42501', '22023', 'P0002'])
const GENERIC_ERROR = 'โหลดรายการเรื่องที่ดำเนินการแล้วไม่ได้'

const isDay = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)

/** แถวเดียว (การ์ด ไม่ใช้ตาราง — ไม่ล้นแนวนอนบนมือถือ) */
function NewsRow({ item, onOpen }) {
  return (
    <li data-exec-news-row={item.id} className="min-w-0 space-y-1.5 rounded-xl border border-slate-200 bg-white p-2.5">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="break-all text-sm font-black text-slate-900">{item.ref}</span>
        <span className="min-w-0 break-words text-xs font-semibold text-slate-700">{item.cat_label || 'ไม่ระบุหมวด'}</span>
      </div>
      <p className="text-[11px] leading-snug text-slate-600">
        {item.dept || 'ไม่ระบุกอง'}
        {isDay(item.closed) ? ` · ปิดงาน ${thaiShortDate(item.closed.slice(0, 10))}` : ''}
        {' · '}รูปหลังดำเนินการ {execNf(item.photos)} รูป
      </p>
      <button type="button" data-exec-news-btn onClick={() => onOpen(item)}
        className="inline-flex min-h-9 items-center justify-center gap-1 rounded-lg px-3 text-xs font-bold text-white active:scale-95"
        style={{ backgroundColor: '#c2410c' }}>
        <Megaphone size={13} aria-hidden="true" /> ภาพข่าว
      </button>
    </li>
  )
}

/** @param {{ tenant: object }} props */
export default function ExecNewsList({ tenant }) {
  const tenantId = tenant?.id
  const [state, setState] = useState({ status: 'loading', data: null, message: '' })
  const [openId, setOpenId] = useState(null)
  const [batchOpen, setBatchOpen] = useState(false)

  const load = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc('exec_complaint_news_items', { _municipality_id: tenantId })
      if (error) throw error
      setState({ status: 'ok', data, message: '' })
    } catch (e) {
      console.error('exec_complaint_news_items error:', e?.message)
      // โหลดซ้ำพลาดหลังเคยโหลดได้ = คงรายการเดิมไว้ · ครั้งแรกพลาด = ขึ้นปุ่มลองใหม่ (ข้อความดิบของระบบไม่โชว์)
      setState((prev) => (prev.status === 'ok' ? prev
        : { status: 'error', data: null, message: SHOWABLE_CODES.has(e?.code) && e?.message ? e.message : GENERIC_ERROR }))
    }
  }, [tenantId])

  useEffect(() => { load() }, [load])

  const data = state.data
  const rawItems = data?.items
  const items = useMemo(() => (Array.isArray(rawItems) ? rawItems : []), [rawItems])
  const days = data?.days ?? 90
  const batchCandidates = useMemo(() => items.flatMap((item) => {
    const day = isDay(item.closed) ? item.closed.slice(0, 10) : ''
    const label = String(item.cat_label ?? '').trim()
    if (!day || !label || !(Number(item.photos) > 0)) return []
    return [{ id: item.id, ref: item.ref, day, categoryKey: label, categoryLabel: label, departmentName: item.dept ?? '', detail: null }]
  }), [items])
  const hasBatch = useMemo(() => groupNewsCandidates(batchCandidates).some((group) => group.items.length >= 2), [batchCandidates])

  return (
    <div data-exec-news-panel className="space-y-2 rounded-2xl border border-orange-200 bg-white p-2.5 shadow-sm sm:p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <p className="min-w-0 flex-1 text-[11px] leading-snug text-slate-600">
          เรื่องที่ดำเนินการแล้วและมีรูปหลังดำเนินการ ใน {execNf(days)} วันที่ผ่านมา · ภาพข่าวไม่มีชื่อ เบอร์ หรือที่อยู่ของผู้แจ้ง
        </p>
        <button type="button" onClick={() => { setState({ status: 'loading', data: null, message: '' }); load() }} aria-label="โหลดรายการใหม่"
          className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 active:scale-95">
          <RefreshCw size={13} aria-hidden="true" /> โหลดใหม่
        </button>
      </div>

      {state.status === 'loading' && <LoadingLine text="กำลังโหลดรายการเรื่องที่ดำเนินการแล้ว…" />}
      {state.status === 'error' && <SectionError text={state.message} onRetry={() => { setState({ status: 'loading', data: null, message: '' }); load() }} />}
      {state.status === 'ok' && items.length === 0 && (
        <p data-exec-news-empty className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-center text-sm text-slate-500">
          ยังไม่มีเรื่องที่ดำเนินการแล้วและมีรูปใน {execNf(days)} วันที่ผ่านมา
        </p>
      )}
      {state.status === 'ok' && data?.truncated && (
        <p data-exec-news-truncated className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] font-semibold text-amber-900">
          แสดง {execNf(data.limit)} จาก {execNf(data.total)} เรื่อง
        </p>
      )}
      {state.status === 'ok' && hasBatch && (
        <button type="button" data-exec-news-batch-btn onClick={() => setBatchOpen(true)}
          className="inline-flex min-h-9 items-center justify-center gap-1 rounded-lg px-3 text-xs font-bold text-white active:scale-95"
          style={{ backgroundColor: '#c2410c' }}>
          <Layers size={13} aria-hidden="true" /> ภาพข่าวรวม
        </button>
      )}
      {state.status === 'ok' && items.length > 0 && (
        <ul className="space-y-1.5">
          {items.map((item) => <NewsRow key={item.id} item={item} onOpen={(row) => setOpenId(row.id)} />)}
        </ul>
      )}

      {batchOpen && <ComplaintNewsBatchDialog source="exec" candidates={batchCandidates} tenant={tenant} onClose={() => setBatchOpen(false)} />}
      {openId && <ComplaintNewsDialog key={openId} source="exec" complaintId={openId} tenant={tenant} onClose={() => setOpenId(null)} />}
    </div>
  )
}
