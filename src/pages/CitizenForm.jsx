import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  MapPin, Phone, ChevronDown, ChevronRight,
  Loader2, CheckCircle2, ArrowLeft, X, User,
  ImagePlus,
  Lightbulb, Trash2, Scissors, Droplets, Package, Megaphone, Bug,
  Waves, Wind, Building2, Volume2, HelpCircle,
  CreditCard, PawPrint, Shield, FlameKindling, Axe, Wrench,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { notifyTelegram } from '../lib/notifyTelegram'
import { useTenant } from '../contexts/TenantContext'
import { CategoryIcon } from '../lib/categoryIcon'
import { compressImage } from '../lib/imageUtils'
import MapPicker from '../components/MapPicker'
import { NAME_TITLES, splitThaiFullName, joinThaiFullName } from '../lib/thaiName'
import { uploadFile } from '../lib/driveStorage'
import { ODOR_TIME_RANGES } from '../lib/odorTimeRanges'

const MAX_PHOTOS = 3


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
  odor:             Wind,
  other:            HelpCircle,
}

const FALLBACK_EMOJI = {
  light: '💡', road: '🛣️', mosquito: '🦟', tree: '🌳',
  trash: '🗑️', water_supply: '🚿', drain: '🕳️', flood: '🌊',
  borrow_equipment: '📦', corruption: '⚖️', grievance: '📣',
  noise: '📢', building: '🏗️', tax: '📋', canal: '🏞️',
  animals: '🐕', fire: '🔥', phone_complaint: '📞',
  waste_water: '💧', odor: '💨', other: '📝',
}

const FALLBACK_COLOR = {
  light: '#f59e0b', road: '#3b82f6', mosquito: '#10b981', tree: '#22c55e',
  trash: '#6b7280', water_supply: '#06b6d4', drain: '#8b5cf6', flood: '#0ea5e9',
  borrow_equipment: '#f97316', corruption: '#ef4444', grievance: '#ec4899',
  noise: '#a855f7', building: '#64748b', tax: '#14b8a6', canal: '#78716c',
  animals: '#f97316', fire: '#ef4444', phone_complaint: '#3b82f6',
  waste_water: '#06b6d4', odor: '#84cc16', other: '#9ca3af',
}

// ตัวเลือก "ลักษณะปัญหา" เฉพาะหมวดที่มีประโยชน์จริง (ตอนนี้มีแค่ไฟฟ้าสาธารณะ) — เพิ่มหมวดอื่นได้โดยเพิ่ม
// key ใหม่ที่นี่ ไม่ต้องแก้ที่อื่น (การ render/validate เช็คแค่ ISSUE_TYPES_BY_CATEGORY[form.category])
const ISSUE_TYPES_BY_CATEGORY = {
  light: ['ไฟดับทั้งดวง', 'ไฟกระพริบ', 'เสาเอียง/ชำรุด', 'สายไฟชำรุด', 'ต้องการติดตั้งเพิ่ม', 'อื่นๆ'],
}

// ฟิลด์เสริมของหมวด "กลิ่นเหม็นรบกวน (มลพิษทางอากาศ)" — เก็บรวมเป็น complaints.extra_data (jsonb) ก้อนเดียว
// ไม่ใช่คอลัมน์แยกทีละฟิลด์ เพราะยังไม่มีความจำเป็นต้องกรอง/ออกรายงานสถิติแยกรายฟิลด์ในเร็วๆ นี้
const ODOR_INTENSITY_LEVELS = [
  { value: 1, label: 'ได้กลิ่นจางๆ' },
  { value: 2, label: 'ได้กลิ่นชัดเจน' },
  { value: 3, label: 'รบกวนการใช้ชีวิต' },
  { value: 4, label: 'แสบจมูก/เวียนหัว' },
  { value: 5, label: 'รุนแรงจนนอนไม่หลับ' },
]
const WIND_DIRECTIONS = ['เหนือ', 'ใต้', 'ตะวันออก', 'ตะวันตก', 'ลมสงบ']
const HEALTH_EFFECT_NONE = 'ไม่มีอาการทางกาย'
const HEALTH_EFFECT_OPTIONS = ['เวียนศีรษะ', 'คลื่นไส้', 'ระคายเคืองทางเดินหายใจ', HEALTH_EFFECT_NONE]

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
  { value: 'odor',             label: 'กลิ่นเหม็นรบกวน (มลพิษทางอากาศ)' },
  { value: 'other',            label: 'อื่นๆ' },
]

const REPAIR_CATEGORIES = new Set([
  'light', 'road', 'road_concrete', 'road_asphalt', 'road_slurry', 'road_gravel',
  'drain', 'manhole', 'pipe_water',
])

function getFormActionCopy(formType, category, categoryLabel = '') {
  if (formType === 'infrastructure') {
    return { title: 'แจ้งเหตุ/แจ้งซ่อม', submit: 'ส่งเรื่องแจ้งเหตุ/แจ้งซ่อม' }
  }
  if (formType === 'water_support') {
    return { title: 'ขอสนับสนุนน้ำอุปโภค-บริโภค', submit: 'ส่งคำขอรับบริการ' }
  }
  if (category === 'mosquito') {
    return { title: 'ขอรับบริการควบคุมและกำจัดยุง', submit: 'ส่งคำขอรับบริการ' }
  }
  if (category === 'disease') {
    return { title: 'ขอรับบริการควบคุมโรคติดต่อ', submit: 'ส่งคำขอรับบริการ' }
  }
  if (['water_supply', 'borrow_equipment', 'suction'].includes(category)) {
    return { title: categoryLabel || 'ขอรับบริการ', submit: 'ส่งคำขอรับบริการ' }
  }
  if (category === 'grievance') {
    return { title: 'แจ้งเรื่องร้องทุกข์', submit: 'ส่งเรื่องร้องทุกข์' }
  }
  if (category === 'corruption') {
    return { title: 'แจ้งเบาะแสหรือข้อร้องเรียนทุจริต', submit: 'ส่งเรื่องร้องเรียน' }
  }
  if (category === 'odor') {
    return { title: 'แจ้งกลิ่นเหม็นรบกวน (มลพิษทางอากาศ)', submit: 'ส่งเรื่องแจ้งกลิ่นเหม็น' }
  }
  if (REPAIR_CATEGORIES.has(category)) {
    return { title: categoryLabel ? `แจ้ง${categoryLabel}ชำรุด` : 'แจ้งเหตุ/แจ้งซ่อม', submit: 'ส่งเรื่องแจ้งซ่อม' }
  }
  if (formType === 'environment') {
    return { title: 'แจ้งเหตุสิ่งแวดล้อม/ขอรับบริการ', submit: 'ส่งคำร้อง' }
  }
  return { title: categoryLabel || 'ยื่นคำร้อง', submit: 'ส่งคำร้อง' }
}

const GEO_STATUS = { idle: 'idle', ok: 'ok' }

function SuccessScreen({ onBack, onMyComplaints, complaintNumber, isLoggedIn, complaintId, photoFiles, primaryColor }) {
  const { tenant } = useTenant()
  const [items, setItems] = useState(() =>
    (photoFiles ?? []).map(f => ({ file: f, status: 'pending' }))
  )
  const [uploading, setUploading] = useState(false)
  const [dbSaved, setDbSaved] = useState(null) // null=pending, true=ok, false=error
  const didMount = useRef(false)

  const hasItems  = items.length > 0
  const allOk     = hasItems && items.every(i => i.status === 'ok')
  const hasFailed = items.some(i => i.status === 'error')
  const okCount   = items.filter(i => i.status === 'ok').length
  const failCount = items.filter(i => i.status === 'error').length
  const busy      = uploading || (hasItems && !hasFailed && dbSaved === null)

  const uploadAll = useCallback(async () => {
    if (!complaintId) return
    let toUpload = []
    setItems(prev => {
      toUpload = prev.map((item, idx) => ({ ...item, idx })).filter(i => i.status !== 'ok')
      return prev.map(i => i.status === 'error' ? { ...i, status: 'pending' } : i)
    })
    if (toUpload.length === 0) return
    setUploading(true)
    setDbSaved(null)

    const collected = []
    await Promise.all(
      toUpload.map(async ({ file, idx }) => {
        try {
          let compressed
          try { compressed = await compressImage(file, undefined, 0.85) }
          catch { try { compressed = await compressImage(file, 480, 0.60) } catch { compressed = file } }
          const { url, error } = await uploadFile('complaint-attachments', compressed, {
            subject: complaintId,
            filename: `${crypto.randomUUID()}.jpg`,
            municipality: tenant?.slug,
          })
          if (error) throw error
          collected.push(url)
          setItems(prev => prev.map((p, i) => i === idx ? { ...p, status: 'ok' } : p))
        } catch (err) {
          console.error('[upload]', file.name, err?.message ?? err)
          setItems(prev => prev.map((p, i) => i === idx ? { ...p, status: 'error', errMsg: err?.message } : p))
        }
      })
    )
    setUploading(false)

    if (collected.length > 0) {
      let saved = false
      for (let attempt = 0; attempt < 3 && !saved; attempt++) {
        try {
          const { data: ok, error } = await supabase.rpc('attach_complaint_photos', {
            p_complaint_id: complaintId,
            p_urls: collected,
          })
          if (error) throw error
          if (!ok) throw new Error('attach_failed')
          saved = true
        } catch (err) {
          console.error('[db-save] attempt', attempt + 1, err?.message ?? err)
          if (attempt < 2) await new Promise(r => setTimeout(r, 1500))
        }
      }
      setDbSaved(saved)
    } else {
      setDbSaved(true)
    }
  }, [complaintId])

  useEffect(() => {
    if (!didMount.current && hasItems) { didMount.current = true; uploadAll() }
  }, [hasItems, uploadAll])

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

      {hasItems && (
        <div className="w-full max-w-xs mb-5">
          <div className="flex items-center justify-center gap-2 mb-2">
            {items.map((item, i) => (
              <div key={i} className="flex flex-col items-center gap-1">
                <div className="w-12 h-12 rounded-xl border-2 flex items-center justify-center bg-gray-50"
                  style={{ borderColor: item.status === 'ok' ? '#22c55e' : item.status === 'error' ? '#ef4444' : '#e5e7eb' }}>
                  {item.status === 'pending' && <Loader2 size={18} className="animate-spin text-gray-300" />}
                  {item.status === 'ok'      && <CheckCircle2 size={18} className="text-green-500" />}
                  {item.status === 'error'   && <X size={18} className="text-red-400" />}
                </div>
                {item.status === 'error' && item.errMsg && (
                  <p className="text-[9px] text-red-400 max-w-[60px] text-center leading-tight">{item.errMsg}</p>
                )}
              </div>
            ))}
          </div>
          {uploading && <p className="text-xs text-gray-400">กำลังอัปโหลดรูปภาพ...</p>}
          {!uploading && allOk && dbSaved === null && <p className="text-xs text-gray-400">กำลังบันทึก...</p>}
          {!uploading && allOk && dbSaved === true && <p className="text-xs text-green-600 font-semibold">แนบรูปภาพเรียบร้อย {okCount} รูป</p>}
          {!uploading && allOk && dbSaved === false && <p className="text-xs text-red-500 font-semibold">บันทึกรูปไม่สำเร็จ กรุณาลองใหม่</p>}
          {hasFailed && !uploading && (
            <button onClick={uploadAll}
              className="mt-2 w-full py-2 rounded-xl text-xs font-semibold text-white"
              style={{ backgroundColor: primaryColor }}>
              ลองอัปโหลดใหม่อีกครั้ง ({failCount} รายการ)
            </button>
          )}
        </div>
      )}

      <p className="text-gray-500 text-sm leading-relaxed mb-8 max-w-xs">
        เจ้าหน้าที่จะดำเนินการตรวจสอบและติดต่อกลับหาท่านโดยเร็วที่สุด
      </p>
      <div className="w-full max-w-xs flex flex-col gap-3">
        {isLoggedIn && (
          <button onClick={onMyComplaints} disabled={busy}
            className="w-full py-3.5 rounded-2xl font-semibold text-white shadow-lg active:scale-95 transition-all disabled:opacity-50"
            style={{ backgroundColor: 'var(--color-primary)' }}>
            {busy ? <Loader2 size={18} className="animate-spin mx-auto" /> : 'ติดตามสถานะคำร้อง'}
          </button>
        )}
        <button onClick={onBack} disabled={busy}
          className="w-full py-3 rounded-2xl font-medium text-gray-600 bg-gray-100 active:scale-95 transition-all disabled:opacity-50">
          กลับหน้าหลัก
        </button>
      </div>
    </div>
  )
}

const FORM_TYPE_CONFIG = {
  infrastructure: {
    label: 'แจ้งเหตุ/แจ้งซ่อม',
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
    label: 'แจ้งเหตุสิ่งแวดล้อม / ขอรับบริการ',
    icon: '🌿',
    color: '#10b981',
    categories: [
      { value: 'trash',       label: '🗑️  ขยะตกค้าง / ทิ้งผิดที่' },
      { value: 'tree',        label: '🌳  กิ่งไม้ / ต้นไม้อันตราย' },
      { value: 'env_hazard',  label: '⚠️  จุดเสี่ยง / มั่วสุม' },
      { value: 'env_fire',    label: '🔥  ควันไฟ / เผาป่า' },
      { value: 'mosquito',    label: '🦟  ยุงชุกชุม / น้ำขัง' },
      { value: 'pollution',   label: '🌫️  กลิ่น / มลพิษ' },
      { value: 'odor',        label: '💨  กลิ่นเหม็นรบกวน (มลพิษทางอากาศ)' },
      { value: 'other',       label: '📝  อื่นๆ' },
    ],
    placeholder: 'อธิบายสถานการณ์ เช่น พบขยะทิ้งเกลื่อนข้างทาง มีกลิ่นเหม็น...',
  },
}

export default function CitizenForm() {
  const { tenant } = useTenant()
  const primaryBg = 'linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%)'
  const primaryColor = 'var(--color-primary)'
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const preCategory = searchParams.get('category') ?? ''
  const formType = searchParams.get('form') ?? 'legacy'
  const ftConfig = FORM_TYPE_CONFIG[formType] ?? null

  const defaultCategory = ftConfig?.categories?.[0]?.value ?? preCategory
  const [form, setForm] = useState({
    category: defaultCategory, issue_type: '', village: '', detail: '', phone: '',
    name_title: '', name_first: '', name_last: '',
    // ฟิลด์เสริมเฉพาะหมวด odor — ดู buildExtraData()/validateOdorFields() ด้านล่าง
    odor_intensity: '', wind_direction: '', health_effect: '', odor_time_range: '',
  })
  const [profilePhone, setProfilePhone] = useState('') // เบอร์เดิมจากโปรไฟล์ ไว้เทียบว่าผู้ใช้แก้เบอร์หรือไม่
  const [syncPhoneToProfile, setSyncPhoneToProfile] = useState(false)
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
  const [savedPhotoFiles, setSavedPhotoFiles] = useState([])
  const [photos, setPhotos] = useState([]) // { file, preview }
  const [locations, setLocations] = useState([])
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES)
  // ค่าที่ "มีแถวในตารางของเทศบาลนี้แต่ is_active=false" เท่านั้น — ค่าที่ไม่มีแถวเลย (env_hazard,
  // env_fire, pollution, water_flood ที่มีแต่ใน FORM_TYPE_CONFIG) จะไม่อยู่ในนี้และยังแสดงตามเดิม
  // ตั้งใจไม่ใช้วิธี intersect pills กับตารางตรงๆ เพราะจะทำให้ค่าพวกนั้นหายหมดทุกเทศบาล
  const [disabledCategoryValues, setDisabledCategoryValues] = useState(() => new Set())
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
          const { title, first, last } = splitThaiFullName(data?.full_name || metaName)
          const resolvedPhone = data?.phone || metaPhone
          setForm((prev) => ({
            ...prev,
            ...(data?.full_name || metaName ? { name_title: title, name_first: first, name_last: last } : {}),
            ...(resolvedPhone ? { phone: resolvedPhone } : {}),
          }))
          setProfilePhone(resolvedPhone || '')
        })
        .catch(() => {
          const { title, first, last } = splitThaiFullName(metaName)
          setForm((prev) => ({
            ...prev,
            ...(metaName ? { name_title: title, name_first: first, name_last: last } : {}),
            ...(metaPhone ? { phone: metaPhone } : {}),
          }))
          setProfilePhone(metaPhone || '')
        })
    })
  }, [])

  useEffect(() => {
    if (!tenant?.id) return
    supabase.from('locations').select('id, name').eq('municipality_id', tenant.id).order('sort_order')
      .then(({ data }) => setLocations(data ?? []))
    // ดึงทุกแถวรวมที่ปิดใช้งาน (เดิมกรอง is_active=true มาตั้งแต่ query เลยไม่รู้ว่าหมวดไหนถูกปิด)
    // เพราะ pills ของ FORM_TYPE_CONFIG เป็น list ที่ hardcode ไว้ในโค้ด ไม่ได้มาจากตารางนี้ ต้องรู้ว่า
    // เทศบาลนี้ปิดหมวดไหนไว้ถึงจะซ่อน pill ให้ตรงกันได้ — ไม่งั้นแอดมินปิดหมวดใน DB แล้วประชาชน
    // ยังกดเลือกได้อยู่ผ่านลิงก์ ?form=... (เคสจริง: หมวดเฉพาะกิจ odor ที่ใช้แค่บางเทศบาล)
    supabase.from('complaint_categories').select('value, label, emoji, color, is_active').eq('municipality_id', tenant.id).order('sort_order')
      .then(({ data }) => {
        if (!data) return
        const active = data.filter((c) => c.is_active)
        if (active.length > 0)
          setCategories(active.map((c) => ({ value: c.value, label: c.label, emoji: c.emoji, color: c.color })))
        setDisabledCategoryValues(new Set(data.filter((c) => !c.is_active).map((c) => c.value)))
      })
  }, [tenant?.id])


  function raceTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), ms)
      promise.then(
        v => { clearTimeout(timer); resolve(v) },
        e => { clearTimeout(timer); reject(e) },
      )
    })
  }


  const photosRef = useRef([])
  useEffect(() => { photosRef.current = photos }, [photos])
  useEffect(() => () => photosRef.current.forEach(p => URL.revokeObjectURL(p.preview)), [])

  function handlePhotoPick(e) {
    const MAX_MB = 25
    const valid = Array.from(e.target.files)
      .filter(f => {
        if (f.size > MAX_MB * 1024 * 1024) { alert(`ไฟล์ "${f.name}" ใหญ่เกิน ${MAX_MB} MB กรุณาย่อขนาดก่อนแนบ`); return false }
        return true
      })
      .slice(0, MAX_PHOTOS - photos.length)
    setPhotos(prev => [...prev, ...valid.map(f => ({ file: f, preview: URL.createObjectURL(f) }))])
    e.target.value = ''
  }

  function removePhoto(idx) {
    setPhotos(prev => { URL.revokeObjectURL(prev[idx].preview); return prev.filter((_, i) => i !== idx) })
  }



  // ล้าง error ทันทีที่ผู้ใช้เริ่มแก้ฟิลด์ — ของเดิมล้างตอนกดส่งเท่านั้น ข้อความอย่าง
  // "กรุณาเลือกลักษณะปัญหา" จึงค้างอยู่ใต้ฟอร์มทั้งที่เลือกไปแล้ว ทำให้เข้าใจว่ายังกรอกไม่ครบ
  const set = (field) => (e) => {
    setError(null)
    setForm((prev) => ({ ...prev, [field]: e.target.value }))
  }
  const reporterFullName = joinThaiFullName(form.name_title, form.name_first, form.name_last)

  // รวมฟิลด์เสริมของหมวดที่มีเป็น jsonb object เดียว — คืน null ถ้าหมวดนี้ไม่มีฟิลด์เสริม (ไม่ใช่ odor)
  // ตัด incident_source_suspected/incident_time ออกแล้ว (ใช้ complaints.created_at แทนวันเวลาที่แจ้ง)
  function buildExtraData(form) {
    if (form.category !== 'odor') return null
    return {
      odor_intensity: form.odor_intensity ? Number(form.odor_intensity) : null,
      odor_time_range: form.odor_time_range || null,
      wind_direction: form.wind_direction || null,
      health_effect:  form.health_effect || null,
    }
  }

  // คืนข้อความ error ตัวแรกที่พบ หรือ null ถ้าผ่าน — ใช้ทั้ง 2 จุดที่ validate ก่อนส่ง (ปุ่มกดก่อนเปิด
  // consent modal และ handleSubmit จริง) เหมือนแพทเทิร์นเดิมของ issue_type
  function validateOdorFields(form) {
    if (form.category !== 'odor') return null
    if (!form.odor_intensity) return 'กรุณาเลือกระดับความรุนแรงของกลิ่น'
    if (!form.wind_direction) return 'กรุณาเลือกทิศทางลม'
    if (!form.odor_time_range) return 'กรุณาเลือกช่วงเวลาที่ได้กลิ่น'
    // พิกัดบังคับเฉพาะหมวดนี้ (หมวดอื่นยังไม่บังคับเหมือนเดิม) — เรื่องกลิ่นไม่มีบ้านเลขที่ให้ยึด
    // มีแค่ชื่อหมู่บ้านกว้างๆ ถ้าไม่มีพิกัด เจ้าหน้าที่รับทราบไปก็ไม่รู้จะไปตรวจสอบจุดไหน
    if (geo.lat == null || geo.lng == null) return 'กรุณากดปุ่ม "ปักหมุดจากแผนที่" เพื่อระบุจุดที่ได้กลิ่น'
    return null
  }

  // ลิงก์เก่าแบบ ?category=xxx ยัง set ค่าเข้าฟอร์มได้แม้หมวดนั้นถูกปิดไปแล้วและ pill ถูกซ่อน
  // ถ้าปล่อยผ่าน คำร้องจะถูกบันทึกในหมวดที่เทศบาลไม่ได้เปิดใช้ ไม่มีผู้รับผิดชอบ แล้วตกหล่นเงียบ
  // เรียกทั้ง 2 จุดที่ validate ก่อนส่ง เหมือนแพทเทิร์นของ validateOdorFields()
  function validateCategoryEnabled(form) {
    if (!disabledCategoryValues.has(form.category)) return null
    return 'ประเภทคำร้องนี้ไม่เปิดให้บริการในหน่วยงานนี้แล้ว กรุณาเลือกประเภทอื่น'
  }

  function handleMapConfirm({ lat, lng, address }) {
    setGeo({ lat, lng, address })
    setGeoStatus(GEO_STATUS.ok)
    setShowMap(false)
  }

  async function handleSubmit(e) {
    e?.preventDefault()
    if (!form.category) { setError('กรุณาเลือกประเภทคำร้อง'); return }
    const catErr = validateCategoryEnabled(form)
    if (catErr) { setError(catErr); return }
          if (!form.name_first.trim() || !form.name_last.trim()) { setError('กรุณากรอกชื่อ-นามสกุล'); return }

    if (ISSUE_TYPES_BY_CATEGORY[form.category] && !form.issue_type) { setError('กรุณาเลือกลักษณะปัญหา'); return }
    const odorErr = validateOdorFields(form)
    if (odorErr) { setError(odorErr); return }
    if (form.detail.trim().length < 10) { setError('กรุณาอธิบายรายละเอียดอย่างน้อย 10 ตัวอักษร'); return }
    if (!form.phone.trim()) { setError('กรุณากรอกเบอร์โทรติดต่อ'); return }
    if (!tenant?.id) { setError('ไม่พบข้อมูลหน่วยงาน'); return }

    abortCtrlRef.current?.abort()
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
      // ใช้ RPC (SECURITY DEFINER) แทน .insert().select() ตรงๆ เพราะ PostgREST ต้องผ่าน SELECT RLS
      // policy ด้วยตอนคืนแถวที่เพิ่ง insert กลับมา (เอาไปโชว์เลขที่คำร้อง) แต่ SELECT policy ของ
      // complaints ไม่อนุญาต anon อ่านแถวตัวเองได้เลย — ทำให้คนไม่ login ยื่นคำร้องไม่ได้เลย (ดู
      // migration 20260807150000_fix_anon_complaint_submit_rls.sql สำหรับรายละเอียดเต็ม)
      let insertResult
      try {
        insertResult = await raceTimeout(
          supabase.rpc('submit_citizen_complaint_v4', {
            p_id:              complaintId,
            p_municipality_id: tenant.id,
            p_category:        form.category,
            p_form_type:       formType !== 'legacy' ? formType : 'legacy',
            p_village:         form.village || null,
            p_detail:          form.detail.trim(),
            p_phone:           form.phone.trim(),
            p_reporter_name:   reporterFullName,
            p_latitude:        geo.lat,
            p_longitude:       geo.lng,
            p_user_id:         userId,
            p_channel:         'citizen_online',
            p_issue_type:      form.issue_type || null,
            p_extra_data:      buildExtraData(form),
          }).single()
            .abortSignal(abortCtrl.signal),
          20_000,
        )
      } catch {
        setError(`เครือข่ายช้าหรือขาดหาย กรุณาตรวจสอบสัญญาณแล้วกด ${getFormActionCopy(formType, form.category).submit} อีกครั้ง`)
        return
      }
      const { data: inserted, error: dbError } = insertResult ?? {}
      if (dbError) { setError(`เกิดข้อผิดพลาด: ${dbError.message}`); return }

      setSuccess(true)
      setComplaintNumber(inserted?.ref_no ?? null)
      setSavedComplaintId(complaintId)
      setSavedPhotoFiles(photos.map(p => p.file))
      photos.forEach(p => URL.revokeObjectURL(p.preview))

      // ผู้ใช้กดยืนยันให้ sync เบอร์ใหม่เข้าโปรไฟล์ — อัปเดตเฉพาะคอลัมน์ phone ไม่แตะฟิลด์อื่น
      if (syncPhoneToProfile && userId && form.phone.trim() !== profilePhone.trim()) {
        supabase.from('profiles').upsert({ id: userId, phone: form.phone.trim() }).then(({ error }) => {
          if (!error) setProfilePhone(form.phone.trim())
        })
      }

      const allCats = [...(ftConfig?.categories ?? []), ...categories]
      const catLabel = allCats.find((c) => c.value === form.category)?.label?.replace(/^[\p{Emoji}\s]+/u, '').trim() ?? form.category
      supabase.functions.invoke('send-push', {
        body: { municipality_id: tenant.id, title: `คำร้องใหม่: ${catLabel}`, body: form.detail.trim().slice(0, 100), url: '/admin' },
      }).catch(() => {})
      notifyTelegram('complaint_created', complaintId)
    } catch (err) {
      const isNetworkErr = err?.message?.toLowerCase().includes('fetch') || err?.message?.toLowerCase().includes('network')
      setError(isNetworkErr ? 'ไม่มีสัญญาณอินเทอร์เน็ต กรุณาตรวจสอบสัญญาณแล้วลองใหม่' : 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง')
    } finally {
      setSubmitting(false)
      abortCtrlRef.current = null
    }
  }

  if (success) return <SuccessScreen onBack={() => navigate('/')} onMyComplaints={() => navigate('/my-complaints')} complaintNumber={complaintNumber} isLoggedIn={isLoggedIn} complaintId={savedComplaintId} photoFiles={savedPhotoFiles} primaryColor={primaryColor} />

  // pills ของ ftConfig ต้องเคารพหมวดที่เทศบาลนี้ปิดไว้ เหมือน dropdown หลักที่อ่านจาก DB อยู่แล้ว
  const visibleFtCategories = (ftConfig?.categories ?? []).filter((c) => !disabledCategoryValues.has(c.value))
  const allCatsDisplay = [...(ftConfig?.categories ?? []), ...categories]
  const catLabel = allCatsDisplay.find((c) => c.value === form.category)?.label?.replace(/^[\p{Emoji}\s]+/u, '').trim() ?? form.category
  const CatIcon = CATEGORY_ICON[form.category] ?? HelpCircle
  const catDbData = categories.find(c => c.value === form.category)
  const catEmoji = catDbData?.emoji ?? FALLBACK_EMOJI[form.category] ?? null
  const catColor = catDbData?.color ?? FALLBACK_COLOR[form.category] ?? null
  const actionCopy = getFormActionCopy(formType, form.category, catLabel)

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#eef2f7' }}>

      {/* PC header */}
      <div className="hidden md:flex items-center justify-between px-8 py-4 bg-white border-b border-gray-200 shadow-sm">
        <h1 className="text-lg font-bold text-gray-800">{actionCopy.title}</h1>
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
              <p><strong>วัตถุประสงค์</strong></p>
              <ul className="list-disc list-inside space-y-1 pl-1">
                <li>ตรวจสอบและแก้ไขปัญหาตามคำร้อง</li>
                <li>ติดต่อกลับเพื่อสอบถามข้อเท็จจริงเพิ่มเติมและแจ้งผลการดำเนินการ</li>
                <li>จัดทำสถิติและวิเคราะห์เชิงพื้นที่เพื่อวางแผนแก้ปัญหา (ใช้เฉพาะพิกัด ช่วงเวลา และคำตอบแบบตัวเลือก โดยไม่ระบุตัวบุคคล)</li>
              </ul>
              <p><strong>ระยะเวลาเก็บรักษา</strong> ข้อมูลติดต่อ (ชื่อ-นามสกุล เบอร์โทรศัพท์) เก็บไว้ 5 ปีนับจากวันปิดเรื่อง</p>
              <p>ข้อมูลจะถูกใช้ตามวัตถุประสงค์ข้างต้นเท่านั้น และจะไม่ถูกเปิดเผยให้บุคคลภายนอก เว้นแต่เป็นการปฏิบัติตามกฎหมาย</p>
            </div>
            <button onClick={() => setShowPdpa(false)}
              className="mt-5 w-full py-3 rounded-2xl font-semibold text-white text-sm"
              style={{ backgroundColor: 'var(--color-primary)' }}>รับทราบ</button>
          </div>
        </div>
      )}

      {/* Mobile header */}
      <div className="md:hidden sticky top-0 z-10 flex items-center gap-3 px-4 py-3 shadow-sm"
        style={{ background: primaryBg }}>
        <button onClick={() => navigate(-1)}
          className="p-1.5 rounded-xl bg-white/20 hover:bg-white/30 transition-colors">
          <ArrowLeft size={20} className="text-white" />
        </button>
        <h1 className="font-bold text-white text-base flex-1 text-center pr-8">
          {actionCopy.title}
        </h1>
      </div>

      {/* Category display row */}
      {!ftConfig && form.category && (
        <div className="flex items-center gap-3 px-4 py-3 bg-white border-b border-gray-100">
          <div className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 shadow-sm"
            style={{
              backgroundColor: catColor ? catColor + '18' : '#eff6ff',
              border: `1.5px solid ${catColor ? catColor + '45' : '#bfdbfe'}`,
            }}>
            {catEmoji
              ? <CategoryIcon emoji={catEmoji} size={24} style={tenant?.category_icon_style} />
              : <CatIcon size={20} strokeWidth={1.5} style={{ color: catColor ?? 'var(--color-primary)' }} />}
          </div>
          <div>
            <p className="text-[10px] text-gray-400 font-medium">ประเภทคำร้อง</p>
            <span className="text-sm font-bold text-gray-800">{catLabel}</span>
          </div>
        </div>
      )}

      {/* ftConfig: subcategory pills */}
      {ftConfig && (
        <div className="bg-white px-4 py-3 border-b border-gray-100">
          <div className="flex flex-wrap gap-2">
            {visibleFtCategories.map((cat) => (
              <button key={cat.value} type="button"
                onClick={() => { setError(null); setForm((p) => ({ ...p, category: cat.value })) }}
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
        {isLoggedIn ? (
          <div className="relative">
            <input type="text" value={reporterFullName} readOnly
              className="w-full px-4 py-2.5 pl-10 rounded-xl border text-base placeholder-gray-400 focus:outline-none bg-gray-50 border-gray-200 text-gray-500" />
            <User size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-emerald-500 font-semibold">จากโปรไฟล์</span>
          </div>
        ) : (
          <div className="flex gap-2">
            <select value={form.name_title} onChange={set('name_title')}
              className="w-24 shrink-0 px-3 py-2.5 rounded-xl border border-gray-300 bg-white text-gray-900 text-base focus:outline-none focus:border-blue-400">
              <option value="">คำนำหน้า</option>
              {NAME_TITLES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <input type="text" value={form.name_first} onChange={set('name_first')}
              maxLength={100}
              placeholder="ชื่อ *"
              className="flex-1 min-w-0 px-4 py-2.5 rounded-xl border border-gray-300 bg-white text-gray-900 text-base placeholder-gray-400 focus:outline-none focus:border-blue-400" />
            <input type="text" value={form.name_last} onChange={set('name_last')}
              maxLength={100}
              placeholder="นามสกุล *"
              className="flex-1 min-w-0 px-4 py-2.5 rounded-xl border border-gray-300 bg-white text-gray-900 text-base placeholder-gray-400 focus:outline-none focus:border-blue-400" />
          </div>
        )}

        {/* ลักษณะปัญหา — เฉพาะหมวดที่มีตัวเลือกกำหนดไว้ใน ISSUE_TYPES_BY_CATEGORY */}
        {ISSUE_TYPES_BY_CATEGORY[form.category] && (
          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1 block">ลักษณะปัญหา *</label>
            <div className="relative">
              <select value={form.issue_type} onChange={set('issue_type')} required
                className="w-full px-4 py-2.5 pr-10 rounded-xl border border-gray-300 bg-white text-gray-900 text-base focus:outline-none focus:border-blue-400 appearance-none">
                <option value="">— กรุณาเลือก —</option>
                {ISSUE_TYPES_BY_CATEGORY[form.category].map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <ChevronDown size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            </div>
          </div>
        )}

        {/* ฟิลด์เสริมเฉพาะหมวด odor — GPS ใช้ปุ่ม "ปักหมุดจากแผนที่" เดิมด้านล่างของฟอร์ม ไม่ซ้ำที่นี่ */}
        {form.category === 'odor' && (
          <div className="space-y-2">
            {/* หมวดนี้เก็บทั้งคำตอบเชิงวิเคราะห์ (ช่วงเวลา/ความรุนแรง/ทิศลม/อาการ) และข้อมูลติดต่อ
                ผู้แจ้ง — PDPA กำหนดให้ต้องแจ้งวัตถุประสงค์และระยะเวลาเก็บ ณ จุดที่เก็บข้อมูล
                ไม่ใช่ซ่อนไว้ในนโยบายอย่างเดียว จึงขึ้นเป็นกล่องบนหัวชุดคำถามของหมวดนี้โดยตรง */}
            <div className="rounded-xl border border-lime-200 bg-lime-50/70 px-3 py-2.5 text-[11px] leading-relaxed text-lime-900">
              <p className="font-bold mb-0.5">ทำไมต้องขอชื่อและเบอร์โทร</p>
              <p>
                คำตอบและพิกัดใช้เพื่อวิเคราะห์การกระจายตัวของกลิ่นในพื้นที่
                ส่วนชื่อ-นามสกุลและเบอร์โทรใช้เพื่อติดต่อสอบถามข้อเท็จจริงเพิ่มเติมและแจ้งผลการตรวจสอบกลับ
                โดย{tenant?.name ?? 'หน่วยงาน'}เก็บข้อมูลติดต่อไว้ 5 ปีนับจากวันปิดเรื่อง
              </p>
              <p className="mt-0.5">เจ้าหน้าที่ที่เห็นข้อมูลติดต่อของท่านคือผู้รับผิดชอบเรื่องและผู้ดูแลระบบเท่านั้น ผู้บริหารเห็นเฉพาะหมุดและคำตอบแบบไม่ระบุตัวบุคคล</p>
            </div>
            {/* ช่วงเวลาที่ได้กลิ่น — ข้อมูลที่เจ้าหน้าที่ใช้จริงคือ "ควรไปดมช่วงไหน" ไม่ใช่นาทีที่พบกลิ่น
                วันเวลาแบบละเอียดซ้ำซ้อนกับ complaints.created_at จึงไม่เก็บ (เคยมีแล้วถอดออก 2 รอบ)
                ค่านี้ชนะค่าที่คำนวณจากเวลาที่แจ้งเสมอในตัวกรอง (ดู src/lib/odorTimeRanges.js) */}
            <div>
              <label className="text-xs font-semibold text-gray-600 mb-1 block">ช่วงเวลาที่ได้กลิ่น *</label>
              <div className="relative">
                <select value={form.odor_time_range} onChange={set('odor_time_range')} required
                  className="w-full px-4 py-2.5 pr-10 rounded-xl border border-gray-300 bg-white text-gray-900 text-base focus:outline-none focus:border-blue-400 appearance-none">
                  <option value="">— กรุณาเลือก —</option>
                  {ODOR_TIME_RANGES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
                <ChevronDown size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              </div>
            </div>
            {/* ระดับความรุนแรง 1-5 */}
            <div>
              <label className="text-xs font-semibold text-gray-600 mb-1 block">ระดับความรุนแรงของกลิ่น *</label>
              <div className="relative">
                <select value={form.odor_intensity} onChange={set('odor_intensity')} required
                  className="w-full px-4 py-2.5 pr-10 rounded-xl border border-gray-300 bg-white text-gray-900 text-base focus:outline-none focus:border-blue-400 appearance-none">
                  <option value="">— กรุณาเลือก —</option>
                  {ODOR_INTENSITY_LEVELS.map((lv) => <option key={lv.value} value={lv.value}>{lv.value} — {lv.label}</option>)}
                </select>
                <ChevronDown size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              </div>
            </div>

            {/* อาการทางสุขภาพ — เลือกได้ข้อเดียว (ถ้ามี) */}
            <div>
              <label className="text-xs font-semibold text-gray-600 mb-1 block">อาการทางสุขภาพที่พบ (ถ้ามี)</label>
              <div className="relative">
                <select value={form.health_effect} onChange={set('health_effect')}
                  className="w-full px-4 py-2.5 pr-10 rounded-xl border border-gray-300 bg-white text-gray-900 text-base focus:outline-none focus:border-blue-400 appearance-none">
                  <option value="">— กรุณาเลือก —</option>
                  {HEALTH_EFFECT_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                </select>
                <ChevronDown size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              </div>
            </div>

            {/* ทิศทางลม */}
            <div>
              <label className="text-xs font-semibold text-gray-600 mb-1 block">ทิศทางลม *</label>
              <div className="relative">
                <select value={form.wind_direction} onChange={set('wind_direction')} required
                  className="w-full px-4 py-2.5 pr-10 rounded-xl border border-gray-300 bg-white text-gray-900 text-base focus:outline-none focus:border-blue-400 appearance-none">
                  <option value="">— กรุณาเลือก —</option>
                  {WIND_DIRECTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
                <ChevronDown size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              </div>
            </div>
          </div>
        )}

        {/* Detail */}
        <textarea value={form.detail} onChange={set('detail')} rows={2} required minLength={10} maxLength={5000}
          placeholder={ftConfig?.placeholder ?? 'รายละเอียด'}
          className="w-full px-4 py-3.5 rounded-xl border border-gray-300 bg-white text-gray-900 text-base placeholder-gray-400 resize-none focus:outline-none focus:border-blue-400" />

        {/* Village */}
        {locations.length === 0 ? (
          <input type="text" value={form.village} onChange={set('village')}
            maxLength={250}
            placeholder="สถานที่"
            className="w-full px-4 py-2.5 rounded-xl border border-gray-300 bg-white text-gray-900 text-base placeholder-gray-400 focus:outline-none focus:border-blue-400" />
        ) : (
          <div className="relative">
            <select value={form.village} onChange={set('village')}
              className="w-full px-4 py-2.5 pr-10 rounded-xl border border-gray-300 bg-white text-gray-900 text-base focus:outline-none focus:border-blue-400 appearance-none">
              <option value="">— เลือกสถานที่ —</option>
              {locations.map((l) => <option key={l.id} value={l.name}>{l.name}</option>)}
            </select>
            <ChevronDown size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>
        )}

        {/* Phone */}
        <div className="relative">
          <input type="tel" value={form.phone} onChange={set('phone')}
            maxLength={30}
            placeholder="เบอร์ติดต่อ *"
            className="w-full px-4 py-2.5 pl-10 rounded-xl border border-gray-300 bg-white text-gray-900 text-base placeholder-gray-400 focus:outline-none focus:border-blue-400" />
          <Phone size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        </div>

        {/* ถามก่อนว่าจะอัปเดตเบอร์นี้ในโปรไฟล์ด้วยหรือไม่ — เด้งเฉพาะตอนโปรไฟล์มีเบอร์เดิมอยู่แล้ว และผู้ใช้พิมพ์เบอร์อื่นทับ */}
        {isLoggedIn && profilePhone.trim() && form.phone.trim() && form.phone.trim() !== profilePhone.trim() && (
          <label className="flex items-start gap-2.5 px-3.5 py-2.5 rounded-xl bg-amber-50 border border-amber-100 cursor-pointer">
            <input type="checkbox" checked={syncPhoneToProfile}
              onChange={(e) => setSyncPhoneToProfile(e.target.checked)}
              className="mt-0.5 shrink-0" />
            <span className="text-xs text-amber-700 leading-relaxed">
              เบอร์นี้ต่างจากที่บันทึกไว้ในโปรไฟล์ ({profilePhone})
              — ต้องการอัปเดตเป็นเบอร์นี้ในโปรไฟล์ของฉันด้วยหรือไม่?
            </span>
          </label>
        )}

        {/* Map pin */}
        <button type="button" onClick={() => setShowMap(true)}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-full font-semibold text-white text-sm transition-all active:scale-95 shadow-sm"
          style={{ backgroundColor: geoStatus === GEO_STATUS.ok ? '#16a34a' : primaryColor }}>
          {geoStatus === GEO_STATUS.ok
            ? <CheckCircle2 size={18} />
            : <MapPin size={18} />}
          <span className="truncate max-w-[220px]">
            {geoStatus === GEO_STATUS.ok
              ? `${geo.lat?.toFixed(5)}, ${geo.lng?.toFixed(5)}`
              : form.category === 'odor' ? 'ปักหมุดจากแผนที่ *' : 'ปักหมุดจากแผนที่'}
          </span>
          {geoStatus !== GEO_STATUS.ok && <ChevronRight size={18} />}
        </button>
        {/* หมวดกลิ่นบังคับพิกัด — บอกให้รู้ตั้งแต่ก่อนกดส่ง ไม่ใช่ให้ไปเจอ error ตอนกดส่งแล้วงงว่าติดตรงไหน */}
        {form.category === 'odor' && geoStatus !== GEO_STATUS.ok && (
          <p className="-mt-1 text-xs text-gray-500 text-center">
            จำเป็นต้องระบุจุดที่ได้กลิ่น เพื่อให้เจ้าหน้าที่ลงพื้นที่ตรวจสอบได้ถูกจุด
          </p>
        )}

        {/* Photo picker */}
        <div className="bg-white rounded-2xl border border-gray-200 p-4">
          {photos.length > 0 && (
            <div className="grid grid-cols-3 gap-2 mb-3">
              {photos.map((p, i) => (
                <div key={i} className="relative aspect-square rounded-xl overflow-hidden border border-gray-200 bg-gray-100">
                  <img src={p.preview} alt="" className="w-full h-full object-cover" />
                  <button type="button" onClick={() => removePhoto(i)}
                    className="absolute top-1 right-1 bg-black/55 rounded-full p-0.5 active:scale-90 transition-transform">
                    <X size={13} className="text-white" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {photos.length < MAX_PHOTOS && (
            <div className="relative w-full">
              <div className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-dashed border-gray-300 text-gray-500 text-xs font-medium pointer-events-none">
                <ImagePlus size={15} />
                แนบรูปภาพ
                <span className="text-gray-400 font-normal">(ไม่บังคับ)</span>
                {photos.length > 0 && <span className="ml-auto text-gray-400">{photos.length}/{MAX_PHOTOS}</span>}
              </div>
              <input type="file" accept="image/*" multiple onChange={handlePhotoPick}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" />
            </div>
          )}
        </div>

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
          const catErr = validateCategoryEnabled(form)
          if (catErr) { setError(catErr); return }
    if (!form.name_first.trim() || !form.name_last.trim()) { setError('กรุณากรอกชื่อ-นามสกุล'); return }

          if (ISSUE_TYPES_BY_CATEGORY[form.category] && !form.issue_type) { setError('กรุณาเลือกลักษณะปัญหา'); return }
          const odorErr = validateOdorFields(form)
          if (odorErr) { setError(odorErr); return }
          if (form.detail.trim().length < 10) { setError('กรุณาอธิบายรายละเอียดอย่างน้อย 10 ตัวอักษร'); return }
          if (!form.phone.trim()) { setError('กรุณากรอกเบอร์โทรติดต่อ'); return }
          setShowConsent(true)
        }} disabled={submitting}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-full font-semibold text-white text-sm shadow-sm active:scale-95 transition-all disabled:opacity-60"
          style={{ backgroundColor: '#16a34a' }}>
          {submitting
            ? <><Loader2 size={18} className="animate-spin" /> กำลังส่ง...</>
            : actionCopy.submit}
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
