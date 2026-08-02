import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Loader2, MapPin, Phone, X, RefreshCw,
  CheckCircle2, ChevronRight, Wrench, Printer,
  Plus, ChevronDown, Image,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useTenant } from '../contexts/TenantContext'
import { fmtNo } from '../lib/formatComplaintNo'
import { compressImage } from '../lib/imageUtils'
import { notifyTelegram } from '../lib/notifyTelegram'
import MapPicker from '../components/MapPicker'

const STATUS = {
  pending:     { label: 'รอดำเนินการ',    bg: '#fef3c7', text: '#92400e' },
  received:    { label: 'รับเรื่องแล้ว',   bg: '#dbeafe', text: '#1e40af' },
  in_progress: { label: 'กำลังดำเนินการ', bg: '#ede9fe', text: '#5b21b6' },
  done:        { label: 'รอปิดเรื่อง',    bg: '#fff7ed', text: '#9a3412' },
  completed:   { label: 'ปิดเรื่องแล้ว',  bg: '#d1fae5', text: '#065f46' },
  closed:      { label: 'ปิดเรื่องแล้ว',  bg: '#d1fae5', text: '#065f46' },
  rejected:    { label: 'ปฏิเสธ',         bg: '#fee2e2', text: '#991b1b' },
}

const NEXT_ACTION = {
  received:    { label: 'เริ่มดำเนินการ', next: 'in_progress' },
  in_progress: { label: 'ปิดงาน',        next: 'done' },
}

let CATEGORY_LABEL = {
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
  disease: 'ควบคุมโรคติดต่อ', other: 'อื่นๆ',
}

let CATEGORY_EMOJI = {
  road: '🛣️', light: '💡', trash: '🗑️', water: '🚰',
  flood: '🌊', tree: '🌳', noise: '📢', drain: '🕳️',
  waste_water: '💧', suction: '🚛', manhole: '⚙️', vendor: '🏪',
  building: '🏗️', mosquito: '🦟', pollution: '🌫️', corruption: '⚖️',
  tax: '📋', canal: '🏞️', animals: '🐕', water_supply: '🚿',
  borrow_equipment: '📦', grievance: '📣', disease: '🏥', other: '📝',
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
  const count = list.filter(c => c.status !== 'completed' && c.status !== 'closed' && !seen.has(c.id)).length
  localStorage.setItem('sl_tech_new', String(count))
  window.dispatchEvent(new CustomEvent('tech-badge-update', { detail: count }))
}

const STATUS_FLOW = ['pending', 'received', 'in_progress', 'done', 'completed']
const STATUS_FLOW_LABEL = {
  pending:     { label: 'รอดำเนินการ',    desc: 'คำร้องของคุณถูกส่งเข้าระบบแล้ว' },
  received:    { label: 'รับเรื่องแล้ว',   desc: 'เจ้าหน้าที่รับทราบและตรวจสอบ' },
  in_progress: { label: 'กำลังดำเนินการ', desc: 'อยู่ระหว่างดำเนินการแก้ไข' },
  done:        { label: 'รอปิดเรื่อง',    desc: 'ดำเนินการเสร็จแล้ว รอผู้บริหารปิดเรื่อง' },
  completed:   { label: 'ปิดเรื่องแล้ว',  desc: 'ผู้บริหารปิดเรื่องและแจ้งประชาชนแล้ว' },
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
  const [mapPos, setMapPos] = useState(c.latitude ? { lat: c.latitude, lng: c.longitude } : null)
  const [locationName, setLocationName] = useState(c.location_name || c.village || '')
  const [showMapEdit, setShowMapEdit] = useState(false)

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
    const compressed = await compressImage(file, 1200)
    const { error: upErr } = await supabase.storage
      .from('complaint-attachments')
      .upload(path, compressed, { upsert: false })
    if (!upErr) {
      const { data } = supabase.storage.from('complaint-attachments').getPublicUrl(path)
      const newPhotos = [...photos, data.publicUrl]
      setPhotos(newPhotos)
      await supabase.from('complaints').update({ work_photos: newPhotos }).eq('id', c.id)
      if (c.user_id) {
        supabase.functions.invoke('send-push', {
          body: {
            user_id: c.user_id,
            title: 'มีรูปหลักฐานการทำงานใหม่',
            body: `เจ้าหน้าที่เพิ่มรูปความคืบหน้าในคำร้อง${CATEGORY_LABEL[c.category] ?? c.category ?? ''}`,
            url: '/my-complaints',
          },
        }).catch(() => {})
      }
    }
    setUploading(false)
    e.target.value = ''
  }

  async function saveNote() {
    setSavingNote(true)
    await supabase.from('complaints').update({ technician_note: note }).eq('id', c.id)
    setSavingNote(false)
  }

  async function handleMapConfirm({ lat, lng, address }) {
    const updates = { latitude: lat, longitude: lng }
    if (address) updates.location_name = address
    const { error } = await supabase.from('complaints').update(updates).eq('id', c.id)
    if (!error) {
      setMapPos({ lat, lng })
      if (address) setLocationName(address)
    }
    setShowMapEdit(false)
  }

  const needsPhoto = false

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

          {/* รูปจากผู้แจ้ง */}
          {(c.attachments ?? []).length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                รูปภาพจากผู้แจ้ง ({c.attachments.length})
              </p>
              <div className="grid grid-cols-3 gap-2">
                {c.attachments.map((url, i) => (
                  <a key={i} href={url} target="_blank" rel="noreferrer"
                     className="aspect-square rounded-xl overflow-hidden border border-blue-200 bg-blue-50">
                    <img src={url} alt={`แนบ ${i + 1}`} className="w-full h-full object-cover" />
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* สถานที่ + โทร */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">จุดเกิดเหตุ</p>
              {c.status !== 'completed' && c.status !== 'rejected' && (
                <button onClick={() => setShowMapEdit(true)}
                  className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl bg-orange-50 text-orange-600 hover:bg-orange-100 transition-colors">
                  <MapPin size={13} />
                  {mapPos ? 'แก้ไขหมุด' : 'ปักหมุดตำแหน่ง'}
                </button>
              )}
            </div>
            {(locationName || c.phone || mapPos) && (
              <div className="bg-gray-50 rounded-2xl divide-y divide-gray-100 overflow-hidden border border-gray-100">
                {locationName && (
                  <div className="flex items-center gap-3 px-4 py-3">
                    <MapPin size={15} className="text-orange-400 shrink-0" />
                    <p className="text-sm text-gray-700">{locationName}</p>
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
                {mapPos && (
                  <a href={`https://maps.google.com/?q=${mapPos.lat},${mapPos.lng}`}
                     target="_blank" rel="noreferrer"
                     className="flex items-center gap-3 px-4 py-3 hover:bg-gray-100 transition-colors">
                    <MapPin size={15} className="text-blue-500 shrink-0" />
                    <p className="text-sm text-gray-700 flex-1">
                      {mapPos.lat.toFixed(5)}, {mapPos.lng.toFixed(5)}
                    </p>
                    <span className="text-xs font-semibold px-2 py-1 bg-blue-100 text-blue-700 rounded-lg">แผนที่</span>
                  </a>
                )}
              </div>
            )}
          </div>

          {showMapEdit && (
            <MapPicker
              initialPos={mapPos}
              fallbackPos={mapPos}
              onConfirm={handleMapConfirm}
              onClose={() => setShowMapEdit(false)}
            />
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
                  {uploading ? 'กำลังอัปโหลด...' : 'เพิ่มรูป'}
                  <input type="file" accept="image/*"
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
  const [myAvatar, setMyAvatar] = useState(null)
  const [seenIds, setSeenIds] = useState(getSeenIds)

  // ดึงหมวดหมู่ที่ Admin สร้างเอง merge เข้า CATEGORY_LABEL/EMOJI
  const [, setCatVer] = useState(0)
  useEffect(() => {
    if (!tenant?.id) return
    supabase.from('complaint_categories').select('value, label, emoji').eq('municipality_id', tenant.id)
      .then(({ data }) => {
        if (data && data.length > 0) {
          for (const c of data) {
            CATEGORY_LABEL[c.value] = c.label
            if (c.emoji) CATEGORY_EMOJI[c.value] = c.emoji
          }
          setCatVer(v => v + 1)
        }
      })
  }, [tenant?.id])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) return
      supabase.from('profiles').select('full_name, role, avatar_url').eq('id', data.session.user.id).single()
        .then(({ data: p }) => {
          if (p?.role !== 'technician') navigate('/')
          setMyName(p?.full_name ?? 'ช่าง')
          setMyAvatar(p?.avatar_url ?? null)
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
      .neq('status', 'pending')
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

      const notificationType = {
        received: 'technician_received',
        in_progress: 'technician_in_progress',
        done: 'technician_closed',
        completed: 'technician_closed',
      }[nextStatus]
      if (notificationType) notifyTelegram(notificationType, id)

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

  // ─── GPS ปักหมุดโครงการ (civil_projects) ────────────────────────────────
  const GPS_TODAY   = new Date().toISOString().split('T')[0]
  const THIS_YEAR_BE = String(new Date().getFullYear() + 543)
  const GPS_TYPES = [
    { value: 'road',         label: '🛣️  ถนน/สะพาน' },
    { value: 'drain',        label: '🕳️  ระบายน้ำ' },
    { value: 'light',        label: '💡  ไฟฟ้า' },
    { value: 'waterway',     label: '🏞️  ลำเหมือง' },
    { value: 'building',     label: '🏗️  อาคาร' },
    { value: 'irrigation',   label: '💧  ชลประทาน' },
    { value: 'water_supply', label: '🚰  ประปา' },
    { value: 'other',        label: '📝  อื่นๆ' },
  ]

  const [showGpsMap, setShowGpsMap]       = useState(false)
  const [showGpsForm, setShowGpsForm]     = useState(false)
  const [gpsForm, setGpsForm]             = useState({ title: '', project_type: 'road', village: '', start_date: GPS_TODAY })
  const [gpsGeo, setGpsGeo]               = useState({ lat: null, lng: null })
  const [gpsSubmitting, setGpsSubmitting] = useState(false)
  const [gpsError, setGpsError]           = useState(null)
  const [myProjects, setMyProjects]       = useState([])
  const [loadingProjects, setLoadingProjects] = useState(false)

  const fetchMyProjects = useCallback(async () => {
    if (!tenant?.id) return
    setLoadingProjects(true)
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { setLoadingProjects(false); return }
    const { data } = await supabase
      .from('civil_projects')
      .select('id, title, project_type, status, latitude, longitude, village, start_date, progress_pct, fiscal_year')
      .eq('municipality_id', tenant.id)
      .eq('created_by', session.user.id)
      .order('created_at', { ascending: false })
      .limit(20)
    setMyProjects(data ?? [])
    setLoadingProjects(false)
  }, [tenant?.id])

  async function submitGps(e) {
    e.preventDefault()
    if (!gpsForm.title.trim()) { setGpsError('กรุณาระบุชื่องาน / โครงการ'); return }
    if (!gpsGeo.lat) { setGpsError('กรุณาปักหมุด GPS ตำแหน่งงานก่อนบันทึก'); return }
    setGpsError(null)
    setGpsSubmitting(true)
    const { data: { session } } = await supabase.auth.getSession()
    const { error: dbErr } = await supabase.from('civil_projects').insert({
      id:              crypto.randomUUID(),
      municipality_id: tenant.id,
      created_by:      session.user.id,
      title:           gpsForm.title.trim(),
      project_type:    gpsForm.project_type,
      status:          'in_progress',
      progress_pct:    50,
      village:         gpsForm.village?.trim() || null,
      start_date:      gpsForm.start_date,
      fiscal_year:     THIS_YEAR_BE,
      latitude:        gpsGeo.lat,
      longitude:       gpsGeo.lng,
    })
    setGpsSubmitting(false)
    if (dbErr) { setGpsError(`บันทึกไม่สำเร็จ: ${dbErr.message}`); return }
    setGpsForm({ title: '', project_type: 'road', village: '', start_date: GPS_TODAY })
    setGpsGeo({ lat: null, lng: null })
    setShowGpsForm(false)
    fetchMyProjects()
  }

  useEffect(() => { fetchMyProjects() }, [fetchMyProjects])

  const pending = complaints.filter((c) => c.status !== 'completed')
  const done = complaints.filter((c) => c.status === 'completed')

  // ระดับความเร่งด่วนตาม due_date ที่ระบบกำหนดให้อัตโนมัติตอนมอบหมายงาน (auto_assign_complaint)
  const todayStr = new Date().toISOString().split('T')[0]
  const tomorrowStr = new Date(Date.now() + 86400000).toISOString().split('T')[0]
  function slaLevel(c) {
    if (!c.due_date) return null
    if (c.due_date < todayStr) return 'crit'
    if (c.due_date <= tomorrowStr) return 'warn'
    return 'ok'
  }
  const dueSoonCount = pending.filter((c) => { const l = slaLevel(c); return l === 'crit' || l === 'warn' }).length
  const doneTodayCount = complaints.filter((c) =>
    (c.status === 'completed' || c.status === 'closed') && c.closed_at?.slice(0, 10) === todayStr
  ).length

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#eef2f7', paddingBottom: 'calc(5rem + max(env(safe-area-inset-bottom, 0px), 12px))' }}>
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

      {showGpsMap && (
        <MapPicker
          initialPos={gpsGeo.lat ? { lat: gpsGeo.lat, lng: gpsGeo.lng } : (tenant?.latitude ? { lat: tenant.latitude, lng: tenant.longitude } : null)}
          onConfirm={({ lat, lng, address }) => {
            setGpsGeo({ lat, lng })
            if (address && !gpsForm.village) setGpsForm(p => ({ ...p, village: address }))
            setShowGpsMap(false)
          }}
          onClose={() => setShowGpsMap(false)}
        />
      )}

      {/* PC header */}
      <div className="hidden md:block">
        <div className="px-8 py-1.5 flex items-center justify-between border-b"
          style={{ backgroundColor: '#dce8f5', borderColor: '#b8cfea' }}>
          <p className="text-[11px] text-gray-600">
            ระบบบริการอิเล็กทรอนิกส์ › {tenant?.name ?? ''} › <span className="font-semibold text-gray-700">งานของฉัน</span>
          </p>
          <p className="text-[11px] text-gray-500">
            {new Date().toLocaleDateString('th-TH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <div className="px-8 py-3 flex items-center justify-between bg-white border-b border-gray-200 shadow-sm">
          <div>
            <h1 className="text-base font-bold text-gray-800">งานของฉัน</h1>
            <p className="text-[11px] text-gray-400 mt-0.5">{myName} · {tenant?.name} — แผงควบคุมช่าง</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={fetchComplaints} disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-200 bg-white hover:bg-gray-50 transition-colors disabled:opacity-50">
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
              รีเฟรช
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="px-4 py-4 pb-8 md:py-6 md:px-8 md:flex md:gap-6 md:items-start">

        {/* Mobile header — โทนส้ม สื่อ "โหมดช่าง" ต่างจากโหมดเจ้าหน้าที่/ประชาชน */}
        <div className="md:hidden -mx-4 -mt-4 mb-4 text-white px-4 pt-4 pb-5 relative overflow-hidden"
          style={{ background: 'linear-gradient(135deg, #8F3E17 0%, #D9622B 100%)' }}>
          <div className="flex items-center gap-3 relative z-10">
            <button onClick={() => navigate('/')} className="shrink-0 active:opacity-70 transition-opacity">
              {tenant?.logo_url
                ? <img src={tenant.logo_url} alt="โลโก้" className="w-11 h-11 rounded-full object-contain bg-white/10 p-0.5 border border-white/20" />
                : <div className="w-11 h-11 rounded-full border-2 border-white/40 bg-white/20 flex items-center justify-center text-lg font-bold">{tenant?.name?.[0] ?? '?'}</div>}
            </button>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-sm leading-tight truncate">{tenant?.name ?? 'ระบบช่าง'}</p>
              <p className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/20 mt-1">
                🔧 โหมดช่าง
              </p>
            </div>
            <button onClick={fetchComplaints} disabled={loading} aria-label="รีเฟรช"
              className="p-1.5 text-white/85 hover:text-white transition-colors shrink-0 disabled:opacity-50">
              <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
            </button>
            <button onClick={() => navigate('/profile')} className="p-1 shrink-0">
              {myAvatar ? (
                <img src={myAvatar} alt="โปรไฟล์" className="w-7 h-7 rounded-full object-cover border-2 border-white/60" />
              ) : (
                <div className="w-7 h-7 rounded-full bg-white/20 border-2 border-white/60 flex items-center justify-center text-white text-xs font-bold">
                  {(myName || '?')[0].toUpperCase()}
                </div>
              )}
            </button>
          </div>
          <p className="text-white/70 text-[11px] mt-2 relative z-10">{myName}</p>
        </div>

        {/* ─── Left: รายการงาน ─── */}
        <div className="flex-1 min-w-0 space-y-4">
          {/* สรุปงานวันนี้ — ใช้ due_date/priority ที่ระบบมีอยู่แล้ว ยังไม่เคยถูกโชว์ที่หน้าช่างมาก่อน */}
          {!loading && complaints.length > 0 && (
            <div className="md:hidden grid grid-cols-3 gap-2">
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3 text-center">
                <p className="text-lg font-bold text-gray-800">{pending.length}</p>
                <p className="text-[10px] font-semibold text-gray-400 mt-0.5">ค้างอยู่</p>
              </div>
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3 text-center">
                <p className="text-lg font-bold" style={{ color: doneTodayCount > 0 ? '#059669' : '#374151' }}>{doneTodayCount}</p>
                <p className="text-[10px] font-semibold text-gray-400 mt-0.5">เสร็จวันนี้</p>
              </div>
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3 text-center">
                <p className="text-lg font-bold" style={{ color: dueSoonCount > 0 ? '#dc2626' : '#374151' }}>{dueSoonCount}</p>
                <p className="text-[10px] font-semibold text-gray-400 mt-0.5">ใกล้ครบกำหนด</p>
              </div>
            </div>
          )}

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
                <div className="space-y-2">
                  <p className="text-[11px] font-bold uppercase tracking-widest text-gray-400">
                    งานที่รอดำเนินการ ({pending.length})
                  </p>
                  {/* Mobile cards */}
                  <div className="md:hidden bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                    {pending.map((c, i) => {
                      const s = STATUS[c.status]
                      const level = slaLevel(c)
                      const stripeColor = level === 'crit' ? '#dc2626' : level === 'warn' ? '#d97706' : level === 'ok' ? '#059669' : 'transparent'
                      const dueHint = level === 'crit' ? 'เลยกำหนดแล้ว' : level === 'warn' ? (c.due_date === todayStr ? 'ครบกำหนดวันนี้' : 'ครบกำหนดพรุ่งนี้') : null
                      return (
                        <button key={c.id} onClick={() => handleOpenComplaint(c)}
                          style={{ borderLeft: `3px solid ${stripeColor}` }}
                          className={`w-full flex items-center gap-3 pl-3 pr-4 py-3.5 text-left hover:bg-gray-50 transition-colors active:bg-gray-100 ${i < pending.length - 1 ? 'border-b border-gray-50' : ''}`}>
                          <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0 bg-gray-100">
                            {CATEGORY_EMOJI[c.category] ?? '📄'}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-gray-800 truncate">
                              <span className="text-gray-400 font-mono font-normal mr-1">{i + 1}.</span>
                              {CATEGORY_LABEL[c.category] ?? c.category}
                            </p>
                            <p className="text-xs text-gray-500 mt-0.5 truncate font-medium">
                              {c.location_name || c.village || '—'}{dueHint ? ` · ${dueHint}` : ''}
                            </p>
                            <p className="text-xs text-gray-400 truncate">{c.detail}</p>
                          </div>
                          <div className="flex flex-col items-end gap-1.5 shrink-0">
                            <div className="flex items-center gap-1.5">
                              {!seenIds.has(c.id) && <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />}
                              <span className="text-[13px] font-semibold px-2 py-0.5 rounded-full"
                                style={{ backgroundColor: s?.bg, color: s?.text }}>{s?.label}</span>
                            </div>
                            <ChevronRight size={14} className="text-gray-300" />
                          </div>
                        </button>
                      )
                    })}
                  </div>
                  {/* PC table */}
                  <div className="hidden md:block bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr style={{ backgroundColor: '#1a3a5c' }}>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-white/80 w-8">#</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-white/80">ประเภท</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-white/80">รายละเอียด</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-white/80">สถานที่</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-white/80">สถานะ</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-white/80">วันที่</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {pending.map((c, i) => {
                          const s = STATUS[c.status]
                          return (
                            <tr key={c.id} onClick={() => handleOpenComplaint(c)}
                              className="cursor-pointer transition-colors"
                              style={{ backgroundColor: i % 2 === 0 ? '#fff' : '#f5f8fc' }}
                              onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#dbeafe' }}
                              onMouseLeave={e => { e.currentTarget.style.backgroundColor = i % 2 === 0 ? '#fff' : '#f5f8fc' }}>
                              <td className="px-4 py-3 text-gray-400 font-mono text-xs">{i + 1}</td>
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2">
                                  {!seenIds.has(c.id) && <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />}
                                  <span className="font-semibold text-gray-800">{CATEGORY_LABEL[c.category] ?? c.category}</span>
                                </div>
                              </td>
                              <td className="px-4 py-3 text-gray-500 max-w-[220px] truncate">{c.detail}</td>
                              <td className="px-4 py-3 text-gray-500 text-xs">{c.location_name || c.village || '—'}</td>
                              <td className="px-4 py-3">
                                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium"
                                  style={{ backgroundColor: s?.bg, color: s?.text }}>{s?.label}</span>
                              </td>
                              <td className="px-4 py-3 text-gray-400 text-xs">
                                {new Date(c.created_at).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* งานที่เสร็จแล้ว */}
              {done.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[11px] font-bold uppercase tracking-widest text-gray-400">
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
        </div>

        {/* ─── Right: GPS Projects ─── */}
        <div className="mt-6 md:mt-0 md:w-80 md:shrink-0 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-violet-100 flex items-center justify-center shrink-0">
                <MapPin size={13} className="text-violet-600" />
              </div>
              <div>
                <p className="text-sm font-bold text-gray-700">ปักหมุด GPS โครงการ</p>
                <p className="text-[11px] text-gray-400">ช่างบันทึก · ธุรการเพิ่มรายละเอียดใน Admin</p>
              </div>
            </div>
            <button onClick={fetchMyProjects} disabled={loadingProjects}
              className="p-1.5 rounded-xl text-gray-400 hover:text-gray-600 transition-colors">
              <RefreshCw size={13} className={loadingProjects ? 'animate-spin' : ''} />
            </button>
          </div>

          <button onClick={() => setShowGpsForm(v => !v)}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold text-white"
            style={{ backgroundColor: '#7c3aed' }}>
            {showGpsForm ? <ChevronDown size={14} /> : <Plus size={14} />}
            {showGpsForm ? 'ซ่อนฟอร์ม' : '📍 ปักหมุด GPS โครงการ'}
          </button>

          {showGpsForm && (
            <form onSubmit={submitGps}
              className="bg-white rounded-2xl border border-violet-100 shadow-sm p-4 space-y-3">
              <p className="text-xs text-violet-600 bg-violet-50 rounded-lg px-3 py-2">
                ปักหมุด GPS ตำแหน่งโครงการหน้างาน · ธุรการเพิ่มรายละเอียดใน Admin ต่อ
              </p>
              <div className="flex flex-wrap gap-1.5">
                {GPS_TYPES.map(t => (
                  <button key={t.value} type="button"
                    onClick={() => setGpsForm(p => ({ ...p, project_type: t.value }))}
                    className="text-[13px] font-semibold px-2.5 py-1 rounded-full border transition-all"
                    style={gpsForm.project_type === t.value
                      ? { backgroundColor: '#7c3aed', color: '#fff', borderColor: '#7c3aed' }
                      : { backgroundColor: '#f8fafc', color: '#64748b', borderColor: '#e2e8f0' }}>
                    {t.label}
                  </button>
                ))}
              </div>
              <input type="text" value={gpsForm.title} required
                onChange={e => setGpsForm(p => ({ ...p, title: e.target.value }))}
                placeholder="ชื่อโครงการ / งานที่ทำ"
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-300" />
              <div className={`rounded-xl border p-3 ${gpsGeo.lat ? 'bg-green-50 border-green-200' : 'bg-violet-50 border-violet-200'}`}>
                <div className="flex items-center gap-2 mb-2">
                  <MapPin size={13} className={gpsGeo.lat ? 'text-green-600' : 'text-violet-600'} />
                  <span className="text-xs font-bold text-gray-700">พิกัด GPS</span>
                  <span className="ml-auto text-[10px] font-bold text-violet-700 bg-violet-100 px-2 py-0.5 rounded-full">* บังคับ</span>
                </div>
                <button type="button" onClick={() => setShowGpsMap(true)}
                  className={`w-full py-2 rounded-lg text-xs font-medium border transition-all ${
                    gpsGeo.lat ? 'bg-white border-green-200 text-green-700' : 'bg-white border-violet-200 text-violet-700'
                  }`}>
                  {gpsGeo.lat
                    ? `📍 ${gpsGeo.lat.toFixed(5)}, ${gpsGeo.lng.toFixed(5)} — กดแก้ไข`
                    : '📍 กดเพื่อปักหมุดบนแผนที่'}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input type="text" value={gpsForm.village}
                  onChange={e => setGpsForm(p => ({ ...p, village: e.target.value }))}
                  placeholder="หมู่บ้าน / สถานที่"
                  className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-300" />
                <input type="date" value={gpsForm.start_date}
                  onChange={e => setGpsForm(p => ({ ...p, start_date: e.target.value }))}
                  className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-300" />
              </div>
              {gpsError && <p className="text-xs text-red-500 bg-red-50 px-3 py-2 rounded-xl">{gpsError}</p>}
              <div className="flex gap-2">
                <button type="submit" disabled={gpsSubmitting}
                  className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 flex items-center justify-center gap-2"
                  style={{ backgroundColor: '#7c3aed' }}>
                  {gpsSubmitting ? <><Loader2 size={13} className="animate-spin" /> บันทึก...</> : '📍 ปักหมุดโครงการ'}
                </button>
                <button type="button" onClick={() => setShowGpsForm(false)}
                  className="px-4 py-2.5 rounded-xl text-sm text-gray-500 bg-gray-100 hover:bg-gray-200">
                  ยกเลิก
                </button>
              </div>
            </form>
          )}

          {myProjects.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-50">
                <p className="text-[11px] font-bold uppercase tracking-widest text-gray-400">
                  โครงการที่บันทึกไว้ ({myProjects.length})
                </p>
              </div>
              {myProjects.map((p, i) => (
                <div key={p.id}
                  className={`flex items-center gap-3 px-4 py-3 ${i < myProjects.length - 1 ? 'border-b border-gray-50' : ''}`}>
                  <div className="w-9 h-9 rounded-xl bg-violet-50 flex items-center justify-center text-base shrink-0">
                    🏗️
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-700 truncate">{p.title}</p>
                    <p className="text-xs text-gray-400 mt-0.5 truncate">
                      {p.village || '—'}
                      {p.start_date ? ` · ${new Date(p.start_date).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: '2-digit' })}` : ''}
                    </p>
                  </div>
                  {p.latitude && (
                    <span className="text-[10px] text-green-600 font-mono bg-green-50 px-1.5 py-0.5 rounded shrink-0">📍</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
