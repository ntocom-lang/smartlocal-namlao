import { useState } from 'react'
import { X, MapPin, Loader2, ImagePlus, Trash2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { compressImage } from '../../lib/imageUtils'
import MapPicker from '../MapPicker'
import { buildCouncilComplaintHtml } from '../../lib/councilFormPrint'
import { isMissingSignatoryError, prepareComplaintPrint } from '../../lib/complaintPrint'
import { uploadFile } from '../../lib/driveStorage'

const MAX_PHOTOS = 3

export default function OssIntakeForm({ tenant, categoryLabels, onClose }) {
  const [form, setForm] = useState({ category: '', reporter_name: '', phone: '', village: '', detail: '' })
  const [photos, setPhotos] = useState([])
  const [geo, setGeo] = useState({ lat: null, lng: null })
  const [showMap, setShowMap] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null) // { id, ref_no }

  const set = (field) => (e) => setForm((p) => ({ ...p, [field]: e.target.value }))

  function addPhotos(files) {
    const room = MAX_PHOTOS - photos.length
    const picked = Array.from(files).slice(0, room)
    setPhotos((p) => [...p, ...picked.map((file) => ({ file, preview: URL.createObjectURL(file) }))])
  }
  function removePhoto(idx) {
    setPhotos((prev) => { URL.revokeObjectURL(prev[idx].preview); return prev.filter((_, i) => i !== idx) })
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.category) { setError('กรุณาเลือกประเภทคำร้อง'); return }
    if (!form.reporter_name.trim()) { setError('กรุณากรอกชื่อ-นามสกุลผู้แจ้ง'); return }
    if (!form.phone.trim()) { setError('กรุณากรอกเบอร์โทรติดต่อ'); return }
    if (form.detail.trim().length < 10) { setError('กรุณาอธิบายรายละเอียดอย่างน้อย 10 ตัวอักษร'); return }
    if (!tenant?.id) { setError('ไม่พบข้อมูลหน่วยงาน'); return }

    setError(null)
    setSubmitting(true)
    try {
      const complaintId = crypto.randomUUID()
      const { data: inserted, error: dbError } = await supabase.rpc('submit_citizen_complaint_v4', {
        p_id: complaintId,
        p_municipality_id: tenant.id,
        p_category: form.category,
        p_form_type: 'infrastructure',
        p_village: form.village.trim() || null,
        p_detail: form.detail.trim(),
        p_phone: form.phone.trim(),
        p_reporter_name: form.reporter_name.trim(),
        p_latitude: geo.lat,
        p_longitude: geo.lng,
        p_user_id: null,
        p_channel: 'oss_counter',
        p_issue_type: null,
        p_extra_data: null,
      }).single()

      if (dbError) { setError(`เกิดข้อผิดพลาด: ${dbError.message}`); return }

      if (photos.length > 0) {
        const urls = []
        for (const { file } of photos) {
          try {
            let compressed
            try { compressed = await compressImage(file, undefined, 0.85) }
            catch { try { compressed = await compressImage(file, 480, 0.60) } catch { compressed = file } }
            const { url, error: upErr } = await uploadFile('complaint-attachments', compressed, {
              subject: inserted.id,
              filename: `${crypto.randomUUID()}.jpg`,
              municipality: tenant?.slug,
            })
            if (upErr) throw upErr
            urls.push(url)
          } catch (err) {
            console.error('[oss-intake] photo upload failed:', err?.message ?? err)
          }
        }
        if (urls.length > 0) {
          await supabase.rpc('attach_complaint_photos', { p_complaint_id: inserted.id, p_urls: urls }).catch(() => {})
        }
      }

      setResult(inserted)
    } catch (err) {
      setError(err?.message ?? 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง')
    } finally {
      setSubmitting(false)
    }
  }

  async function handlePrintReceipt() {
    if (!result) return
    const w = window.open('', '_blank', 'width=800,height=900')
    if (!w) {
      alert('เบราว์เซอร์บล็อกหน้าต่างพิมพ์ กรุณาอนุญาตป๊อปอัพแล้วลองใหม่')
      return
    }
    let printContextResult = await prepareComplaintPrint(result.id)
    if (printContextResult.error && isMissingSignatoryError(printContextResult.error)) {
      const allowBlank = window.confirm(
        `${printContextResult.error.message}\n\nต้องการพิมพ์แบบเว้นชื่อผู้ลงนามหรือไม่?`,
      )
      if (!allowBlank) { w.close(); return }
      printContextResult = await prepareComplaintPrint(result.id, true)
    }
    if (printContextResult.error) {
      w.close()
      alert('เตรียมแบบพิมพ์ไม่สำเร็จ: ' + printContextResult.error.message)
      return
    }
    const html = buildCouncilComplaintHtml({
      c: {
        id: result.id,
        ref_no: result.ref_no,
        category: form.category,
        detail: form.detail,
        village: form.village,
        reporter_name: form.reporter_name,
        department_id: printContextResult.data?.department_id,
        department: printContextResult.data?.department_name,
        profiles: null,
      },
      tenant,
      terminology: null,
      num: result.ref_no,
      thDate: new Date().toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' }),
      cat: categoryLabels?.[form.category] ?? form.category,
      phone: form.phone,
      signatories: printContextResult.data?.signatories ?? {},
    })
    w.document.write(html)
    w.document.close()
    setTimeout(() => w.print(), 400)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50 px-4 pb-4 md:p-6">
      <div className="w-full max-w-lg bg-white rounded-t-3xl md:rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <h3 className="font-bold text-gray-800">รับแจ้งที่เคาน์เตอร์ (OSS)</h3>
          <button onClick={onClose} className="p-1.5 rounded-xl hover:bg-gray-100">
            <X size={18} className="text-gray-500" />
          </button>
        </div>

        {result ? (
          <div className="p-6 space-y-4 text-center">
            <p className="text-xs text-gray-400">บันทึกคำร้องสำเร็จ — เลขที่อ้างอิง</p>
            <p className="text-3xl font-black text-gray-800 tracking-widest font-mono">{result.ref_no}</p>
            <div className="flex gap-3 pt-2">
              <button onClick={handlePrintReceipt}
                className="flex-1 py-3 rounded-2xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50">
                พิมพ์ใบรับเรื่อง
              </button>
              <button onClick={onClose}
                className="flex-1 py-3 rounded-2xl text-white text-sm font-semibold"
                style={{ backgroundColor: 'var(--color-primary)' }}>
                เสร็จสิ้น
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
            <div className="px-6 py-4 space-y-4">
              {error && (
                <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                  <span className="text-red-500 font-bold text-sm shrink-0">⚠️</span>
                  <p className="text-sm text-red-600 font-medium">{error}</p>
                </div>
              )}
              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1 block">ประเภทคำร้อง *</label>
                <select value={form.category} onChange={set('category')}
                  className="w-full px-4 py-3 rounded-2xl border border-gray-200 text-sm text-gray-900 bg-white focus:outline-none focus:border-blue-400">
                  <option value="">— เลือกประเภท —</option>
                  {Object.entries(categoryLabels ?? {}).map(([v, label]) => (
                    <option key={v} value={v}>{label}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-500 mb-1 block">ชื่อ-นามสกุลผู้แจ้ง *</label>
                  <input value={form.reporter_name} onChange={set('reporter_name')}
                    maxLength={250}
                    className="w-full px-4 py-3 rounded-2xl border border-gray-200 text-sm text-gray-900 bg-white focus:outline-none focus:border-blue-400" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-500 mb-1 block">เบอร์โทร *</label>
                  <input value={form.phone} onChange={set('phone')} type="tel"
                    maxLength={30}
                    className="w-full px-4 py-3 rounded-2xl border border-gray-200 text-sm text-gray-900 bg-white focus:outline-none focus:border-blue-400" />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1 block">หมู่บ้าน/สถานที่</label>
                <input value={form.village} onChange={set('village')} placeholder="เช่น หมู่ 5 บ้านหนองหาร"
                  maxLength={250}
                  className="w-full px-4 py-3 rounded-2xl border border-gray-200 text-sm text-gray-900 bg-white focus:outline-none focus:border-blue-400" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1 block">รายละเอียด *</label>
                <textarea value={form.detail} onChange={set('detail')} rows={3} minLength={10} maxLength={5000}
                  placeholder="อธิบายปัญหาอย่างน้อย 10 ตัวอักษร..."
                  className="w-full px-4 py-3 rounded-2xl border border-gray-200 text-sm text-gray-900 bg-white focus:outline-none focus:border-blue-400 resize-none" />
              </div>
              <div>
                <button type="button" onClick={() => setShowMap(true)}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border-2 border-dashed border-gray-200 text-sm text-gray-500 hover:border-blue-300 hover:bg-blue-50/50 transition-colors">
                  <MapPin size={15} />
                  {geo.lat ? 'ปักหมุดแล้ว — แก้ไขตำแหน่ง' : 'ปักหมุดตำแหน่ง (ถ้ามี)'}
                </button>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-gray-500 block">รูปภาพประกอบ</label>
                  <span className="text-[11px] text-gray-400">{photos.length}/{MAX_PHOTOS}</span>
                </div>
                {photos.length > 0 && (
                  <div className="flex gap-2 mb-2">
                    {photos.map((p, i) => (
                      <div key={i} className="relative w-16 h-16 rounded-xl overflow-hidden border border-gray-200">
                        <img src={p.preview} alt="" className="w-full h-full object-cover" />
                        <button type="button" onClick={() => removePhoto(i)}
                          className="absolute top-0.5 right-0.5 p-0.5 rounded-full bg-black/50 text-white">
                          <Trash2 size={11} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {photos.length < MAX_PHOTOS && (
                  <label className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border-2 border-dashed border-gray-200 cursor-pointer hover:border-blue-300 hover:bg-blue-50/50 transition-colors">
                    <ImagePlus size={15} className="text-gray-400" />
                    <span className="text-xs text-gray-400">แนบรูปภาพ</span>
                    <input type="file" accept="image/*" multiple className="hidden"
                      onChange={(e) => { if (e.target.files?.length) addPhotos(e.target.files); e.target.value = '' }} />
                  </label>
                )}
              </div>
            </div>
            <div className="border-t border-gray-100 shrink-0 px-6 py-4 flex gap-3">
              <button type="button" onClick={onClose} disabled={submitting}
                className="flex-1 py-3 rounded-2xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                ยกเลิก
              </button>
              <button type="submit" disabled={submitting}
                className="flex-1 py-3 rounded-2xl text-white text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
                style={{ backgroundColor: 'var(--color-primary)' }}>
                {submitting ? <Loader2 size={16} className="animate-spin" /> : 'บันทึกคำร้อง'}
              </button>
            </div>
          </form>
        )}

        {showMap && (
          <MapPicker
            initialPos={geo.lat ? { lat: geo.lat, lng: geo.lng } : null}
            fallbackPos={tenant?.latitude ? { lat: tenant.latitude, lng: tenant.longitude } : null}
            onConfirm={({ lat, lng }) => { setGeo({ lat, lng }); setShowMap(false) }}
            onClose={() => setShowMap(false)}
          />
        )}
      </div>
    </div>
  )
}
