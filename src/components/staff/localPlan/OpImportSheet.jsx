// นำเข้ารายการแผนการดำเนินงานจาก CSV / ตารางที่คัดลอกจาก Excel-Word (เฉพาะผู้จัดการแผน ฉบับร่าง)
// ลำดับ: เลือกแหล่งข้อมูล → ระบบหาแถวหัวตาราง + เดาคอลัมน์ให้ (แก้ได้) → พรีวิวทั้งหมด → กด "นำเข้า" ครั้งเดียว
// ตรรกะอ่าน/เดา/ตรวจแถวอยู่ใน localPlanImport.js + tabularImport.js + htmlTableGrid.js (pure) — ไฟล์นี้มีแค่หน้าจอ
// ต่อท้ายรายการเดิมเสมอ ไม่ลบ/ไม่ทับของเดิม · แถวที่มี error ถูกข้าม (บอกจำนวน) · แสดงผลผ่าน React ล้วน ไม่ใช้ innerHTML
import { useMemo, useState } from 'react'
import { AlertTriangle, FileUp, Loader2 } from 'lucide-react'
import { readHtmlTables } from '../../../lib/htmlTableGrid'
import { friendlyError, importOpItems } from '../../../lib/localPlanApi'
import { fiscalMonthLabel, spanLabel } from '../../../lib/localPlanCalendar'
import { IMPORT_FIELDS, buildImportPreview, detectHeaderRows, guessMapping } from '../../../lib/localPlanImport'
import { formatBaht } from '../../../lib/localPlanView'
import { MAX_ROWS, decodeTextBytes, mergeHeaderRows, normalizeCell, parseDelimited } from '../../../lib/tabularImport'
import { Sheet } from '../../patientTransport/StaffShell'
import { Field } from '../construction/ui'
import { btnGhost, btnPrimary, inp } from '../construction/uiStyles'

const HEADER_SCAN_ROWS = 15
const PREVIEW_ROWS_SHOWN = 500
const SORT_STEP = 10 // ช่วงห่าง sort_order เท่ากับที่ OpItemSheet ใช้ตอนเพิ่มรายการ

const clip = (s, n = 40) => ([...s].length > n ? `${[...s].slice(0, n).join('')}…` : s)

/** ตารางดิบ → แถวที่ล้างช่องแล้ว (เหมือนที่ buildImportPreview อ่าน) */
const cleanRows = rows => rows.map(r => r.map(normalizeCell))

/** หัวตาราง + การเดาคอลัมน์ ตามแถวหัวที่เลือก (null = ยังไม่รู้แถวหัว) */
function headerState(rows, headerRowIndex, headerRowCount) {
  if (headerRowIndex === null) return { headerCells: [], mapping: {}, monthColumns: {} }
  const headerCells = mergeHeaderRows(rows, headerRowIndex, headerRowCount)
  return { headerCells, ...guessMapping(headerCells) }
}

export default function OpImportSheet({ tenant, opPlan, existingItems, departments, projects, onClose, onImported }) {
  const [source, setSource] = useState(null) // { rows, kind: 'file'|'html'|'text', label, warnings, merged }
  const [pasteText, setPasteText] = useState('')
  const [head, setHead] = useState({ headerRowIndex: null, headerRowCount: 1, headerCells: [], mapping: {}, monthColumns: {} })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const departmentRows = useMemo(() => departments.map(d => ({ id: d.id, name: d.name, code: d.short_name })), [departments])
  const departmentName = id => departments.find(d => d.id === id)?.name ?? ''

  // ตารางใหม่เข้ามา → ล้างช่อง → หาแถวหัวเอง ไม่เจอให้ผู้ใช้เลือก
  const loadTable = (rawRows, meta) => {
    const rows = cleanRows(rawRows)
    if (!rows.length) { setSource(null); setError('ไม่พบข้อมูลในตาราง'); return }
    const found = detectHeaderRows(rows)
    setHead(found
      ? { headerRowIndex: found.headerRowIndex, headerRowCount: found.headerRowCount, ...headerState(rows, found.headerRowIndex, found.headerRowCount) }
      : { headerRowIndex: null, headerRowCount: 1, headerCells: [], mapping: {}, monthColumns: {} })
    setSource({ rows, ...meta })
    setError('')
  }

  const onFile = async e => {
    const file = e.target.files?.[0]
    e.target.value = '' // เลือกไฟล์เดิมซ้ำได้
    if (!file) return
    setError('')
    try {
      const { text, encoding } = decodeTextBytes(await file.arrayBuffer())
      const parsed = parseDelimited(text)
      setPasteText('')
      loadTable(parsed.rows, { kind: 'file', label: `ไฟล์ ${file.name} (รหัสอักษร ${encoding})`, warnings: parsed.warnings, merged: { rowspan: false, colspan: false } })
    } catch (err) {
      setSource(null)
      setError(`${err.message || 'อ่านไฟล์ไม่ได้'} — ไฟล์ .xlsx ให้บันทึกเป็น CSV หรือคัดลอกตารางมาวาง`)
    }
  }

  const onPasteText = text => {
    setPasteText(text)
    if (text.trim() === '') { if (source?.kind === 'text') setSource(null); return }
    const parsed = parseDelimited(text)
    loadTable(parsed.rows, { kind: 'text', label: 'ข้อความที่วาง (แยกช่องด้วย tab / ,)', warnings: parsed.warnings, merged: { rowspan: false, colspan: false } })
  }

  // วางจาก Excel/Word: clipboard มีตาราง HTML → อ่านแบบคงโครง merge ; ไม่ได้ผล → ปล่อยให้ข้อความลง textarea ตามปกติ
  const onPaste = e => {
    const html = e.clipboardData?.getData('text/html') ?? ''
    if (!/<table[\s>]/i.test(html)) return
    try {
      const table = readHtmlTables(html)
      if (!table || !(table.rows[0]?.length >= 2)) return
      e.preventDefault()
      setPasteText('')
      const warnings = []
      if (table.truncated) warnings.push(`ตารางมีมากกว่า ${MAX_ROWS} แถว — อ่านเฉพาะ ${MAX_ROWS} แถวแรก`)
      if (table.clippedColumns) warnings.push('ตารางกว้างเกินที่อ่านได้ — ตัดคอลัมน์ท้ายออก')
      loadTable(table.rows, { kind: 'html', label: 'ตาราง HTML จาก Excel/Word (คงโครงช่องที่รวมไว้)', warnings, merged: table.merged })
    } catch { /* อ่านตาราง HTML ไม่ได้ → ใช้ข้อความธรรมดาที่ลงใน textarea */ }
  }

  const changeHeader = (index, count) => {
    if (!source) return
    setHead({ headerRowIndex: index, headerRowCount: count, ...headerState(source.rows, index, count) })
  }

  // ห้ามเลือก field เดียวสองคอลัมน์ : เลือกใหม่ = ยกเลิกของเดิม
  const changeMapping = (col, key) => {
    setHead(h => {
      const mapping = Object.fromEntries(Object.entries(h.mapping).filter(([c, k]) => Number(c) !== col && (key === '' || k !== key)))
      if (key) mapping[col] = key
      return { ...h, mapping }
    })
  }

  const rows = source?.rows ?? []
  const itemNameMapped = Object.values(head.mapping).includes('item_name')
  const preview = useMemo(() => {
    if (!source || head.headerRowIndex === null || !itemNameMapped) return null
    return buildImportPreview({
      rows: source.rows, headerRowIndex: head.headerRowIndex, headerRowCount: head.headerRowCount,
      mapping: head.mapping, monthColumns: head.monthColumns, departments: departmentRows, projects, fiscalYearBE: opPlan.fiscal_year,
    })
  }, [source, head, itemNameMapped, departmentRows, projects, opPlan.fiscal_year])

  const importable = preview ? preview.items.filter(i => !i.errors.length) : []
  const shown = preview ? preview.items.slice(0, PREVIEW_ROWS_SHOWN) : []
  const startSortOrder = Math.max(0, ...existingItems.map(i => Number(i.sort_order) || 0)) + SORT_STEP

  const submit = async () => {
    if (busy || !importable.length) return
    setBusy(true); setError('')
    const { count, error: importError, leftover } = await importOpItems({
      opPlanId: opPlan.id, municipalityId: tenant.id, rows: importable.map(i => i.values), startSortOrder,
    })
    setBusy(false)
    if (importError) {
      const extra = leftover ? ` · ลบรายการที่นำเข้าไปแล้วบางส่วนไม่สำเร็จ (ค้าง ${leftover} รายการ) ตรวจในตารางรายการแล้วลบเอง` : ''
      return setError(`${friendlyError(importError)}${extra}`)
    }
    onImported(count)
  }

  const fieldOptions = IMPORT_FIELDS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)
  const monthColCount = Object.keys(head.monthColumns).length
  const sampleOf = col => {
    const start = head.headerRowIndex === null ? 0 : head.headerRowIndex + head.headerRowCount
    for (let r = start; r < Math.min(rows.length, start + 8); r++) if (rows[r][col]) return clip(rows[r][col], 30)
    return ''
  }

  return (
    <Sheet title="นำเข้ารายการแผนการดำเนินงาน" subtitle={`ปีงบ ${opPlan.fiscal_year}`} onClose={onClose} busy={busy} wide>
      <div className="space-y-4 text-gray-800">
        <section className="space-y-2 rounded-2xl border border-gray-200 bg-white p-3">
          <p className="text-sm font-bold">1) เลือกแหล่งข้อมูล</p>
          <label className={`${btnGhost} cursor-pointer`}>
            <FileUp size={16} />เลือกไฟล์ CSV / ข้อความ
            <input type="file" accept=".csv,.txt,text/csv,text/plain" className="sr-only" onChange={onFile} disabled={busy} />
          </label>
          <Field label="หรือวางตารางที่คัดลอกจาก Excel/Word ลงในกล่องนี้">
            <textarea className={`${inp} min-h-24 font-mono text-xs`} rows={4} value={pasteText} disabled={busy}
              placeholder="คัดลอกทั้งตาราง (รวมหัวตาราง) แล้ววางที่นี่" onPaste={onPaste} onChange={e => onPasteText(e.target.value)} />
          </Field>
          <p className="text-xs text-gray-500">ไฟล์ .xlsx ให้บันทึกเป็น CSV หรือคัดลอกตารางมาวาง · วางจาก Excel/Word ระบบอ่านช่องที่รวม (merge) ให้ครบ</p>
          {source && (
            <p className="rounded-xl bg-sky-50 px-3 py-2 text-xs text-sky-900">
              อ่านจาก: {source.label} · {rows.length} แถว
            </p>
          )}
          {source?.warnings?.map(w => <p key={w} className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">{w}</p>)}
        </section>

        {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        {source && (
          <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-3">
            <p className="text-sm font-bold">2) แถวหัวตารางและการจับคู่คอลัมน์</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="แถวหัวตาราง" className="sm:col-span-2">
                <select className={inp} value={head.headerRowIndex === null ? '' : head.headerRowIndex}
                  onChange={e => changeHeader(e.target.value === '' ? null : Number(e.target.value), head.headerRowCount)}>
                  <option value="">— เลือกแถวหัวตาราง —</option>
                  {rows.slice(0, HEADER_SCAN_ROWS).map((r, i) => (
                    <option key={i} value={i}>แถว {i + 1}{r.filter(Boolean).length ? ` — ${clip(r.filter(Boolean).slice(0, 3).join(' | '), 50)}` : ' (ว่าง)'}</option>
                  ))}
                </select>
              </Field>
              <Field label="จำนวนแถวของหัวตาราง">
                <select className={inp} value={head.headerRowCount} disabled={head.headerRowIndex === null}
                  onChange={e => changeHeader(head.headerRowIndex, Number(e.target.value))}>
                  <option value={1}>1 แถว</option><option value={2}>2 แถว (เช่น ไตรมาส + เดือน)</option><option value={3}>3 แถว</option>
                </select>
              </Field>
            </div>
            {head.headerRowIndex === null && <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">ระบบหาแถวหัวตารางเองไม่เจอ — เลือกแถวที่เป็นชื่อคอลัมน์ด้านบน</p>}

            {head.headerRowIndex !== null && (
              <>
                <div className="max-h-72 overflow-y-auto rounded-xl border border-gray-200">
                  <ul className="divide-y divide-gray-100">
                    {head.headerCells.map((cell, col) => (
                      <li key={col} className="flex flex-col gap-1 px-3 py-2 sm:flex-row sm:items-center sm:gap-3">
                        <div className="min-w-0 flex-1 text-sm">
                          <span className="break-words font-semibold">{cell || '(ไม่มีชื่อ)'}</span>
                          {sampleOf(col) && <span className="block break-words text-xs text-gray-500">ตัวอย่าง: {sampleOf(col)}</span>}
                        </div>
                        {col in head.monthColumns
                          ? <span className="rounded-full bg-sky-50 px-3 py-1.5 text-xs font-bold text-sky-800">ช่องเดือน {fiscalMonthLabel(head.monthColumns[col])}</span>
                          : (
                            <select className={`${inp} sm:w-64`} aria-label={`คอลัมน์ ${col + 1}: ${cell}`} value={head.mapping[col] ?? ''} onChange={e => changeMapping(col, e.target.value)}>
                              <option value="">— ไม่ใช้ —</option>{fieldOptions}
                            </select>
                          )}
                      </li>
                    ))}
                  </ul>
                </div>
                {monthColCount > 0 && (
                  <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
                    <span>พบช่องเดือน {monthColCount} คอลัมน์ — ช่องที่มีเครื่องหมาย (ลูกศร ✓ x ข้อความ) นับเป็นเดือนที่ทำงาน</span>
                    <button type="button" className={btnGhost} onClick={() => setHead(h => ({ ...h, monthColumns: {} }))}>ไม่ใช้ช่องเดือน</button>
                  </div>
                )}
                {!itemNameMapped && <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">เลือกคอลัมน์ "ชื่อโครงการ/กิจกรรม" อย่างน้อยหนึ่งคอลัมน์ ระบบจึงจะแสดงพรีวิวได้</p>}
              </>
            )}
          </section>
        )}

        {preview && (
          <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-3">
            <p className="text-sm font-bold">3) ตรวจพรีวิวก่อนนำเข้า</p>
            <div className="flex flex-wrap gap-2 text-xs font-semibold">
              <span className="rounded-full bg-gray-100 px-3 py-1">ทั้งหมด {preview.summary.total} แถว</span>
              <span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-800">พร้อม {preview.summary.ok}</span>
              <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-800">มีข้อควรตรวจ {preview.summary.withWarnings}</span>
              <span className="rounded-full bg-red-50 px-3 py-1 text-red-700">ข้าม (มีข้อผิดพลาด) {preview.summary.withErrors}</span>
              {(preview.summary.skippedTotals > 0 || preview.summary.skippedEmpty > 0) && (
                <span className="rounded-full bg-gray-100 px-3 py-1 text-gray-600">ไม่นับ: แถวรวมยอด {preview.summary.skippedTotals} · แถวว่าง {preview.summary.skippedEmpty}</span>
              )}
            </div>

            <div className="space-y-1.5 text-xs">
              {source.merged?.rowspan && (
                <p className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-amber-900"><AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />มีช่องที่รวมแถว (merge) ระบบคัดค่าลงทุกแถว — ตรวจงบประมาณที่อาจนับซ้ำ</p>
              )}
              {existingItems.length > 0 && <p className="rounded-xl bg-sky-50 px-3 py-2 text-sky-900">จะต่อท้ายรายการเดิม {existingItems.length} รายการ (ไม่ลบของเดิม)</p>}
              {preview.summary.unmatchedProjects > 0 && (
                <p className="rounded-xl bg-amber-50 px-3 py-2 text-amber-900">{preview.summary.unmatchedProjects} รายการไม่พบในทะเบียนโครงการของแผนพัฒนา (ข้อ 25) — นำเข้าได้ แต่ควรผูกทะเบียนภายหลัง</p>
              )}
              <p className="rounded-xl bg-gray-50 px-3 py-2 text-gray-600">ลูกศรที่วาดเป็นรูปทรงใน Word นำเข้าไม่ได้ — ต้องกดเดือนบนตารางเองหลังนำเข้า</p>
            </div>

            <div className="max-h-96 overflow-auto rounded-xl border border-gray-200">
              <table className="w-full min-w-[44rem] border-collapse text-xs">
                <thead className="sticky top-0 bg-gray-50 text-gray-600">
                  <tr>
                    <th className="px-2 py-2 text-center font-semibold">แถว</th>
                    <th className="px-2 py-2 text-center font-semibold">ที่</th>
                    <th className="px-2 py-2 text-left font-semibold">โครงการ/กิจกรรม</th>
                    <th className="px-2 py-2 text-right font-semibold">งบประมาณ</th>
                    <th className="px-2 py-2 text-left font-semibold">เดือน</th>
                    <th className="px-2 py-2 text-left font-semibold">กอง</th>
                    <th className="px-2 py-2 text-left font-semibold">ผลตรวจ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 align-top">
                  {shown.map(item => (
                    <tr key={item.rowNumber} className={item.errors.length ? 'bg-red-50/40' : ''}>
                      <td className="px-2 py-1.5 text-center text-gray-500">{item.rowNumber}</td>
                      <td className="px-2 py-1.5 text-center">{item.values.seq_no ?? ''}</td>
                      <td className="min-w-[14rem] break-words px-2 py-1.5 font-semibold">{item.values.item_name || '—'}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right">{item.values.amount === null ? '—' : formatBaht(item.values.amount)}</td>
                      <td className="whitespace-nowrap px-2 py-1.5">{spanLabel(item.values.month_from, item.values.month_to) || '—'}</td>
                      <td className="break-words px-2 py-1.5">{departmentName(item.values.department_id) || (item.raw.department ? <span className="text-amber-700">ไม่พบ: {clip(item.raw.department, 24)}</span> : '—')}</td>
                      <td className="min-w-[10rem] px-2 py-1.5">
                        {item.errors.map(m => <p key={m} className="break-words text-red-700">{m}</p>)}
                        {item.warnings.map(m => <p key={m} className="break-words text-amber-700">{m}</p>)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview.items.length > shown.length && <p className="text-xs text-gray-500">แสดง {shown.length} แถวแรก (ทั้งหมด {preview.items.length} แถว — นำเข้าครบทุกแถวที่ไม่มีข้อผิดพลาด)</p>}

            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className={`${btnPrimary} flex-1`} style={{ backgroundColor: 'var(--color-primary)' }} onClick={submit} disabled={busy || !importable.length}>
                {busy && <Loader2 size={16} className="animate-spin" />}นำเข้า {importable.length} รายการ
              </button>
              <button type="button" className={btnGhost} onClick={onClose} disabled={busy}>ปิด</button>
            </div>
            {preview.summary.withErrors > 0 && <p className="text-xs text-red-700">แถวที่มีข้อผิดพลาด {preview.summary.withErrors} แถวจะไม่ถูกนำเข้า — แก้ในไฟล์ต้นฉบับแล้วนำเข้าใหม่ หรือเพิ่มเองทีหลัง</p>}
          </section>
        )}
      </div>
    </Sheet>
  )
}
