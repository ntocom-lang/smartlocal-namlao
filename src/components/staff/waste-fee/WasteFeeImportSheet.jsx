import { useMemo, useState } from 'react'
import { Download, Loader2, Upload } from 'lucide-react'
import { Sheet } from '../../patientTransport/StaffShell'
import { parseXlsx } from '../../../lib/spreadsheetRead'
import { decodeTextBytes, normalizeCell, parseDelimited } from '../../../lib/tabularImport'
import { cancelImportBatch, friendlyError, importAccounts } from '../../../lib/wasteFeeApi'
import { IMPORT_MAX_ROWS, buildImportTemplateCsv, currentMonthStart, monthStart, parseImportRows } from '../../../lib/wasteFee'
import { btnGhost, btnPrimary, inp } from '../construction/uiStyles'
import Field from '../licence/Field'
import { fmtDate, fmtMonth, toMonthInput } from './format'

function downloadTemplate() {
  const url = URL.createObjectURL(new Blob([buildImportTemplateCsv()], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url; a.download = 'แบบนำเข้าทะเบียนค่าธรรมเนียมขยะ.csv'
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * แผ่นนำเข้าทะเบียนจาก Excel (.xlsx / .csv) — มีพรีวิวและตรวจซ้ำก่อนบันทึก (แถวผิดไม่ถูกนำเข้า · คำเตือนไม่บล็อก)
 * ทั้งไฟล์ = หนึ่งชุด (import_batch) ยกเลิกทั้งชุดได้ · เดือนเริ่มเก็บ/ปริมาณที่ไฟล์ไม่ระบุใช้ค่าเริ่มต้น (เดือนที่เลือกด้านบน / 1 หน่วย)
 * ไม่รับเลขบัตรประชาชน — ไฟล์ที่มีคอลัมน์นี้ ระบบไม่อ่านค่านั้นเข้ามา
 */
export default function WasteFeeImportSheet({ tenantId, accounts, onClose, onChanged }) {
  const [preview, setPreview] = useState(null) // { rows, missingHeaders }
  const [matrix, setMatrix] = useState(null)
  const [defaultFrom, setDefaultFrom] = useState(() => currentMonthStart())
  const [fileName, setFileName] = useState('')
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [lastBatch, setLastBatch] = useState(null) // { id, count }

  const ready = useMemo(() => (preview?.rows ?? []).filter(r => r.status === 'ready'), [preview])
  const invalid = useMemo(() => (preview?.rows ?? []).filter(r => r.status === 'invalid'), [preview])
  const warned = useMemo(() => ready.filter(r => r.warnings.length > 0).length, [ready])
  // ชุดนำเข้าที่เคยบันทึกไว้ (จัดกลุ่มจาก import_batch ในทะเบียน) — ยกเลิกได้จากที่นี่แม้ปิดแผ่นไปแล้ว
  const batches = useMemo(() => {
    const map = new Map()
    for (const a of accounts) {
      if (!a.import_batch) continue
      const b = map.get(a.import_batch) ?? { id: a.import_batch, count: 0, at: a.created_at }
      b.count += 1
      if (a.created_at < b.at) b.at = a.created_at
      map.set(a.import_batch, b)
    }
    return [...map.values()].sort((a, b) => String(b.at).localeCompare(String(a.at)))
  }, [accounts])

  const check = (grid, from) => setPreview(parseImportRows(grid, { existing: accounts, defaultServiceFrom: from }))

  async function handleFile(file) {
    setPreview(null); setMatrix(null); setMessage(''); setError(''); setLastBatch(null)
    if (!file) return
    setFileName(file.name)
    if (!/\.(csv|txt|xlsx)$/i.test(file.name)) { setError('รองรับเฉพาะไฟล์ CSV และ XLSX (Excel รุ่นเก่า .xls ให้บันทึกเป็น .xlsx ก่อน)'); return }
    setLoading(true)
    try {
      let grid
      let truncated = false
      if (/\.xlsx$/i.test(file.name)) grid = await parseXlsx(file)
      else {
        const parsed = parseDelimited(decodeTextBytes(await file.arrayBuffer()).text)
        grid = parsed.rows.map(r => r.map(normalizeCell))
        truncated = parsed.truncated // ตัวอ่านหยุดที่ 2,000 แถว — ต้องไม่ปล่อยให้นำเข้าครึ่งไฟล์เงียบๆ
      }
      if (truncated || grid.length - 1 > IMPORT_MAX_ROWS) { setError(`ไฟล์มีเกิน ${IMPORT_MAX_ROWS.toLocaleString('th-TH')} แถว — แบ่งไฟล์แล้วนำเข้าทีละส่วน`); setLoading(false); return }
      setMatrix(grid)
      check(grid, defaultFrom)
    } catch (e) {
      setError(e?.message || 'อ่านไฟล์ไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }

  function changeDefaultFrom(value) {
    const next = monthStart(value) ?? ''
    setDefaultFrom(next)
    if (matrix) check(matrix, next)
  }

  async function doImport() {
    if (ready.length === 0) return
    setProgress({ done: 0, total: ready.length }); setError(''); setMessage('')
    const result = await importAccounts(tenantId, ready.map(r => r.payload), (done, total) => setProgress({ done, total }))
    setProgress(null)
    if (result.inserted > 0) { setLastBatch({ id: result.batchId, count: result.inserted }); onChanged() }
    if (result.error) {
      setError(`${friendlyError(result.error)} — บันทึกสำเร็จ ${result.inserted} แถว หยุดที่ก้อนที่เริ่มแถวที่ ${result.failedAt} ของแถวที่ผ่านการตรวจ (ยกเลิกทั้งชุดได้ด้านล่าง)`)
      return
    }
    setPreview(null); setMatrix(null)
    setMessage(`นำเข้าสำเร็จ ${result.inserted} บัญชี`)
  }

  async function cancelBatch(id) {
    if (!window.confirm('ยกเลิกทั้งชุดนำเข้านี้? บัญชีทั้งหมดในชุดจะถูกลบออกจากทะเบียน (ประวัติการแก้ไขยังเก็บไว้)')) return
    setError(''); setMessage('')
    const { deleted, error: err } = await cancelImportBatch(tenantId, id)
    if (err) { setError(friendlyError(err)); return }
    setLastBatch(b => (b?.id === id ? null : b))
    setMessage(`ยกเลิกชุดนำเข้าแล้ว ลบ ${deleted} บัญชี`)
    onChanged()
  }

  return (
    <Sheet title="นำเข้าทะเบียนจาก Excel" subtitle="CSV หรือ XLSX · มีพรีวิวและตรวจซ้ำก่อนบันทึก" onClose={onClose} busy={Boolean(progress)} wide>
      <div className="space-y-3">
        <p className="rounded-xl bg-gray-50 px-3 py-2 text-xs leading-relaxed text-gray-700">
          แถวแรกคือหัวคอลัมน์ภาษาไทย — จำเป็น: <b>ชื่อผู้ชำระ</b> · ที่เหลือเว้นว่างได้: เลขทะเบียน · เบอร์โทร · บ้านเลขที่ · หมู่ · ที่อยู่
          · ประเภทสถานที่ (เว้นว่าง = บ้านพักอาศัย) · ปริมาณ (หน่วย) หรือ ปริมาณ (กก.) ต่อเดือน (เว้นว่าง = 1 หน่วย) · เดือนเริ่มเก็บ (พ.ศ./ค.ศ. ได้)
          · เลขทะเบียนซ้ำจะไม่ถูกนำเข้า ส่วนบ้านเลขที่+หมู่ซ้ำขึ้นเป็นคำเตือน (บ้านหนึ่งมีได้หลายบัญชี) · ไม่ต้องใส่เลขบัตรประชาชน ระบบไม่อ่านคอลัมน์นั้น
          · เบอร์โทรที่ Excel ตัดเลข 0 หน้าทิ้ง ระบบเติมคืนให้
        </p>
        <Field label="เดือนเริ่มเก็บที่ใช้เมื่อไฟล์ไม่ระบุ" hint={defaultFrom ? `${fmtMonth(defaultFrom)}` : 'ไม่เลือก = แถวที่ไม่ระบุเดือนจะถูกตีกลับ'}>
          <input type="month" className={`${inp} sm:max-w-xs`} value={toMonthInput(defaultFrom)} onChange={e => changeDefaultFrom(e.target.value)} />
        </Field>
        <div className="flex flex-wrap gap-2">
          <label className={`${btnPrimary} cursor-pointer`} style={{ backgroundColor: 'var(--color-primary)' }}>
            <Upload size={16} />เลือกไฟล์
            <input type="file" accept=".csv,.txt,.xlsx" className="hidden" onChange={e => { handleFile(e.target.files?.[0]); e.target.value = '' }} />
          </label>
          <button type="button" className={btnGhost} onClick={downloadTemplate}><Download size={16} />ดาวน์โหลดแบบ (CSV)</button>
        </div>
        {loading && <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 size={16} className="animate-spin" />กำลังอ่าน {fileName}…</p>}
        {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {message && <p role="status" className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</p>}

        {preview?.missingHeaders.length > 0 && (
          <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">ไม่พบหัวคอลัมน์ที่จำเป็น: {preview.missingHeaders.join(', ')}</p>
        )}
        {preview && preview.missingHeaders.length === 0 && (
          <>
            <p className="text-sm font-semibold text-gray-800">
              {fileName}: พร้อมนำเข้า {ready.length} แถว{warned > 0 ? ` (มีคำเตือน ${warned})` : ''} · ผิด {invalid.length} แถว (แถวผิดจะไม่ถูกนำเข้า)
            </p>
            <div className="max-h-72 overflow-auto rounded-xl border border-gray-200">
              <table className="w-full min-w-[560px] border-collapse text-xs">
                <thead className="sticky top-0 bg-gray-50 text-left text-gray-600">
                  <tr><th className="px-3 py-2">แถว</th><th className="px-3 py-2">ผู้ชำระ</th><th className="px-3 py-2">ผลตรวจ</th></tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {preview.rows.map(r => (
                    <tr key={r.line} className={r.status === 'invalid' ? 'bg-red-50/60' : r.warnings.length ? 'bg-amber-50/60' : ''}>
                      <td className="whitespace-nowrap px-3 py-1.5 text-gray-500">{r.line}</td>
                      <td className="px-3 py-1.5 text-gray-800">{r.label}</td>
                      <td className={`px-3 py-1.5 ${r.status === 'invalid' ? 'text-red-700' : r.warnings.length ? 'text-amber-800' : 'text-emerald-700'}`}>
                        {r.status === 'invalid' ? r.errors.join(' · ') : r.warnings.length ? `พร้อมนำเข้า — เตือน: ${r.warnings.join(' · ')}` : 'พร้อมนำเข้า'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button type="button" className={btnPrimary} style={{ backgroundColor: 'var(--color-primary)' }} disabled={ready.length === 0 || Boolean(progress)} onClick={doImport}>
              {progress ? <><Loader2 size={15} className="animate-spin" />กำลังนำเข้า {progress.done}/{progress.total}</> : `นำเข้า ${ready.length} บัญชี`}
            </button>
          </>
        )}

        {lastBatch && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <span>ชุดนำเข้าล่าสุด {lastBatch.count} บัญชี</span>
            <button type="button" className={`${btnGhost} min-h-9 px-3 text-xs`} onClick={() => cancelBatch(lastBatch.id)}>ยกเลิกทั้งชุดนี้</button>
          </div>
        )}
        {batches.length > 0 && (
          <section className="space-y-1.5">
            <h4 className="text-sm font-bold text-gray-800">ชุดนำเข้าที่เคยบันทึก</h4>
            <ul className="space-y-1.5">
              {batches.map(b => (
                <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gray-200 px-3 py-2 text-xs text-gray-700">
                  <span>{b.count} บัญชี · นำเข้าเมื่อ {fmtDate(String(b.at).slice(0, 10))}</span>
                  <button type="button" className={`${btnGhost} min-h-9 px-3 text-xs`} onClick={() => cancelBatch(b.id)}>ยกเลิกทั้งชุด</button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </Sheet>
  )
}
