import { useState, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  MapPin, Phone, FileText, ChevronDown, AlignLeft, Home,
  Loader2, CheckCircle2, ArrowLeft, Send, Paperclip, X, Image, User,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { notifyTelegram } from '../lib/notifyTelegram'
import { useTenant } from '../contexts/TenantContext'
import MapPicker from '../components/MapPicker'

const DEFAULT_CATEGORIES = [
  { value: 'light',            label: '💡  ไฟฟ้าสาธารณะ' },
  { value: 'road',             label: '🛣️  ซ่อมแซมถนน' },
  { value: 'mosquito',         label: '🦟  พ่นยุง' },
  { value: 'tree',             label: '🌳  ตัดต้นไม้' },
  { value: 'trash',            label: '🗑️  ขยะ / ความสะอาด' },
  { value: 'water_supply',     label: '🚿  สนับสนุนน้ำอุปโภค' },
  { value: 'borrow_equipment', label: '📦  ยืมพัสดุ' },
  { value: 'corruption',       label: '⚖️  แจ้งการทุจริต' },
  { value: 'grievance',        label: '📣  แจ้งเรื่องร้องทุกข์ร้องเรียน' },
  { value: 'other',            label: '📝  อื่นๆ' },
]

const GEO_STATUS = { idle: 'idle', ok: 'ok' }

const MAX_FILE_MB  = 5          // ไฟล์ที่ไม่ใช่รูป: ห้ามเกิน 5 MB
const COMPRESS_MB  = 2          // รูปที่เกิน 2 MB → บีบอัด
const MAX_DIM      = 1920       // ความกว้าง/สูงสูงสุดหลังบีบ

async function compressImage(file) {
  return new Promise((resolve) => {
    const img = new window.Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      let { width, height } = img
      const ratio = Math.min(MAX_DIM / width, MAX_DIM / height, 1)
      width  = Math.round(width  * ratio)
      height = Math.round(height * ratio)
      const canvas = document.createElement('canvas')
      canvas.width  = width
      canvas.height = height
      canvas.getContext('2d').drawImage(img, 0, 0, width, height)
      canvas.toBlob(
        (blob) => {
          const name = file.name.replace(/\.[^.]+$/, '.jpg')
          resolve(new File([blob], name, { type: 'image/jpeg' }))
        },
        'image/jpeg',
        0.82,
      )
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(file) // fallback ใช้ไฟล์ต้นฉบับ
    }
    img.src = url
  })
}

function SuccessScreen({ onBack, complaintNumber }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] px-6 text-center">
      <div className="w-20 h-20 rounded-full bg-green-50 flex items-center justify-center mb-5 animate-bounce-once">
        <CheckCircle2 size={44} className="text-green-500" />
      </div>
      <h2 className="text-xl font-bold text-gray-800 mb-2">ส่งเรื่องสำเร็จ!</h2>
      {complaintNumber && (
        <div className="mb-3 px-4 py-2 bg-gray-100 rounded-xl">
          <p className="text-xs text-gray-500">เลขที่คำร้อง</p>
          <p className="text-lg font-bold text-gray-800">
            {(() => { const d = new Date(); const yy = String(d.getFullYear()+543).slice(-2); const mm = String(d.getMonth()+1).padStart(2,'0'); return `${yy}${mm}${String(complaintNumber).padStart(3,'0')}` })()}
          </p>
        </div>
      )}
      <p className="text-gray-500 text-sm leading-relaxed mb-8 max-w-xs">
        เจ้าหน้าที่จะดำเนินการตรวจสอบและติดต่อกลับหาท่านโดยเร็วที่สุด
      </p>
      <button onClick={onBack}
        className="w-full max-w-xs py-3.5 rounded-2xl font-semibold text-white shadow-lg active:scale-95 transition-transform"
        style={{ backgroundColor: 'var(--color-primary)' }}>
        กลับหน้าหลัก
      </button>
    </div>
  )
}

// ─── One Data form type config ────────────────────────────────────────────────
const FORM_TYPE_CONFIG = {
  infrastructure: {
    label: 'ยื่นคำร้องออนไลน์',
    icon: '🔧',
    color: '#ef4444',
    gpsRequired: true,
    categories: [
      { value: 'road',       label: '🛣️  ถนน / สะพาน' },
      { value: 'light',      label: '💡  ไฟฟ้าสาธารณะ' },
      { value: 'drain',      label: '🕳️  ท่อระบายน้ำ' },
      { value: 'canal',      label: '🏞️  ลำเหมือง / คูน้ำ' },
      { value: 'building',   label: '🏗️  สิ่งก่อสร้างชำรุด' },
      { value: 'other',      label: '📝  อื่นๆ' },
    ],
    placeholder: 'อธิบายปัญหาที่พบ เช่น ถนนเป็นหลุมบ่อขนาดใหญ่ ลึกประมาณ 20 ซม. มีน้ำขัง...',
  },
  water_support: {
    label: 'ขอสนับสนุนน้ำอุปโภค-บริโภค',
    icon: '💧',
    color: '#3b82f6',
    gpsRequired: true,
    categories: [
      { value: 'water_drought', label: '🚛  ขอน้ำช่วงฤดูแล้ง' },
      { value: 'water_tank',    label: '🪣  ถังน้ำกลางหมู่บ้านหมด' },
      { value: 'water_flood',   label: '🌊  ขอน้ำช่วงอุทกภัย' },
      { value: 'other',         label: '📝  อื่นๆ' },
    ],
    placeholder: 'อธิบายสถานการณ์ เช่น น้ำในถังกลางหมู่บ้านหมดแล้ว ประชาชนในหมู่ที่ 3 ขาดแคลนน้ำ...',
  },
  environment: {
    label: 'แจ้งเหตุสิ่งแวดล้อม / จุดเสี่ยงภัย',
    icon: '🌿',
    color: '#10b981',
    gpsRequired: true,
    categories: [
      { value: 'trash',       label: '🗑️  ขยะตกค้าง / ทิ้งผิดที่' },
      { value: 'tree',        label: '🌳  กิ่งไม้ / ต้นไม้อันตราย' },
      { value: 'env_hazard',  label: '⚠️  จุดเสี่ยง / มั่วสุม' },
      { value: 'env_fire',    label: '🔥  ควันไฟ / เผาป่า' },
      { value: 'mosquito',    label: '🦟  ยุงชุกชุม / น้ำขัง' },
      { value: 'pollution',   label: '🌫️  กลิ่น / มลพิษ' },
      { value: 'other',       label: '📝  อื่นๆ' },
    ],
    placeholder: 'อธิบายสถานการณ์ เช่น พบขยะทิ้งเกลื่อนข้างทาง มีกลิ่นเหม็น...',
  },
}

export default function CitizenForm() {
  const { tenant } = useTenant()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const preCategory = searchParams.get('category') ?? ''
  const formType = searchParams.get('form') ?? 'legacy'
  const ftConfig = FORM_TYPE_CONFIG[formType] ?? null

  const defaultCategory = ftConfig?.categories?.[0]?.value ?? preCategory
  const [form, setForm] = useState({ category: defaultCategory, subject: '', village: '', detail: '', phone: '', reporter_name: '' })
  const [geo, setGeo] = useState({ lat: null, lng: null, address: null })
  const [geoStatus, setGeoStatus] = useState(GEO_STATUS.idle)
  const [showMap, setShowMap] = useState(false)
  const [files, setFiles] = useState([])        // { file, preview, name }
  const [consent, setConsent] = useState(false)
  const prefilledRef = useRef(false)

  useEffect(() => {
    return () => files.forEach((f) => { if (f.preview) URL.revokeObjectURL(f.preview) })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const [showPdpa, setShowPdpa] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(false)
  const [complaintNumber, setComplaintNumber] = useState(null)
  const [locations, setLocations] = useState([])
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES)

  useEffect(() => {
    if (form.category) {
      let matchedLabel = ''
      if (ftConfig) {
        const matched = ftConfig.categories.find((c) => c.value === form.category)
        if (matched) matchedLabel = matched.label
      } else if (categories.length > 0) {
        const matched = categories.find((c) => c.value === form.category)
        if (matched) matchedLabel = matched.label
      }

      if (matchedLabel && (!prefilledRef.current || prefilledRef.current !== form.category)) {
        const cleanSubject = matchedLabel.replace(/^[\p{Emoji}\s]+/u, '').trim()
        setForm((prev) => ({ ...prev, subject: cleanSubject }))
        prefilledRef.current = form.category
      }
    }
  }, [form.category, categories, ftConfig])

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) return
      const meta = session.user.user_metadata ?? {}
      const metaName = meta.full_name || meta.name || ''
      const metaPhone = meta.phone || ''
      supabase.from('profiles').select('full_name, phone').eq('id', session.user.id).single()
        .then(({ data }) => {
          const name = data?.full_name || metaName
          const phone = data?.phone || metaPhone
          setForm((prev) => ({
            ...prev,
            ...(name ? { reporter_name: name } : {}),
            ...(phone ? { phone } : {}),
          }))
        })
        .catch(() => {
          setForm((prev) => ({
            ...prev,
            ...(metaName ? { reporter_name: metaName } : {}),
            ...(metaPhone ? { phone: metaPhone } : {}),
          }))
        })
    })
  }, [])

  useEffect(() => {
    if (!tenant?.id) return
    supabase
      .from('locations')
      .select('id, name')
      .eq('municipality_id', tenant.id)
      .order('sort_order')
      .then(({ data }) => setLocations(data ?? []))
    supabase
      .from('complaint_categories')
      .select('value, label, emoji')
      .eq('municipality_id', tenant.id)
      .order('sort_order')
      .then(({ data }) => {
        if (data && data.length > 0) {
          setCategories(data.map((c) => ({ value: c.value, label: `${c.emoji}  ${c.label}` })))
        }
      })
  }, [tenant?.id])

  async function handleFileChange(e) {
    const chosen = Array.from(e.target.files)
    const remaining = 5 - files.length
    if (remaining <= 0) return
    const toProcess = chosen.slice(0, remaining)
    const added = []
    const oversized = []

    for (const f of toProcess) {
      if (f.type.startsWith('image/')) {
        const needsCompress = f.size > COMPRESS_MB * 1024 * 1024
        const processed = needsCompress ? await compressImage(f) : f
        added.push({
          file: processed,
          name: processed.name,
          preview: URL.createObjectURL(processed),
          compressed: needsCompress,
        })
      } else {
        if (f.size > MAX_FILE_MB * 1024 * 1024) {
          oversized.push(f.name)
        } else {
          added.push({ file: f, name: f.name, preview: null, compressed: false })
        }
      }
    }

    if (oversized.length > 0)
      setError(`ไฟล์ต่อไปนี้ใหญ่เกิน ${MAX_FILE_MB} MB: ${oversized.join(', ')}`)

    setFiles((prev) => [...prev, ...added])
    e.target.value = ''
  }

  function removeFile(idx) {
    setFiles((prev) => {
      if (prev[idx]?.preview) URL.revokeObjectURL(prev[idx].preview)
      return prev.filter((_, i) => i !== idx)
    })
  }

  async function uploadFiles(complaintId) {
    const urls = []
    for (const item of files) {
      const ext = item.name.split('.').pop()
      const path = `${complaintId}/${crypto.randomUUID()}.${ext}`
      const { error: upErr } = await supabase.storage
        .from('complaint-attachments')
        .upload(path, item.file, { upsert: false })
      if (upErr) continue
      const { data } = supabase.storage.from('complaint-attachments').getPublicUrl(path)
      if (data?.publicUrl) urls.push(data.publicUrl)
    }
    return urls
  }

  const set = (field) => (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }))

  function handleMapConfirm({ lat, lng, address }) {
    setGeo({ lat, lng, address })
    setGeoStatus(GEO_STATUS.ok)
    setShowMap(false)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.category) { setError('กรุณาเลือกประเภทปัญหา'); return }
    if (!form.reporter_name.trim()) { setError('กรุณากรอกชื่อ-นามสกุล'); return }
    if (!form.subject.trim()) { setError('กรุณากรอกเรื่อง'); return }
    if (form.detail.trim().length < 10) { setError('กรุณาอธิบายรายละเอียดอย่างน้อย 10 ตัวอักษร'); return }
    if (!form.phone.trim()) { setError('กรุณากรอกเบอร์โทรติดต่อ'); return }
    if (ftConfig?.gpsRequired && !geo.lat) { setError('ฟอร์มนี้ต้องการพิกัด GPS หน้างาน — กรุณากดปักหมุดก่อนส่ง'); return }
    if (!consent) { setError('กรุณายอมรับข้อตกลงและการรับรองข้อมูลก่อนส่งคำร้อง'); return }
    if (!tenant?.id) { setError('ไม่พบข้อมูลหน่วยงาน'); return }

    setError(null)
    setSubmitting(true)

    const { data: { session } } = await supabase.auth.getSession()

    // generate UUID ก่อน เพื่อใช้เป็น path ของไฟล์แนบ
    const complaintId = crypto.randomUUID()
    const attachmentUrls = files.length > 0 ? await uploadFiles(complaintId) : []

    const { data: inserted, error: dbError } = await supabase.from('complaints').insert({
      id:              complaintId,
      municipality_id: tenant.id,
      category:        form.category,
      form_type:       formType !== 'legacy' ? formType : 'legacy',
      subject:         form.subject.trim(),
      village:         form.village || null,
      detail:          form.detail.trim(),
      phone:           form.phone.trim(),
      reporter_name:   form.reporter_name.trim(),
      latitude:        geo.lat,
      longitude:       geo.lng,
      user_id:         session?.user?.id ?? null,
      attachments:     attachmentUrls,
    }).select('id, complaint_number').single()

    if (dbError) { setSubmitting(false); setError(`เกิดข้อผิดพลาด: ${dbError.message}`); return }

    // ส่ง push notification ให้เจ้าหน้าที่ (fire-and-forget)
    const catLabel = form.category
      ? (categories.find((c) => c.value === form.category)?.label?.replace(/^[\p{Emoji}\s]+/u, '').trim() ?? form.category)
      : 'คำร้อง'
    supabase.functions.invoke('send-push', {
      body: {
        municipality_id: tenant.id,
        title: `คำร้องใหม่: ${catLabel}`,
        body: form.detail.trim().slice(0, 100),
        url: '/admin',
      },
    }).catch(() => {})

    notifyTelegram(tenant.telegram_group_id,
      `📋 <b>คำร้องใหม่</b>\nประเภท: ${catLabel}\nผู้แจ้ง: ${form.reporter_name.trim()}\nเบอร์: ${form.phone.trim()}\nรายละเอียด: ${form.detail.trim().slice(0, 120)}`
    )

    setSubmitting(false)
    setSuccess(true)
    setComplaintNumber(inserted.complaint_number ?? null)
  }

  if (success) return <SuccessScreen onBack={() => navigate('/')} complaintNumber={complaintNumber} />

  const geoLabel = geoStatus === GEO_STATUS.ok
    ? `${geo.lat?.toFixed(6)}, ${geo.lng?.toFixed(6)}`
    : 'ปักหมุดจากแผนที่'

  return (
    <div className="max-w-3xl mx-auto min-h-screen bg-gray-50">
      {showMap && (
        <MapPicker
          initialPos={geo.lat ? { lat: geo.lat, lng: geo.lng } : (tenant?.latitude ? { lat: tenant.latitude, lng: tenant.longitude } : null)}
          onConfirm={handleMapConfirm}
          onClose={() => setShowMap(false)}
        />
      )}

      {/* PDPA Modal */}
      {showPdpa && (
        <div className="fixed inset-0 z-300 flex items-end bg-black/40" onClick={() => setShowPdpa(false)}>
          <div
            className="w-full max-w-lg mx-auto bg-white rounded-t-3xl px-5 pt-5 pb-10 max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-gray-800 text-base">นโยบายความเป็นส่วนตัว (PDPA)</h2>
              <button onClick={() => setShowPdpa(false)} className="p-1.5 rounded-full hover:bg-gray-100">
                <X size={18} className="text-gray-500" />
              </button>
            </div>
            <div className="text-sm text-gray-600 leading-relaxed space-y-3">
              <p><strong>{tenant?.name ?? 'หน่วยงาน'}</strong> ในฐานะผู้ควบคุมข้อมูลส่วนบุคคล มีความจำเป็นต้องเก็บรวบรวมข้อมูลส่วนบุคคลของท่าน เพื่อใช้ในการดำเนินการตามคำร้องขอที่ท่านได้ยื่นมา</p>
              <p><strong>ข้อมูลที่เก็บรวบรวม</strong></p>
              <ul className="list-disc list-inside space-y-1 pl-1">
                <li>ชื่อ-นามสกุล และเบอร์โทรศัพท์ติดต่อ</li>
                <li>รายละเอียดคำร้องและประเภทปัญหา</li>
                <li>ตำแหน่งที่ตั้ง (หากให้ความยินยอม)</li>
                <li>ไฟล์ภาพหรือเอกสารที่แนบมา (หากมี)</li>
              </ul>
              <p><strong>วัตถุประสงค์การใช้งาน</strong></p>
              <p>ข้อมูลจะถูกใช้เพื่อดำเนินการตรวจสอบและแก้ไขปัญหาตามที่ร้องขอ ติดต่อกลับเพื่อแจ้งความคืบหน้า และปรับปรุงการให้บริการของหน่วยงานเท่านั้น</p>
              <p><strong>การเปิดเผยข้อมูล</strong></p>
              <p>หน่วยงานจะไม่เปิดเผยข้อมูลส่วนบุคคลของท่านให้แก่บุคคลภายนอก เว้นแต่เป็นการปฏิบัติตามกฎหมายหรือได้รับความยินยอมจากท่าน</p>
              <p><strong>สิทธิ์ของเจ้าของข้อมูล</strong></p>
              <p>ท่านมีสิทธิ์ขอเข้าถึง แก้ไข ลบ หรือถอนความยินยอมได้ตลอดเวลา โดยติดต่อ{tenant?.name ?? 'หน่วยงาน'}โดยตรง</p>
            </div>
            <button
              onClick={() => setShowPdpa(false)}
              className="mt-5 w-full py-3 rounded-2xl font-semibold text-white text-sm"
              style={{ backgroundColor: 'var(--color-primary)' }}
            >
              รับทราบ
            </button>
          </div>
        </div>
      )}
      {/* Mobile top bar */}
      <div className="md:hidden sticky top-0 z-10 flex items-center gap-3 px-4 py-3 text-white shadow-sm"
           style={{ background: ftConfig ? `linear-gradient(135deg, ${ftConfig.color}, ${ftConfig.color}cc)` : 'linear-gradient(135deg, var(--color-primary), var(--color-primary-dark))' }}>
        <button onClick={() => navigate(-1)} className="p-1.5 rounded-xl bg-white/20 hover:bg-white/30 transition-colors">
          <ArrowLeft size={20} className="text-white" />
        </button>
        <div>
          <h1 className="font-bold text-white text-base leading-tight">
            {ftConfig ? ftConfig.label : 'ยื่นคำร้องออนไลน์'}
          </h1>
          <p className="text-white/70 text-xs">{tenant?.name}</p>
        </div>
        {ftConfig?.gpsRequired && (
          <span className="ml-auto shrink-0 text-[10px] font-bold bg-white/20 text-white px-2 py-0.5 rounded-full">
            GPS บังคับ
          </span>
        )}
      </div>

      {/* PC header */}
      <div className="hidden md:flex items-center gap-3 px-6 pt-8 pb-5 border-b border-gray-200 mb-2">
        <div className="w-11 h-11 rounded-2xl flex items-center justify-center text-2xl shrink-0"
             style={{ background: ftConfig ? `linear-gradient(135deg, ${ftConfig.color}cc, ${ftConfig.color})` : 'linear-gradient(135deg, var(--color-primary), var(--color-primary-dark))' }}>
          {ftConfig?.icon ?? '📝'}
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-800">{ftConfig?.label ?? 'ยื่นคำร้องออนไลน์'}</h1>
          <p className="text-sm text-gray-500 mt-0.5">{tenant?.name}</p>
        </div>
        {ftConfig?.gpsRequired && (
          <span className="text-xs font-bold px-3 py-1 rounded-full"
                style={{ backgroundColor: ftConfig.color + '18', color: ftConfig.color }}>
            📍 GPS บังคับ
          </span>
        )}
      </div>

      <form onSubmit={handleSubmit} className="px-4 md:px-6 pt-5 pb-32 md:pb-10 space-y-4">
        {/* Category selector */}
        {ftConfig ? (
          /* System form: แสดงเป็น pill selector */
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
            <p className="text-sm font-semibold text-gray-700 mb-3">ประเภทย่อย</p>
            <div className="flex flex-wrap gap-2">
              {ftConfig.categories.map((cat) => (
                <button key={cat.value} type="button"
                  onClick={() => setForm((p) => ({ ...p, category: cat.value }))}
                  className="text-xs font-semibold px-3 py-1.5 rounded-full border transition-all"
                  style={form.category === cat.value
                    ? { backgroundColor: ftConfig.color, color: '#fff', borderColor: ftConfig.color }
                    : { backgroundColor: '#f8fafc', color: '#475569', borderColor: '#e2e8f0' }}>
                  {cat.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          /* Legacy: แสดงเป็น badge หัวข้อ */
          form.category && (
            <div className="flex items-center gap-2 px-1">
              <span className="text-xl font-bold text-gray-800">
                {categories.find((c) => c.value === form.category)?.label ?? form.category}
              </span>
            </div>
          )
        )}

        {/* Subject */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlignLeft size={16} style={{ color: 'var(--color-primary)' }} />
            <span className="text-sm font-semibold text-gray-700">เรื่อง</span>
          </div>
          <input
            type="text"
            value={form.subject}
            onChange={set('subject')}
            required
            placeholder="ระบุเรื่องที่ต้องการยื่นคำร้อง"
            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:border-transparent"
            style={{ '--tw-ring-color': 'var(--color-primary)' }}
          />
        </div>

        {/* Village → สถานที่เกิดเหตุ (dropdown) */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Home size={16} style={{ color: 'var(--color-primary)' }} />
            <span className="text-sm font-semibold text-gray-700">สถานที่เกิดเหตุ</span>
          </div>
          {locations.length === 0 ? (
            <input
              type="text"
              value={form.village}
              onChange={set('village')}
              placeholder="ระบุสถานที่เกิดเหตุ"
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:border-transparent"
              style={{ '--tw-ring-color': 'var(--color-primary)' }}
            />
          ) : (
            <div className="relative">
              <select
                value={form.village}
                onChange={set('village')}
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 pr-10 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:border-transparent appearance-none"
                style={{ '--tw-ring-color': 'var(--color-primary)' }}
              >
                <option value="">— เลือกสถานที่เกิดเหตุ —</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.name}>{l.name}</option>
                ))}
              </select>
              <ChevronDown size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            </div>
          )}
        </div>

        {/* Detail */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
          <div className="flex items-center gap-2 mb-3">
            <FileText size={16} style={{ color: 'var(--color-primary)' }} />
            <span className="text-sm font-semibold text-gray-700">รายละเอียดปัญหา</span>
          </div>
          <textarea value={form.detail} onChange={set('detail')} rows={4} required
            placeholder="อธิบายปัญหาที่พบ เช่น สถานที่ ความเร่งด่วน ความเสียหาย..."
            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-700 placeholder-gray-400 resize-none focus:outline-none focus:ring-2 focus:border-transparent"
            style={{ '--tw-ring-color': 'var(--color-primary)' }} />
          <p className="text-right text-xs text-gray-400 mt-1">{form.detail.length} ตัวอักษร</p>
        </div>

        {/* Reporter name */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
          <div className="flex items-center gap-2 mb-3">
            <User size={16} style={{ color: 'var(--color-primary)' }} />
            <span className="text-sm font-semibold text-gray-700">ชื่อ-นามสกุลผู้แจ้ง</span>
          </div>
          <input type="text" value={form.reporter_name} onChange={set('reporter_name')} required
            placeholder="กรอกชื่อ-นามสกุล"
            autoComplete="name"
            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:border-transparent"
            style={{ '--tw-ring-color': 'var(--color-primary)' }} />
        </div>

        {/* Phone */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Phone size={16} style={{ color: 'var(--color-primary)' }} />
            <span className="text-sm font-semibold text-gray-700">เบอร์โทรติดต่อ</span>
          </div>
          <input type="tel" value={form.phone} onChange={set('phone')} required
            placeholder="08X-XXX-XXXX"
            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:border-transparent"
            style={{ '--tw-ring-color': 'var(--color-primary)' }} />
        </div>

        {/* Geolocation */}
        <div className={`rounded-2xl shadow-sm border p-4 ${ftConfig?.gpsRequired ? 'bg-white border-orange-200 ring-1 ring-orange-100' : 'bg-white border-gray-100'}`}>
          <div className="flex items-center gap-2 mb-3">
            <MapPin size={16} style={{ color: ftConfig?.gpsRequired ? '#f97316' : 'var(--color-primary)' }} />
            <span className="text-sm font-semibold text-gray-700">ตำแหน่งที่เกิดเหตุ</span>
            {ftConfig?.gpsRequired && (
              <span className="ml-auto text-[10px] font-bold text-orange-600 bg-orange-50 px-2 py-0.5 rounded-full">
                * บังคับ
              </span>
            )}
          </div>
          <button type="button" onClick={() => setShowMap(true)}
            className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-medium border transition-all ${
              geoStatus === GEO_STATUS.ok
                ? 'bg-green-50 border-green-200 text-green-700'
                : 'bg-gray-50 border-gray-200 text-gray-600 hover:border-(--color-primary) hover:text-(--color-primary)'
            }`}>
            {geoStatus === GEO_STATUS.ok
              ? <CheckCircle2 size={16} />
              : <MapPin size={16} />}
            <span className="truncate">{geoLabel}</span>
          </button>
        </div>

        {/* Attachments */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Paperclip size={16} style={{ color: 'var(--color-primary)' }} />
            <span className="text-sm font-semibold text-gray-700">ไฟล์แนบ</span>
          </div>

          {/* preview grid */}
          {files.length > 0 && (
            <div className="grid grid-cols-3 gap-2 mb-3">
              {files.map((item, idx) => (
                <div key={idx} className="relative group rounded-xl overflow-hidden border border-gray-200 bg-gray-50 aspect-square flex items-center justify-center">
                  {item.preview
                    ? <img src={item.preview} alt={item.name} className="object-cover w-full h-full" />
                    : <div className="flex flex-col items-center gap-1 px-1">
                        <FileText size={24} className="text-gray-400" />
                        <span className="text-[11px] text-gray-400 text-center leading-tight truncate w-full px-1">{item.name}</span>
                      </div>
                  }
                  {item.compressed && (
                    <span className="absolute bottom-1 left-1 bg-green-500/80 text-white text-[9px] font-semibold px-1.5 py-0.5 rounded-full leading-none">
                      บีบอัด
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => removeFile(idx)}
                    className="absolute top-1 right-1 bg-black/50 rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X size={12} className="text-white" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {files.length < 5 && (
            <div className="flex gap-2">
              {/* เลือกจากคลังรูป/ไฟล์ */}
              <label className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border border-dashed border-gray-300 text-sm text-gray-500 hover:border-gray-400 cursor-pointer transition-colors">
                <Image size={16} />
                <span>รูปภาพ / ไฟล์</span>
                <input type="file" accept="image/*,.pdf,.doc,.docx" multiple className="hidden" onChange={handleFileChange} />
              </label>
              {/* ถ่ายภาพ */}
              <label className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border border-dashed border-gray-300 text-sm text-gray-500 hover:border-gray-400 cursor-pointer transition-colors">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>
                <span>ถ่ายรูป</span>
                <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFileChange} />
              </label>
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-2xl px-4 py-3 text-sm text-red-700">
            <FileText size={16} className="shrink-0 mt-0.5" />
            {error}
          </div>
        )}

        {/* Consent */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
          <label className="flex items-start gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-1 w-4 h-4 rounded accent-(--color-primary) shrink-0"
            />
            <span className="text-xs text-gray-600 leading-relaxed">
              ข้าพเจ้ารับรองว่าข้อมูลถูกต้องและเป็นความจริง ยอมรับผิดชอบทางแพ่งและอาญาหากเกิดความเสียหาย และยินยอมให้{tenant?.name ?? 'หน่วยงาน'}เก็บรวบรวมและใช้ข้อมูลส่วนบุคคลในคำร้องนี้เพื่อดำเนินการตามที่ร้องขอ ตาม{' '}
              <a
                href="#"
                className="underline"
                style={{ color: 'var(--color-primary)' }}
                onClick={(e) => { e.preventDefault(); setShowPdpa(true) }}
              >นโยบายความเป็นส่วนตัว (PDPA)</a>
            </span>
          </label>
        </div>
      </form>

      {/* Fixed submit button */}
      <div className="fixed bottom-16 left-0 right-0 p-4 bg-white border-t border-gray-100 shadow-lg max-w-lg mx-auto z-60">
        <button onClick={handleSubmit} disabled={submitting}
          className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl font-bold text-white shadow-lg active:scale-95 transition-all disabled:opacity-60"
          style={{ backgroundColor: 'var(--color-primary)' }}>
          {submitting
            ? <><Loader2 size={20} className="animate-spin" /> กำลังส่ง...</>
            : <><Send size={20} /> ส่งคำร้อง</>}
        </button>
      </div>
    </div>
  )
}
