import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, ChevronRight, HeartHandshake, Hourglass, Inbox } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import {
  EXEC_COMPARE_LABELS, EXEC_ISSUE_BREAKDOWN_CATEGORY, EXEC_PERIODS, EXEC_PERIOD_LABELS, EXEC_ROW_LIMIT, EXEC_TOP_CATEGORIES,
  buildServiceRows, categoryCounts, compareValues, decorateServiceRows, execFormulas, execNf, execRangeText, issueBreakdownRows,
  normalizeComplaintStats, rowsTruncated, splitServiceRows, summarizePulse,
} from '../../../lib/executiveData'
import { useExecRpc } from '../../../hooks/useExecRpc'
import { DeltaLine, ExecSection, FormulaPanel, InfoButton, LoadingLine, SectionError, SubHead } from './ExecParts'
import { ChannelBlock, BottleneckBlock, OverdueCard, QualityCards, SatisfactionBlock, TransportBlock, VillageBlock } from './ExecServiceBlocks'
import { execIcon } from './execIcons'

// โซน ② งานบริการประชาชน — ใหญ่สุดของห้อง
// เฟส E1: ชีพจร/ตารางแยกประเภท/หมวดปัญหา ใช้ RPC สถิติสาธารณะ (EXEC_E1_RPCS) ตัวเลขชุดเดียวกับหน้าสถิติ — ห้ามอ่านตาราง complaints/document_requests ตรงๆ
// เฟส E2: เลยกำหนด / % ทันกำหนด / คะแนน / คอขวด / หมู่บ้าน / ช่องทาง ฯลฯ มาจาก executive_overview (prop ov จาก ExecutiveHome — เรียกครั้งเดียวทั้งหน้า)
// ทุกส่วนย่อยเรียกข้อมูล/ประตูเองแยกกัน — ส่วนไหนพังขึ้น "โหลดไม่ได้" เฉพาะส่วนนั้น ส่วนอื่นแสดงตามปกติ

// คำอธิบาย "ปฏิเสธ" ไม่อยู่ในทะเบียน (ทะเบียนไม่มี kpi นี้) — เขียนตามที่ RPC นับจริง: สถานะ rejected
const REJECTED_FORMULA = {
  who: 'ทุกแถว',
  formula: 'จำนวนเรื่องที่สถานะเป็น rejected (ปฏิเสธ/ไม่รับเรื่อง) ของเรื่องที่ยื่นในช่วงนี้ — คำขอที่ผู้ยื่นถอนเองถูกบันทึกเป็นสถานะเดียวกัน แยกไม่ได้ในข้อมูลสถิติ',
  source: 'complaint_stats_fy.rejected · executive_overview.doc_requests.by_type',
}

const nf = execNf
const formulasOf = execFormulas

// ⓘ ของแต่ละส่วนใช้รหัส "ส่วน:kpi" (เช่น pulse:open, table:open) — กล่องสูตรเปิดใต้ส่วนที่กด ไม่เด้งไปอยู่ไกลจากปุ่ม
const scopedId = (scope, id) => `${scope}:${id}`
const idInScope = (formulaId, scope) => (formulaId?.startsWith(`${scope}:`) ? formulaId.slice(scope.length + 1) : null)

function failedReloads(states) {
  return () => states.filter((s) => s.status === 'error').forEach((s) => s.reload())
}

// ───────────────────────── ชีพจร ②-1 ─────────────────────────

const PULSE_TONES = {
  new: { card: 'border-sky-500', label: 'text-sky-800', value: 'text-sky-700' },
  open: { card: 'border-amber-500', label: 'text-amber-800', value: 'text-amber-600' },
  done: { card: 'border-emerald-500', label: 'text-emerald-800', value: 'text-emerald-600' },
}

function PulseBlock({ ctx, hasComplaints, hasDocs, entries, formulaId, onToggleFormula }) {
  const { tenantId, profileId, range, prev, period } = ctx
  const cArgs = { _municipality_id: tenantId, _from: range.from, _to: range.to }
  const cPrevArgs = { _municipality_id: tenantId, _from: prev.from, _to: prev.to }
  const base = { tenantId, profileId }
  const cur = {
    c: useExecRpc({ ...base, rpc: 'complaint_stats_fy', args: cArgs, enabled: hasComplaints }),
    d: useExecRpc({ ...base, rpc: 'doc_request_stats_fy', args: cArgs, enabled: hasDocs }),
  }
  const before = {
    c: useExecRpc({ ...base, rpc: 'complaint_stats_fy', args: cPrevArgs, enabled: hasComplaints }),
    d: useExecRpc({ ...base, rpc: 'doc_request_stats_fy', args: cPrevArgs, enabled: hasDocs }),
  }
  const pulseId = ['new', 'open', 'done'].find((id) => idInScope(formulaId, 'pulse') === id) ?? null
  const active = [hasComplaints && cur.c, hasDocs && cur.d].filter(Boolean)
  if (active.some((s) => s.status === 'error')) {
    return <SectionError text="โหลดตัวเลขภาพรวมไม่ได้" onRetry={failedReloads(active)} />
  }
  if (active.length === 0 || active.some((s) => s.status !== 'ok')) return <LoadingLine text="กำลังโหลดตัวเลขภาพรวม…" />

  const now = summarizePulse({ complaints: hasComplaints ? cur.c.data : null, docs: hasDocs ? cur.d.data : null })
  // ช่วงก่อนโหลดไม่ได้ = ไม่มีลูกศร (ตัวเลขหลักยังแสดงได้) ไม่ใช่ทำทั้งส่วนล้ม
  const prevActive = [hasComplaints && before.c, hasDocs && before.d].filter(Boolean)
  const prevOk = prevActive.every((s) => s.status === 'ok')
  const then = prevOk
    ? summarizePulse({ complaints: hasComplaints ? before.c.data : null, docs: hasDocs ? before.d.data : null })
    : null

  // สีตามความหมาย: ใหม่ = ฟ้า, ยังไม่เสร็จ = ส้ม (ต้องตาม), เสร็จ = เขียว · ชื่อคลาสเต็มทุกตัว (Tailwind)
  const cards = [
    { id: 'new', label: 'เรื่องใหม่', value: now.new, prev: then?.new, Icon: Inbox, tone: PULSE_TONES.new },
    { id: 'open', label: 'ยังไม่เสร็จ', value: now.open, prev: then?.open, Icon: Hourglass, tone: PULSE_TONES.open, sub: now.parked > 0 ? `รวมรอดำเนินการ ${nf(now.parked)}` : null },
    { id: 'done', label: 'เสร็จแล้ว', value: now.done, prev: then?.done, Icon: CheckCircle2, tone: PULSE_TONES.done },
  ]
  return (
    <div className="space-y-2">
      <div data-exec-pulse className="grid grid-cols-3 gap-2">
        {cards.map((c) => (
          <div key={c.id} data-exec-pulse-card={c.id} className={`min-w-0 rounded-2xl border-l-4 bg-white p-2.5 shadow-sm sm:p-3 ${c.tone.card}`}>
            <div className="flex items-start justify-between gap-1">
              <p className={`flex min-w-0 items-center gap-1 text-[11px] font-bold sm:text-xs ${c.tone.label}`}>
                <c.Icon size={14} className="hidden shrink-0 sm:block" aria-hidden="true" />{c.label}
              </p>
              <InfoButton active={formulaId === scopedId('pulse', c.id)} onClick={() => onToggleFormula(scopedId('pulse', c.id))} label={c.label} />
            </div>
            <p className={`text-3xl font-black tabular-nums leading-none sm:text-4xl ${c.value > 0 ? c.tone.value : 'text-slate-300'}`}>{nf(c.value)}</p>
            <DeltaLine cmp={then ? compareValues(c.value, c.prev) : null} />
            {c.sub && <p className="mt-0.5 text-[10px] leading-tight text-slate-400">{c.sub}</p>}
          </div>
        ))}
      </div>
      <p className="text-[10px] text-slate-500">ลูกศรเทียบกับ{EXEC_COMPARE_LABELS[period]} ({execRangeText(prev)})</p>
      {pulseId && <FormulaPanel title={cards.find((c) => c.id === pulseId)?.label ?? ''} items={formulasOf(entries, pulseId)} />}
    </div>
  )
}

// ───────────────────────── ตาราง ②-2 ─────────────────────────

// on = สีเมื่อค่ามากกว่า 0 (ความหมายเดียวกับชีพจรด้านบน) · ค่า 0 เป็นสีจางทุกคอลัมน์
// เลยกำหนด/% ทันกำหนด (E2): ค่า null = ขีด (การ์ดนั้นโหลดไม่ได้ หรือยังไม่มีเรื่องที่ครบกำหนด) ไม่ใช่ 0
const COLUMNS = [
  { key: 'total', label: 'ยื่น', formulaId: 'new', on: 'text-sky-700' },
  { key: 'open', label: 'ยังไม่เสร็จ', formulaId: 'open', on: 'text-amber-600' },
  { key: 'done', label: 'เสร็จ', formulaId: 'done', on: 'text-emerald-600' },
  { key: 'rejected', label: 'ปฏิเสธ', formulaId: 'rejected', on: 'text-rose-600' },
]
const E2_COLUMNS = [
  { key: 'overdue', label: 'เลยกำหนด', formulaId: 'overdue', on: 'text-rose-600', pct: false },
  { key: 'onTimePct', label: '% ทันกำหนด', formulaId: 'on_time_pct', on: 'text-emerald-700', pct: true },
]
const cellTone = (c, value) => (value > 0 ? `font-bold ${c.on}` : 'text-slate-300')
// % ทันกำหนด: 0% เป็นข้อมูลจริง (ทุกเรื่องเกินกำหนด) ไม่ใช่ "ไม่มี" — ขีดเฉพาะ null
const e2CellText = (c, v) => (v == null ? '—' : c.pct ? `${nf(v)}%` : nf(v))
const e2CellTone = (c, v) => (v == null ? 'text-slate-300' : c.pct ? 'font-bold text-emerald-700' : cellTone(c, v))

// Icon ส่งเข้ามาจากผู้เรียก (ไม่สร้างคอมโพเนนต์จากชื่อไอคอนระหว่าง render ในตัวมันเอง — ผิดกฎ react-hooks/static-components)
function RowName({ row, Icon }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {Icon && <Icon size={15} className="shrink-0 text-slate-500" aria-hidden="true" />}
      <span className="min-w-0 break-words font-semibold text-slate-800">{row.label}</span>
      {row.closed && <span className="shrink-0 text-[10px] font-normal text-slate-400">(ปิดรับแล้ว)</span>}
    </span>
  )
}

const COLUMN_FORMULA_TITLES = { new: 'ยื่น', open: 'ยังไม่เสร็จ', done: 'เสร็จ', rejected: 'ปฏิเสธ', avg_days: 'เวลาเฉลี่ยจนเสร็จ', overdue: 'เลยกำหนด', on_time_pct: '% ทันกำหนด' }

const iconOfRow = (row) => (row.kind === 'complaint' && row.owner ? execIcon(row.owner.icon) : null)

const avgText = (row) => (row.avgDays == null ? '—' : `${nf(row.avgDays)} วัน`)

function ServiceTable({ ctx, ov, hasComplaints, hasDocs, entries, tenant, isModuleEnabled, resolveLink, formulaId, onToggleFormula }) {
  const { tenantId, profileId, range } = ctx
  const args = { _municipality_id: tenantId, _from: range.from, _to: range.to }
  const base = { tenantId, profileId }
  const complaintStats = useExecRpc({ ...base, rpc: 'complaint_stats_fy', args, enabled: hasComplaints })
  const complaintEntry = entries.find((e) => e.key === 'complaints') ?? null
  const [showEmpty, setShowEmpty] = useState(false)

  // แถวคำขอรายประเภทนับในฐานข้อมูลครบทุกแถว (executive_overview.doc_requests.by_type) แทนการนับจากรายการรายเรื่องที่ถูกตัด 1,000 แถวใน E1
  // รอ ov ตอบก่อน (loading) — ตอบแล้วแต่ใช้ไม่ได้ (error/forbidden/การ์ดพัง) = ไม่มีแถวคำขอ + บอกชัดว่าโหลดไม่ได้ (ไม่แสดง 0 ลวง)
  const docsPart = ov.model.docRequests
  const docsSettled = !hasDocs || ov.status === 'ok' || ov.status === 'error' || ov.status === 'forbidden'
  const docsUsable = hasDocs && ov.status === 'ok' && docsPart.state === 'ok'
  const docsFailed = hasDocs && docsSettled && !docsUsable
  const today = ov.today

  const allRows = useMemo(() => {
    if (hasComplaints && complaintStats.status !== 'ok') return null
    if (!docsSettled) return null
    const rows = buildServiceRows({
      complaintStats: hasComplaints ? complaintStats.data : null,
      docByType: docsUsable ? docsPart.data.byType : null,
      tenant, isModuleEnabled, complaintEntry,
    })
    // ov ใช้ไม่ได้ = ไม่มี model → เติม overdue/% เป็น null (ขีด) · ใช้ได้ = เติมจริง
    return decorateServiceRows(rows, { model: ov.status === 'ok' ? ov.model : {}, today })
  }, [hasComplaints, docsSettled, docsUsable, docsPart, complaintStats.status, complaintStats.data, ov.status, ov.model, today, tenant, isModuleEnabled, complaintEntry])

  if (hasComplaints && complaintStats.status === 'error') return <SectionError text="โหลดตารางแยกประเภทไม่ได้" onRetry={complaintStats.reload} />
  if (!allRows) return <LoadingLine text="กำลังโหลดตารางแยกประเภท…" />

  // แสดงเฉพาะแถวที่มีเรื่อง แถว 0 ซ่อนไว้หลังปุ่ม (เจ้าของระบบสั่ง 2569-11-10)
  const { withData, empty } = splitServiceRows(allRows)
  const rows = showEmpty ? allRows : withData
  const emptyToggle = empty.length > 0 && (
    <button type="button" data-exec-toggle-empty aria-expanded={showEmpty} onClick={() => setShowEmpty((v) => !v)}
      className="inline-flex min-h-8 items-center rounded-full border border-slate-200 bg-white px-3 text-[11px] font-semibold text-slate-600 hover:bg-slate-50">
      {showEmpty ? 'ซ่อนประเภทที่ไม่มีเรื่อง' : `แสดงประเภทที่ไม่มีเรื่อง (${nf(empty.length)})`}
    </button>
  )

  const tableId = idInScope(formulaId, 'table')
  // แถวคำร้อง = สูตรของ kpi ในทะเบียน (ใช้ complaint_stats_fy) · แถวคำขอรายประเภท = by_type_full (นับในฐานข้อมูล) — ทั้งสองดึงจากทะเบียน
  // เลยกำหนด/% ทันกำหนด = สูตรของทั้งคำร้องและคำขอ (แสดงทีละรายการพร้อมชื่อ)
  const docRowFormula = hasDocs && ['new', 'open', 'done', 'avg_days'].includes(tableId) ? formulasOf(entries, 'by_type_full') : []
  const sheetFormulas = tableId === 'rejected'
    ? [REJECTED_FORMULA]
    : ['overdue', 'on_time_pct'].includes(tableId)
      ? formulasOf(entries, tableId)
      : [...formulasOf(complaintEntry ? [complaintEntry] : [], tableId ?? ''), ...docRowFormula]
  const sheetTitle = COLUMN_FORMULA_TITLES[tableId] ?? ''
  const showE2 = ov.status === 'ok'

  return (
    <div className="space-y-2">
      {rows.length === 0 && (
        <p data-exec-table-empty className="rounded-2xl border border-dashed border-slate-200 bg-white px-3 py-4 text-center text-sm text-slate-500">
          ช่วงนี้ยังไม่มีเรื่องเข้ามา
        </p>
      )}
      {/* PC: ตารางจริง */}
      {rows.length > 0 && <div className="hidden overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm md:block">
        <table data-exec-table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-[11px] text-slate-500">
              <th scope="col" className="px-3 py-2 text-left font-semibold">เรื่อง/ประเภทคำขอ</th>
              {COLUMNS.map((c) => (
                <th key={c.key} scope="col" className="px-1 py-2 text-right font-semibold">
                  <span className="inline-flex items-center gap-0.5">{c.label}
                    <InfoButton active={tableId === c.formulaId} onClick={() => onToggleFormula(scopedId('table', c.formulaId))} label={c.label} />
                  </span>
                </th>
              ))}
              <th scope="col" className="px-1 py-2 text-right font-semibold">
                <span className="inline-flex items-center gap-0.5">เวลาเฉลี่ยจนเสร็จ
                  <InfoButton active={tableId === 'avg_days'} onClick={() => onToggleFormula(scopedId('table', 'avg_days'))} label="เวลาเฉลี่ยจนเสร็จ" />
                </span>
              </th>
              {showE2 && E2_COLUMNS.map((c) => (
                <th key={c.key} scope="col" className="px-1 py-2 text-right font-semibold">
                  <span className="inline-flex items-center gap-0.5">{c.label}
                    <InfoButton active={tableId === c.formulaId} onClick={() => onToggleFormula(scopedId('table', c.formulaId))} label={c.label} />
                  </span>
                </th>
              ))}
              <th scope="col" className="w-6" aria-hidden="true" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const go = resolveLink(row.owner)
              return (
                <tr key={row.id} data-exec-row={row.id} className={`border-b border-slate-50 last:border-0 ${go ? 'cursor-pointer hover:bg-slate-50' : ''}`}
                  onClick={go ?? undefined}>
                  <td className="px-3 py-2"><RowName row={row} Icon={iconOfRow(row)} /></td>
                  {COLUMNS.map((c) => (
                    <td key={c.key} className={`px-1 py-2 text-right text-base tabular-nums ${cellTone(c, row[c.key])}`}>{nf(row[c.key])}</td>
                  ))}
                  <td className="px-1 py-2 text-right tabular-nums text-slate-700">{avgText(row)}</td>
                  {showE2 && E2_COLUMNS.map((c) => (
                    <td key={c.key} className={`px-1 py-2 text-right text-base tabular-nums ${e2CellTone(c, row[c.key])}`}>{e2CellText(c, row[c.key])}</td>
                  ))}
                  <td className="pr-2 text-slate-300">
                    {go && (
                      <button type="button" onClick={(e) => { e.stopPropagation(); go() }} aria-label={`เปิดงาน ${row.label}`}
                        className="flex h-7 w-6 items-center justify-center"><ChevronRight size={15} aria-hidden="true" /></button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>}

      {/* มือถือ: การ์ดรายแถว ไม่ล้นจอ 390px (ไม่ใช้ตารางกว้างเลื่อนซ้าย-ขวา) */}
      <ul data-exec-cards className="space-y-1.5 md:hidden">
        {rows.map((row) => {
          const go = resolveLink(row.owner)
          const body = (
            <>
              <span className="flex items-center gap-1.5"><span className="min-w-0 flex-1"><RowName row={row} Icon={iconOfRow(row)} /></span>{go && <ChevronRight size={15} className="shrink-0 text-slate-300" aria-hidden="true" />}</span>
              {/* ตัวเลขทุกช่องเรียงเป็นบรรทัดเดียวพร้อมป้าย (เดิมกล่อง 4 ช่อง สูงเกือบเท่าตัว — เจ้าของขอให้หน้าไม่ยาว 2569-11-10) */}
              <span className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
                {COLUMNS.map((c) => (
                  <span key={c.key}>{c.label} <span className={`text-sm font-black tabular-nums ${row[c.key] > 0 ? c.on : 'text-slate-400'}`}>{nf(row[c.key])}</span></span>
                ))}
                <span>เวลาเฉลี่ยจนเสร็จ <span className="font-semibold text-slate-700">{avgText(row)}</span></span>
                {showE2 && E2_COLUMNS.map((c) => (
                  <span key={c.key}>{c.label} <span className={`font-semibold ${e2CellTone(c, row[c.key])}`}>{e2CellText(c, row[c.key])}</span></span>
                ))}
              </span>
            </>
          )
          return (
            <li key={row.id} data-exec-row={row.id}>
              {go ? (
                <button type="button" onClick={go} className="block w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-left shadow-sm active:scale-[0.99]">{body}</button>
              ) : (
                <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-sm">{body}</div>
              )}
            </li>
          )
        })}
      </ul>

      {emptyToggle && <div className="flex justify-center">{emptyToggle}</div>}
      {docsFailed && <SectionError text="โหลดแถวคำขอแยกประเภทไม่ได้" onRetry={ov.status === 'forbidden' ? undefined : ov.reload} />}

      {/* มือถือไม่มีหัวตารางให้วาง ⓘ — แถวปุ่มสูตรอยู่ใต้การ์ด (PC มีที่หัวคอลัมน์แล้ว) */}
      <div className="flex flex-wrap items-center gap-1 md:hidden">
        <span className="text-[10px] text-slate-400">วิธีคำนวณ:</span>
        {[...COLUMNS.map((c) => ({ id: c.formulaId, label: c.label })), { id: 'avg_days', label: 'เวลาเฉลี่ย' }, ...(showE2 ? E2_COLUMNS.map((c) => ({ id: c.formulaId, label: c.label })) : [])].map((c) => (
          <button key={c.id} type="button" aria-expanded={tableId === c.id} onClick={() => onToggleFormula(scopedId('table', c.id))}
            className={`inline-flex min-h-8 items-center rounded-full border px-2.5 text-[11px] font-semibold ${tableId === c.id ? 'border-sky-300 bg-sky-50 text-sky-800' : 'border-slate-200 bg-white text-slate-600'}`}>
            ⓘ {c.label}
          </button>
        ))}
      </div>

      <p className="text-[10px] text-slate-400">
        กดแถวเพื่อเปิดกล่องงานของเรื่องนั้น · เวลาเฉลี่ยนับเป็นวันปฏิทิน เฉพาะเรื่องที่เสร็จแล้ว
        {showE2 && ' · เลยกำหนดนับเรื่องที่ค้างอยู่ตอนนี้ (ไม่ขึ้นกับช่วงที่เลือก) ต่างจากคอลัมน์อื่นที่นับตามวันที่ยื่นในช่วง'}
      </p>
      <FormulaPanel title={sheetTitle} items={sheetFormulas} />
    </div>
  )
}

// ───────────────────────── หมวดปัญหา ②-4 ─────────────────────────

// ค่าว่างคงที่ — คืน {} ใหม่ทุกครั้งที่ render ทำให้ useMemo ที่พึ่ง labels คำนวณใหม่ทุกรอบ
const EMPTY_LABELS = Object.freeze({})

function useCategoryLabels(tenantId) {
  const [state, setState] = useState({ tenantId: null, labels: EMPTY_LABELS })
  useEffect(() => {
    if (!tenantId) return undefined
    let cancelled = false
    Promise.resolve()
      .then(() => supabase.from('complaint_categories').select('value, label').eq('municipality_id', tenantId).eq('is_active', true))
      .then(({ data }) => {
        if (cancelled) return
        const labels = {}
        ;(data ?? []).forEach((c) => { labels[c.value] = c.label })
        setState({ tenantId, labels })
      })
      .catch(() => { if (!cancelled) setState({ tenantId, labels: EMPTY_LABELS }) }) // ไม่มีชื่อ อปท. = ใช้ชื่อมาตรฐาน ไม่ใช่ error
    return () => { cancelled = true }
  }, [tenantId])
  return state.tenantId === tenantId ? state.labels : EMPTY_LABELS
}

function CategoryBlock({ ctx, entry, formulaId, onToggleFormula }) {
  const { tenantId, profileId, range } = ctx
  const args = { _municipality_id: tenantId, _from: range.from, _to: range.to }
  const base = { tenantId, profileId }
  const labels = useCategoryLabels(tenantId)
  const rows = useExecRpc({ ...base, rpc: 'complaints_public_fy', args: { ...args, _limit: EXEC_ROW_LIMIT }, enabled: true })
  const stats = useExecRpc({ ...base, rpc: 'complaint_stats_fy', args, enabled: true })

  const list = useMemo(() => (rows.status === 'ok' ? categoryCounts(rows.data, { labels }) : []), [rows.status, rows.data, labels])
  const hasLight = list.some((c) => c.key === EXEC_ISSUE_BREAKDOWN_CATEGORY)
  const issues = useExecRpc({
    ...base, rpc: 'complaint_issue_breakdown_fy', args: { ...args, _category: EXEC_ISSUE_BREAKDOWN_CATEGORY }, enabled: hasLight,
  })

  const formulas = idInScope(formulaId, 'cat') === 'by_category' ? formulasOf([entry], 'by_category') : []
  const head = (
    <div className="flex items-center gap-1">
      <SubHead>หมวดปัญหายอดนิยม (คำร้อง)</SubHead>
      <InfoButton active={idInScope(formulaId, 'cat') === 'by_category'} onClick={() => onToggleFormula(scopedId('cat', 'by_category'))} label="หมวดปัญหา" />
    </div>
  )
  if (rows.status === 'error') {
    return <div className="space-y-2">{head}<SectionError text="โหลดหมวดปัญหาไม่ได้" onRetry={rows.reload} /></div>
  }
  if (rows.status !== 'ok') return <div className="space-y-2">{head}<LoadingLine text="กำลังโหลดหมวดปัญหา…" /></div>

  const total = rows.data.length
  const knownTotal = stats.status === 'ok' ? normalizeComplaintStats(stats.data).total : null
  const truncated = rowsTruncated(total, { knownTotal })
  const max = list.reduce((m, c) => Math.max(m, c.count), 0)
  const issueRows = issues.status === 'ok' ? issueBreakdownRows(issues.data) : []

  return (
    <div data-exec-categories className="space-y-2">
      {head}
      {list.length === 0 ? (
        <p className="rounded-2xl border border-slate-200 bg-white px-3 py-3 text-xs text-slate-500">ไม่มีเรื่องร้องเรียนในช่วงนี้</p>
      ) : (
        <ul className="space-y-1.5 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          {list.map((c) => (
            <li key={c.key} data-exec-category={c.key}>
              <div className="flex items-baseline gap-2 text-xs">
                <span className="min-w-0 flex-1 break-words font-medium text-slate-700">{c.label}</span>
                <span className="font-black tabular-nums text-slate-900">{nf(c.count)}<span className="sr-only"> เรื่อง</span></span>
              </div>
              <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
                <div className={`h-full rounded-full ${c.isRest ? 'bg-slate-300' : 'bg-sky-400'}`} style={{ width: `${max > 0 ? Math.max(3, Math.round((c.count / max) * 100)) : 0}%` }} />
              </div>
              {c.key === EXEC_ISSUE_BREAKDOWN_CATEGORY && (
                issues.status === 'error' ? (
                  <p className="mt-1 text-[10px] text-amber-700">ลักษณะย่อยโหลดไม่ได้ <button type="button" onClick={issues.reload} className="font-bold underline">ลองใหม่</button></p>
                ) : issueRows.length > 0 && (
                  <ul className="mt-1 space-y-0.5 border-l-2 border-slate-100 pl-2 text-[11px] text-slate-500" data-exec-issues>
                    {issueRows.map((r) => (
                      <li key={r.label} className="flex items-baseline gap-2"><span className="min-w-0 flex-1">{r.label}</span><span className="tabular-nums text-slate-700">{nf(r.total)}</span></li>
                    ))}
                  </ul>
                )
              )}
            </li>
          ))}
        </ul>
      )}
      {truncated && (
        <p data-exec-truncated className="text-[10px] text-amber-700">
          นับจาก {nf(total)} เรื่องล่าสุด{knownTotal != null ? ` (ทั้งหมดในช่วงนี้ ${nf(knownTotal)} เรื่อง)` : ''} — ตัวเลขรายหมวดอาจต่ำกว่าจริง
        </p>
      )}
      <p className="text-[10px] text-slate-400">แสดง {nf(Math.min(EXEC_TOP_CATEGORIES, list.filter((c) => !c.isRest).length))} หมวดสูงสุด · หมวด "อื่นๆ" รวมหมวดที่เหลือและเรื่องที่ไม่ระบุหมวด</p>
      <FormulaPanel title="หมวดปัญหา" items={formulas} />
    </div>
  )
}

// ───────────────────────── โซน ② ─────────────────────────

/**
 * @param {{
 *   entries: Array,           // รายการทะเบียนที่ขึ้นจอและอยู่โซน service
 *   tenant: object|null,
 *   profileId?: string,
 *   isModuleEnabled: (key: string) => boolean,
 *   resolveLink: (entry: object|null) => (null | (() => void)),   // null = ไม่มีทางเปิดจากบัญชีนี้ (ไม่ทำเป็นปุ่ม)
 *   ov: object,               // ผล executive_overview ของช่วงที่เลือก (status/model/derived/today/ช่วงก่อนหน้า/reload) — ExecutiveHome เรียกครั้งเดียวทั้งหน้า
 *   period: string, setPeriod: (p: string) => void,   // ช่วงเวลาถือที่ ExecutiveHome (โซน ⑥ รายกองใช้ช่วงเดียวกัน)
 *   range: { from: string, to: string }, prev: { from: string, to: string },
 * }} props
 */
export default function ExecServiceZone({ entries, tenant, profileId, isModuleEnabled, resolveLink, ov, period, setPeriod, range, prev }) {
  const complaintsEntry = entries.find((e) => e.key === 'complaints') ?? null
  const docEntries = entries.filter((e) => e.isCitizenService && e.key !== 'complaints')
  const hasComplaints = Boolean(complaintsEntry)
  const hasDocs = docEntries.length > 0
  const [formulaId, setFormulaId] = useState(null)
  const ctx = { tenantId: tenant?.id, profileId, range, prev, period }
  const toggleFormula = (id) => setFormulaId((cur) => (cur === id ? null : id))

  if (!hasComplaints && !hasDocs) return null

  return (
    <ExecSection id="service" title="งานบริการประชาชน" Icon={HeartHandshake}
      note="ตัวเลขชุดเดียวกับหน้าสถิติสาธารณะ · ไม่แสดงชื่อผู้ยื่น/ผู้ร้อง">
      <div role="group" aria-label="ช่วงเวลา" data-exec-periods className="flex flex-wrap items-center gap-1.5">
        {EXEC_PERIODS.map((p) => (
          <button key={p} type="button" aria-pressed={period === p} onClick={() => { setPeriod(p); setFormulaId(null) }}
            className={`min-h-9 rounded-full border px-3.5 text-xs font-bold active:scale-95 ${period === p ? 'border-sky-600 bg-sky-600 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
            {EXEC_PERIOD_LABELS[p]}
          </button>
        ))}
        <span className="text-[11px] text-slate-400" data-exec-range>{execRangeText(range)}</span>
      </div>

      {/* ②-1 ชีพจร: เลยกำหนด (ใหญ่สุด) → เรื่องใหม่/ยังไม่เสร็จ/เสร็จ → % ทันกำหนด + คะแนนพึงพอใจ */}
      <OverdueCard ov={ov} entries={entries} />
      <PulseBlock ctx={ctx} hasComplaints={hasComplaints} hasDocs={hasDocs} entries={entries} formulaId={formulaId} onToggleFormula={toggleFormula} />
      <QualityCards ov={ov} entries={entries} rangeText={execRangeText(range)} compareText={`${EXEC_COMPARE_LABELS[period]} (${execRangeText(prev)})`} />

      <div className="space-y-1.5">
        <div className="flex items-center gap-1">
          <SubHead>แยกตามประเภทเรื่อง</SubHead>
          {hasDocs && <InfoButton active={formulaId === scopedId('type', 'by_type')} onClick={() => toggleFormula(scopedId('type', 'by_type'))} label="แยกประเภทคำขอ" />}
        </div>
        {formulaId === scopedId('type', 'by_type') && <FormulaPanel title="แยกประเภทคำขอ" items={formulasOf(entries, 'by_type_full')} />}
        <ServiceTable ctx={ctx} ov={ov} hasComplaints={hasComplaints} hasDocs={hasDocs} entries={entries} tenant={tenant} isModuleEnabled={isModuleEnabled}
          resolveLink={resolveLink} formulaId={formulaId} onToggleFormula={toggleFormula} />
      </div>

      {hasComplaints && <CategoryBlock ctx={ctx} entry={complaintsEntry} formulaId={formulaId} onToggleFormula={toggleFormula} />}
      {hasComplaints && <BottleneckBlock ov={ov} entries={entries} />}
      {hasComplaints && <VillageBlock ov={ov} entries={entries} />}
      {hasComplaints && <SatisfactionBlock ov={ov} entries={entries} />}
      <ChannelBlock ov={ov} entries={entries} />
      <TransportBlock ov={ov} entries={entries} />
    </ExecSection>
  )
}
