import { useMemo, useState } from 'react'
import { FileSpreadsheet, Loader2, ShieldCheck, TriangleAlert } from 'lucide-react'
import { Sheet } from '../../patientTransport/StaffShell'
import { parseCsv, parseXlsx } from '../../../lib/spreadsheetRead'
import { fetchBankMapping, friendlyError, importBankRows, saveBankMapping } from '../../../lib/paymentDuesApi'
import {
  FILE_KINDS, MAPPING_FIELDS, MAX_IMPORT_ROWS, chunkBankRows, explainRowError, guessHeaderRow, guessMapping, headerLabels, isBlockedHeader,
  mappingToSaved, parseBankRows, postingDateWarning, resolveSavedMapping, validateMapping,
} from '../../../lib/paymentBankImport'
import { sumBankAmount } from '../../../lib/paymentDues'
import { btnGhost, btnPrimary, inp } from '../construction/uiStyles'
import { fmtDate, fmtMoney } from '../licence/format'

const MAX_FILE_BYTES = 10 * 1024 * 1024
const PREVIEW_ROWS = 10
const SKIPPED_SHOWN = 20

// ไฟล์ธนาคารไทยมักเป็น CSV แบบ Windows-874 — ลอง UTF-8 แบบเข้มก่อน ถอดไม่ได้ค่อยใช้ Windows-874 (ไม่งั้นหัวคอลัมน์ภาษาไทยเป็นอักษรเพี้ยนแล้วเดาคอลัมน์ไม่ได้)
async function readMatrix(file) {
  if (/\.xlsx$/i.test(file.name)) return parseXlsx(file)
  const buffer = await file.arrayBuffer()
  let text
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer) } catch { text = new TextDecoder('windows-874').decode(buffer) }
  return parseCsv(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)
}

/** การจับคู่เริ่มต้น: ที่บันทึกไว้ (หัวคอลัมน์ยังตรง) ก่อน ไม่มี/ใช้ไม่ได้ = เดาจากหัวตาราง · source บอกคนว่าที่มาคืออะไร */
function initialMapping(matrix, saved) {
  const fromSaved = resolveSavedMapping(saved, matrix)
  if (fromSaved && fromSaved.cols.date !== null && (fromSaved.cols.amount !== null || fromSaved.cols.credit !== null)) return { ...fromSaved, source: 'saved' }
  const headerRow = guessHeaderRow(matrix)
  return { headerRow, cols: guessMapping(headerLabels(matrix, headerRow)), source: 'guess' }
}

function Tile({ label, value, tone = 'text-gray-900' }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-center">
      <p className={`text-xl font-bold tabular-nums ${tone}`}>{Number(value).toLocaleString('th-TH')}</p>
      <p className="text-xs text-gray-600">{label}</p>
    </div>
  )
}

/**
 * แผ่นนำเข้าไฟล์ธนาคาร (CSV/XLSX) — ชนิดไฟล์ → เลือกไฟล์ → จับคู่คอลัมน์ (เติมจากที่บันทึกไว้ หรือเดาจากหัวตาราง) → พรีวิว → ยืนยัน → ผล
 * ⚠️ PDPA: อ่านไฟล์ในเครื่องเท่านั้น ส่งขึ้นฐานเฉพาะ { txn_at, amount, ref1, ref2, bank_ref } — คอลัมน์ชื่อ/บัญชีผู้โอน/รายละเอียดจับคู่ไม่ได้
 *    ตารางไฟล์ (matrix) อยู่ใน state ของแผ่นนี้เท่านั้น ปิดแผ่น = ทิ้งทั้งหมด · พรีวิวแสดงเฉพาะช่องที่จับคู่
 * ฐานปฏิเสธทั้งชุดถ้าแถวเดียวผิด จึงกรองแถวผิดฝั่งนี้ให้และแสดงเหตุผลทุกแถวที่ข้าม (ไม่ข้ามเงียบ) · นำเข้าซ้ำไฟล์เดิมได้ ฐานกันแถวซ้ำให้
 * บันทึกการจับคู่คอลัมน์ขึ้นฐานหลังนำเข้าสำเร็จเท่านั้น (จับคู่ผิดจนฐานปฏิเสธ = ไม่บันทึกค่าผิดไว้ให้ครั้งหน้า)
 */
export default function PaymentBankImportSheet({ tenantId, onClose, onDone }) {
  const [kind, setKind] = useState('bill_payment')
  const [fileName, setFileName] = useState('')
  const [matrix, setMatrix] = useState(null)
  const [saved, setSaved] = useState({}) // { bill_payment, account } จากฐาน
  const [mapping, setMapping] = useState(null) // { headerRow, cols, source }
  const [reading, setReading] = useState(false)
  const [busy, setBusy] = useState(null) // { done, total } ขณะนำเข้า
  const [error, setError] = useState('')
  const [result, setResult] = useState(null) // { inserted, duplicates, auto_matched, unmatched, rows, mappingNote }

  const headers = useMemo(() => (matrix && mapping ? headerLabels(matrix, mapping.headerRow) : []), [matrix, mapping])
  const mappingError = useMemo(() => (mapping ? validateMapping(mapping, headers) : ''), [mapping, headers])
  const parsed = useMemo(() => (matrix && mapping && !mappingError ? parseBankRows(matrix, mapping) : null), [matrix, mapping, mappingError])
  // แถวที่ไม่เกินแถวหัวตารางที่เดาได้ = ชื่อรายงาน/หัวตาราง แสดงข้อความแรกให้เลือกถูก · แถวหลังจากนั้นเป็นข้อมูล (อาจมีชื่อผู้โอน) ไม่แสดงเนื้อหา
  const guessedHeaderRow = useMemo(() => (matrix ? guessHeaderRow(matrix) : 1), [matrix])

  async function handleFile(file) {
    setError(''); setResult(null); setMatrix(null); setMapping(null)
    if (!file) return
    setFileName(file.name)
    if (!/\.(csv|xlsx)$/i.test(file.name)) { setError('รองรับเฉพาะไฟล์ CSV และ XLSX (Excel รุ่นเก่า .xls ให้บันทึกเป็น .xlsx ก่อน)'); return }
    if (file.size > MAX_FILE_BYTES) { setError('ไฟล์ใหญ่เกิน 10 MB — แบ่งไฟล์ตามช่วงวันที่แล้วนำเข้าทีละส่วน'); return }
    setReading(true)
    try {
      const [grid, stored] = await Promise.all([readMatrix(file), fetchBankMapping(tenantId)])
      if (grid.length < 2) { setError('ไฟล์ไม่มีข้อมูล (ต้องมีแถวหัวตารางและอย่างน้อย 1 แถวข้อมูล)'); return }
      setSaved(stored.mapping)
      setMatrix(grid)
      setMapping(initialMapping(grid, stored.mapping?.[kind]))
    } catch (e) {
      setError(e?.message || 'อ่านไฟล์ไม่สำเร็จ')
    } finally {
      setReading(false)
    }
  }

  function changeKind(next) {
    setKind(next)
    if (matrix) setMapping(initialMapping(matrix, saved?.[next]))
  }
  function changeHeaderRow(row) {
    setMapping({ headerRow: row, cols: guessMapping(headerLabels(matrix, row)), source: 'guess' })
  }
  function changeCol(key, value) {
    setMapping(prev => ({ ...prev, source: 'manual', cols: { ...prev.cols, [key]: value === '' ? null : Number(value) } }))
  }

  async function confirm() {
    if (!parsed || parsed.rows.length === 0 || busy) return
    setError('')
    const chunks = chunkBankRows(parsed.rows, parsed.lines)
    const totals = { inserted: 0, duplicates: 0, auto_matched: 0, auto_evidence: 0, unmatched: 0, rows: 0 }
    setBusy({ done: 0, total: chunks.length })
    for (let i = 0; i < chunks.length; i += 1) {
      const label = chunks.length > 1 ? `${fileName} (ชุด ${i + 1}/${chunks.length})` : fileName
      const { result: r, error: err } = await importBankRows(tenantId, kind, label, chunks[i].rows)
      if (err) {
        setBusy(null)
        const done = totals.rows > 0 ? ` — ชุดก่อนหน้านำเข้าแล้ว ${totals.inserted.toLocaleString('th-TH')} รายการ (นำเข้าไฟล์เดิมซ้ำได้ ระบบไม่สร้างแถวซ้ำ)` : ''
        setError(`${explainRowError(friendlyError(err), chunks[i].lines)}${done}`)
        if (totals.rows > 0) onDone()
        return
      }
      for (const key of Object.keys(totals)) totals[key] += Number(r?.[key]) || 0
      setBusy({ done: i + 1, total: chunks.length })
    }
    // นำเข้าสำเร็จแล้วค่อยจำการจับคู่คอลัมน์ (ไม่เปลี่ยนจากที่จำไว้ = ไม่ต้องเขียน)
    let mappingNote = ''
    if (mapping.source !== 'saved') {
      const { error: saveErr } = await saveBankMapping(tenantId, kind, mappingToSaved(mapping, headers))
      mappingNote = saveErr ? `นำเข้าแล้ว แต่จำการจับคู่คอลัมน์ไว้ไม่ได้: ${friendlyError(saveErr)}` : 'จำการจับคู่คอลัมน์นี้ไว้แล้ว — ครั้งหน้าเลือกไฟล์แล้วกดยืนยันได้เลย'
    }
    setBusy(null)
    setResult({ ...totals, mappingNote })
    onDone()
  }

  const preview = parsed?.rows.slice(0, PREVIEW_ROWS) ?? []
  const hasRef1 = mapping?.cols?.ref1 !== null && mapping?.cols?.ref1 !== undefined
  const lastHeaderRow = matrix ? Math.min(20, matrix.length - 1) : 1

  if (result) {
    return (
      <Sheet title="นำเข้าไฟล์ธนาคารเสร็จแล้ว" subtitle={fileName} onClose={onClose} wide>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <Tile label="นำเข้าใหม่" value={result.inserted} tone="text-emerald-700" />
          <Tile label="ซ้ำ (มีอยู่แล้ว)" value={result.duplicates} tone="text-gray-600" />
          <Tile label="ระบบจับคู่เอง" value={result.auto_matched} tone="text-blue-700" />
          <Tile label="ผูกเป็นหลักฐาน" value={result.auto_evidence} tone="text-emerald-700" />
          <Tile label="ยังระบุไม่ได้" value={result.unmatched} tone={result.unmatched > 0 ? 'text-amber-700' : 'text-gray-900'} />
        </div>
        {result.auto_evidence > 0 && (
          <p className="rounded-xl bg-emerald-50 px-3 py-2 text-xs leading-relaxed text-emerald-900">
            "ผูกเป็นหลักฐาน" = Ref1 และยอดตรงกับยอดที่บันทึกเลขใบเสร็จไปแล้ว ระบบผูกเงินเข้ากับรายการนั้นเป็นหลักฐาน ไม่ใช่เงินซ้ำ และไม่ต้องกรอกเลขใบเสร็จอีก
          </p>
        )}
        <p className="rounded-xl bg-gray-50 px-3 py-2 text-xs leading-relaxed text-gray-700">
          ระบบจับคู่เองเฉพาะรายการที่ Ref1 และยอดตรงกับยอดค้าง · รายการที่เหลือไปที่ตัวกรอง "ยังระบุไม่ได้" ให้เจ้าหน้าที่กดยืนยันคู่ · ยอดจะยังรอชำระจนกว่าจะกรอกเลขใบเสร็จ (ระบบไม่ออกใบเสร็จ)
        </p>
        {result.mappingNote && <p role="status" className="rounded-xl bg-blue-50 px-3 py-2 text-sm text-blue-900">{result.mappingNote}</p>}
        <div className="flex gap-2 pt-1"><button type="button" className={btnPrimary} style={{ backgroundColor: 'var(--color-primary)' }} onClick={onClose}>ปิด</button></div>
      </Sheet>
    )
  }

  return (
    <Sheet title="นำเข้าไฟล์ธนาคาร" subtitle="เงินเข้าจากธนาคาร" onClose={onClose} busy={Boolean(busy)} wide>
      <p className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs leading-relaxed text-emerald-900">
        <ShieldCheck size={15} className="mt-0.5 shrink-0" />
        <span>ระบบอ่านไฟล์ในเครื่องนี้ แล้วส่งขึ้นระบบเฉพาะ วันเวลา ยอด Ref1 Ref2 และเลขอ้างอิงธนาคาร — <b>ไม่เก็บและไม่ส่งชื่อหรือเลขบัญชีผู้โอน</b> คอลัมน์ที่เป็นชื่อ/บัญชี/รายละเอียดเลือกไม่ได้</span>
      </p>

      <fieldset>
        <legend className="mb-1 block text-xs font-semibold text-gray-500">ชนิดไฟล์</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {Object.entries(FILE_KINDS).map(([id, k]) => (
            <label key={id} className={`flex min-h-11 cursor-pointer items-start gap-2 rounded-xl border px-3 py-2.5 text-sm ${kind === id ? 'border-blue-300 bg-blue-50' : 'border-gray-200'}`}>
              <input type="radio" name="bank-file-kind" className="mt-1 size-4" checked={kind === id} disabled={Boolean(busy)} onChange={() => changeKind(id)} />
              <span><span className="block font-semibold text-gray-900">{k.label}</span><span className="block text-xs text-gray-600">{k.hint}</span></span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="block">
        <span className="mb-1 block text-xs font-semibold text-gray-500">ไฟล์ (CSV หรือ XLSX · ไม่เกิน 10 MB)</span>
        <input type="file" accept=".csv,.xlsx" className={inp} disabled={reading || Boolean(busy)} onChange={e => handleFile(e.target.files?.[0] ?? null)} />
      </label>
      {reading && <p className="flex items-center gap-2 text-sm text-gray-600"><Loader2 size={15} className="animate-spin" />กำลังอ่านไฟล์…</p>}

      {matrix && mapping && (
        <>
          <section className="space-y-3 rounded-xl border border-gray-200 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-sm font-bold text-gray-900">จับคู่คอลัมน์</h4>
              <span className="text-xs text-gray-600">
                {mapping.source === 'saved' ? 'ใช้การจับคู่ที่บันทึกไว้ครั้งก่อน' : mapping.source === 'manual' ? 'ปรับเอง' : 'ระบบเดาจากหัวตาราง — ตรวจให้ถูกต้องก่อนยืนยัน'}
              </span>
            </div>
            <label className="block sm:max-w-xs">
              <span className="mb-1 block text-xs font-semibold text-gray-500">แถวที่เป็นหัวตาราง</span>
              <select className={inp} value={mapping.headerRow} onChange={e => changeHeaderRow(Number(e.target.value))}>
                {Array.from({ length: lastHeaderRow }, (_, i) => i + 1).map(n => (
                  <option key={n} value={n}>แถวที่ {n}{n <= guessedHeaderRow ? ` — ${String(matrix[n - 1]?.find(c => String(c ?? '').trim()) ?? '(ว่าง)').trim().slice(0, 30)}` : ''}</option>
                ))}
              </select>
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              {MAPPING_FIELDS.map(f => (
                <label key={f.key} className="block">
                  <span className="mb-1 block text-xs font-semibold text-gray-500">{f.label}{f.required ? ' *' : ''}</span>
                  <select className={inp} value={mapping.cols[f.key] ?? ''} onChange={e => changeCol(f.key, e.target.value)} disabled={Boolean(busy)}>
                    <option value="">— ไม่ใช้ —</option>
                    {headers.map((h, i) => (
                      <option key={i} value={i} disabled={isBlockedHeader(h)}>{h}{isBlockedHeader(h) ? ' (อาจมีชื่อ/บัญชีผู้โอน — ไม่รับ)' : ''}</option>
                    ))}
                  </select>
                  {f.hint && <span className="mt-0.5 block text-xs text-gray-500">{f.hint}</span>}
                </label>
              ))}
            </div>
            {!mappingError && postingDateWarning(headers, mapping) && (
              <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-950">
                คอลัมน์วันที่ที่เลือกเป็น "วันที่ลงบัญชี" ไม่ใช่วันที่ผู้ชำระทำรายการ — เงินที่จ่ายทันวันหมดอายุอาจถูกมองว่าจ่ายช้า (ธนาคารลงบัญชีช้ากว่าวันจ่าย) ถ้าไฟล์มีคอลัมน์ "วันที่ทำรายการ/วันที่ชำระ" ให้เลือกคอลัมน์นั้นแทน
              </p>
            )}
            {mappingError && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{mappingError}</p>}
            {!mappingError && kind === 'bill_payment' && !hasRef1 && (
              <p role="status" className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">ยังไม่ได้เลือกคอลัมน์ Ref1 — ระบบจะจับคู่เองไม่ได้ ต้องกดยืนยันคู่ทีละรายการ</p>
            )}
          </section>

          {parsed && (
            <section className="space-y-3">
              <p className="text-sm text-gray-800">
                อ่านได้ <b>{parsed.rows.length.toLocaleString('th-TH')}</b> แถว รวม <b>{fmtMoney(sumBankAmount(parsed.rows))}</b> บาท
                {parsed.skipped.length > 0 && <> · ข้าม <b className="text-amber-700">{parsed.skipped.length.toLocaleString('th-TH')}</b> แถว</>}
                {parsed.rows.length > MAX_IMPORT_ROWS && ` · ระบบจะแบ่งนำเข้าเป็น ${Math.ceil(parsed.rows.length / MAX_IMPORT_ROWS)} ชุด`}
              </p>
              {preview.length > 0 && (
                <div className="overflow-x-auto rounded-xl border border-gray-200">
                  <table className="w-full min-w-[520px] border-collapse text-xs">
                    <caption className="sr-only">ตัวอย่าง {preview.length} แถวแรกที่อ่านได้</caption>
                    <thead className="bg-gray-50 text-left font-bold text-gray-600">
                      <tr><th className="px-2.5 py-2">แถวที่</th><th className="px-2.5 py-2">วันที่เวลา</th><th className="px-2.5 py-2 text-right">ยอด (บาท)</th><th className="px-2.5 py-2">Ref1</th><th className="px-2.5 py-2">Ref2</th><th className="px-2.5 py-2">เลขอ้างอิงธนาคาร</th></tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {preview.map((r, i) => (
                        <tr key={i}>
                          <td className="px-2.5 py-1.5 text-gray-500">{parsed.lines[i]}</td>
                          <td className="whitespace-nowrap px-2.5 py-1.5">{fmtDate(r.txn_at.slice(0, 10))}{r.txn_at.length > 10 ? ` ${r.txn_at.slice(11, 16)}` : ''}</td>
                          <td className="whitespace-nowrap px-2.5 py-1.5 text-right font-semibold">{fmtMoney(r.amount)}</td>
                          <td className="px-2.5 py-1.5 font-mono">{r.ref1 ?? '—'}</td>
                          <td className="px-2.5 py-1.5 font-mono">{r.ref2 ?? '—'}</td>
                          <td className="break-all px-2.5 py-1.5 font-mono">{r.bank_ref ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="text-xs text-gray-500">วันที่แบบ 03/04/2569 อ่านเป็น วัน/เดือน/ปี (พ.ศ. ลบ 543 ให้) — ตรวจวันที่ในตัวอย่างให้ตรงกับไฟล์ก่อนยืนยัน</p>
              {parsed.skipped.length > 0 && (
                <div role="status" className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs text-amber-950">
                  <p className="flex items-center gap-1.5 text-sm font-bold"><TriangleAlert size={15} />แถวที่ข้าม {parsed.skipped.length.toLocaleString('th-TH')} แถว จะไม่ถูกนำเข้า — ตรวจว่าไม่มีเงินเข้าตกหล่น</p>
                  <ul className="mt-1.5 max-h-40 space-y-0.5 overflow-y-auto">
                    {parsed.skipped.slice(0, SKIPPED_SHOWN).map(s => <li key={s.line}>แถวที่ {s.line}: {s.reason}</li>)}
                  </ul>
                  {parsed.skipped.length > SKIPPED_SHOWN && <p className="mt-1">และอีก {(parsed.skipped.length - SKIPPED_SHOWN).toLocaleString('th-TH')} แถว</p>}
                </div>
              )}
              {parsed.rows.length === 0 && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">ไม่มีแถวที่นำเข้าได้ — ตรวจการจับคู่คอลัมน์และแถวหัวตาราง</p>}
            </section>
          )}
        </>
      )}

      {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="flex flex-wrap gap-2 pt-1">
        <button type="button" className={btnPrimary} style={{ backgroundColor: 'var(--color-primary)' }}
          disabled={!parsed || parsed.rows.length === 0 || Boolean(busy)} onClick={confirm}>
          {busy ? <Loader2 size={15} className="animate-spin" /> : <FileSpreadsheet size={15} />}
          {busy ? `กำลังนำเข้า ${busy.done}/${busy.total}` : `ยืนยัน นำเข้า${parsed?.rows.length ? ` ${parsed.rows.length.toLocaleString('th-TH')} แถว` : ''}`}
        </button>
        <button type="button" className={btnGhost} onClick={onClose} disabled={Boolean(busy)}>ยกเลิก</button>
      </div>
    </Sheet>
  )
}
