import { useMemo, useState } from 'react'
import { Download, Loader2, Upload } from 'lucide-react'
import { Sheet } from '../../patientTransport/StaffShell'
import { parseCsv, parseXlsx } from '../../../lib/spreadsheetRead'
import { cancelImportBatch, friendlyError, importLicences } from '../../../lib/licenceRegistryApi'
import { IMPORT_MAX_ROWS, IMPORT_TEMPLATE_HEADERS, buildImportPreview } from '../../../lib/licenceRegistry'
import { btnGhost, btnPrimary } from '../construction/uiStyles'
import { fmtDate } from './format'

function downloadTemplate() {
  const sample = ['ชื่อประเภทตามหน้าประเภทใบอนุญาต', '', 'ร้านตัวอย่าง', '', 'นายสมชาย ตัวอย่าง', '', '', 'หมู่ 1', '', '', '2026-01-15', '2027-01-14', '', '']
  const csv = [IMPORT_TEMPLATE_HEADERS, sample].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob([String.fromCharCode(65279) + csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url; a.download = 'แบบนำเข้าทะเบียนใบอนุญาต.csv'
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * แผ่นนำเข้าทะเบียนจาก Excel (.xlsx / .csv) — มีพรีวิวและแถวผิดก่อนบันทึก (แถวผิดไม่ถูกนำเข้า)
 * ทั้งไฟล์ = หนึ่งชุด (import_batch) ยกเลิกทั้งชุดได้ถ้ายังไม่มีการรับเงิน · วันที่ในไฟล์รับ พ.ศ./ค.ศ. และเลขวันของ Excel
 * ใบที่นำเข้าเป็น "ใช้งาน" เสมอ — พักใช้/เพิกถอนต้องบันทึกคำสั่งทีหลัง
 */
export default function LicenceImportSheet({ tenantId, types, licences, onClose, onChanged }) {
  const [preview, setPreview] = useState(null) // { rows, missingHeaders }
  const [fileName, setFileName] = useState('')
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [lastBatch, setLastBatch] = useState(null) // { id, count }

  const ready = useMemo(() => (preview?.rows ?? []).filter(r => r.status === 'ready'), [preview])
  const invalid = useMemo(() => (preview?.rows ?? []).filter(r => r.status === 'invalid'), [preview])
  // ชุดนำเข้าที่เคยบันทึกไว้ (จัดกลุ่มจาก import_batch ในทะเบียน) — ยกเลิกได้จากที่นี่แม้ปิดแผ่นไปแล้ว
  const batches = useMemo(() => {
    const map = new Map()
    for (const l of licences) {
      if (!l.import_batch) continue
      const b = map.get(l.import_batch) ?? { id: l.import_batch, count: 0, at: l.created_at }
      b.count += 1
      if (l.created_at < b.at) b.at = l.created_at
      map.set(l.import_batch, b)
    }
    return [...map.values()].sort((a, b) => String(b.at).localeCompare(String(a.at)))
  }, [licences])

  async function handleFile(file) {
    setPreview(null); setMessage(''); setError(''); setLastBatch(null)
    if (!file) return
    setFileName(file.name)
    if (!/\.(csv|xlsx)$/i.test(file.name)) { setError('รองรับเฉพาะไฟล์ CSV และ XLSX (Excel รุ่นเก่า .xls ให้บันทึกเป็น .xlsx ก่อน)'); return }
    setLoading(true)
    try {
      const matrix = /\.xlsx$/i.test(file.name) ? await parseXlsx(file) : parseCsv((await file.text()).replace(new RegExp('^' + String.fromCharCode(65279)), ''))
      if ((matrix.length - 1) > IMPORT_MAX_ROWS) { setError(`ไฟล์มีเกิน ${IMPORT_MAX_ROWS.toLocaleString('th-TH')} แถว — แบ่งไฟล์แล้วนำเข้าทีละส่วน`); setLoading(false); return }
      setPreview(buildImportPreview(matrix, { types, existing: licences }))
    } catch (e) {
      setError(e?.message || 'อ่านไฟล์ไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }

  async function doImport() {
    if (ready.length === 0) return
    setProgress({ done: 0, total: ready.length }); setError(''); setMessage('')
    const result = await importLicences(tenantId, ready.map(r => r.payload), (done, total) => setProgress({ done, total }))
    setProgress(null)
    if (result.inserted > 0) { setLastBatch({ id: result.batchId, count: result.inserted }); onChanged() }
    if (result.error) {
      setError(`${friendlyError(result.error)} — บันทึกสำเร็จ ${result.inserted} แถว หยุดที่ก้อนที่เริ่มแถว ${result.failedAt} ของไฟล์ (ยกเลิกทั้งชุดได้ด้านล่าง)`)
      return
    }
    setPreview(null)
    setMessage(`นำเข้าสำเร็จ ${result.inserted} ใบ`)
  }

  async function cancelBatch(id) {
    if (!window.confirm('ยกเลิกทั้งชุดนำเข้านี้? ใบทั้งหมดในชุดจะถูกลบออกจากทะเบียน (ใบที่มีรายการรับค่าธรรมเนียมแล้ว ลบไม่ได้)')) return
    setError(''); setMessage('')
    const { deleted, error: err } = await cancelImportBatch(tenantId, id)
    if (err) { setError(friendlyError(err)); return }
    setLastBatch(b => (b?.id === id ? null : b))
    setMessage(`ยกเลิกชุดนำเข้าแล้ว ลบ ${deleted} ใบ`)
    onChanged()
  }

  return (
    <Sheet title="นำเข้าทะเบียนจาก Excel" subtitle="CSV หรือ XLSX · มีพรีวิวก่อนบันทึก" onClose={onClose} busy={Boolean(progress)} wide>
      <div className="space-y-3">
        <p className="rounded-xl bg-gray-50 px-3 py-2 text-xs leading-relaxed text-gray-700">
          แถวแรกคือหัวคอลัมน์ภาษาไทย — จำเป็น: <b>ประเภท</b> (ชื่อตรงกับหน้าประเภทใบอนุญาต) · <b>ชื่อสถานประกอบการ</b> · <b>ชื่อผู้ประกอบการ</b>
          · ใบอนุญาตต้องมี <b>วันหมดอายุ</b> · หนังสือรับรองการแจ้งต้องมี <b>วันครบกำหนดชำระ</b> · วันที่ใช้ พ.ศ. หรือ ค.ศ. ก็ได้ · ใบที่นำเข้าเป็น "ใช้งาน" เสมอ
        </p>
        <div className="flex flex-wrap gap-2">
          <label className={`${btnPrimary} cursor-pointer`} style={{ backgroundColor: 'var(--color-primary)' }}>
            <Upload size={16} />เลือกไฟล์
            <input type="file" accept=".csv,.xlsx" className="hidden" onChange={e => { handleFile(e.target.files?.[0]); e.target.value = '' }} />
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
              {fileName}: พร้อมนำเข้า {ready.length} แถว · ผิด {invalid.length} แถว (แถวผิดจะไม่ถูกนำเข้า)
            </p>
            <div className="max-h-72 overflow-auto rounded-xl border border-gray-200">
              <table className="w-full min-w-[560px] border-collapse text-xs">
                <thead className="sticky top-0 bg-gray-50 text-left text-gray-600">
                  <tr><th className="px-3 py-2">แถว</th><th className="px-3 py-2">สถานประกอบการ</th><th className="px-3 py-2">ผลตรวจ</th></tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {preview.rows.map(r => (
                    <tr key={r.line} className={r.status === 'invalid' ? 'bg-red-50/60' : ''}>
                      <td className="whitespace-nowrap px-3 py-1.5 text-gray-500">{r.line}</td>
                      <td className="px-3 py-1.5 text-gray-800">{r.label}</td>
                      <td className={`px-3 py-1.5 ${r.status === 'invalid' ? 'text-red-700' : 'text-emerald-700'}`}>{r.status === 'invalid' ? r.errors.join(' · ') : 'พร้อมนำเข้า'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button type="button" className={btnPrimary} style={{ backgroundColor: 'var(--color-primary)' }} disabled={ready.length === 0 || Boolean(progress)} onClick={doImport}>
              {progress ? <><Loader2 size={15} className="animate-spin" />กำลังนำเข้า {progress.done}/{progress.total}</> : `นำเข้า ${ready.length} ใบ`}
            </button>
          </>
        )}

        {lastBatch && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <span>ชุดนำเข้าล่าสุด {lastBatch.count} ใบ</span>
            <button type="button" className={`${btnGhost} min-h-9 px-3 text-xs`} onClick={() => cancelBatch(lastBatch.id)}>ยกเลิกทั้งชุดนี้</button>
          </div>
        )}
        {batches.length > 0 && (
          <section className="space-y-1.5">
            <h4 className="text-sm font-bold text-gray-800">ชุดนำเข้าที่เคยบันทึก</h4>
            <ul className="space-y-1.5">
              {batches.map(b => (
                <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gray-200 px-3 py-2 text-xs text-gray-700">
                  <span>{b.count} ใบ · นำเข้าเมื่อ {fmtDate(String(b.at).slice(0, 10))}</span>
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
