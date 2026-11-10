import { useMemo, useState } from 'react'
import { FileText, Loader2, Printer, TriangleAlert } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { EXEC_E2_RPC } from '../../../lib/executiveRegistry'
import { buildExecModel, execSummaryKeys, execToday } from '../../../lib/executiveData'
import {
  EXEC_REPORT_KINDS, EXEC_REPORT_KIND_LABELS, execReportDefaultPeriod, execReportPeriodOptions, findExecReportPeriod,
} from '../../../lib/executiveReportPeriods'
import {
  buildExecServiceReportHtml, openExecReportPreparingWindow, openExecServiceReportPrintWindow,
} from '../../../lib/executiveServiceReportPrint'
import { pickSignatory, signatoryName, signatoryTitle } from '../../../lib/documentSignatories'
import { fetchActiveSignatories } from '../../../lib/signatoryApi'

// ไทล์ "สรุปผลการให้บริการประชาชน (A4)" ในโซน ⑧ รายงานพร้อมใช้ — เลือกช่วง (รายเดือน/รายไตรมาส) แล้วกด "พิมพ์/บันทึก PDF"
// ใบเป็นตัวเลขล้วนจาก executive_overview (ไม่มีชื่อผู้ร้อง/ผู้ประเมิน/ความเห็น) · ไม่มีช่องกรอกของเจ้าหน้าที่ ไม่มีปุ่มอนุมัติ
//
// ขั้นตอนตอนกด: (1) เปิดหน้าต่างพิมพ์ทันทีในจังหวะคลิก (ก่อน await — กัน pop-up blocker บนมือถือ) แล้วแสดง "กำลังเตรียมใบพิมพ์"
//   (2) เรียก executive_overview ด้วย "ช่วงของใบ" (ไม่ใช่ช่วงของหน้า) + โหลดผู้ลงนามจากทะเบียนกลาง (viewer อ่านได้ ตาม RLS)
//   (3) เขียนใบลงหน้าต่างเดิมแล้วสั่งพิมพ์
// ไม่ poll ไม่แคช — กดเองครั้งต่อครั้ง (Supabase แผนฟรี egress จำกัด) · ข้อความสถานะอยู่ใต้ปุ่ม ไม่ใช้ alert()

// ขอเฉพาะสรุปที่ใบใช้ (ไม่ขอ fleet/projects ฯลฯ — ลดงานฐานข้อมูล) และเฉพาะคีย์ของรายการที่ขึ้นจอ (โมดูลเปิดอยู่)
// โมดูลที่ อปท. ปิด = ไม่ขอคีย์นั้น → ส่วนนั้นในใบขึ้น "ไม่มีข้อมูล" ตรงกับหมายเหตุในภาคผนวก (code review E3-1)
const REPORT_KEYS = Object.freeze(['complaints', 'doc_requests', 'satisfaction', 'departments'])
const FORBIDDEN_CODE = '42501'
// เน็ตมือถือค้าง/แท็บถูกพักไว้ คำขอไม่จบเอง — ตัดที่ 20 วิ ให้ปุ่มกลับมากดใหม่ได้และปิดหน้าต่าง "กำลังเตรียม" (code review E3-1)
const REQUEST_TIMEOUT_MS = 20_000
const withTimeout = (promise) => Promise.race([
  promise,
  new Promise((_, reject) => { setTimeout(() => reject(new Error('timeout')), REQUEST_TIMEOUT_MS) }),
])

const MESSAGES = Object.freeze({
  popup: 'เบราว์เซอร์ปิดกั้นหน้าต่างพิมพ์ กรุณาอนุญาต pop-up ของเว็บนี้แล้วกดใหม่',
  forbidden: 'บัญชีนี้ไม่มีสิทธิ์พิมพ์สรุปนี้ — แจ้งผู้ดูแลระบบหากควรมีสิทธิ์',
  failed: 'เตรียมใบไม่สำเร็จ (เซิร์ฟเวอร์ตอบช้าหรือสัญญาณขาดช่วง) กรุณากดใหม่อีกครั้ง',
  closed: 'หน้าต่างพิมพ์ถูกปิดไปก่อน กรุณากดใหม่อีกครั้ง',
  stale: 'ช่วงที่เลือกไว้เก่าเกินรายการแล้ว กรุณาเลือกช่วงใหม่',
})

// ผู้ลงนาม ณ วันที่พิมพ์ (ใบรายงานไม่มีเรื่องที่ "เสร็จแล้ว" ให้ล็อกชื่อ ณ เวลาอื่น) · ไม่ตั้ง/อ่านไม่ได้ = null → ใบพิมพ์เส้นประ + ชื่อตำแหน่งสำรอง
const toSignatory = (row) => (row ? { name: signatoryName(row), title: signatoryTitle(row) } : null)

/**
 * @param {{ tenant: object|null, sub?: string, entries: object[] }} props
 *   entries = รายการที่ขึ้นจอของหน้านี้ (liveEntries — โมดูลเปิดอยู่) ใช้ตัดสินว่าขอคีย์ไหน และภาคผนวกพิมพ์สูตรของใคร
 */
export default function ExecServiceReportTile({ tenant, sub, entries = [] }) {
  const tenantId = tenant?.id
  // "ตอนนี้" อัปเดตทุกครั้งที่ผู้ใช้แตะตัวเลือก/กดพิมพ์ — หน้าห้องผู้บริหารเปิดค้างข้ามเดือนได้ (code review E3-1)
  const [now, setNow] = useState(() => new Date())
  const [kind, setKind] = useState('month')
  const [periodKey, setPeriodKey] = useState(() => execReportDefaultPeriod('month', now).key)
  // ยังไม่ได้เลือกช่วงเอง = ใช้ "ช่วงที่เพิ่งจบ" ณ วินาทีที่กดพิมพ์เสมอ (เปิดหน้าค้างจาก 30 พ.ย. ถึง 1 ธ.ค. แล้วกด = ได้ พ.ย. ไม่ใช่ ต.ค.)
  const [picked, setPicked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)
  const options = useMemo(() => execReportPeriodOptions(kind, now), [kind, now])
  const keys = useMemo(() => {
    const live = new Set(execSummaryKeys(entries))
    return REPORT_KEYS.filter((k) => live.has(k))
  }, [entries])
  const refreshNow = () => {
    const fresh = new Date()
    setNow(fresh)
    if (!picked) setPeriodKey(execReportDefaultPeriod(kind, fresh).key)
  }

  const changeKind = (next) => {
    setKind(next)
    setPeriodKey(execReportDefaultPeriod(next, new Date()).key) // เปลี่ยนชนิด = กลับไปช่วงที่เพิ่งจบของชนิดนั้น
    setPicked(false)
    setMessage(null)
  }

  async function handlePrint() {
    const clickedAt = new Date()
    const period = picked ? findExecReportPeriod(kind, periodKey, clickedAt) : execReportDefaultPeriod(kind, clickedAt)
    if (busy || !tenantId) return
    // ช่วงที่เลือกไว้หลุดจากรายการ (เปิดหน้าค้างนานจนเลื่อนออกจาก 12 เดือน/8 ไตรมาส) — ให้เลือกใหม่ ไม่เดาให้
    if (!period) { refreshNow(); setMessage(MESSAGES.stale); return }
    if (!picked) setPeriodKey(period.key)
    // ต้องเปิดหน้าต่างก่อน await ใดๆ ทั้งสิ้น — ถ้าเปิดหลังรอข้อมูล เบราว์เซอร์ถือว่าไม่ใช่การกดของผู้ใช้แล้วบล็อก
    const win = openExecReportPreparingWindow()
    if (!win) { setMessage(MESSAGES.popup); return }
    setBusy(true)
    setMessage(null)
    try {
      const [overview, signatoryResult] = await withTimeout(Promise.all([
        supabase.rpc(EXEC_E2_RPC, { _municipality_id: tenantId, _from: period.from, _to: period.to, _keys: keys }),
        // อ่านทะเบียนผู้ลงนามไม่ได้ไม่ใช่เหตุให้ใบพิมพ์ไม่ได้ (ใบต้องเวียนเซ็นได้เสมอ) — ได้เส้นประแทน
        Promise.resolve(fetchActiveSignatories(tenantId)).catch(() => ({ data: null })),
      ]))
      if (overview.error) throw overview.error
      if (overview.data == null || typeof overview.data !== 'object') throw new Error('empty response')
      const rows = signatoryResult?.data ?? []
      const html = buildExecServiceReportHtml({
        model: buildExecModel(overview.data.summaries),
        // "วันนี้" ใช้ค่าจากฐานข้อมูล (วันปฏิทินไทยตัวเดียวกับที่ SQL ตัดสินเลยกำหนด) ไม่มีก็ใช้เวลาไทยของเครื่อง
        today: typeof overview.data.today === 'string' ? overview.data.today.slice(0, 10) : execToday(),
        period,
        tenant,
        signatories: { clerk: toSignatory(pickSignatory(rows, { role: 'clerk' })), mayor: toSignatory(pickSignatory(rows, { role: 'mayor' })) },
        entries,
      })
      if (!openExecServiceReportPrintWindow(html, win)) setMessage(MESSAGES.closed)
    } catch (error) {
      console.error('exec service report error:', error?.message ?? error)
      try { win.close() } catch { /* หน้าต่างปิดไปแล้ว */ }
      setMessage(error?.code === FORBIDDEN_CODE ? MESSAGES.forbidden : MESSAGES.failed)
    } finally {
      setBusy(false)
    }
  }

  const selectCls = 'min-h-11 min-w-0 rounded-xl border border-slate-300 bg-white px-2 text-sm text-slate-800 disabled:opacity-60'
  return (
    <div data-exec-tile="service_summary" className="space-y-2 rounded-2xl border border-white bg-white px-3 py-2.5 shadow-sm">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700"><FileText size={19} aria-hidden="true" /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-slate-800">สรุปผลการให้บริการประชาชน (A4)</span>
          {sub && <span className="block truncate text-[11px] text-slate-500">{sub}</span>}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="ชนิดช่วงของใบสรุป" data-exec-report-kind value={kind} disabled={busy} onFocus={refreshNow} onChange={(e) => changeKind(e.target.value)} className={selectCls}>
          {EXEC_REPORT_KINDS.map((k) => <option key={k} value={k}>{EXEC_REPORT_KIND_LABELS[k]}</option>)}
        </select>
        <select aria-label="ช่วงของใบสรุป" data-exec-report-period value={periodKey} disabled={busy} onFocus={refreshNow} onChange={(e) => { setPeriodKey(e.target.value); setPicked(true); setMessage(null) }} className={`${selectCls} flex-1`}>
          {options.map((p) => <option key={p.key} value={p.key}>{p.optionLabel}</option>)}
        </select>
        <button type="button" data-exec-report-print onClick={handlePrint} disabled={busy || !tenantId || keys.length === 0}
          className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl bg-violet-600 px-3 text-sm font-bold text-white hover:bg-violet-700 active:scale-95 disabled:opacity-60">
          {busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Printer size={16} aria-hidden="true" />}
          {busy ? 'กำลังเตรียมใบ…' : 'พิมพ์/บันทึก PDF'}
        </button>
      </div>
      {message && (
        <p role="alert" data-exec-report-error className="flex items-start gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-900">
          <TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">{message}</span>
        </p>
      )}
    </div>
  )
}
