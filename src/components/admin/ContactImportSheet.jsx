import { useEffect, useMemo, useState } from 'react'
import { Check, Download, FileSpreadsheet, Loader2, ShieldQuestion, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { parseCsv, parseXlsx } from '../../lib/spreadsheetRead'
import {
  CONTACT_IMPORT_MAX_ROWS,
  buildContactImportPreview,
  buildContactInsertPayload,
  buildContactTemplateCsv,
} from '../../lib/contactImport'
import { EMERGENCY_CATEGORY_MAP } from '../../lib/emergencyCategories'

// หน้าตาเหมือน ConsentWarnBadge ใน AdminDashboard.jsx ทุกประการ — ทำซ้ำตรงนี้แทนการ import
// เพราะ AdminDashboard import ไฟล์นี้อยู่แล้ว (import วนกลับจะพัง) · แก้ป้ายนั้นแล้วต้องแก้ที่นี่ด้วย
function ConsentWarnBadge() {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap bg-amber-100 text-amber-700"
          title="เบอร์มือถือส่วนบุคคล — ยังไม่ได้ยืนยันว่าเจ้าของยินยอมให้เผยแพร่ (PDPA)">
      <ShieldQuestion size={11} /> ยังไม่ยืนยันยินยอม
    </span>
  )
}

function downloadTemplate() {
  const url = URL.createObjectURL(new Blob([buildContactTemplateCsv()], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = 'แบบนำเข้าสมุดเบอร์โทร.csv'
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * แผ่นนำเข้าสมุดเบอร์โทรจาก Excel (.xlsx / .csv) — ใช้ทั้งสายด่วนฉุกเฉินและเบอร์โทรสำคัญ (book ที่เปิดอยู่)
 * มีพรีวิวรายแถวก่อนบันทึก: จะเพิ่ม / ข้าม (ซ้ำ-ผิดรูป) / เตือน (มือถือส่วนตัวที่ยังไม่ยินยอม ไม่บล็อก)
 * กดยืนยันครั้งเดียว = insert ทั้งชุดในคำสั่งเดียว (PostgREST เป็นคำสั่งเดียว พังทั้งชุด ไม่มีบันทึกครึ่งๆ)
 *
 * @param {{ tenantId: string, book: string, bookInfo: { label: string, itemNoun: string },
 *   existing: Array<{ number: string }>, startOrder: number, guessEmoji?: (label: string) => string,
 *   onClose: () => void, onImported: (rows: object[]) => void }} props
 *   existing = เบอร์ของสมุดนี้ที่โหลดอยู่แล้ว (ไว้เทียบซ้ำ) · startOrder = nextDisplayOrder() ของสมุดนี้
 */
export default function ContactImportSheet({ tenantId, book, bookInfo, existing, startOrder, guessEmoji, onClose, onImported }) {
  const [preview, setPreview] = useState(null)
  const [fileName, setFileName] = useState('')
  const [reading, setReading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [doneCount, setDoneCount] = useState(null)

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !saving) onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, saving])

  const warningsByRow = useMemo(() => {
    const map = new Map()
    for (const w of preview?.warnings ?? []) map.set(w.rowNo, [...(map.get(w.rowNo) ?? []), w])
    return map
  }, [preview])
  const consentWarnCount = (preview?.warnings ?? []).filter((w) => w.kind === 'consent').length

  async function handleFile(file) {
    setPreview(null); setError(''); setDoneCount(null)
    if (!file) return
    setFileName(file.name)
    if (!/\.(csv|xlsx)$/i.test(file.name)) {
      setError('รองรับเฉพาะไฟล์ CSV และ XLSX (Excel รุ่นเก่า .xls ให้บันทึกเป็น .xlsx ก่อน)')
      return
    }
    setReading(true)
    try {
      const matrix = /\.xlsx$/i.test(file.name)
        ? await parseXlsx(file)
        : parseCsv((await file.text()).replace(new RegExp('^' + String.fromCharCode(0xfeff)), ''))
      setPreview(buildContactImportPreview(matrix, { existing, book }))
    } catch (e) {
      setError(e?.message || 'อ่านไฟล์ไม่สำเร็จ')
    } finally {
      setReading(false)
    }
  }

  async function doImport() {
    if (!preview || preview.errors.length > 0 || preview.toInsert.length === 0 || saving) return
    setSaving(true); setError('')
    try {
      const payload = buildContactInsertPayload(preview.toInsert, { municipalityId: tenantId, book, startOrder, guessEmoji })
      const { data, error: err } = await supabase.from('emergency_contacts').insert(payload).select()
      if (err) {
        // คงพรีวิวไว้ให้กดซ้ำได้ — insert ทั้งชุดเป็นคำสั่งเดียว ฐานตอบ error = ไม่มีแถวใดถูกบันทึก
        // err.code ว่าง = ไม่ใช่คำตอบจากฐาน (เน็ตหลุดกลางทาง) ผลจริงไม่แน่ชัด จึงให้ตรวจรายการก่อนกดซ้ำกันเบอร์ซ้ำ
        setError(err.code
          ? `นำเข้าไม่สำเร็จ ไม่มี${bookInfo.itemNoun}ใดถูกบันทึก: ${err.message}`
          : `เชื่อมต่อไม่สำเร็จกลางทาง (${err.message}) — ปิดหน้านี้แล้วตรวจรายการในสมุดก่อนกดนำเข้าซ้ำ กันเบอร์ซ้ำ`)
        return
      }
      onImported(data ?? [])
      setDoneCount((data ?? []).length)
      setPreview(null)
    } catch (e) {
      console.error('[contact-import] นำเข้าล้มเหลว:', e?.message ?? e)
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — ปิดหน้านี้แล้วตรวจรายการในสมุดก่อนกดนำเข้าซ้ำ กันเบอร์ซ้ำ')
    } finally {
      setSaving(false)
    }
  }

  const canImport = preview && preview.errors.length === 0 && preview.toInsert.length > 0 && !saving

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4" onClick={() => !saving && onClose()}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col" role="dialog" aria-modal="true"
           aria-label={`นำเข้า${bookInfo.itemNoun}จาก Excel`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3 border-b border-gray-100">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-gray-800 flex items-center gap-2">
              <FileSpreadsheet size={18} style={{ color: 'var(--color-primary)' }} />
              นำเข้า{bookInfo.itemNoun}จาก Excel
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">CSV หรือ XLSX · เพิ่มเข้า{bookInfo.label} · มีพรีวิวก่อนบันทึก</p>
          </div>
          <button type="button" onClick={onClose} disabled={saving} aria-label="ปิด"
                  className="shrink-0 p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 disabled:opacity-50">
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4 space-y-3 min-h-0">
          <p className="rounded-xl bg-gray-50 px-3 py-2 text-xs leading-relaxed text-gray-700">
            แถวแรกคือหัวคอลัมน์ — จำเป็น: <b>ชื่อ</b> · <b>เบอร์โทร</b> · ไม่บังคับ: <b>หมวด</b> (ไม่ใส่ ระบบเดาจากชื่อ) · <b>หมายเหตุ</b> · <b>ยินยอม</b> (พิมพ์ "ใช่" เมื่อเจ้าของเบอร์มือถือยินยอมให้เผยแพร่แล้ว)
            · เบอร์ซ้ำกับที่มีอยู่แล้วหรือซ้ำในไฟล์จะถูกข้าม · ครั้งละไม่เกิน {CONTACT_IMPORT_MAX_ROWS} แถว · ลบแถวตัวอย่างในแม่แบบก่อนนำเข้า
          </p>

          <div className="flex flex-wrap gap-2">
            <label className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-white cursor-pointer transition-all ${saving || reading ? 'opacity-50 pointer-events-none' : ''}`}
                   style={{ backgroundColor: 'var(--color-primary)' }}>
              <FileSpreadsheet size={14} /> เลือกไฟล์
              <input type="file" accept=".csv,.xlsx" className="hidden"
                     onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = '' }} />
            </label>
            <button type="button" onClick={downloadTemplate}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-gray-700 bg-white border border-gray-200 hover:bg-gray-50">
              <Download size={14} /> ดาวน์โหลดแม่แบบ (CSV)
            </button>
          </div>

          {reading && <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 size={14} className="animate-spin" />กำลังอ่าน {fileName}…</p>}
          {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          {doneCount !== null && (
            <p role="status" className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800 flex items-center gap-1.5">
              <Check size={14} /> นำเข้าสำเร็จ {doneCount} รายการ — ต่อท้ายลำดับเดิมแล้ว จัดลำดับ/แก้ไขได้ในรายการด้านล่าง
            </p>
          )}

          {preview?.errors.map((m) => (
            <p key={m} role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{m}</p>
          ))}

          {preview && preview.errors.length === 0 && (
            <>
              <p className="text-sm font-semibold text-gray-800">
                {fileName}: จะเพิ่ม {preview.toInsert.length} · ข้าม {preview.skipped.length} · เตือน {preview.warnings.length}
              </p>
              {consentWarnCount > 0 && (
                <p className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800 leading-relaxed">
                  มี {consentWarnCount} รายการเป็นเบอร์มือถือส่วนตัวที่ยังไม่ได้ระบุความยินยอม — ยังนำเข้าได้ (ไม่บล็อก) แต่จะขึ้นหน้าสาธารณะพร้อมป้ายเตือนในหลังบ้าน
                  ควรเก็บหลักฐานยินยอมจากเจ้าของเบอร์ แล้วติ๊กยินยอมที่รายการนั้นภายหลัง
                </p>
              )}

              {preview.toInsert.length > 0 && (
                <div className="max-h-64 overflow-auto rounded-xl border border-gray-200">
                  <table className="w-full min-w-[480px] border-collapse text-xs">
                    <thead className="sticky top-0 bg-gray-50 text-left text-gray-600">
                      <tr><th className="px-3 py-2">แถว</th><th className="px-3 py-2">ชื่อ</th><th className="px-3 py-2">เบอร์โทร</th><th className="px-3 py-2">หมวด</th><th className="px-3 py-2">หมายเหตุจากระบบ</th></tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {preview.toInsert.map((r) => {
                        const cat = EMERGENCY_CATEGORY_MAP[r.category]
                        const ws = warningsByRow.get(r.rowNo) ?? []
                        return (
                          <tr key={r.rowNo}>
                            <td className="whitespace-nowrap px-3 py-1.5 text-gray-500">{r.rowNo}</td>
                            <td className="px-3 py-1.5 text-gray-800">{r.label}</td>
                            <td className="whitespace-nowrap px-3 py-1.5 font-mono text-gray-800">{r.number}</td>
                            <td className="whitespace-nowrap px-3 py-1.5 text-gray-700">{cat ? `${cat.emoji} ${cat.label}` : r.category}</td>
                            <td className="px-3 py-1.5 space-y-1">
                              {ws.some((w) => w.kind === 'consent') && <ConsentWarnBadge />}
                              {ws.filter((w) => w.kind === 'category').map((w) => <p key={w.reason} className="text-[11px] text-gray-500">{w.reason}</p>)}
                              {r.consent && <span className="text-[11px] text-emerald-700">ยินยอมแล้ว</span>}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {preview.skipped.length > 0 && (
                <div>
                  <p className="text-sm font-semibold text-gray-800 mb-1">ข้าม {preview.skipped.length} แถว (ไม่ถูกนำเข้า)</p>
                  <ul className="max-h-40 overflow-auto rounded-xl border border-gray-200 divide-y divide-gray-100 text-xs">
                    {preview.skipped.map((s) => (
                      <li key={s.rowNo} className="flex gap-2 px-3 py-1.5 bg-red-50/50">
                        <span className="shrink-0 text-gray-500">แถว {s.rowNo}</span>
                        <span className="text-red-700">{s.reason}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {preview.toInsert.length === 0 && (
                <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">ไม่มีแถวที่นำเข้าได้ในไฟล์นี้ — ตรวจเหตุผลด้านบนแล้วเลือกไฟล์ใหม่</p>
              )}
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 px-5 py-3 border-t border-gray-100">
          <button type="button" onClick={onClose} disabled={saving}
                  className="px-4 py-2 rounded-xl text-sm font-semibold text-gray-700 bg-white border border-gray-200 hover:bg-gray-50 disabled:opacity-50">
            {doneCount !== null ? 'ปิด' : 'ยกเลิก'}
          </button>
          <button type="button" onClick={doImport} disabled={!canImport}
                  className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-50"
                  style={{ backgroundColor: 'var(--color-primary)' }}>
            {saving ? <><Loader2 size={14} className="animate-spin" />กำลังนำเข้า…</> : `นำเข้า ${preview?.toInsert.length ?? 0} รายการ`}
          </button>
        </div>
      </div>
    </div>
  )
}
