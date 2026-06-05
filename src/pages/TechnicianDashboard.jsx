import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Loader2, LogOut, MapPin, Phone, X, RefreshCw,
  CheckCircle2, Image, AlignLeft, ChevronRight, Wrench, Printer,
  Plus, ChevronDown,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useTenant } from '../contexts/TenantContext'
import { fmtNo } from '../lib/formatComplaintNo'
import MapPicker from '../components/MapPicker'

const STATUS = {
  pending:     { label: 'รอดำเนินการ',    bg: '#fef3c7', text: '#92400e' },
  received:    { label: 'รับเรื่องแล้ว',   bg: '#dbeafe', text: '#1e40af' },
  in_progress: { label: 'กำลังดำเนินการ', bg: '#ede9fe', text: '#5b21b6' },
  completed:   { label: 'เสร็จสิ้น',      bg: '#d1fae5', text: '#065f46' },
  rejected:    { label: 'ปฏิเสธ',         bg: '#fee2e2', text: '#991b1b' },
}

const NEXT_ACTION = {
  pending:     { label: 'รับงาน',      next: 'received' },
  received:    { label: 'เริ่มดำเนินการ', next: 'in_progress' },
  in_progress: { label: 'ปิดงาน',     next: 'completed' },
}

const CATEGORY_LABEL = {
  road: 'ซ่อมแซมถนน', light: 'ไฟฟ้าสาธารณะ',
  trash: 'ขยะ/ความสะอาด', water: 'น้ำประปา',
  flood: 'น้ำท่วม/ระบายน้ำ', tree: 'ตัดต้นไม้',
  noise: 'แจ้งเหตุรำคาญ', drain: 'ท่อระบายน้ำ',
  waste_water: 'น้ำเสีย', suction: 'ดูดสิ่งปฏิกูล',
  manhole: 'ฝาท่อระบายน้ำ', vendor: 'ขายของบนทางสาธารณะ',
  building: 'ตรวจสอบอาคาร', mosquito: 'พ่นยุง',
  pollution: 'กลิ่นควัน/มลพิษ', corruption: 'แจ้งการทุจริต',
  tax: 'ภาษีและค่าธรรมเนียม', canal: 'ลอกคลอง',
  animals: 'สุนัขและแมวจรจัด', water_supply: 'สนับสนุนน้ำอุปโภค',
  borrow_equipment: 'ยืมพัสดุ', grievance: 'ร้องทุกข์/ร้องเรียน',
  other: 'อื่นๆ',
}

const CATEGORY_EMOJI = {
  road: '🛣️', light: '💡', trash: '🗑️', water: '🚰',
  flood: '🌊', tree: '🌳', noise: '📢', drain: '🕳️',
  waste_water: '💧', suction: '🚛', manhole: '⚙️', vendor: '🏪',
  building: '🏗️', mosquito: '🦟', pollution: '🌫️', corruption: '⚖️',
  tax: '📋', canal: '🏞️', animals: '🐕', water_supply: '🚿',
  borrow_equipment: '📦', grievance: '📣', other: '📝',
}

// ── badge helpers ────────────────────────────────────────────────────────────
function getSeenIds() {
  try { return new Set(JSON.parse(localStorage.getItem('sl_tech_seen') ?? '[]')) }
  catch { return new Set() }
}

function markSeen(id) {
  const seen = getSeenIds()
  seen.add(id)
  localStorage.setItem('sl_tech_seen', JSON.stringify([...seen]))
}

function emitTechBadge(list) {
  const seen = getSeenIds()
  const count = list.filter(c => c.status !== 'completed' && !seen.has(c.id)).length
  localStorage.setItem('sl_tech_new', String(count))
  window.dispatchEvent(new CustomEvent('tech-badge-update', { detail: count }))
}

const STATUS_FLOW = ['pending', 'received', 'in_progress', 'completed']
const STATUS_FLOW_LABEL = {
  pending:     { label: 'รอดำเนินการ',    desc: 'คำร้องของคุณถูกส่งเข้าระบบแล้ว' },
  received:    { label: 'รับเรื่องแล้ว',   desc: 'เจ้าหน้าที่รับทราบและตรวจสอบ' },
  in_progress: { label: 'กำลังดำเนินการ', desc: 'อยู่ระหว่างดำเนินการแก้ไข' },
  completed:   { label: 'เสร็จสิ้น',      desc: 'ดำเนินการเสร็จสิ้นเรียบร้อย' },
}

function StatusStepper({ status }) {
  const currentIdx = STATUS_FLOW.indexOf(status)
  return (
    <div className="space-y-0">
      {STATUS_FLOW.map((step, i) => {
        const done = i <= currentIdx
        const isCurrent = i === currentIdx
        const isLast = i === STATUS_FLOW.length - 1
        const info = STATUS_FLOW_LABEL[step]
        return (
          <div key={step} className="flex gap-4">
            <div className="flex flex-col items-center">
              <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 border-2 transition-all mt-1"
                   style={done
                     ? { backgroundColor: '#2563eb', borderColor: '#2563eb' }
                     : { backgroundColor: '#fff', borderColor: '#e5e7eb' }}>
                {done && !isCurrent ? (
                  <CheckCircle2 size={14} className="text-white" />
                ) : isCurrent ? (
                  <div className="w-2.5 h-2.5 rounded-full bg-white" />
                ) : (
                  <div className="w-2.5 h-2.5 rounded-full bg-gray-200" />
                )}
              </div>
              {!isLast && (
                <div className="w-0.5 flex-1 my-1 rounded-full"
                     style={{ backgroundColor: i < currentIdx ? '#2563eb' : '#e5e7eb', minHeight: '28px' }} />
              )}
            </div>
            <div className={`pb-5 pt-0.5 ${isLast ? 'pb-0' : ''}`}>
              <p className={`text-sm font-semibold ${done ? 'text-gray-800' : 'text-gray-300'}`}>
                {info.label}
                {isCurrent && (
                  <span className="ml-2 text-[13px] font-medium px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700">
                    ปัจจุบัน
                  </span>
                )}
              </p>
              <p className={`text-xs mt-0.5 ${done ? 'text-gray-400' : 'text-gray-200'}`}>{info.desc}</p>
            </div>
          </div>
        )
      })}
    </div>
  )
}


function DetailSheet({ complaint: c, onClose, onUpdate, updating, tenantName, tenantLogo }) {
  const [note, setNote] = useState(c.technician_note ?? '')
  const [photos, setPhotos] = useState(c.work_photos ?? [])
  const [uploading, setUploading] = useState(false)
  const [savingNote, setSavingNote] = useState(false)

  const action = NEXT_ACTION[c.status]
  const catLabel = CATEGORY_LABEL[c.category] ?? c.category
  const catEmoji = CATEGORY_EMOJI[c.category] ?? '📄'

  function handlePrint() {
    const dateStr = new Date(c.created_at).toLocaleDateString('th-TH', { day: '2-digit', month: 'long', year: 'numeric' })
    const printDateStr = new Date().toLocaleDateString('th-TH', { day: '2-digit', month: 'long', year: 'numeric' })
    const complaintNo = fmtNo(c.complaint_number, c.created_at)
    const location = c.location_name || c.village || '—'

    // สร้าง row สำหรับตาราง fields
    const tr = (label, value) => `
      <tr>
        <td style="padding:5px 8px;font-weight:bold;white-space:nowrap;width:170px;vertical-align:top;border:1px solid #999;">${label}</td>
        <td style="padding:5px 8px;border:1px solid #999;">${value ?? '—'}</td>
      </tr>`

    const html = `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8"/>
<title>คำร้อง ${complaintNo}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: 'TH Sarabun New', 'Sarabun', 'Tahoma', sans-serif; font-size:16pt; color:#000; background:#fff; }
  @page { size:A4; margin:15mm 18mm 15mm 18mm; }
  @media print { body { font-size:14pt; } }
  table { border-collapse:collapse; width:100%; }
</style>
</head>
<body style="padding:12mm 16mm 10mm;">

  <!-- เลขที่ + วันที่ มุมขวา -->
  <div style="text-align:right; font-size:13pt; margin-bottom:6px; line-height:1.7;">
    <span>เลขที่คำร้อง&nbsp;&nbsp;<strong>${complaintNo}</strong></span><br/>
    <span>วันที่รับแจ้ง&nbsp;&nbsp;${dateStr}</span>
  </div>

  <!-- หัวเอกสาร -->
  <table style="border:none; margin-bottom:0;">
    <tr>
      <td style="border:none; width:80px; text-align:center; vertical-align:middle;">
        ${tenantLogo ? `<img src="${tenantLogo}" style="width:68px;height:68px;object-fit:contain;" alt=""/>` : ''}
      </td>
      <td style="border:none; text-align:center; vertical-align:middle; padding-bottom:4px;">
        <div style="font-size:18pt; font-weight:bold; line-height:1.4;">${tenantName ?? 'หน่วยงานปกครองส่วนท้องถิ่น'}</div>
        <div style="font-size:15pt; font-weight:bold; margin-top:2px;">แบบรับแจ้งปัญหา / คำร้องทั่วไป</div>
      </td>
      <td style="border:none; width:80px;"></td>
    </tr>
  </table>
  <hr style="border:none;border-top:3px solid #000;margin:6px 0 10px;"/>

  <!-- ส่วนที่ 1 -->
  <div style="background:#000;color:#fff;font-weight:bold;font-size:13pt;padding:3px 10px;margin-bottom:6px;">
    ส่วนที่ ๑ &nbsp;ข้อมูลผู้แจ้ง
  </div>
  <table style="margin-bottom:10px;">
    ${tr('ชื่อ – นามสกุล', c.reporter_name)}
    ${tr('หมายเลขโทรศัพท์', c.phone)}
  </table>

  <!-- ส่วนที่ 2 -->
  <div style="background:#000;color:#fff;font-weight:bold;font-size:13pt;padding:3px 10px;margin-bottom:6px;">
    ส่วนที่ ๒ &nbsp;รายละเอียดคำร้อง
  </div>
  <table style="margin-bottom:6px;">
    ${tr('ประเภทปัญหา', catLabel)}
    ${c.subject ? tr('เรื่อง', c.subject) : ''}
    ${tr('จุดเกิดเหตุ / สถานที่', location)}
    ${c.latitude ? tr('พิกัด GPS', `${c.latitude.toFixed(5)}, ${c.longitude.toFixed(5)}`) : ''}
  </table>
  <div style="font-weight:bold;margin-bottom:4px;">รายละเอียดปัญหา</div>
  <div style="border:1px solid #000;min-height:64px;padding:6px 10px;line-height:1.8;white-space:pre-wrap;margin-bottom:10px;">${c.detail}</div>

  <!-- ส่วนที่ 3 -->
  <div style="background:#000;color:#fff;font-weight:bold;font-size:12pt;padding:2px 10px;margin-bottom:5px;">
    ส่วนที่ ๓ &nbsp;สำหรับเจ้าหน้าที่
  </div>
  <table style="margin-bottom:5px;font-size:13pt;">
    <tr>
      <td style="padding:3px 8px;font-weight:bold;white-space:nowrap;width:170px;border:1px solid #999;">วันที่รับเรื่อง</td>
      <td style="padding:3px 8px;border:1px solid #999;"></td>
    </tr>
    <tr>
      <td style="padding:3px 8px;font-weight:bold;white-space:nowrap;border:1px solid #999;">ผู้รับผิดชอบ / ช่าง</td>
      <td style="padding:3px 8px;border:1px solid #999;"></td>
    </tr>
  </table>
  <div style="font-weight:bold;font-size:13pt;margin-bottom:3px;">บันทึกการดำเนินการ</div>
  <div style="border:1px solid #000;min-height:56px;padding:5px 10px;font-size:13pt;line-height:1.7;white-space:pre-wrap;margin-bottom:14px;">${c.technician_note ?? ''}</div>

  <!-- ลายมือชื่อ เฉพาะเจ้าหน้าที่ -->
  <table style="border:none;margin-top:4px;font-size:13pt;">
    <tr>
      <td style="border:none;width:50%;padding:0 8px 0 0;">
        <div style="border-bottom:1px solid #000;height:36px;margin-bottom:5px;"></div>
        <div style="text-align:center;">(&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;)</div>
        <div style="text-align:center;font-weight:bold;">เจ้าหน้าที่ผู้รับเรื่อง</div>
        <div style="text-align:center;">วันที่ .................................</div>
      </td>
      <td style="border:none;width:50%;padding:0 0 0 8px;">
        <div style="border-bottom:1px solid #000;height:36px;margin-bottom:5px;"></div>
        <div style="text-align:center;">(&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;)</div>
        <div style="text-align:center;font-weight:bold;">ผู้อนุมัติ / หัวหน้างาน</div>
        <div style="text-align:center;">วันที่ .................................</div>
      </td>
    </tr>
  </table>

  <hr style="border:none;border-top:1px solid #ccc;margin-top:14px;margin-bottom:4px;"/>
  <div style="text-align:center;font-size:11pt;color:#666;">
    พิมพ์เมื่อ ${printDateStr} &nbsp;·&nbsp; SmartLocal E-Service &nbsp;·&nbsp; ${tenantName ?? ''}
  </div>

<script>window.onload = () => { window.print(); }</script>
</body>
</html>`

    const w = window.open('', '_blank', 'width=820,height=1100')
    w.document.write(html)
    w.document.close()
  }

  async function uploadPhoto(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    const path = `${c.id}/work_${Date.now()}.${file.name.split('.').pop()}`
    const { error: upErr } = await supabase.storage
      .from('complaint-attachments')
      .upload(path, file, { upsert: false })
    if (!upErr) {
      const { data } = supabase.storage.from('complaint-attachments').getPublicUrl(path)
      const newPhotos = [...photos, data.publicUrl]
      setPhotos(newPhotos)
      await supabase.from('complaints').update({ work_photos: newPhotos }).eq('id', c.id)
    }
    setUploading(false)
    e.target.value = ''
  }

  async function saveNote() {
    setSavingNote(true)
    await supabase.from('complaints').update({ technician_note: note }).eq('id', c.id)
    setSavingNote(false)
  }

  const needsPhoto = c.status === 'in_progress' && photos.length === 0

  return (
    <div className="fixed inset-0 z-60 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full sm:max-w-lg bg-white sm:rounded-2xl rounded-t-3xl shadow-2xl max-h-[92dvh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="shrink-0 px-5 pt-6 pb-5"
             style={{ background: 'linear-gradient(135deg, #1d4ed8 0%, #2563eb 100%)' }}>
          <div className="absolute top-4 right-4 flex gap-2">
            <button onClick={handlePrint}
              className="p-2 rounded-xl bg-white/20 hover:bg-white/30 text-white transition-colors"
              title="พิมพ์">
              <Printer size={16} />
            </button>
            <button onClick={onClose}
              className="p-2 rounded-xl bg-white/20 hover:bg-white/30 text-white transition-colors">
              <X size={16} />
            </button>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-2xl bg-white/20 flex items-center justify-center text-2xl shrink-0">
              {catEmoji}
            </div>
            <div className="flex-1 min-w-0 pr-10">
              <p className="text-white/70 text-xs">งานที่ได้รับมอบหมาย</p>
              <p className="text-white font-bold text-base mt-0.5">{catLabel}</p>
              {c.subject && <p className="text-white/80 text-sm mt-1">{c.subject}</p>}
              {c.reporter_name && (
                <p className="text-white/60 text-xs mt-1">ผู้แจ้ง: {c.reporter_name}</p>
              )}
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-white/20 flex justify-between items-center">
            <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold"
                  style={{ backgroundColor: STATUS[c.status]?.bg, color: STATUS[c.status]?.text }}>
              {STATUS[c.status]?.label}
            </span>
            <p className="text-white/70 text-xs">
              {new Date(c.created_at).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: 'numeric' })}
            </p>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5 bg-white">

          {/* ความคืบหน้า */}
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">ความคืบหน้า</p>
            <StatusStepper status={c.status} />
          </div>

          {/* รายละเอียด */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">รายละเอียดปัญหา</p>
            <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100">
              <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{c.detail}</p>
            </div>
          </div>

          {/* สถานที่ + โทร */}
          {(c.location_name || c.village || c.phone || c.latitude) && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">จุดเกิดเหตุ</p>
              <div className="bg-gray-50 rounded-2xl divide-y divide-gray-100 overflow-hidden border border-gray-100">
                {(c.location_name || c.village) && (
                  <div className="flex items-center gap-3 px-4 py-3">
                    <MapPin size={15} className="text-orange-400 shrink-0" />
                    <p className="text-sm text-gray-700">{c.location_name ?? c.village}</p>
                  </div>
                )}
                {c.phone && (
                  <a href={`tel:${c.phone}`}
                     className="flex items-center gap-3 px-4 py-3 hover:bg-gray-100 transition-colors">
                    <Phone size={15} className="text-green-500 shrink-0" />
                    <p className="text-sm font-bold text-gray-800 flex-1">{c.phone}</p>
                    <span className="text-xs font-semibold px-2 py-1 bg-green-100 text-green-700 rounded-lg">โทรออก</span>
                  </a>
                )}
                {c.latitude && (
                  <a href={`https://maps.google.com/?q=${c.latitude},${c.longitude}`}
                     target="_blank" rel="noreferrer"
                     className="flex items-center gap-3 px-4 py-3 hover:bg-gray-100 transition-colors">
                    <MapPin size={15} className="text-blue-500 shrink-0" />
                    <p className="text-sm text-gray-700 flex-1">
                      {c.latitude.toFixed(5)}, {c.longitude.toFixed(5)}
                    </p>
                    <span className="text-xs font-semibold px-2 py-1 bg-blue-100 text-blue-700 rounded-lg">แผนที่</span>
                  </a>
                )}
              </div>
            </div>
          )}

          {/* รูปจากประชาชน */}
          {(c.attachments ?? []).length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">รูปจากประชาชน</p>
              <div className="grid grid-cols-3 gap-2">
                {c.attachments.map((url, i) => (
                  <a key={i} href={url} target="_blank" rel="noreferrer"
                     className="aspect-square rounded-xl overflow-hidden border border-gray-200 bg-gray-100">
                    <img src={url} alt="" className="w-full h-full object-cover" />
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* รูปหลักฐานช่าง */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                รูปหลักฐานการทำงาน {photos.length > 0 && `(${photos.length})`}
              </p>
              {c.status !== 'completed' && c.status !== 'rejected' && (
                <label className="cursor-pointer flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors">
                  {uploading
                    ? <Loader2 size={13} className="animate-spin" />
                    : <Image size={13} />}
                  {uploading ? 'กำลังอัปโหลด...' : 'ถ่ายรูป / เพิ่มรูป'}
                  <input type="file" accept="image/*" capture="environment"
                         className="hidden" onChange={uploadPhoto} disabled={uploading} />
                </label>
              )}
            </div>
            {photos.length > 0 ? (
              <div className="grid grid-cols-3 gap-2">
                {photos.map((url, i) => (
                  <a key={i} href={url} target="_blank" rel="noreferrer"
                     className="aspect-square rounded-xl overflow-hidden border border-blue-200 bg-blue-50">
                    <img src={url} alt="" className="w-full h-full object-cover" />
                  </a>
                ))}
              </div>
            ) : (
              <div className="flex items-center justify-center py-6 rounded-2xl border-2 border-dashed border-gray-200 text-gray-400">
                <div className="text-center">
                  <Image size={24} className="mx-auto mb-1 opacity-50" />
                  <p className="text-xs">ยังไม่มีรูปหลักฐาน</p>
                </div>
              </div>
            )}
          </div>

          {/* บันทึกของช่าง */}
          {c.status !== 'completed' && c.status !== 'rejected' && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">บันทึกของช่าง</p>
              <div className="flex gap-2">
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                  placeholder="บันทึกรายละเอียดการดำเนินการ..."
                  className="flex-1 border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-800 bg-white resize-none focus:outline-none focus:ring-2"
                  style={{ '--tw-ring-color': '#2563eb' }}
                />
                <button onClick={saveNote} disabled={savingNote}
                        className="self-end px-3 py-2 rounded-xl text-xs font-semibold bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors disabled:opacity-50">
                  {savingNote ? <Loader2 size={13} className="animate-spin" /> : 'บันทึก'}
                </button>
              </div>
            </div>
          )}

          {/* บันทึกที่บันทึกไว้แล้ว (completed) */}
          {c.status === 'completed' && c.technician_note && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">บันทึกของช่าง</p>
              <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100">
                <p className="text-sm text-gray-700 whitespace-pre-wrap">{c.technician_note}</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {c.status !== 'completed' && c.status !== 'rejected' && (
          <div className="px-5 py-4 border-t border-gray-100 bg-gray-50 shrink-0 space-y-2">
            {needsPhoto && (
              <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-center">
                กรุณาถ่ายรูปหลักฐานก่อนปิดงาน
              </p>
            )}
            {action && (
              <button
                onClick={() => onUpdate(c.id, action.next, action.next === 'completed' ? photos : null, action.next === 'completed' ? note : null)}
                disabled={updating === c.id || (action.next === 'completed' && needsPhoto)}
                className="w-full py-3 rounded-2xl text-sm font-bold text-white transition-all active:scale-98 disabled:opacity-50"
                style={{ backgroundColor: action.next === 'completed' ? '#10b981' : '#2563eb' }}>
                {updating === c.id
                  ? <Loader2 size={16} className="animate-spin mx-auto" />
                  : action.next === 'completed'
                    ? `✅ ${action.label}`
                    : `${action.label} →`}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function TechnicianDashboard() {
  const { tenant } = useTenant()
  const navigate = useNavigate()
  const [complaints, setComplaints] = useState([])
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(null)
  const [selected, setSelected] = useState(null)
  const [myName, setMyName] = useState('')
  const [seenIds, setSeenIds] = useState(getSeenIds)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) return
      supabase.from('profiles').select('full_name, role').eq('id', data.session.user.id).single()
        .then(({ data: p }) => {
          if (p?.role !== 'technician') navigate('/')
          setMyName(p?.full_name ?? 'ช่าง')
        })
    })
  }, [navigate])

  const fetchComplaints = useCallback(async () => {
    if (!tenant?.id) return
    setLoading(true)
    const { data: session } = await supabase.auth.getSession()
    if (!session.session) { setLoading(false); return }
    const { data } = await supabase
      .from('complaints')
      .select('*')
      .eq('municipality_id', tenant.id)
      .eq('assigned_to', session.session.user.id)
      .neq('status', 'rejected')
      .order('created_at', { ascending: false })
    setComplaints(data ?? [])
    emitTechBadge(data ?? [])
    setLoading(false)
  }, [tenant?.id])

  useEffect(() => { fetchComplaints() }, [fetchComplaints])

  async function updateStatus(id, nextStatus, workPhotos = null, techNote = null) {
    setUpdating(id)
    const payload = { status: nextStatus }
    if (workPhotos?.length > 0) payload.work_photos = workPhotos
    if (techNote !== null) payload.technician_note = techNote
    const { error } = await supabase
      .from('complaints')
      .update(payload)
      .eq('id', id)
    if (!error) {
      const updated = complaints.map((c) => c.id === id ? { ...c, ...payload } : c)
      setComplaints(updated)
      emitTechBadge(updated)
      setSelected(null)
    }
    setUpdating(null)
  }

  function handleOpenComplaint(c) {
    markSeen(c.id)
    const updated = getSeenIds()
    setSeenIds(updated)
    emitTechBadge(complaints)
    setSelected(c)
  }

  // ─── Engineer GPS Tool state ─────────────────────────────────────────────
  const [showInfraForm, setShowInfraForm] = useState(false)
  const [infraForm, setInfraForm] = useState({
    title: '', category: 'road', description: '', budget: '', location_name: '', work_date: new Date().toISOString().split('T')[0],
  })
  const [infraGeo, setInfraGeo] = useState({ lat: null, lng: null })
  const [infraPhotos, setInfraPhotos] = useState([])
  const [showInfraMap, setShowInfraMap] = useState(false)
  const [infraSubmitting, setInfraSubmitting] = useState(false)
  const [infraError, setInfraError] = useState(null)
  const [infraWorks, setInfraWorks] = useState([])
  const [loadingInfra, setLoadingInfra] = useState(false)

  const INFRA_CATEGORIES = [
    { value: 'road',        label: '🛣️  ถนน / สะพาน' },
    { value: 'drainage',    label: '🕳️  ระบบระบายน้ำ' },
    { value: 'electrical',  label: '💡  ไฟฟ้า / แสงสว่าง' },
    { value: 'waterway',    label: '🏞️  ลำเหมือง / คูน้ำ' },
    { value: 'building',    label: '🏗️  อาคาร / สิ่งก่อสร้าง' },
    { value: 'irrigation',  label: '💧  ระบบชลประทาน' },
    { value: 'other',       label: '📝  อื่นๆ' },
  ]

  const fetchInfraWorks = useCallback(async () => {
    if (!tenant?.id) return
    setLoadingInfra(true)
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { setLoadingInfra(false); return }
    const { data } = await supabase
      .from('infrastructure_works')
      .select('*')
      .eq('municipality_id', tenant.id)
      .eq('created_by', session.user.id)
      .order('work_date', { ascending: false })
      .limit(20)
    setInfraWorks(data ?? [])
    setLoadingInfra(false)
  }, [tenant?.id])

  async function handleInfraPhotos(e) {
    const files = Array.from(e.target.files ?? [])
    const items = files.map((f) => ({ file: f, preview: URL.createObjectURL(f) }))
    setInfraPhotos((prev) => [...prev, ...items].slice(0, 4))
    e.target.value = ''
  }

  async function submitInfraWork(e) {
    e.preventDefault()
    if (!infraForm.title.trim()) { setInfraError('กรุณาระบุชื่องาน'); return }
    if (!infraGeo.lat) { setInfraError('กรุณาปักหมุด GPS ตำแหน่งงานก่อนบันทึก'); return }
    setInfraError(null)
    setInfraSubmitting(true)
    const { data: { session } } = await supabase.auth.getSession()
    const id = crypto.randomUUID()
    const photoUrls = []
    for (const item of infraPhotos) {
      const ext = item.file.name.split('.').pop()
      const path = `infra/${id}/${Date.now()}.${ext}`
      const { error } = await supabase.storage.from('complaint-attachments').upload(path, item.file)
      if (!error) {
        const { data } = supabase.storage.from('complaint-attachments').getPublicUrl(path)
        photoUrls.push(data.publicUrl)
      }
    }
    const { error: dbErr } = await supabase.from('infrastructure_works').insert({
      id,
      municipality_id: tenant.id,
      created_by:      session.user.id,
      title:           infraForm.title.trim(),
      category:        infraForm.category,
      description:     infraForm.description.trim() || null,
      budget:          infraForm.budget ? parseFloat(infraForm.budget) : null,
      location_name:   infraForm.location_name.trim() || null,
      work_date:       infraForm.work_date,
      latitude:        infraGeo.lat,
      longitude:       infraGeo.lng,
      photos:          photoUrls,
      status:          'completed',
    })
    setInfraSubmitting(false)
    if (dbErr) { setInfraError(`บันทึกไม่สำเร็จ: ${dbErr.message}`); return }
    setInfraForm({ title: '', category: 'road', description: '', budget: '', location_name: '', work_date: new Date().toISOString().split('T')[0] })
    setInfraGeo({ lat: null, lng: null })
    setInfraPhotos([])
    setShowInfraForm(false)
    fetchInfraWorks()
  }

  useEffect(() => { fetchInfraWorks() }, [fetchInfraWorks])

  const pending = complaints.filter((c) => c.status !== 'completed')
  const done = complaints.filter((c) => c.status === 'completed')

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 pb-24 md:pb-8 space-y-6">
      {selected && (
        <DetailSheet
          complaint={selected}
          onClose={() => setSelected(null)}
          onUpdate={updateStatus}
          updating={updating}
          tenantName={tenant?.name}
          tenantLogo={tenant?.logo_url}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-800">งานของฉัน</h1>
          <p className="text-sm text-gray-400">{myName} · {tenant?.name}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchComplaints} disabled={loading}
            className="p-2 rounded-xl border border-gray-200 bg-white text-gray-500 hover:bg-gray-50 transition-colors disabled:opacity-50">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
          <button onClick={async () => { await supabase.auth.signOut(); navigate('/') }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium border border-red-200 text-red-500 bg-white hover:bg-red-50 transition-colors">
            <LogOut size={14} />
            ออก
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 size={24} className="animate-spin text-gray-300" />
        </div>
      ) : complaints.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Wrench size={40} className="mx-auto mb-3 opacity-30" />
          <p className="font-medium text-gray-500">ยังไม่มีงานที่ได้รับมอบหมาย</p>
          <p className="text-sm mt-1">เมื่อ Admin มอบหมายงานให้ จะแสดงที่นี่</p>
        </div>
      ) : (
        <>
          {/* งานที่ยังค้างอยู่ */}
          {pending.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                งานที่รอดำเนินการ ({pending.length})
              </p>
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                {pending.map((c, i) => {
                  const s = STATUS[c.status]
                  return (
                    <button key={c.id} onClick={() => handleOpenComplaint(c)}
                      className={`w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-gray-50 transition-colors active:bg-gray-100 ${i < pending.length - 1 ? 'border-b border-gray-50' : ''}`}>
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0 bg-gray-100">
                        {CATEGORY_EMOJI[c.category] ?? '📄'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-800 truncate">
                          <span className="text-gray-400 font-mono font-normal mr-1">{i + 1}.</span>
                          {CATEGORY_LABEL[c.category] ?? c.category}
                        </p>
                        <p className="text-xs text-gray-500 mt-0.5 truncate font-medium">
                          {c.location_name || c.village || '—'}
                        </p>
                        <p className="text-xs text-gray-400 truncate">{c.detail}</p>
                      </div>
                      <div className="flex flex-col items-end gap-1.5 shrink-0">
                        <div className="flex items-center gap-1.5">
                          {!seenIds.has(c.id) && (
                            <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
                          )}
                          <span className="text-[13px] font-semibold px-2 py-0.5 rounded-full"
                                style={{ backgroundColor: s?.bg, color: s?.text }}>
                            {s?.label}
                          </span>
                        </div>
                        <ChevronRight size={14} className="text-gray-300" />
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* งานที่เสร็จแล้ว */}
          {done.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                เสร็จสิ้นแล้ว ({done.length})
              </p>
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden opacity-70">
                {done.map((c, i) => (
                  <button key={c.id} onClick={() => handleOpenComplaint(c)}
                    className={`w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-gray-50 transition-colors ${i < done.length - 1 ? 'border-b border-gray-50' : ''}`}>
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0 bg-green-50">
                      {CATEGORY_EMOJI[c.category] ?? '📄'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-600 truncate">
                        <span className="text-gray-400 font-mono font-normal mr-1">{i + 1}.</span>
                        {CATEGORY_LABEL[c.category] ?? c.category}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5 truncate">{c.detail}</p>
                    </div>
                    <CheckCircle2 size={18} className="text-green-500 shrink-0" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* ─── Engineer GPS Tool ─── */}
      {showInfraMap && (
        <MapPicker
          initialPos={infraGeo.lat ? { lat: infraGeo.lat, lng: infraGeo.lng } : null}
          onConfirm={({ lat, lng, address }) => {
            setInfraGeo({ lat, lng })
            if (address && !infraForm.location_name) setInfraForm(p => ({ ...p, location_name: address }))
            setShowInfraMap(false)
          }}
          onClose={() => setShowInfraMap(false)}
        />
      )}

      <div className="space-y-3">
        {/* Section header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-violet-100 flex items-center justify-center">
              <Wrench size={15} className="text-violet-600" />
            </div>
            <div>
              <p className="text-sm font-bold text-gray-700">บันทึกงานโยธาหน้างาน</p>
              <p className="text-xs text-gray-400">Engineer GPS · กองช่างปลั๊กอิน</p>
            </div>
          </div>
          <button
            onClick={() => setShowInfraForm(v => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-white transition-all"
            style={{ backgroundColor: '#8b5cf6' }}>
            {showInfraForm ? <ChevronDown size={13} /> : <Plus size={13} />}
            {showInfraForm ? 'ซ่อน' : 'บันทึกงาน'}
          </button>
        </div>

        {/* Form */}
        {showInfraForm && (
          <form onSubmit={submitInfraWork}
            className="bg-white rounded-2xl border border-violet-100 shadow-sm p-4 space-y-3">

            {/* Category + title */}
            <div className="flex flex-wrap gap-1.5">
              {INFRA_CATEGORIES.map((cat) => (
                <button key={cat.value} type="button"
                  onClick={() => setInfraForm(p => ({ ...p, category: cat.value }))}
                  className="text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-all"
                  style={infraForm.category === cat.value
                    ? { backgroundColor: '#8b5cf6', color: '#fff', borderColor: '#8b5cf6' }
                    : { backgroundColor: '#f8fafc', color: '#64748b', borderColor: '#e2e8f0' }}>
                  {cat.label}
                </button>
              ))}
            </div>

            <input type="text" value={infraForm.title}
              onChange={e => setInfraForm(p => ({ ...p, title: e.target.value }))} required
              placeholder="ชื่องาน เช่น ซ่อมถนนลาดยางหมู่ที่ 3"
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-300" />

            {/* GPS — บังคับ */}
            <div className={`rounded-xl border p-3 ${infraGeo.lat ? 'bg-green-50 border-green-200' : 'bg-violet-50 border-violet-200'}`}>
              <div className="flex items-center gap-2 mb-2">
                <MapPin size={14} className={infraGeo.lat ? 'text-green-600' : 'text-violet-600'} />
                <span className="text-xs font-semibold text-gray-700">พิกัด GPS หน้างาน</span>
                <span className="ml-auto text-[10px] font-bold text-violet-700 bg-violet-100 px-2 py-0.5 rounded-full">* บังคับ</span>
              </div>
              <button type="button" onClick={() => setShowInfraMap(true)}
                className={`w-full py-2 rounded-lg text-xs font-medium border transition-all ${
                  infraGeo.lat
                    ? 'bg-white border-green-200 text-green-700'
                    : 'bg-white border-violet-200 text-violet-700'
                }`}>
                {infraGeo.lat
                  ? `📍 ${infraGeo.lat.toFixed(5)}, ${infraGeo.lng.toFixed(5)} — กดแก้ไข`
                  : '📍 กดปักหมุด GPS ตำแหน่งงาน'}
              </button>
            </div>

            <input type="text" value={infraForm.location_name}
              onChange={e => setInfraForm(p => ({ ...p, location_name: e.target.value }))}
              placeholder="ชื่อสถานที่ / หมู่บ้าน"
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-300" />

            <div className="grid grid-cols-2 gap-2">
              <input type="number" value={infraForm.budget}
                onChange={e => setInfraForm(p => ({ ...p, budget: e.target.value }))}
                placeholder="งบประมาณ (บาท)"
                className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-300" />
              <input type="date" value={infraForm.work_date}
                onChange={e => setInfraForm(p => ({ ...p, work_date: e.target.value }))}
                className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-300" />
            </div>

            <textarea value={infraForm.description}
              onChange={e => setInfraForm(p => ({ ...p, description: e.target.value }))} rows={2}
              placeholder="รายละเอียดงาน (ไม่บังคับ)"
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 resize-none focus:outline-none focus:ring-2 focus:ring-violet-300" />

            {/* Photos */}
            <label className="flex items-center gap-2 cursor-pointer border border-dashed border-gray-200 rounded-xl px-4 py-2.5 hover:bg-gray-50 transition-colors">
              <Image size={15} className="text-gray-400" />
              <span className="text-xs text-gray-500">แนบรูปภาพงาน (ไม่เกิน 4 รูป)</span>
              <input type="file" accept="image/*" multiple className="hidden" onChange={handleInfraPhotos} />
            </label>
            {infraPhotos.length > 0 && (
              <div className="grid grid-cols-4 gap-1.5">
                {infraPhotos.map((p, i) => (
                  <div key={i} className="relative aspect-square rounded-xl overflow-hidden bg-gray-100">
                    <img src={p.preview} alt="" className="w-full h-full object-cover" />
                    <button type="button"
                      onClick={() => setInfraPhotos(prev => prev.filter((_, j) => j !== i))}
                      className="absolute top-0.5 right-0.5 bg-black/50 rounded-full p-0.5">
                      <X size={9} className="text-white" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {infraError && <p className="text-xs text-red-500 bg-red-50 px-3 py-2 rounded-xl">{infraError}</p>}

            <div className="flex gap-2">
              <button type="submit" disabled={infraSubmitting}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 flex items-center justify-center gap-2"
                style={{ backgroundColor: '#8b5cf6' }}>
                {infraSubmitting ? <><Loader2 size={14} className="animate-spin" /> กำลังบันทึก...</> : '📍 บันทึกงานลงแผนที่'}
              </button>
              <button type="button" onClick={() => setShowInfraForm(false)}
                className="px-4 py-2.5 rounded-xl text-sm text-gray-500 bg-gray-100 hover:bg-gray-200 transition-colors">
                ยกเลิก
              </button>
            </div>
          </form>
        )}

        {/* My infra works list */}
        {infraWorks.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-50 flex items-center justify-between">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                งานที่บันทึกไว้ ({infraWorks.length})
              </p>
              <button onClick={fetchInfraWorks} disabled={loadingInfra}
                className="text-gray-400 hover:text-gray-600 transition-colors">
                <RefreshCw size={13} className={loadingInfra ? 'animate-spin' : ''} />
              </button>
            </div>
            {infraWorks.map((w, i) => (
              <div key={w.id}
                className={`flex items-center gap-3 px-4 py-3 ${i < infraWorks.length - 1 ? 'border-b border-gray-50' : ''}`}>
                <div className="w-9 h-9 rounded-xl bg-violet-50 flex items-center justify-center shrink-0">
                  <Wrench size={15} className="text-violet-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-700 truncate">{w.title}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {w.location_name || '—'} · {new Date(w.work_date).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: '2-digit' })}
                  </p>
                </div>
                {w.latitude && (
                  <span className="shrink-0 text-[10px] bg-violet-50 text-violet-600 font-semibold px-2 py-0.5 rounded-full">
                    📍 GPS
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
