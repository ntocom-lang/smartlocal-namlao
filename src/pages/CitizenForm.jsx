import { useState, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  MapPin, Phone, ChevronDown, ChevronRight,
  Loader2, CheckCircle2, ArrowLeft, X, User,
  Camera, Image, Trash2 as TrashIcon, Upload, CheckCircle,
  Lightbulb, Trash2, Scissors, Droplets, Package, Megaphone, Bug,
  Waves, Wind, Building2, Volume2, HelpCircle,
  CreditCard, PawPrint, Shield, FlameKindling, Axe, Wrench,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { notifyTelegram } from '../lib/notifyTelegram'
import { useTenant } from '../contexts/TenantContext'
import MapPicker from '../components/MapPicker'


const CATEGORY_ICON = {
  light:            Lightbulb,
  road:             Wrench,
  mosquito:         Bug,
  tree:             Scissors,
  trash:            Trash2,
  water_supply:     Droplets,
  drain:            Wind,
  flood:            Waves,
  borrow_equipment: Package,
  corruption:       Shield,
  grievance:        Megaphone,
  noise:            Volume2,
  building:         Building2,
  tax:              CreditCard,
  canal:            Axe,
  animals:          PawPrint,
  fire:             FlameKindling,
  phone_complaint:  Phone,
  waste_water:      Droplets,
  other:            HelpCircle,
}

const DEFAULT_CATEGORIES = [
  { value: 'light',            label: 'ไฟฟ้าสาธารณะ' },
  { value: 'road',             label: 'ซ่อมแซมถนน' },
  { value: 'mosquito',         label: 'พ่นยุง' },
  { value: 'tree',             label: 'ตัดต้นไม้' },
  { value: 'trash',            label: 'ขยะ / ความสะอาด' },
  { value: 'water_supply',     label: 'สนับสนุนน้ำอุปโภค' },
  { value: 'borrow_equipment', label: 'ยืมพัสดุ' },
  { value: 'corruption',       label: 'แจ้งการทุจริต' },
  { value: 'grievance',        label: 'แจ้งเรื่องร้องทุกข์' },
  { value: 'other',            label: 'อื่นๆ' },
]

const CATEGORY_DEPT = {
  light: 'กองช่าง', road: 'กองช่าง', road_concrete: 'กองช่าง',
  road_asphalt: 'กองช่าง', road_slurry: 'กองช่าง', road_gravel: 'กองช่าง',
  drain: 'กองช่าง', building: 'กองช่าง', pipe_water: 'กองช่าง',
  canal: 'กองช่าง', dredge: 'กองช่าง', waterway: 'กองช่าง',
  water_supply: 'กองช่าง', flood: 'กองช่าง',
  tax: 'กองคลัง',
}

const GEO_STATUS = { idle: 'idle', ok: 'ok' }

function SuccessScreen({ onBack, onMyComplaints, complaintNumber, isLoggedIn, complaintId }) {
  const [photos, setPhotos]       = useState([]) // { file, preview, status: 'pending'|'ok'|'error' }
  const [uploading, setUploading] = useState(false)
  const [uploadDone, setUploadDone] = useState(false)

  function handlePick(e) {
    const picked = Array.from(e.target.files).slice(0, 5 - photos.length)
    setPhotos(prev => [...prev, ...picked.map(f => ({ file: f, preview: URL.createObjectURL(f), status: 'pending' }))])
    e.target.value = ''
  }

  function removePhoto(idx) {
    setPhotos(prev => { URL.revokeObjectURL(prev[idx].preview); return prev.filter((_, i) => i !== idx) })
  }

  async function handleUpload() {
    if (!complaintId || photos.length === 0 || uploading) return
    setUploading(true)
    const updated = photos.map(p => ({ ...p }))
    const urls = []
    for (let i = 0; i < updated.length; i++) {
      if (updated[i].status === 'ok') continue
      try {
        const f = updated[i].file
        const ext = f.name.split('.').pop().toLowerCase() || 'jpg'
        const path = `${complaintId}/${crypto.randomUUID()}.${ext}`
        const base64 = await new Promise((res, rej) => {
          const reader = new FileReader()
          reader.onload = () => res(reader.result.split(',')[1])
          reader.onerror = rej
          reader.readAsDataURL(f)
        })
        const { data, error: fnErr } = await supabase.functions.invoke('upload-photo', {
          body: { path, data: base64, contentType: f.type || 'image/jpeg' },
        })
        if (fnErr || !data?.url) { updated[i].status = 'error' }
        else { updated[i].status = 'ok'; urls.push(data.url) }
      } catch { updated[i].status = 'error' }
      setPhotos([...updated])
    }
    if (urls.length > 0) {
      await supabase.rpc('attach_complaint_photos', { p_complaint_id: complaintId, p_urls: urls }).catch(() => {})
    }
    setUploading(false)
    setUploadDone(updated.every(p => p.status === 'ok'))
  }

  const hasError = photos.some(p => p.status === 'error')

  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] px-6 text-center">
      <div className="w-20 h-20 rounded-full bg-green-50 flex items-center justify-center mb-5">
        <CheckCircle2 size={44} className="text-green-500" />
      </div>
      <h2 className="text-xl font-bold text-gray-800 mb-2">ส่งคำร้องสำเร็จ!</h2>
      {complaintNumber && (
        <div className="mb-4 px-6 py-3 bg-gray-50 rounded-2xl border border-gray-100">
          <p className="text-xs text-gray-400 mb-0.5">เลขที่อ้างอิง — บันทึกไว้เพื่อติดตาม</p>
          <p className="text-2xl font-black text-gray-800 tracking-widest font-mono">{complaintNumber}</p>
        </div>
      )}

      {/* Photo section */}
      {complaintId && !uploadDone && (
        <div className="w-full max-w-xs mb-6 text-left">
          <p className="text-xs font-semibold text-gray-500 mb-2 text-center">ต้องการแนบรูปภาพประกอบ? (ไม่บังคับ)</p>

          {photos.length > 0 && (
            <div className="grid grid-cols-3 gap-2 mb-3">
              {photos.map((p, i) => (
                <div key={i} className="relative rounded-xl overflow-hidden aspect-square border-2"
                  style={{ borderColor: p.status === 'ok' ? '#22c55e' : p.status === 'error' ? '#ef4444' : '#e5e7eb' }}>
                  <img src={p.preview} alt="" className="w-full h-full object-cover" />
                  {p.status === 'ok' && (
                    <div className="absolute inset-0 bg-green-500/30 flex items-center justify-center">
                      <CheckCircle size={22} className="text-white drop-shadow" />
                    </div>
                  )}
                  {p.status === 'error' && (
                    <div className="absolute inset-0 bg-red-500/30 flex items-center justify-center">
                      <X size={22} className="text-white drop-shadow" />
                    </div>
                  )}
                  {p.status === 'pending' && !uploading && (
                    <button onClick={() => removePhoto(i)}
                      className="absolute top-1 right-1 bg-black/50 rounded-full p-0.5">
                      <X size={12} className="text-white" />
                    </button>
                  )}
                  {p.status === 'pending' && uploading && (
                    <div className="absolute inset-0 bg-black/20 flex items-center justify-center">
                      <Loader2 size={18} className="animate-spin text-white" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2 mb-3">
            {photos.length < 5 && (
              <>
                <label className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-2xl border-2 border-dashed border-gray-300 text-gray-500 text-xs font-semibold cursor-pointer hover:border-gray-400 transition-colors">
                  <Image size={16} /> แกลเลอรี
                  <input type="file" accept="image/*" multiple className="hidden" onChange={handlePick} />
                </label>
                <label className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-2xl border-2 border-dashed border-gray-300 text-gray-500 text-xs font-semibold cursor-pointer hover:border-gray-400 transition-colors">
                  <Camera size={16} /> กล้อง
                  <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handlePick} />
                </label>
              </>
            )}
          </div>

          {photos.length > 0 && (
            <button onClick={handleUpload} disabled={uploading}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl font-semibold text-sm text-white disabled:opacity-60 transition-all active:scale-95"
              style={{ backgroundColor: hasError ? '#ef4444' : 'var(--color-primary)' }}>
              {uploading
                ? <><Loader2 size={16} className="animate-spin" /> กำลังส่งรูป...</>
                : hasError
                ? <><Upload size={16} /> ส่งใหม่อีกครั้ง ({photos.filter(p => p.status !== 'ok').length} ภาพ)</>
                : <><Upload size={16} /> ส่งรูปภาพ {photos.length} ภาพ</>}
            </button>
          )}
        </div>
      )}

      {uploadDone && (
        <div className="mb-5 px-4 py-2.5 bg-green-50 border border-green-200 rounded-2xl flex items-center gap-2">
          <CheckCircle size={16} className="text-green-600 shrink-0" />
          <p className="text-xs text-green-700 font-semibold">แนบรูปภาพเรียบร้อย {photos.length} ภาพ</p>
        </div>
      )}

      <p className="text-gray-500 text-sm leading-relaxed mb-8 max-w-xs">
        เจ้าหน้าที่จะดำเนินการตรวจสอบและติดต่อกลับหาท่านโดยเร็วที่สุด
      </p>
      <div className="w-full max-w-xs flex flex-col gap-3">
        {isLoggedIn && (
          <button onClick={onMyComplaints}
            className="w-full py-3.5 rounded-2xl font-semibold text-white shadow-lg active:scale-95 transition-transform"
            style={{ backgroundColor: 'var(--color-primary)' }}>
            ติดตามสถานะคำร้อง
          </button>
        )}
        <button onClick={onBack}
          className="w-full py-3 rounded-2xl font-medium text-gray-600 bg-gray-100 active:scale-95 transition-transform">
          กลับหน้าหลัก
        </button>
      </div>
    </div>
  )
}

const FORM_TYPE_CONFIG = {
  infrastructure: {
    label: 'ยื่นคำร้อง',
    icon: '🔧',
    color: '#ef4444',
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
    categories: [
      { value: 'water_drought', label: '🚛  ขอน้ำช่วงฤดูแล้ง' },
      { value: 'water_tank',    label: '🪣  ถังน้ำกลางหมู่บ้านหมด' },
      { value: 'water_flood',   label: '🌊  ขอน้ำช่วงอุทกภัย' },
      { value: 'other',         label: '📝  อื่นๆ' },
    ],
    placeholder: 'อธิบายสถานการณ์ เช่น น้ำในถังกลางหมู่บ้านหมดแล้ว...',
  },
  environment: {
    label: 'แจ้งเหตุสิ่งแวดล้อม / จุดเสี่ยงภัย',
    icon: '🌿',
    color: '#10b981',
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
  const [showConsent, setShowConsent] = useState(false)
  const [isLoggedIn, setIsLoggedIn] = useState(false)

  const [showPdpa, setShowPdpa] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(false)
  const [complaintNumber, setComplaintNumber] = useState(null)
  const [savedComplaintId, setSavedComplaintId] = useState(null)
  const [locations, setLocations] = useState([])
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES)
  const abortCtrlRef = useRef(null)

  // ถ้า submitting อยู่แล้วกลับมาจาก background นาน > 5s → abort request ทันที
  // (setTimeout ถูก mobile browser pause แต่ visibilitychange fire ทันทีเมื่อ JS resume)
  useEffect(() => {
    if (!submitting) return
    let hiddenAt = null
    function onVisChange() {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now()
      } else if (document.visibilityState === 'visible' && hiddenAt !== null) {
        if (Date.now() - hiddenAt > 5_000) abortCtrlRef.current?.abort()
        hiddenAt = null
      }
    }
    document.addEventListener('visibilitychange', onVisChange)
    return () => document.removeEventListener('visibilitychange', onVisChange)
  }, [submitting])

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) return
      setIsLoggedIn(true)
      const meta = session.user.user_metadata ?? {}
      const metaName = meta.full_name || meta.name || ''
      const metaPhone = meta.phone || ''
      supabase.from('profiles').select('full_name, phone').eq('id', session.user.id).single()
        .then(({ data }) => {
          setForm((prev) => ({
            ...prev,
            ...(data?.full_name || metaName ? { reporter_name: data?.full_name || metaName } : {}),
            ...(data?.phone || metaPhone ? { phone: data?.phone || metaPhone } : {}),
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
    supabase.from('locations').select('id, name').eq('municipality_id', tenant.id).order('sort_order')
      .then(({ data }) => setLocations(data ?? []))
    supabase.from('complaint_categories').select('value, label, emoji').eq('municipality_id', tenant.id).order('sort_order')
      .then(({ data }) => {
        if (data && data.length > 0)
          setCategories(data.map((c) => ({ value: c.value, label: c.label })))
      })
  }, [tenant?.id])


  function raceTimeout(promise, ms) {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
    ])
  }


  // Upload รูปหลัง INSERT สำเร็จ — ส่งเป็น base64 JSON ผ่าน Edge Function
  const set = (field) => (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }))

  function handleMapConfirm({ lat, lng, address }) {
    setGeo({ lat, lng, address })
    setGeoStatus(GEO_STATUS.ok)
    setShowMap(false)
  }

  async function handleSubmit(e) {
    e?.preventDefault()
    if (!form.category) { setError('กรุณาเลือกประเภทคำร้อง'); return }
    if (!form.reporter_name.trim()) { setError('กรุณากรอกชื่อ-นามสกุล'); return }
    if (!form.subject.trim()) { setError('กรุณากรอกหัวข้อ'); return }
    if (form.detail.trim().length < 10) { setError('กรุณาอธิบายรายละเอียดอย่างน้อย 10 ตัวอักษร'); return }
    if (!form.phone.trim()) { setError('กรุณากรอกเบอร์โทรติดต่อ'); return }
    if (!tenant?.id) { setError('ไม่พบข้อมูลหน่วยงาน'); return }

    setError(null)
    setSubmitting(true)

    const abortCtrl = new AbortController()
    abortCtrlRef.current = abortCtrl

    try {
      // getSession อ่านจาก IndexedDB — timeout 5s กันแขวนบน mobile
      const { data: sessionData } = await raceTimeout(
        supabase.auth.getSession().catch(() => ({ data: null })),
        5_000,
      ).catch(() => ({ data: null }))
      const userId = sessionData?.session?.user?.id ?? null
      const complaintId = crypto.randomUUID()

      // INSERT ก่อน — ไม่รอ upload (upload ค้างบน mobile ทำให้ connection เย็นลง INSERT ก็ stall ด้วย)
      let insertResult
      try {
        insertResult = await raceTimeout(
          supabase.from('complaints').insert({
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
            user_id:         userId,
            attachments:     [],
            department:      CATEGORY_DEPT[form.category] ?? 'สำนักปลัด',
          }).select('id, ref_no').single()
            .abortSignal(abortCtrl.signal),
          20_000,
        )
      } catch {
        setError('เครือข่ายช้าหรือขาดหาย กรุณาตรวจสอบสัญญาณแล้วกด ยื่นคำร้อง อีกครั้ง')
        return
      }
      const { data: inserted, error: dbError } = insertResult ?? {}
      if (dbError) { setError(`เกิดข้อผิดพลาด: ${dbError.message}`); return }

      setSuccess(true)
      setComplaintNumber(inserted?.ref_no ?? null)
      setSavedComplaintId(complaintId)

      const allCats = [...(ftConfig?.categories ?? []), ...categories]
      const catLabel = allCats.find((c) => c.value === form.category)?.label?.replace(/^[\p{Emoji}\s]+/u, '').trim() ?? form.category
      supabase.functions.invoke('send-push', {
        body: { municipality_id: tenant.id, title: `คำร้องใหม่: ${catLabel}`, body: form.detail.trim().slice(0, 100), url: '/admin' },
      }).catch(() => {})
      notifyTelegram(tenant.telegram_group_id,
        `📋 <b>คำร้องใหม่</b>\nประเภท: ${catLabel}\nผู้แจ้ง: ${form.reporter_name.trim()}\nเบอร์: ${form.phone.trim()}\nรายละเอียด: ${form.detail.trim().slice(0, 120)}`
      )
    } catch (err) {
      const isNetworkErr = err?.message?.toLowerCase().includes('fetch') || err?.message?.toLowerCase().includes('network')
      setError(isNetworkErr ? 'ไม่มีสัญญาณอินเทอร์เน็ต กรุณาตรวจสอบสัญญาณแล้วลองใหม่' : 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง')
    } finally {
      setSubmitting(false)
      abortCtrlRef.current = null
    }
  }

  if (success) return <SuccessScreen onBack={() => navigate('/')} onMyComplaints={() => navigate('/my-complaints')} complaintNumber={complaintNumber} isLoggedIn={isLoggedIn} complaintId={savedComplaintId} />

  const allCatsDisplay = [...(ftConfig?.categories ?? []), ...categories]
  const catLabel = allCatsDisplay.find((c) => c.value === form.category)?.label?.replace(/^[\p{Emoji}\s]+/u, '').trim() ?? form.category
  const CatIcon = CATEGORY_ICON[form.category] ?? HelpCircle

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#eef2f7' }}>

      {/* PC header */}
      <div className="hidden md:flex items-center justify-between px-8 py-4 bg-white border-b border-gray-200 shadow-sm">
        <h1 className="text-lg font-bold text-gray-800">ยื่นคำร้อง</h1>
        <button onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 transition-colors">
          <ArrowLeft size={15} />
          ย้อนกลับ
        </button>
      </div>

      <div className="max-w-lg mx-auto">

      {/* MapPicker */}
      {showMap && (
        <MapPicker
          initialPos={geo.lat ? { lat: geo.lat, lng: geo.lng } : null}
          fallbackPos={tenant?.latitude ? { lat: tenant.latitude, lng: tenant.longitude } : null}
          onConfirm={handleMapConfirm}
          onClose={() => setShowMap(false)}
        />
      )}

      {/* PDPA Modal */}
      {showPdpa && (
        <div className="fixed inset-0 z-300 flex items-end bg-black/40" onClick={() => setShowPdpa(false)}>
          <div className="w-full max-w-lg mx-auto bg-white rounded-t-3xl px-5 pt-5 pb-10 max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-gray-800 text-base">นโยบายความเป็นส่วนตัว (PDPA)</h2>
              <button onClick={() => setShowPdpa(false)} className="p-1.5 rounded-full hover:bg-gray-100">
                <X size={18} className="text-gray-500" />
              </button>
            </div>
            <div className="text-sm text-gray-600 leading-relaxed space-y-3">
              <p><strong>{tenant?.name ?? 'หน่วยงาน'}</strong> มีความจำเป็นต้องเก็บรวบรวมข้อมูลส่วนบุคคลของท่านเพื่อดำเนินการตามคำร้องที่ยื่นมา</p>
              <p><strong>ข้อมูลที่เก็บรวบรวม</strong></p>
              <ul className="list-disc list-inside space-y-1 pl-1">
                <li>ชื่อ-นามสกุล และเบอร์โทรศัพท์ติดต่อ</li>
                <li>รายละเอียดคำร้องและประเภทปัญหา</li>
                <li>ตำแหน่งที่ตั้ง (หากให้ความยินยอม)</li>
                <li>ไฟล์ภาพหรือเอกสารที่แนบมา (หากมี)</li>
              </ul>
              <p>ข้อมูลจะถูกใช้เพื่อดำเนินการตรวจสอบและแก้ไขปัญหาตามที่ร้องขอเท่านั้น และจะไม่ถูกเปิดเผยให้บุคคลภายนอก เว้นแต่เป็นการปฏิบัติตามกฎหมาย</p>
            </div>
            <button onClick={() => setShowPdpa(false)}
              className="mt-5 w-full py-3 rounded-2xl font-semibold text-white text-sm"
              style={{ backgroundColor: 'var(--color-primary)' }}>รับทราบ</button>
          </div>
        </div>
      )}

      {/* Mobile header */}
      <div className="md:hidden sticky top-0 z-10 flex items-center gap-3 px-4 py-3 shadow-sm"
        style={{ background: 'linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%)' }}>
        <button onClick={() => navigate(-1)}
          className="p-1.5 rounded-xl bg-white/20 hover:bg-white/30 transition-colors">
          <ArrowLeft size={20} className="text-white" />
        </button>
        <h1 className="font-bold text-white text-base flex-1 text-center pr-8">
          {ftConfig ? ftConfig.label : 'ยื่นคำร้อง'}
        </h1>
      </div>

      {/* Category display row */}
      {!ftConfig && form.category && (
        <div className="flex items-center gap-3 px-4 py-3 bg-white border-b border-gray-100">
          <div className="w-13 h-13 rounded-full bg-blue-50 flex items-center justify-center shrink-0"
            style={{ width: 40, height: 40 }}>
            <CatIcon size={20} strokeWidth={1.5} style={{ color: 'var(--color-primary)' }} />
          </div>
          <span className="text-base font-bold text-gray-800">{catLabel}</span>
        </div>
      )}

      {/* ftConfig: subcategory pills */}
      {ftConfig && (
        <div className="bg-white px-4 py-3 border-b border-gray-100">
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
      )}

      {/* Form */}
      <form onSubmit={handleSubmit} className="px-3 pt-3 pb-24 space-y-2">

        {!isLoggedIn && (
          <div className="bg-blue-50 border border-blue-100 rounded-xl px-3.5 py-2.5 flex items-center gap-2.5">
            <User size={14} className="text-blue-400 shrink-0" />
            <p className="text-xs text-blue-600 leading-relaxed">
              ไม่ต้องเข้าสู่ระบบก็ยื่นได้ — กรอกชื่อและเบอร์ติดต่อเพื่อให้เจ้าหน้าที่ตามงานได้
            </p>
          </div>
        )}

        {/* Reporter name */}
        <div className="relative">
          <input type="text" value={form.reporter_name}
            onChange={isLoggedIn ? undefined : set('reporter_name')}
            readOnly={isLoggedIn}
            placeholder="ชื่อ-นามสกุล *"
            className={`w-full px-4 py-2.5 pl-10 rounded-xl border text-gray-900 text-sm placeholder-gray-400 focus:outline-none focus:border-blue-400 ${isLoggedIn ? 'bg-gray-50 border-gray-200 text-gray-500' : 'bg-white border-gray-300'}`} />
          <User size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          {isLoggedIn && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-emerald-500 font-semibold">จากโปรไฟล์</span>}
        </div>

        {/* Subject */}
        <input type="text" value={form.subject} onChange={set('subject')} required
          placeholder="หัวข้อ"
          className="w-full px-4 py-2.5 rounded-xl border border-gray-300 bg-white text-gray-900 text-sm placeholder-gray-400 focus:outline-none focus:border-blue-400" />

        {/* Detail */}
        <textarea value={form.detail} onChange={set('detail')} rows={4} required
          placeholder={ftConfig?.placeholder ?? 'รายละเอียด'}
          className="w-full px-4 py-3.5 rounded-xl border border-gray-300 bg-white text-gray-900 text-sm placeholder-gray-400 resize-none focus:outline-none focus:border-blue-400" />

        {/* Village */}
        {locations.length === 0 ? (
          <input type="text" value={form.village} onChange={set('village')}
            placeholder="สถานที่"
            className="w-full px-4 py-2.5 rounded-xl border border-gray-300 bg-white text-gray-900 text-sm placeholder-gray-400 focus:outline-none focus:border-blue-400" />
        ) : (
          <div className="relative">
            <select value={form.village} onChange={set('village')}
              className="w-full px-4 py-2.5 pr-10 rounded-xl border border-gray-300 bg-white text-gray-900 text-sm focus:outline-none focus:border-blue-400 appearance-none">
              <option value="">— เลือกสถานที่ —</option>
              {locations.map((l) => <option key={l.id} value={l.name}>{l.name}</option>)}
            </select>
            <ChevronDown size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>
        )}

        {/* Phone */}
        <div className="relative">
          <input type="tel" value={form.phone}
            onChange={isLoggedIn && form.phone ? undefined : set('phone')}
            readOnly={isLoggedIn && !!form.phone}
            placeholder="เบอร์ติดต่อ *"
            className={`w-full px-4 py-2.5 pl-10 rounded-xl border text-gray-900 text-sm placeholder-gray-400 focus:outline-none focus:border-blue-400 ${isLoggedIn && form.phone ? 'bg-gray-50 border-gray-200 text-gray-500' : 'bg-white border-gray-300'}`} />
          <Phone size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          {isLoggedIn && form.phone && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-emerald-500 font-semibold">จากโปรไฟล์</span>}
        </div>

        {/* Map pin */}
        <button type="button" onClick={() => setShowMap(true)}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-full font-semibold text-white text-sm transition-all active:scale-95 shadow-sm"
          style={{ backgroundColor: geoStatus === GEO_STATUS.ok ? '#16a34a' : 'var(--color-primary)' }}>
          {geoStatus === GEO_STATUS.ok
            ? <CheckCircle2 size={18} />
            : <MapPin size={18} />}
          <span className="truncate max-w-[220px]">
            {geoStatus === GEO_STATUS.ok
              ? `${geo.lat?.toFixed(5)}, ${geo.lng?.toFixed(5)}`
              : 'ปักหมุดจากแผนที่'}
          </span>
          {geoStatus !== GEO_STATUS.ok && <ChevronRight size={18} />}
        </button>

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Submit */}
        <button type="button" onClick={() => {
          setError(null)
          if (!form.category) { setError('กรุณาเลือกประเภทคำร้อง'); return }
          if (!form.reporter_name.trim()) { setError('กรุณากรอกชื่อ-นามสกุล'); return }
          if (!form.subject.trim()) { setError('กรุณากรอกหัวข้อ'); return }
          if (form.detail.trim().length < 10) { setError('กรุณาอธิบายรายละเอียดอย่างน้อย 10 ตัวอักษร'); return }
          if (!form.phone.trim()) { setError('กรุณากรอกเบอร์โทรติดต่อ'); return }
          setShowConsent(true)
        }} disabled={submitting}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-full font-semibold text-white text-sm shadow-sm active:scale-95 transition-all disabled:opacity-60"
          style={{ backgroundColor: '#16a34a' }}>
          {submitting
            ? <><Loader2 size={18} className="animate-spin" /> กำลังส่ง...</>
            : 'ยื่นคำร้อง'}
        </button>


      </form>

      {/* Consent modal */}
      {showConsent && (
        <div className="fixed inset-0 z-200 flex items-end bg-black/40" onClick={() => setShowConsent(false)}>
          <div className="w-full max-w-lg mx-auto bg-white rounded-t-3xl px-5 pt-5 pb-8"
            onClick={(e) => e.stopPropagation()}>
            <h2 className="font-bold text-gray-800 text-base mb-3">ยืนยันการส่งคำร้อง</h2>
            <p className="text-sm text-gray-600 leading-relaxed mb-4">
              ข้าพเจ้ารับรองว่าข้อมูลถูกต้องและเป็นความจริง และยินยอมให้{tenant?.name ?? 'หน่วยงาน'}เก็บข้อมูลส่วนบุคคลเพื่อดำเนินการตามคำร้อง ตาม{' '}
              <a href="#" className="underline" style={{ color: 'var(--color-primary)' }}
                onClick={(e) => { e.preventDefault(); setShowConsent(false); setShowPdpa(true) }}>นโยบายความเป็นส่วนตัว (PDPA)</a>
            </p>
            <div className="flex gap-3">
              <button onClick={() => setShowConsent(false)}
                className="flex-1 py-3 rounded-2xl border border-gray-200 text-gray-600 text-sm font-medium">
                ยกเลิก
              </button>
              <button onClick={() => { setShowConsent(false); handleSubmit() }} disabled={submitting}
                className="flex-1 py-3 rounded-2xl font-semibold text-white text-sm disabled:opacity-60"
                style={{ backgroundColor: 'var(--color-primary)' }}>
                {submitting ? <Loader2 size={16} className="animate-spin mx-auto" /> : 'ยอมรับและส่ง'}
              </button>
            </div>
          </div>
        </div>
      )}

      </div>
    </div>
  )
}
