import { lazy, Suspense, useState, useEffect, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  Inbox, FileText, MessageSquareWarning, LogOut,
  ChevronRight, X, Clock, CheckCircle2, XCircle, Loader2,
  Plus, Phone, MapPin, User, AlignLeft, Calendar, Hash, RefreshCw,
  Printer, Search, ClipboardList, Hammer, Home, CalendarDays, TrendingUp, Images, Camera,
  CreditCard, BadgeCheck, Banknote, Luggage, Star, Car, Bell, Trash2, Briefcase, Database,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { fetchComplaintPrivateDetail, fetchRoleScopedComplaints } from '../lib/complaintPrivacy'
import { compressImage } from '../lib/imageUtils'
import { useTenant } from '../contexts/TenantContext'
import { notifyTelegram } from '../lib/notifyTelegram'
import { thaiDate } from '../lib/thaiDate'
import { buildBuildingPermitHtml } from '../lib/buildingPermitPrint'

const MapPicker = lazy(() => import('../components/MapPicker'))
const CivilProjectAdmin = lazy(() => import('../components/admin/CivilProjectAdmin'))
const InfraWorkAdmin = lazy(() => import('../components/admin/InfraWorkAdmin'))
const CivilProjectReport = lazy(() => import('../components/admin/CivilProjectReport'))
const EventsManager = lazy(() => import('../components/admin/EventsManager'))
const ComplaintsManager = lazy(() => import('../components/admin/ComplaintsManager'))
const ReportManager = lazy(() => import('../components/admin/ReportManager'))
const TourismManager = lazy(() => import('../components/admin/TourismManager'))
const TourismReviewsAdmin = lazy(() => import('../components/admin/TourismManager').then(module => ({ default: module.TourismReviewsAdmin })))
const PostsManager = lazy(() => import('../components/staff/PostsManager'))
const PositionsManager = lazy(() => import('../components/staff/PositionsManager'))
const StaffOperationalDashboard = lazy(() => import('../components/staff/StaffOperationalDashboard'))
const FleetPage = lazy(() => import('./FleetPage'))
const BuildingPermitWizard = lazy(() => import('./BuildingPermitWizard'))

// ─── Config ───────────────────────────────────────────────────────────────────

const DOC_TYPES = [
  { value: 'residence_cert',   label: '🏠 ใบรับรองการอยู่อาศัย' },
  { value: 'personal_cert',    label: '👤 หนังสือรับรองบุคคล' },
  { value: 'tax_notice',       label: '🏦 ค่าธรรมเนียม/ภาษี' },
  { value: 'waste_collection', label: '🗑️ ค่าธรรมเนียมขยะ' },
  { value: 'building_permit',  label: '🏗️ ขออนุญาตก่อสร้างบ้าน' },
]
let _customDocTypes = []
function getAllDocTypes() { return [...DOC_TYPES, ..._customDocTypes] }

const STATUS = {
  pending:    { label: 'รอดำเนินการ',    color: '#f59e0b', bg: '#fef3c7', Icon: Clock },
  processing: { label: 'กำลังดำเนินการ', color: '#3b82f6', bg: '#dbeafe', Icon: RefreshCw },
  completed:  { label: 'เสร็จสิ้น',      color: '#10b981', bg: '#d1fae5', Icon: CheckCircle2 },
  rejected:   { label: 'ปฏิเสธ',         color: '#ef4444', bg: '#fee2e2', Icon: XCircle },
}

// เมนูที่ข้ามกอง (ใช้ร่วมกันทุกกอง ไม่ผูกกับกองใดกองหนึ่ง) — จัดเป็นกลุ่มย่อยตามลักษณะงาน
// เพื่อให้หาเจอง่าย แทนที่จะเป็นลิสต์ยาวไม่มีหัวข้อ
const STANDALONE_GROUPS = [
  {
    group: 'งานบริการประชาชน',
    items: [
      { key: 'complaints', label: 'คำร้อง',     Icon: MessageSquareWarning, color: '#ef4444', bg: '#fee2e2' },
      { key: 'inbox',      label: 'คำขอเอกสาร', Icon: FileText,             color: '#8b5cf6', bg: '#ede9fe' },
    ],
  },
  {
    group: 'ประชาสัมพันธ์และท่องเที่ยว',
    items: [
      { key: 'events',          label: 'ปฏิทินกิจกรรม',       Icon: CalendarDays, color: '#10b981', bg: '#d1fae5' },
      { key: 'posts',           label: 'ข่าวสาร/ภาพกิจกรรม',  Icon: Images,       color: '#059669', bg: '#d1fae5' },
      { key: 'tourism',         label: 'เที่ยว กิน พัก OTOP', Icon: Luggage,      color: '#d97706', bg: '#fef3c7' },
      { key: 'tourism-reviews', label: 'รีวิวสถานที่',        Icon: Star,         color: '#f59e0b', bg: '#fef3c7' },
    ],
  },
  {
    group: 'แผนงานและทรัพยากรกลาง',
    items: [
      { key: 'projects',      label: 'แผนงาน/โครงการ',  Icon: ClipboardList, color: '#7c3aed', bg: '#ede9fe' },
      { key: 'civil-report',  label: 'รายงานโครงการ',   Icon: Printer,       color: '#7c3aed', bg: '#ede9fe' },
      { key: 'report',        label: 'รายงาน',           Icon: TrendingUp,    color: '#f59e0b', bg: '#fef3c7' },
      // รวมกับศูนย์ข้อมูลดิจิทัลแล้ว — กดแล้ว navigate ไป /data-center/staff ตรงๆ ในแท็บเดิม (ข้าม
      // หน้าเลือกโหมด "เจ้าหน้าที่/ประชาชน" ของ /data-center เพราะรู้อยู่แล้วว่าเป็นฝั่งเจ้าหน้าที่)
      // (ปุ่ม externalUrl เช็คใน StaffOperationalDashboard.openTask และตัว sidebar เองด้านล่าง)
      { key: 'data-center', label: 'ศูนย์ข้อมูลดิจิทัล', Icon: MapPin,        color: '#0891b2', bg: '#e0f2fe', externalUrl: '/data-center/staff' },
      { key: 'fleet',    label: 'ยานพาหนะ/น้ำมัน',  Icon: Car,           color: '#0369a1', bg: '#e0f2fe' },
    ],
  },
  {
    group: 'บุคลากร',
    items: [
      { key: 'positions', label: 'ตำแหน่งและบุคลากร', Icon: Briefcase, color: '#4338ca', bg: '#e0e7ff' },
    ],
  },
]

// จัดกลุ่มเมนูตามโครงสร้างส่วนราชการจริง (สำนักปลัด/กองคลัง/กองช่าง/กองการศึกษา/ตรวจสอบภายใน)
// กองที่ยังไม่มีเมนูงาน (alwaysShow) ยังคงโชว์หัวข้อไว้ให้ครบทุกกอง ไม่ซ่อน
const MODULE_GROUPS = [
  { group: 'สำนักปลัด', items: [], alwaysShow: true },
  { group: 'กองคลัง', items: [], alwaysShow: true },
  {
    group: 'กองช่าง',
    items: [
      { key: 'infra', label: 'บันทึกงานซ่อม', Icon: Hammer, color: '#0891b2', bg: '#e0f2fe' },
    ],
  },
  { group: 'กองการศึกษา', items: [], alwaysShow: true },
  { group: 'ตรวจสอบภายใน', items: [], alwaysShow: true },
]
const MODULES = [...STANDALONE_GROUPS.flatMap(g => g.items), ...MODULE_GROUPS.flatMap(g => g.items)]


const inputCls = 'w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-200'

const ROLE_TH = {
  superadmin: 'Super Admin',
  admin:      'แอดมินระบบ',
  officer:    'แอดมินกอง',
  technician: 'ปฏิบัติงาน',
  staff:      'เจ้าหน้าที่',
  viewer:     'ผู้บริหาร',
  council:    'สภาเทศบาล',
}

function dateTH(s) {
  if (!s) return ''
  return new Date(s).toLocaleDateString('th-TH', {
    day: '2-digit', month: 'short', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

// ─── Shared components ────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const s = STATUS[status]
  if (!s) return null
  const SIcon = s.Icon
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{ backgroundColor: s.bg, color: s.color }}>
      <SIcon size={10} /> {s.label}
    </span>
  )
}

function InfoRow({ icon, label, value }) {
  return (
    <div className="flex items-start gap-2 text-gray-700">
      <span className="text-gray-400 shrink-0 mt-0.5">{icon}</span>
      <span className="text-xs text-gray-400 w-20 shrink-0 pt-0.5">{label}</span>
      <span className="text-xs flex-1 leading-relaxed">{value}</span>
    </div>
  )
}

// ─── Task Card ────────────────────────────────────────────────────────────────

const PAYMENT_BADGE = {
  pending:  { label: 'รอชำระ',   cls: 'bg-amber-50 text-amber-600 border-amber-200' },
  uploaded: { label: 'รอยืนยัน', cls: 'bg-orange-50 text-orange-600 border-orange-200' },
  verified: { label: 'ชำระแล้ว', cls: 'bg-emerald-50 text-emerald-600 border-emerald-200' },
  waived:   { label: 'ยกเว้นค่า', cls: 'bg-gray-50 text-gray-500 border-gray-200' },
}

function TaskCard({ req, onClick }) {
  const docType = getAllDocTypes().find(d => d.value === req.document_type)
  const emoji = docType?.label.match(/^(\S+)/)?.[1] ?? '📄'
  const docLabel = docType?.label.replace(/^\S+\s*/, '') ?? req.document_type
  const payBadge = req.payment_status && req.payment_status !== 'not_required'
    ? PAYMENT_BADGE[req.payment_status] : null

  return (
    <button onClick={onClick}
      className="w-full bg-white rounded-2xl shadow-sm border border-gray-100 p-4 text-left hover:shadow-md active:scale-[0.99] transition-all flex items-start gap-3">
      <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 text-xl bg-blue-50">
        {emoji}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2 mb-0.5">
          <p className="text-sm font-bold text-gray-800 truncate">{req.requester_name}</p>
          <StatusBadge status={req.status} />
        </div>
        <p className="text-xs text-gray-500 truncate">{docLabel}</p>
        {req.purpose && (
          <p className="text-xs text-gray-400 mt-0.5 line-clamp-1">{req.purpose}</p>
        )}
        <div className="flex items-center gap-2 mt-1.5">
          <p className="text-[11px] text-gray-300">{dateTH(req.created_at)}</p>
          <p className="text-[11px] font-mono text-gray-300">#{req.id?.slice(0, 8)?.toUpperCase()}</p>
          {payBadge && (
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${payBadge.cls}`}>
              💳 {payBadge.label}
            </span>
          )}
        </div>
      </div>
      <ChevronRight size={16} className="text-gray-300 shrink-0 mt-1" />
    </button>
  )
}

// ─── Task Detail Sheet ────────────────────────────────────────────────────────

const SET_FEE_TYPES = ['tax_notice', 'waste_collection']

function TaskDetailSheet({ req, onClose, onUpdate, acting, tenant, onPaymentUpdate, currentUserRole, onDelete }) {
  const [staffNote, setStaffNote]         = useState(req.staff_notes || '')
  const [confirmReject, setConfirmReject] = useState(false)
  const [rejectReason, setRejectReason]   = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [payActing, setPayActing]         = useState(false)
  const [slipSignedUrl, setSlipSignedUrl] = useState(null)
  const defaultFee = tenant?.fee_schedule?.[req.document_type] ?? 0
  const [feeInput, setFeeInput]           = useState(defaultFee > 0 ? String(defaultFee) : '')
  const [settingFee, setSettingFee]       = useState(false)

  useEffect(() => {
    if (!req.payment_slip_url) return
    let cancelled = false
    async function resolve() {
      if (!req.payment_slip_url.startsWith('http')) {
        const { data } = await supabase.storage.from('payment-slips')
          .createSignedUrl(req.payment_slip_url, 3600)
        if (!cancelled && data?.signedUrl) setSlipSignedUrl(data.signedUrl)
      } else {
        if (!cancelled) setSlipSignedUrl(req.payment_slip_url)
      }
    }
    resolve()
    return () => { cancelled = true }
  }, [req.payment_slip_url])

  const docType     = getAllDocTypes().find(d => d.value === req.document_type)
  const isActive    = req.status === 'pending' || req.status === 'processing'
  const hasPayment  = req.payment_status && req.payment_status !== 'not_required'
  const needsFeeSet = SET_FEE_TYPES.includes(req.document_type) && req.payment_status === 'not_required'

  async function handleSetFee() {
    const amount = parseInt(feeInput)
    if (!amount || amount <= 0) { alert('กรุณาระบุยอดที่ถูกต้อง'); return }
    setSettingFee(true)
    try {
      const { error } = await supabase.from('document_requests')
        .update({ fee_amount: amount, payment_status: 'pending' })
        .eq('id', req.id)
      if (error) throw error
      const docLabel = getAllDocTypes().find(d => d.value === req.document_type)?.label ?? req.document_type
      notifyTelegram(tenant?.telegram_group_id,
        `💳 <b>แจ้งยอดค่าชำระ</b>\nประเภท: ${docLabel}\nผู้ขอ: ${req.requester_name}\nยอด: <b>${amount.toLocaleString()} บาท</b>\nรอประชาชนชำระผ่านบัญชีธนาคาร`
      )
      onPaymentUpdate?.()
      onClose()
    } catch (err) {
      alert('เกิดข้อผิดพลาด: ' + err.message)
    } finally {
      setSettingFee(false)
    }
  }

  async function handlePaymentVerify(action) {
    setPayActing(true)
    try {
      const now = new Date().toISOString()

      if (SET_FEE_TYPES.includes(req.document_type)) {
        // Auto-generate receipt + mark completed in one step
        const docDate = now.slice(0, 10)
        const html = buildDocHTML({ req, tenant, docDate })
        const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
        const path = `${tenant?.id ?? 'org'}/${req.id}.html`
        let document_url = null
        const { error: upErr } = await supabase.storage
          .from('document-certs').upload(path, blob, { upsert: true, contentType: 'text/html' })
        if (!upErr) {
          const { data: urlData } = supabase.storage.from('document-certs').getPublicUrl(path)
          document_url = urlData?.publicUrl ?? null
        }
        const { error } = await supabase.from('document_requests').update({
          payment_status:      action === 'verify' ? 'verified' : 'waived',
          payment_verified_at: now,
          status:              'completed',
          issued_at:           now,
          ...(document_url ? { document_url } : {}),
        }).eq('id', req.id)
        if (error) throw error
        const docLabel2 = getAllDocTypes().find(d => d.value === req.document_type)?.label ?? req.document_type
        notifyTelegram(tenant?.telegram_group_id,
          `✅ <b>${action === 'verify' ? 'ยืนยันการชำระเงิน' : 'ยกเว้นค่าธรรมเนียม'}</b>\nประเภท: ${docLabel2}\nผู้ขอ: ${req.requester_name}\n${action === 'verify' ? `จำนวน: ${(req.fee_amount ?? 0).toLocaleString()} บาท\n` : ''}ออกใบเสร็จแล้ว — รอประชาชนดาวน์โหลด`
        )
      } else {
        const updates = action === 'verify'
          ? { payment_status: 'verified', payment_verified_at: now }
          : { payment_status: 'waived',   payment_verified_at: now }
        const { error } = await supabase.from('document_requests')
          .update(updates).eq('id', req.id)
        if (error) throw error
        const docLabel3 = getAllDocTypes().find(d => d.value === req.document_type)?.label ?? req.document_type
        notifyTelegram(tenant?.telegram_group_id,
          `✅ <b>${action === 'verify' ? 'ยืนยันการชำระเงิน' : 'ยกเว้นค่าธรรมเนียม'}</b>\nประเภท: ${docLabel3}\nผู้ขอ: ${req.requester_name}`
        )
      }

      onPaymentUpdate?.()
      onClose()
    } catch (err) {
      alert('เกิดข้อผิดพลาด: ' + err.message)
    } finally {
      setPayActing(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end md:items-center justify-center">
      <div className="bg-white w-full md:max-w-xl md:rounded-3xl rounded-t-3xl max-h-[93vh] flex flex-col overflow-hidden shadow-2xl">

        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 shrink-0">
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100 text-gray-500 transition-colors">
            <X size={18} />
          </button>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-gray-800 truncate">{req.requester_name}</p>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xs text-gray-400 truncate">{docType?.label ?? req.document_type}</span>
              <StatusBadge status={req.status} />
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">

          {/* Requester info */}
          <div className="bg-gray-50 rounded-2xl p-4 space-y-2.5">
            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">ข้อมูลผู้ยื่นคำขอ</p>
            <InfoRow icon={<User size={14} />}     label="ชื่อ-สกุล"      value={req.requester_name} />
            {req.requester_id_card && (
              <InfoRow icon={<Hash size={14} />}     label="เลขบัตร ปชช."  value={req.requester_id_card} />
            )}
            {req.requester_phone && (
              <InfoRow icon={<Phone size={14} />}    label="โทรศัพท์"
                value={<a href={`tel:${req.requester_phone}`} className="text-blue-600 hover:underline">{req.requester_phone}</a>} />
            )}
            {req.requester_address && (
              <InfoRow icon={<MapPin size={14} />}   label="ที่อยู่"        value={req.requester_address} />
            )}
            {req.purpose && (
              <InfoRow icon={<AlignLeft size={14} />} label="วัตถุประสงค์"  value={req.purpose} />
            )}
            <InfoRow icon={<Hash size={14} />}       label="เลขอ้างอิง"    value={<span className="font-mono font-bold tracking-widest">{req.id?.slice(0, 8)?.toUpperCase() ?? '—'}</span>} />
            <InfoRow icon={<Calendar size={14} />}  label="วันที่ยื่น"     value={dateTH(req.created_at)} />
          </div>

          {/* Set fee for tax/waste types */}
          {needsFeeSet && (
            <div className="rounded-2xl border border-amber-200 overflow-hidden">
              <div className="px-4 py-2.5 bg-amber-50 flex items-center gap-2">
                <Banknote size={14} className="text-amber-600 shrink-0" />
                <p className="text-xs font-bold text-amber-800">แจ้งยอดค่าชำระให้ประชาชน</p>
              </div>
              <div className="px-4 py-3 bg-white space-y-3">
                <p className="text-xs text-gray-500 leading-relaxed">
                  คำนวณยอดจากระบบ อปท. แล้วระบุที่นี่ ระบบจะแสดงบัญชีธนาคารให้ประชาชนชำระ
                </p>
                <div className="flex gap-2">
                  <div className="flex-1 relative">
                    <input
                      type="number" min={1} max={999999}
                      value={feeInput}
                      onChange={e => setFeeInput(e.target.value)}
                      placeholder="ระบุยอดที่ต้องชำระ"
                      className={inputCls + ' pr-10'}
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">บาท</span>
                  </div>
                  <button
                    onClick={handleSetFee}
                    disabled={settingFee || !feeInput || parseInt(feeInput) <= 0}
                    className="px-4 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 active:scale-95 transition-all flex items-center gap-1.5 shrink-0"
                    style={{ backgroundColor: '#f59e0b' }}>
                    {settingFee ? <Loader2 size={14} className="animate-spin" /> : <Banknote size={14} />}
                    แจ้งยอด
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Payment section */}
          {hasPayment && (
            <div className="rounded-2xl border overflow-hidden"
              style={{ borderColor: req.payment_status === 'verified' ? '#6ee7b7' : req.payment_status === 'uploaded' ? '#fed7aa' : '#fde68a' }}>
              <div className="px-4 py-2.5 flex items-center gap-2"
                style={{ backgroundColor: req.payment_status === 'verified' ? '#f0fdf4' : req.payment_status === 'uploaded' ? '#fff7ed' : '#fffbeb' }}>
                <CreditCard size={14} className="shrink-0" style={{ color: req.payment_status === 'verified' ? '#059669' : req.payment_status === 'uploaded' ? '#ea580c' : '#d97706' }} />
                <p className="text-xs font-bold" style={{ color: req.payment_status === 'verified' ? '#065f46' : req.payment_status === 'uploaded' ? '#9a3412' : '#92400e' }}>
                  ค่าธรรมเนียม {req.fee_amount?.toLocaleString()} บาท
                  {' · '}
                  {req.payment_status === 'pending'  && 'รอการชำระเงิน'}
                  {req.payment_status === 'uploaded' && 'อัปโหลดสลิปแล้ว — รอยืนยัน'}
                  {req.payment_status === 'verified' && '✅ ยืนยันการชำระแล้ว'}
                  {req.payment_status === 'waived'   && '✅ ยกเว้นค่าธรรมเนียม'}
                </p>
              </div>

              {req.payment_slip_url && (
                <div className="px-4 py-3 bg-white border-t border-gray-100 space-y-2">
                  <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide">หลักฐานการชำระ</p>
                  {slipSignedUrl ? (
                    <a href={slipSignedUrl} target="_blank" rel="noopener noreferrer"
                      className="block rounded-xl overflow-hidden border border-gray-100 hover:opacity-90 transition-opacity">
                      <img src={slipSignedUrl} alt="slip" className="w-full max-h-52 object-contain bg-gray-50" />
                    </a>
                  ) : (
                    <div className="flex items-center justify-center h-20 bg-gray-50 rounded-xl">
                      <Loader2 size={18} className="animate-spin text-gray-300" />
                    </div>
                  )}
                </div>
              )}

              {(req.payment_status === 'uploaded' || req.payment_status === 'pending') && (
                <div className="px-4 py-3 bg-white border-t border-gray-100 flex gap-2">
                  <button onClick={() => handlePaymentVerify('verify')} disabled={payActing}
                    className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-1.5 disabled:opacity-50 transition-opacity active:scale-95"
                    style={{ backgroundColor: '#10b981' }}>
                    {payActing ? <Loader2 size={14} className="animate-spin" /> : <BadgeCheck size={14} />}
                    ยืนยันการชำระ
                  </button>
                  <button onClick={() => handlePaymentVerify('waive')} disabled={payActing}
                    className="flex-1 py-2.5 rounded-xl text-sm font-bold text-gray-600 bg-gray-100 flex items-center justify-center gap-1.5 disabled:opacity-50 transition-opacity active:scale-95">
                    {payActing ? <Loader2 size={14} className="animate-spin" /> : <Banknote size={14} />}
                    ยกเว้นค่าธรรมเนียม
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Staff notes (editable when active) */}
          {isActive && (
            <div>
              <label className="text-xs font-semibold text-gray-500 mb-1.5 block">บันทึกเจ้าหน้าที่</label>
              <textarea value={staffNote} onChange={e => setStaffNote(e.target.value)} rows={3}
                placeholder="บันทึกการดำเนินการ, หมายเหตุ, เอกสารที่ต้องการเพิ่มเติม..."
                className={inputCls + ' resize-none'} />
            </div>
          )}
          {req.staff_notes && !isActive && (
            <div className="bg-blue-50 rounded-xl p-3.5">
              <p className="text-[11px] font-bold text-blue-400 uppercase tracking-wide mb-1">บันทึกเจ้าหน้าที่</p>
              <p className="text-sm text-blue-800 leading-relaxed">{req.staff_notes}</p>
            </div>
          )}
          {req.reject_reason && (
            <div className="bg-red-50 rounded-xl p-3.5">
              <p className="text-[11px] font-bold text-red-400 uppercase tracking-wide mb-1">เหตุผลการปฏิเสธ</p>
              <p className="text-sm text-red-700 leading-relaxed">{req.reject_reason}</p>
            </div>
          )}

          {/* Reject confirm block */}
          {confirmReject && (
            <div className="bg-red-50 border border-red-200 rounded-2xl p-4 space-y-3">
              <p className="text-sm font-bold text-red-700">ระบุเหตุผลการปฏิเสธ</p>
              <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} rows={2}
                placeholder="เอกสารไม่ครบ / ไม่อยู่ในเขต / เหตุผลอื่นๆ..."
                className="w-full border border-red-200 rounded-xl px-3 py-2 text-sm text-gray-900 bg-white resize-none focus:outline-none" />
              <div className="flex gap-2">
                <button onClick={() => setConfirmReject(false)}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-white border border-gray-200 text-gray-600 transition-colors hover:bg-gray-50">
                  ยกเลิก
                </button>
                <button onClick={() => onUpdate(req.id, 'rejected', staffNote, rejectReason)}
                  disabled={acting || !rejectReason.trim()}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-red-500 text-white disabled:opacity-50 transition-opacity">
                  {acting ? <Loader2 size={14} className="animate-spin mx-auto" /> : 'ยืนยันปฏิเสธ'}
                </button>
              </div>
            </div>
          )}

          {/* Delete confirm — Super Admin เท่านั้น ลบถาวร ไม่มีการกู้คืน */}
          {confirmDelete && (
            <div className="bg-red-50 border border-red-300 rounded-2xl p-4 space-y-3">
              <p className="text-sm font-bold text-red-700">ยืนยันลบคำขอนี้ถาวร?</p>
              <p className="text-xs text-red-500 leading-relaxed">
                ข้อมูลคำขอ ({req.requester_name}) จะถูกลบออกจากระบบทันที กู้คืนไม่ได้
              </p>
              <div className="flex gap-2">
                <button onClick={() => setConfirmDelete(false)}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-white border border-gray-200 text-gray-600 transition-colors hover:bg-gray-50">
                  ยกเลิก
                </button>
                <button onClick={() => onDelete(req.id)} disabled={acting}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-red-600 text-white disabled:opacity-50 transition-opacity">
                  {acting ? <Loader2 size={14} className="animate-spin mx-auto" /> : 'ลบถาวร'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer actions */}
        {req.document_type === 'building_permit' && req.permit_form_data && (
          <div className="px-4 pb-2 pt-3 border-t border-gray-100 shrink-0">
            <button onClick={() => {
              const html = buildBuildingPermitHtml({ form: req.permit_form_data, tenant, thDate: thaiDate(req.created_at) })
              const w = window.open('', '_blank', 'width=860,height=1100')
              if (!w) return
              w.document.write(html)
              w.document.close()
              setTimeout(() => { w.focus(); w.print() }, 400)
            }}
              className="w-full py-3.5 rounded-2xl font-semibold text-white flex items-center justify-center gap-2 text-sm active:scale-[0.98] transition-all"
              style={{ backgroundColor: '#7c3aed' }}>
              <Printer size={16} /> พิมพ์แบบ ข.๑ ฉบับเต็ม
            </button>
          </div>
        )}
        {req.status === 'completed' && (
          <div className="px-4 pb-6 pt-3 border-t border-gray-100 shrink-0">
            <button onClick={() => {
              const html = buildDocHTML({ req, tenant, docDate: new Date().toISOString().slice(0, 10) })
              const w = window.open('', '_blank', 'width=860,height=1100')
              if (!w) return
              w.document.write(html)
              w.document.close()
              setTimeout(() => { w.focus(); w.print() }, 400)
            }}
              className="w-full py-3.5 rounded-2xl font-semibold text-white flex items-center justify-center gap-2 text-sm active:scale-[0.98] transition-all"
              style={{ backgroundColor: '#8b5cf6' }}>
              <Printer size={16} /> พิมพ์ / บันทึกเป็น PDF
            </button>
          </div>
        )}
        {isActive && !confirmReject && (
          <div className="px-4 pb-6 pt-3 border-t border-gray-100 space-y-2 shrink-0">
            {req.status === 'pending' && (
              <button onClick={() => onUpdate(req.id, 'processing', staffNote, '')} disabled={acting}
                className="w-full py-3.5 rounded-2xl font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.98] transition-all text-sm"
                style={{ backgroundColor: '#3b82f6' }}>
                {acting ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                รับเรื่อง — เริ่มดำเนินการ
              </button>
            )}
            {req.status === 'processing' &&
             (!SET_FEE_TYPES.includes(req.document_type) ||
              req.payment_status === 'verified' ||
              req.payment_status === 'waived') && (
              <button onClick={() => onUpdate(req.id, 'completed', staffNote, '')} disabled={acting}
                className="w-full py-3.5 rounded-2xl font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.98] transition-all text-sm"
                style={{ backgroundColor: '#10b981' }}>
                {acting ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                ดำเนินการเสร็จสิ้น
              </button>
            )}
            <button onClick={() => setConfirmReject(true)} disabled={acting}
              className="w-full py-2.5 rounded-2xl font-semibold text-red-500 bg-red-50 hover:bg-red-100 flex items-center justify-center gap-2 text-sm transition-colors">
              <XCircle size={16} /> ปฏิเสธคำขอ
            </button>
          </div>
        )}
        {currentUserRole === 'superadmin' && !confirmDelete && (
          <div className="px-4 pb-6 pt-2 shrink-0">
            <button onClick={() => setConfirmDelete(true)} disabled={acting}
              className="w-full py-2 rounded-xl font-semibold text-red-400 hover:text-red-600 hover:bg-red-50 flex items-center justify-center gap-1.5 text-xs transition-colors">
              <Trash2 size={13} /> ลบคำขอนี้ถาวร (Super Admin)
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── New Request Sheet (walk-in) ──────────────────────────────────────────────

const EMPTY_REQ = {
  document_type: 'residence_cert',
  requester_name: '', requester_id_card: '',
  requester_phone: '', requester_address: '', purpose: '',
}

function NewRequestSheet({ tenant, staffId, onClose, onCreated, onSelectBuildingPermit }) {
  const [form, setForm] = useState(EMPTY_REQ)
  const [saving, setSaving] = useState(false)
  const set = k => e => setForm(p => ({ ...p, [k]: e.target.value }))

  async function handleCreate() {
    if (!form.requester_name.trim()) return
    setSaving(true)
    const { data } = await supabase.from('document_requests').insert({
      municipality_id:   tenant.id,
      document_type:     form.document_type,
      requester_name:    form.requester_name.trim(),
      requester_id_card: form.requester_id_card.trim() || null,
      requester_phone:   form.requester_phone.trim() || null,
      requester_address: form.requester_address.trim() || null,
      purpose:           form.purpose.trim() || null,
      status:            'pending',
      assigned_to:       staffId ?? null,
    }).select().single()
    setSaving(false)
    if (data) { onCreated(data); onClose() }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end md:items-center justify-center">
      <div className="bg-white w-full md:max-w-xl md:rounded-3xl rounded-t-3xl max-h-[93vh] flex flex-col overflow-hidden shadow-2xl">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 shrink-0">
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100 text-gray-500"><X size={18} /></button>
          <p className="font-bold text-gray-800">สร้างคำขอ (walk-in / โทรศัพท์)</p>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          <div>
            <label className="text-xs font-semibold text-gray-500 mb-2 block">ประเภทเอกสาร</label>
            <div className="grid grid-cols-2 gap-2">
              {getAllDocTypes().map(d => {
                const [emoji, ...rest] = d.label.split(' ')
                const isSel = form.document_type === d.value
                return (
                  <button key={d.value} type="button"
                    onClick={() => d.value === 'building_permit' ? onSelectBuildingPermit() : setForm(p => ({ ...p, document_type: d.value }))}
                    className="flex items-center gap-2 px-3 py-2.5 rounded-xl border text-left text-xs font-semibold transition-all active:scale-95"
                    style={isSel
                      ? { borderColor: '#3b82f6', backgroundColor: '#eff6ff', color: '#1d4ed8' }
                      : { borderColor: '#e5e7eb', backgroundColor: '#fff', color: '#6b7280' }}>
                    <span className="text-base shrink-0">{emoji}</span>
                    <span className="leading-snug">{rest.join(' ')}</span>
                  </button>
                )
              })}
            </div>
          </div>
          {[
            { k: 'requester_name',     label: 'ชื่อ-สกุล *',      ph: 'นายสมชาย ใจดี', type: 'text' },
            { k: 'requester_id_card',  label: 'เลขบัตรประชาชน',   ph: '1-xxxx-xxxxx-xx-x', type: 'text' },
            { k: 'requester_phone',    label: 'เบอร์โทรศัพท์',    ph: '08x-xxx-xxxx', type: 'tel' },
          ].map(({ k, label, ph, type }) => (
            <div key={k}>
              <label className="text-xs font-semibold text-gray-500 mb-1 block">{label}</label>
              <input type={type} value={form[k]} onChange={set(k)} placeholder={ph} className={inputCls} />
            </div>
          ))}
          <div>
            <label className="text-xs font-semibold text-gray-500 mb-1 block">ที่อยู่</label>
            <textarea value={form.requester_address} onChange={set('requester_address')} rows={2}
              placeholder="บ้านเลขที่ หมู่ที่ ตำบล..." className={inputCls + ' resize-none'} />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 mb-1 block">วัตถุประสงค์</label>
            <input type="text" value={form.purpose} onChange={set('purpose')}
              placeholder="เช่น เพื่อยื่นกู้ธนาคาร, เพื่อสมัครงาน" className={inputCls} />
          </div>
        </div>
        <div className="px-4 pb-6 pt-3 border-t border-gray-100 shrink-0">
          <button onClick={handleCreate} disabled={saving || !form.requester_name.trim()}
            className="w-full py-3.5 rounded-2xl font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-50 text-sm active:scale-[0.98] transition-all"
            style={{ backgroundColor: '#3b82f6' }}>
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
            สร้างคำขอ
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Inbox Module ─────────────────────────────────────────────────────────────

export function InboxModule({ tenant, staffId, currentUserRole }) {
  const [requests, setRequests]   = useState([])
  const [loading, setLoading]     = useState(true)
  const [activeTab, setActiveTab] = useState('all')
  const [selected, setSelected]   = useState(null)
  const [acting, setActing]       = useState(false)
  const [showAdd, setShowAdd]     = useState(false)
  const [showPermitWizard, setShowPermitWizard] = useState(false)
  const [search, setSearch]       = useState('')
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    if (!tenant?.id) return
    let cancelled = false
    supabase.from('document_requests')
      .select('*')
      .eq('municipality_id', tenant.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        if (cancelled) return
        setRequests(data ?? [])
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [tenant?.id, refreshKey])

  useEffect(() => {
    if (!tenant?.id) return
    const ch = supabase.channel(`inbox-${tenant.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'document_requests' },
        ({ new: row }) => {
          if (row.municipality_id !== tenant.id) return
          setRequests(prev => prev.find(r => r.id === row.id) ? prev : [row, ...prev])
        })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'document_requests' },
        ({ new: row }) => {
          if (row.municipality_id !== tenant.id) return
          setRequests(prev => prev.map(r => r.id === row.id ? { ...r, ...row } : r))
        })
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [tenant?.id])

  async function handleUpdate(id, newStatus, staffNote, rejectReason) {
    setActing(true)
    const req = requests.find(r => r.id === id)

    let document_url = null
    if (newStatus === 'completed' && req) {
      const docDate = new Date().toISOString().slice(0, 10)
      const html = buildDocHTML({ req: { ...req, staff_notes: staffNote || req.staff_notes }, tenant, docDate })
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
      const path = `${tenant?.id ?? 'org'}/${id}.html`
      const { error: upErr } = await supabase.storage.from('document-certs').upload(path, blob, { upsert: true, contentType: 'text/html' })
      if (!upErr) {
        const { data: urlData } = supabase.storage.from('document-certs').getPublicUrl(path)
        document_url = urlData?.publicUrl ?? null
      }
    }

    await supabase.from('document_requests').update({
      status:        newStatus,
      staff_notes:   staffNote   || null,
      reject_reason: rejectReason || null,
      assigned_to:   staffId,
      updated_at:    new Date().toISOString(),
      ...(document_url ? { document_url, issued_at: new Date().toISOString() } : {}),
    }).eq('id', id)

    setRequests(prev => prev.map(r =>
      r.id === id ? { ...r, status: newStatus, staff_notes: staffNote || null, document_url } : r
    ))
    const docLabel = getAllDocTypes().find(d => d.value === req?.document_type)?.label ?? req?.document_type ?? ''
    notifyTelegram(tenant?.telegram_group_id,
      `🔄 <b>อัปเดตสถานะคำขอเอกสาร</b>\nประเภท: ${docLabel}\nผู้ขอ: ${req?.requester_name ?? ''}\nสถานะ: ${STATUS[newStatus]?.label ?? newStatus}${staffNote ? `\nหมายเหตุ: ${staffNote}` : ''}`
    )
    setActing(false)
    setSelected(null)
  }

  // ลบถาวร — จำกัดเฉพาะ superadmin เท่านั้น (บังคับจริงด้วย RLS policy ในฐานข้อมูล
  // ไม่ใช่แค่ซ่อนปุ่มฝั่ง UI) ใช้เมื่อคำขอผิดพลาด/สแปม/ทดสอบ ไม่ใช่ทางเลือกแทนการปฏิเสธคำขอปกติ
  async function handleDelete(id) {
    setActing(true)
    const { error } = await supabase.from('document_requests').delete().eq('id', id)
    setActing(false)
    if (error) { alert('ลบไม่สำเร็จ: ' + error.message); return }
    setRequests(prev => prev.filter(r => r.id !== id))
    setSelected(null)
  }

  const TABS = [
    { key: 'all',        label: 'ทั้งหมด' },
    { key: 'pending',    label: 'รอดำเนินการ' },
    { key: 'processing', label: 'กำลังดำเนินการ' },
    { key: 'completed',  label: 'เสร็จสิ้น' },
  ]
  const counts = {
    pending:    requests.filter(r => r.status === 'pending').length,
    processing: requests.filter(r => r.status === 'processing').length,
    completed:  requests.filter(r => r.status === 'completed').length,
    all:        requests.length,
  }
  const byTab    = activeTab === 'all' ? requests : requests.filter(r => r.status === activeTab)
  const filtered = search.trim()
    ? byTab.filter(r => {
        const q = search.toLowerCase()
        const docLabel = (getAllDocTypes().find(d => d.value === r.document_type)?.label ?? '').toLowerCase()
        return r.requester_name?.toLowerCase().includes(q) || docLabel.includes(q)
      })
    : byTab

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-800">คำขอเอกสาร</h2>
          <p className="text-xs text-gray-400 mt-0.5">คำขอเอกสารจากประชาชน</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setRefreshKey(k => k + 1)} disabled={loading}
            className="p-2 rounded-xl bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors disabled:opacity-40"
            title="รีเฟรช">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
          <button onClick={() => setShowAdd(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold text-white shadow-sm active:scale-95 transition-all"
            style={{ backgroundColor: '#3b82f6' }}>
            <Plus size={14} /> สร้างคำขอ
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="ค้นหาชื่อ หรือประเภทเอกสาร..."
          className="w-full pl-9 pr-9 py-2.5 text-sm border border-gray-200 rounded-xl bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-200" />
        {search && (
          <button onClick={() => setSearch('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors">
            <X size={14} />
          </button>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2.5">
        {[
          { label: 'รอดำเนินการ', count: counts.pending,    color: '#f59e0b', bg: '#fef3c7' },
          { label: 'กำลังดำเนิน', count: counts.processing, color: '#3b82f6', bg: '#dbeafe' },
          { label: 'เสร็จสิ้น',   count: counts.completed,  color: '#10b981', bg: '#d1fae5' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-2xl p-3 text-center shadow-sm border border-gray-100">
            <p className="text-2xl font-bold leading-none" style={{ color: s.color }}>{s.count}</p>
            <p className="text-[11px] text-gray-500 mt-1 leading-tight">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key)}
            className="shrink-0 flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full transition-all"
            style={activeTab === t.key
              ? { backgroundColor: '#3b82f6', color: '#fff' }
              : { backgroundColor: '#f1f5f9', color: '#64748b' }}>
            {t.label}
            {counts[t.key] > 0 && (
              <span className="text-[10px] font-bold px-1.5 rounded-full"
                style={activeTab === t.key
                  ? { backgroundColor: 'rgba(255,255,255,0.25)', color: '#fff' }
                  : { backgroundColor: '#e2e8f0', color: '#64748b' }}>
                {counts[t.key]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 size={28} className="animate-spin text-gray-200" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-gray-400">
          <Inbox size={44} className="mb-3 opacity-20" />
          <p className="text-sm font-semibold text-gray-400">{search ? 'ไม่พบคำขอที่ค้นหา' : 'ไม่มีรายการ'}</p>
          <p className="text-xs text-gray-300 mt-1">{search ? `"${search}"` : 'ลองเลือกแท็บอื่น'}</p>
        </div>
      ) : (
        <>
          {/* PC — government table */}
          <div className="hidden md:block overflow-x-auto border border-gray-300 shadow-sm" style={{ borderRadius: 4 }}>
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr style={{ backgroundColor: '#1a3a5c' }}>
                  <th className="px-4 py-2.5 text-left text-[11px] font-bold text-white w-8 border-r border-white/10">ที่</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-bold text-white border-r border-white/10">เลขอ้างอิง</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-bold text-white border-r border-white/10">ชื่อ-สกุลผู้ยื่น</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-bold text-white border-r border-white/10">ประเภทเอกสาร</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-bold text-white border-r border-white/10">วัตถุประสงค์</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-bold text-white border-r border-white/10">โทรศัพท์</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-bold text-white border-r border-white/10">วันที่ยื่น</th>
                  <th className="px-4 py-2.5 text-center text-[11px] font-bold text-white border-r border-white/10">สถานะ</th>
                  <th className="px-4 py-2.5 text-center text-[11px] font-bold text-white">ดำเนินการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filtered.map((req, idx) => {
                  const docType = getAllDocTypes().find(d => d.value === req.document_type)
                  return (
                    <tr key={req.id}
                      className="cursor-pointer transition-colors"
                      style={{ backgroundColor: idx % 2 === 0 ? '#fff' : '#f5f8fc' }}
                      onMouseEnter={e => e.currentTarget.style.backgroundColor = '#dbeafe'}
                      onMouseLeave={e => e.currentTarget.style.backgroundColor = idx % 2 === 0 ? '#fff' : '#f5f8fc'}
                      onClick={() => setSelected(req)}>
                      <td className="px-4 py-2.5 text-gray-500 text-xs border-r border-gray-200">{idx + 1}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-gray-600 border-r border-gray-200 whitespace-nowrap">{req.id?.slice(0, 8)?.toUpperCase() ?? '—'}</td>
                      <td className="px-4 py-2.5 font-semibold text-gray-800 text-sm border-r border-gray-200">{req.requester_name}</td>
                      <td className="px-4 py-2.5 text-gray-700 text-xs border-r border-gray-200">{docType?.label.replace(/^\S+\s*/, '') ?? req.document_type}</td>
                      <td className="px-4 py-2.5 text-gray-500 text-xs max-w-[180px] truncate border-r border-gray-200">{req.purpose || '—'}</td>
                      <td className="px-4 py-2.5 text-gray-500 text-xs border-r border-gray-200">{req.requester_phone || '—'}</td>
                      <td className="px-4 py-2.5 text-gray-500 text-xs whitespace-nowrap border-r border-gray-200">{dateTH(req.created_at)}</td>
                      <td className="px-4 py-2.5 text-center border-r border-gray-200"><StatusBadge status={req.status} /></td>
                      <td className="px-4 py-2.5 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <button className="text-xs font-bold px-3 py-1 rounded border border-blue-600 text-blue-700 hover:bg-blue-600 hover:text-white transition-colors">ดำเนินการ</button>
                          {currentUserRole === 'superadmin' && (
                            <button
                              onClick={e => {
                                e.stopPropagation()
                                if (!window.confirm(`ลบคำขอนี้ (${req.requester_name}) ออกจากระบบ?\n\nการลบไม่สามารถย้อนกลับได้`)) return
                                handleDelete(req.id)
                              }}
                              title="ลบถาวร (Super Admin)"
                              className="p-1.5 rounded border border-red-200 text-red-500 hover:bg-red-500 hover:text-white transition-colors">
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile — cards */}
          <div className="md:hidden space-y-2">
            {filtered.map(req => (
              <TaskCard key={req.id} req={req} onClick={() => setSelected(req)} />
            ))}
          </div>
        </>
      )}

      {selected && (
        <TaskDetailSheet req={selected} onClose={() => setSelected(null)}
          onUpdate={handleUpdate} acting={acting} tenant={tenant}
          onPaymentUpdate={() => { setSelected(null); setRefreshKey(k => k + 1) }}
          currentUserRole={currentUserRole} onDelete={handleDelete} />
      )}
      {showAdd && (
        <NewRequestSheet tenant={tenant} staffId={staffId}
          onClose={() => setShowAdd(false)}
          onCreated={r => setRequests(prev => [r, ...prev])}
          onSelectBuildingPermit={() => { setShowAdd(false); setShowPermitWizard(true) }} />
      )}
      {/* ขออนุญาตก่อสร้างบ้าน — ใช้ wizard เต็มรูปแบบเดียวกับฝั่งประชาชน (แบบ ข.๑ จริง)
          แทนฟอร์มสั้นทั่วไปใน NewRequestSheet เพราะฟิลด์ไม่พอสำหรับพิมพ์แบบร่างที่ถูกต้อง */}
      {showPermitWizard && (
        <div className="fixed inset-0 z-[60] bg-white overflow-y-auto">
          <BuildingPermitWizard tenant={tenant} session={null} staffId={staffId}
            onBack={() => setShowPermitWizard(false)}
            onDone={() => { setShowPermitWizard(false); setRefreshKey(k => k + 1) }} />
        </div>
      )}
    </div>
  )
}

// ─── Document Templates ───────────────────────────────────────────────────────

const DOC_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Sarabun:ital,wght@0,400;0,600;0,700;1,400&display=swap');
  @page { size: A4 portrait; margin: 2.5cm 2cm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Sarabun', 'TH SarabunNew', sans-serif; font-size: 16pt; line-height: 2; color: #000; }
  .header { text-align: center; margin-bottom: 16pt; }
  .header .emblem { font-size: 44pt; display: block; margin-bottom: 4pt; }
  .header .emblem-img { width: 64pt; height: 64pt; object-fit: contain; display: block; margin: 0 auto 6pt; }
  .header h1 { font-size: 18pt; font-weight: 700; }
  .header h2 { font-size: 15pt; font-weight: 400; }
  .doc-title { font-size: 20pt; font-weight: 700; text-align: center;
    text-decoration: underline; margin: 12pt 0 20pt; }
  .meta { text-align: right; margin-bottom: 20pt; font-size: 14pt; }
  .body p { text-indent: 3em; margin-bottom: 10pt; }
  .body .no-indent { text-indent: 0; }
  .closing { text-indent: 3em; margin-top: 8pt; margin-bottom: 40pt; }
  .signature { text-align: center; margin-top: 30pt; }
  .signature .sig-line { border-top: 1px solid #000; width: 200pt; margin: 0 auto 4pt; }
  .signature p { margin: 2pt 0; font-size: 14pt; }
  .footer-note { margin-top: 40pt; font-size: 11pt; color: #555; border-top: 1px solid #ccc; padding-top: 6pt; }
  @media print { body { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }
`

const DOC_TITLES = {
  residence_cert:   'หนังสือรับรองการอยู่อาศัย',
  personal_cert:    'หนังสือรับรองบุคคล',
  tax_notice:       'ใบเสร็จรับเงินภาษีที่ดินและสิ่งปลูกสร้าง',
  waste_collection: 'ใบเสร็จรับเงินค่าธรรมเนียมขยะ',
  other:            'หนังสือรับรอง',
}

// req.* เป็นข้อมูลที่ประชาชนกรอกเองตอนยื่นคำขอเอกสาร (CitizenDocRequest.jsx) — ต้อง escape
// ก่อนแปะใน HTML เสมอ เพราะไฟล์นี้ถูกเปิดตรงใน window.open และอัปโหลดเป็นไฟล์ .html
// สาธารณะใน bucket document-certs ถ้าไม่ escape จะเป็นช่องโหว่ stored XSS/HTML injection
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]))
}

function buildDocBody(req, orgName) {
  const name    = `<strong>${escapeHtml(req.requester_name)}</strong>`
  const idCard  = req.requester_id_card ? ` เลขบัตรประจำตัวประชาชน ${escapeHtml(req.requester_id_card)}` : ''
  const addr    = req.requester_address ? escapeHtml(req.requester_address) : '......................................................................'
  const purpose = req.purpose ? `เพื่อ${escapeHtml(req.purpose)}` : 'เพื่อใช้เป็นหลักฐาน'

  switch (req.document_type) {
    case 'residence_cert':
      return `<p>ขอรับรองว่า ${name}${idCard} อาศัยอยู่ ณ ${addr} อยู่ในเขต${orgName}จริง</p>
              <p>เอกสารฉบับนี้ออกให้${purpose}</p>`
    case 'personal_cert':
      return `<p>ขอรับรองว่า ${name}${idCard} เป็นบุคคลที่อยู่ในทะเบียนราษฎรของ${orgName} และเป็นผู้มีตัวตนอยู่จริง</p>
              <p>เอกสารฉบับนี้ออกให้${purpose}</p>`
    case 'tax_notice':
      return `<p>ได้รับเงินจาก ${name}${idCard} ที่อยู่ ${addr}</p>
              <p class="no-indent" style="margin-left:3em; margin-top:6pt">
                รายการ: ค่าภาษีที่ดินและสิ่งปลูกสร้างประจำปี<br/>
                จำนวนเงิน: <strong>${req.fee_amount ? req.fee_amount.toLocaleString() + ' บาท' : '...............................................'}</strong><br/>
                วันที่รับชำระ: ${thaiDate(new Date().toISOString().slice(0, 10))}
              </p>
              ${req.staff_notes ? `<p>หมายเหตุ: ${escapeHtml(req.staff_notes)}</p>` : ''}`
    case 'waste_collection':
      return `<p>ได้รับเงินจาก ${name}${idCard} ที่อยู่ ${addr}</p>
              <p class="no-indent" style="margin-left:3em; margin-top:6pt">
                รายการ: ค่าธรรมเนียมขยะ<br/>
                จำนวนเงิน: <strong>${req.fee_amount ? req.fee_amount.toLocaleString() + ' บาท' : '...............................................'}</strong><br/>
                วันที่รับชำระ: ${thaiDate(new Date().toISOString().slice(0, 10))}
              </p>
              ${req.staff_notes ? `<p>หมายเหตุ: ${escapeHtml(req.staff_notes)}</p>` : ''}`
    default:
      return `<p>${escapeHtml(req.purpose) || 'ตามที่ได้รับการร้องขอ'}</p>
              ${req.staff_notes ? `<p>รายละเอียดเพิ่มเติม: ${escapeHtml(req.staff_notes)}</p>` : ''}`
  }
}

function buildDocHTML({ req, tenant, docDate }) {
  const orgName  = escapeHtml(tenant?.name ?? 'หน่วยงาน')
  const title    = DOC_TITLES[req.document_type] ?? DOC_TITLES.other
  const isReceipt = ['tax_notice', 'waste_collection'].includes(req.document_type)
  const logoUrl  = typeof tenant?.logo_url === 'string' && /^https?:\/\//.test(tenant.logo_url)
    ? escapeHtml(tenant.logo_url) : null

  return `<!DOCTYPE html>
<html lang="th"><head>
<meta charset="UTF-8"><title>${title}</title>
<style>${DOC_CSS}</style>
</head><body>
<div class="header">
  ${logoUrl
    ? `<img src="${logoUrl}" class="emblem-img" alt="โลโก้" />`
    : `<span class="emblem">🏛️</span>`}
  <h1>${orgName}</h1>
</div>
<div class="doc-title">${title}</div>
<div class="meta"><p>วันที่ ${thaiDate(docDate)}</p><p>เลขที่: ${req.id?.slice(0, 8)?.toUpperCase() ?? '-'}</p></div>
<div class="body">
  ${buildDocBody(req, orgName)}
</div>
<p class="closing">${isReceipt ? 'ใบเสร็จนี้ออกโดยระบบอิเล็กทรอนิกส์ ถือเป็นหลักฐานการรับชำระเงิน' : 'จึงออกหนังสือรับรองฉบับนี้ให้เพื่อเป็นหลักฐาน'}</p>
<div class="signature">
  <div class="sig-line"></div>
  <p>(...............................................)</p>
  <p>${isReceipt ? 'ผู้รับเงิน' : 'ผู้มีอำนาจลงนาม'}</p>
  <p>${orgName}</p>
</div>
<div class="footer-note">
  หมายเลขอ้างอิง: ${req.id?.slice(0, 8)?.toUpperCase() ?? '-'} &nbsp;|&nbsp; ออกโดย ${orgName} &nbsp;|&nbsp; วันที่ ${thaiDate(docDate)}
</div>
</body></html>`
}

// ─── Complaints Module (staff-side) ───────────────────────────────────────────

const C_STATUS = {
  pending:     { label: 'รอดำเนินการ',    color: '#f59e0b', bg: '#fef3c7' },
  received:    { label: 'รับเรื่องแล้ว',  color: '#3b82f6', bg: '#dbeafe' },
  in_progress: { label: 'กำลังดำเนินการ', color: '#8b5cf6', bg: '#ede9fe' },
  done:        { label: 'รอปิดเรื่อง',    color: '#f97316', bg: '#fff7ed' },
  completed:   { label: 'ปิดเรื่องแล้ว',  color: '#10b981', bg: '#d1fae5' },
  closed:      { label: 'ปิดเรื่องแล้ว',  color: '#10b981', bg: '#d1fae5' },
  rejected:    { label: 'ปฏิเสธ',         color: '#ef4444', bg: '#fee2e2' },
}
const C_NEXT = {
  received:    { label: 'เริ่มดำเนินการ', next: 'in_progress' },
  in_progress: { label: 'ปิดงาน',        next: 'done' },
}
let C_CAT = {
  road: 'ถนน/ทางสาธารณะ', light: 'ไฟฟ้าส่องสว่าง', trash: 'ขยะ/ความสะอาด',
  water: 'น้ำประปา', flood: 'น้ำท่วม/ระบายน้ำ', tree: 'ต้นไม้/สวนสาธารณะ',
  noise: 'เหตุรำคาญ', other: 'อื่นๆ',
}

// ── badge helpers (คำร้องที่มอบหมายแล้วแต่เจ้าหน้าที่ยังไม่เคยเปิดดู) ──────
function getStaffSeenIds() {
  try { return new Set(JSON.parse(localStorage.getItem('sl_staff_seen') ?? '[]')) }
  catch { return new Set() }
}
function markStaffSeen(id) {
  const seen = getStaffSeenIds()
  seen.add(id)
  localStorage.setItem('sl_staff_seen', JSON.stringify([...seen]))
  window.dispatchEvent(new Event('staff-badge-update'))
}

function ComplaintDetailSheetStaff({ complaint: c, onClose, onUpdate, updating }) {
  const [note, setNote] = useState(c.technician_note ?? '')
  const [photos, setPhotos] = useState(c.work_photos ?? [])
  const [uploading, setUploading] = useState(false)
  const [savingNote, setSavingNote] = useState(false)
  const [mapPos, setMapPos] = useState(c.latitude ? { lat: c.latitude, lng: c.longitude } : null)
  const [locationName, setLocationName] = useState(c.location_name || c.village || '')
  const [showMapEdit, setShowMapEdit] = useState(false)

  const st = C_STATUS[c.status]
  const nx = C_NEXT[c.status]
  const isDone = c.status === 'completed' || c.status === 'closed' || c.status === 'rejected'

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
            body: `เจ้าหน้าที่เพิ่มรูปความคืบหน้าในคำร้อง${C_CAT[c.category] ?? c.category ?? ''}`,
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

  return (
    <div className="fixed inset-0 z-60 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full sm:max-w-lg bg-white sm:rounded-2xl rounded-t-3xl shadow-2xl max-h-[92dvh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="shrink-0 px-5 pt-6 pb-5 relative"
             style={{ background: 'linear-gradient(135deg, var(--color-primary-dark) 0%, var(--color-primary) 100%)' }}>
          <button onClick={onClose}
            className="absolute top-4 right-4 w-9 h-9 flex items-center justify-center rounded-full bg-white shadow-lg hover:bg-gray-100 active:scale-95 transition-all">
            <X size={20} className="text-gray-700" strokeWidth={2.5} />
          </button>
          <div className="flex-1 min-w-0 pr-12">
            <p className="text-white/70 text-xs">งานที่ได้รับมอบหมาย</p>
            <p className="text-white font-bold text-base mt-0.5">{C_CAT[c.category] ?? c.category}</p>
            {c.profiles?.full_name && <p className="text-white/60 text-xs mt-1">ผู้แจ้ง: {c.profiles.full_name}</p>}
          </div>
          <div className="mt-4 pt-4 border-t border-white/20 flex justify-between items-center">
            <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold" style={{ backgroundColor: st?.bg, color: st?.color }}>
              {st?.label}
            </span>
            <p className="text-white/70 text-xs">
              {new Date(c.created_at).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: 'numeric' })}
            </p>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5 bg-white">
          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">รายละเอียดปัญหา</p>
            <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100">
              <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{c.description || c.detail}</p>
            </div>
          </div>

          {(c.attachments ?? []).length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">รูปภาพจากผู้แจ้ง ({c.attachments.length})</p>
              <div className="grid grid-cols-3 gap-2">
                {c.attachments.map((url, i) => (
                  <a key={i} href={url} target="_blank" rel="noreferrer" className="aspect-square rounded-xl overflow-hidden border border-blue-200 bg-blue-50">
                    <img src={url} alt={`แนบ ${i + 1}`} className="w-full h-full object-cover" />
                  </a>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">จุดเกิดเหตุ</p>
              {!isDone && (
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
                  <a href={`tel:${c.phone}`} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-100 transition-colors">
                    <Phone size={15} className="text-green-500 shrink-0" />
                    <p className="text-sm font-bold text-gray-800 flex-1">{c.phone}</p>
                    <span className="text-xs font-semibold px-2 py-1 bg-green-100 text-green-700 rounded-lg">โทรออก</span>
                  </a>
                )}
                {mapPos && (
                  <a href={`https://maps.google.com/?q=${mapPos.lat},${mapPos.lng}`} target="_blank" rel="noreferrer"
                     className="flex items-center gap-3 px-4 py-3 hover:bg-gray-100 transition-colors">
                    <MapPin size={15} className="text-blue-500 shrink-0" />
                    <p className="text-sm text-gray-700 flex-1">{mapPos.lat.toFixed(5)}, {mapPos.lng.toFixed(5)}</p>
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

          {/* รูปหลักฐานการทำงาน */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                รูปหลักฐานการทำงาน {photos.length > 0 && `(${photos.length})`}
              </p>
              {!isDone && (
                <label className="cursor-pointer flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors">
                  {uploading ? <Loader2 size={13} className="animate-spin" /> : <Camera size={13} />}
                  {uploading ? 'กำลังอัปโหลด...' : 'เพิ่มรูป'}
                  <input type="file" accept="image/*" className="hidden" onChange={uploadPhoto} disabled={uploading} />
                </label>
              )}
            </div>
            {photos.length > 0 ? (
              <div className="grid grid-cols-3 gap-2">
                {photos.map((url, i) => (
                  <a key={i} href={url} target="_blank" rel="noreferrer" className="aspect-square rounded-xl overflow-hidden border border-blue-200 bg-blue-50">
                    <img src={url} alt="" className="w-full h-full object-cover" />
                  </a>
                ))}
              </div>
            ) : (
              <div className="flex items-center justify-center py-6 rounded-2xl border-2 border-dashed border-gray-200 text-gray-400">
                <div className="text-center">
                  <Camera size={24} className="mx-auto mb-1 opacity-50" />
                  <p className="text-xs">ยังไม่มีรูปหลักฐาน</p>
                </div>
              </div>
            )}
          </div>

          {/* บันทึกการดำเนินการ */}
          {!isDone ? (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">บันทึกการดำเนินการ</p>
              <div className="flex gap-2">
                <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3}
                  placeholder="บันทึกรายละเอียดการดำเนินการ..."
                  className="flex-1 border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-800 bg-white resize-none focus:outline-none focus:ring-2 focus:ring-blue-100" />
                <button onClick={saveNote} disabled={savingNote}
                  className="self-end px-3 py-2 rounded-xl text-xs font-semibold bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors disabled:opacity-50">
                  {savingNote ? <Loader2 size={13} className="animate-spin" /> : 'บันทึก'}
                </button>
              </div>
            </div>
          ) : c.technician_note && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">บันทึกการดำเนินการ</p>
              <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100">
                <p className="text-sm text-gray-700 whitespace-pre-wrap">{c.technician_note}</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {nx && (
          <div className="px-5 py-4 border-t border-gray-100 bg-gray-50 shrink-0">
            <button onClick={() => onUpdate(c.id, nx.next, photos, note)} disabled={updating === c.id}
              className="w-full py-3 rounded-2xl text-sm font-bold text-white transition-all active:scale-98 disabled:opacity-50"
              style={{ backgroundColor: nx.next === 'done' ? '#10b981' : 'var(--color-primary)' }}>
              {updating === c.id ? <Loader2 size={16} className="animate-spin mx-auto" /> : `${nx.label} →`}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function ComplaintsStaffModule({ tenant, staffId }) {
  const tenantId = tenant?.id
  const [complaints, setComplaints] = useState([])
  const [loading, setLoading]       = useState(true)

  // ดึงหมวดหมู่ที่ Admin สร้างเอง merge เข้า C_CAT
  const [, setCatVer] = useState(0)
  useEffect(() => {
    if (!tenant?.id) return
    supabase.from('complaint_categories').select('value, label').eq('municipality_id', tenant.id)
      .then(({ data }) => {
        if (data && data.length > 0) {
          for (const c of data) C_CAT[c.value] = c.label
          setCatVer(v => v + 1)
        }
      })
  }, [tenant?.id])
  const [search, setSearch]         = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [updating, setUpdating]     = useState(null)
  const [selected, setSelected]     = useState(null)
  const [openingComplaintId, setOpeningComplaintId] = useState(null)

  const loadAssignedComplaints = useCallback(async () => {
    if (!tenantId || !staffId) return
    const { data, error } = await fetchRoleScopedComplaints(tenantId)
    if (error) console.error('fetch assigned complaints error:', error.message)
    setComplaints((data ?? []).filter((c) => c.assigned_to === staffId && c.status !== 'pending'))
    setLoading(false)
  }, [tenantId, staffId])

  async function openAssignedComplaint(complaint) {
    if (!complaint?.id || openingComplaintId === complaint.id) return
    setOpeningComplaintId(complaint.id)
    const { data, error } = await fetchComplaintPrivateDetail(
      complaint.id,
      'เปิดรายละเอียดงานที่ได้รับมอบหมาย',
    )
    setOpeningComplaintId(null)
    if (error) {
      console.error('fetch assigned complaint detail error:', error.message)
      alert('ไม่มีสิทธิ์เปิดรายละเอียดคำร้องนี้')
      return
    }
    if (data) {
      markStaffSeen(complaint.id)
      setSelected(data)
    }
  }

  useEffect(() => {
    if (!tenant?.id || !staffId) return
    queueMicrotask(loadAssignedComplaints)
  }, [tenant?.id, staffId, loadAssignedComplaints])

  useEffect(() => {
    if (!tenant?.id || !staffId) return
    const ch = supabase.channel(`complaints-staff-${tenant.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'complaints' },
        ({ new: row }) => {
          if (row.municipality_id !== tenant.id || row.assigned_to !== staffId) return
          loadAssignedComplaints()
        })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'complaints' },
        ({ new: row }) => {
          if (row.municipality_id !== tenant.id) return
          loadAssignedComplaints()
        })
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [tenant?.id, staffId, loadAssignedComplaints])

  async function fetchAll() {
    setLoading(true)
    await loadAssignedComplaints()
  }

  async function advanceStatus(id, next, workPhotos = null, techNote = null) {
    setUpdating(id)
    const payload = { status: next, updated_at: new Date().toISOString() }
    if (workPhotos?.length > 0) payload.work_photos = workPhotos
    if (techNote !== null) payload.technician_note = techNote
    const { error } = await supabase.from('complaints').update(payload).eq('id', id)
    if (!error) {
      setComplaints(prev => prev.map(c => c.id === id ? { ...c, ...payload } : c))
      const c = complaints.find(x => x.id === id)
      const catLabel = C_CAT[c?.category] ?? c?.category ?? ''
      notifyTelegram(tenant?.telegram_group_id,
        `🔄 <b>อัปเดตสถานะคำร้อง</b>\nประเภท: ${catLabel}\nสถานะ: ${C_STATUS[next]?.label ?? next}`
      )
      setSelected(null)
    }
    setUpdating(null)
  }

  const filtered = complaints.filter(c => {
    if (filterStatus !== 'all' && c.status !== filterStatus) return false
    if (search.trim()) {
      const q = search.toLowerCase()
      return (c.description ?? '').toLowerCase().includes(q) || (C_CAT[c.category] ?? '').toLowerCase().includes(q) || (c.profiles?.full_name ?? '').toLowerCase().includes(q)
    }
    return true
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="font-bold text-gray-800">คำร้องประชาชน</h2>
        <div className="flex items-center gap-2">
          <button onClick={fetchAll} className="p-2 rounded-xl hover:bg-gray-100 text-gray-400 transition-colors">
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        {['all','pending','received','in_progress','completed','rejected'].map(s => (
          <button key={s} onClick={() => setFilterStatus(s)}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors ${filterStatus === s ? 'text-white border-transparent' : 'bg-white text-gray-500 border-gray-200'}`}
            style={filterStatus === s ? { backgroundColor: C_STATUS[s]?.color ?? 'var(--color-primary)' } : {}}>
            {s === 'all' ? 'ทั้งหมด' : C_STATUS[s]?.label ?? s}
            {s === 'all' && ` (${complaints.length})`}
          </button>
        ))}
      </div>

      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="ค้นหาคำร้อง..."
          className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-gray-200 bg-white text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-100" />
        {search && <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"><X size={14} /></button>}
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 size={24} className="animate-spin text-gray-300" /></div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center text-gray-400 text-sm">
          {search || filterStatus !== 'all' ? 'ไม่พบคำร้องที่ตรงเงื่อนไข' : 'ยังไม่มีคำร้องที่ได้รับมอบหมาย'}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(c => {
            const st = C_STATUS[c.status]
            const nx = C_NEXT[c.status]
            const date = new Date(c.created_at).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })
            return (
              <div key={c.id} onClick={() => openAssignedComplaint(c)} aria-busy={openingComplaintId === c.id}
                className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 cursor-pointer hover:border-gray-200 transition-colors">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: st?.bg, color: st?.color }}>{st?.label}</span>
                      <span className="text-xs text-gray-400">{C_CAT[c.category] ?? c.category}</span>
                      {c.latitude && (
                        <span className="text-orange-500 shrink-0" title="มีพิกัด GPS"><MapPin size={11} /></span>
                      )}
                      {c.attachments && c.attachments.length > 0 && (
                        <span className="text-blue-500 shrink-0" title="มีภาพประกอบ"><Camera size={11} /></span>
                      )}
                      <span className="text-xs text-gray-300">·</span>
                      <span className="text-xs text-gray-400">{date}</span>
                    </div>
                    <p className="text-sm text-gray-700 line-clamp-2">{c.description}</p>
                    {c.profiles?.full_name && <p className="text-xs text-gray-400 mt-1">👤 {c.profiles.full_name}</p>}
                  </div>
                  {nx && (
                    <button onClick={(e) => { e.stopPropagation(); advanceStatus(c.id, nx.next) }} disabled={updating === c.id}
                      className="shrink-0 text-xs font-bold px-3 py-1.5 rounded-xl text-white disabled:opacity-50"
                      style={{ backgroundColor: 'var(--color-primary)' }}>
                      {updating === c.id ? '...' : nx.label}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {selected && (
        <ComplaintDetailSheetStaff complaint={selected} onClose={() => setSelected(null)}
          onUpdate={advanceStatus} updating={updating} />
      )}
    </div>
  )
}

function StaffReportWrapper({ tenant }) {
  const [complaints, setComplaints] = useState([])
  const [technicians, setTechnicians] = useState([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    if (!tenant?.id) return
    Promise.all([
      fetchRoleScopedComplaints(tenant.id),
      supabase.from('profiles').select('id, full_name, email').eq('municipality_id', tenant.id).eq('role', 'technician'),
    ]).then(([{ data: c, error }, { data: t }]) => {
      if (error) console.error('fetch complaint report data error:', error.message)
      setComplaints(c ?? [])
      setTechnicians(t ?? [])
      setLoading(false)
    })
  }, [tenant?.id])
  if (loading) return <div className="flex justify-center py-16"><Loader2 size={24} className="animate-spin text-gray-300" /></div>
  return <ReportManager complaints={complaints} tenant={tenant} technicians={technicians} />
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function StaffDashboard() {
  const navigate = useNavigate()
  const location = useLocation()
  const { tenant } = useTenant()
  const [activeModule, setActiveModule] = useState(location.state?.module ?? 'home')
  const [mapOpenComplaintId, setMapOpenComplaintId] = useState(location.state?.openComplaintId ?? null)
  const [autoEditEventId, setAutoEditEventId] = useState(location.state?.editEventId ?? null)
  const [autoCreateEventSignal, setAutoCreateEventSignal] = useState(0)
  const [profile, setProfile]           = useState(null)
  const [pendingCount, setPendingCount] = useState(0)
  const [newComplaintCount, setNewComplaintCount] = useState(0)

  const allModuleKeys = MODULES.map(m => m.key)
  // keys ที่เคยอยู่ใน ModuleManager — ถ้า key ใหม่ยังไม่เคยถูก manage ให้ default เป็น enabled
  const managedKeys = ['inbox', 'docs', 'complaints', 'events', 'projects', 'data-center', 'report']
  const baseEnabledKeys = tenant?.enabled_modules
    ? [...tenant.enabled_modules, ...allModuleKeys.filter(k => !managedKeys.includes(k))]
    : allModuleKeys
  // events เปิดเสมอสำหรับ admin/officer/staff/viewer/council ไม่ขึ้นกับ ModuleManager
  // council ได้โมดูลเพิ่มเติม: map, civil-report, report
  const role = profile?.role
  const alwaysEnabled = ['events']
  if (role === 'council') alwaysEnabled.push('data-center', 'civil-report', 'report')
  const enabledKeys = Array.from(new Set([...baseEnabledKeys, ...alwaysEnabled]))
  const visibleStandaloneGroups = STANDALONE_GROUPS
    .map(g => ({ ...g, items: g.items.filter(m => enabledKeys.includes(m.key)) }))
    .filter(g => g.items.length > 0)
  const visibleGroups = MODULE_GROUPS
    .map(g => ({ ...g, items: g.items.filter(m => enabledKeys.includes(m.key)) }))
    .filter(g => g.items.length > 0 || g.alwaysShow)
  // หน้า Dashboard ต้องเห็นทุกงานที่เปิดใช้จริง ไม่ใช่เฉพาะเมนูที่ผูกกับกอง
  // และไม่ส่งกลุ่มว่างไปแสดง เพราะทำให้หน้าแรกดูเหมือนไม่มีเครื่องมือให้ใช้งาน
  const visibleHomeGroups = [...visibleStandaloneGroups, ...visibleGroups]
    .filter(group => group.items.length > 0)
  const visibleModules = visibleHomeGroups.flatMap(group => group.items)

  useEffect(() => {
    _customDocTypes = (tenant?.fee_schedule?._custom_types || []).map(t => ({
      value: t.value,
      label: `${t.emoji || '📋'} ${t.label}`,
    }))
  }, [tenant?.fee_schedule?._custom_types])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) { navigate('/auth', { state: { from: '/staff' } }); return }
      supabase.from('profiles').select('*').eq('id', data.session.user.id).single()
        .then(({ data: p }) => setProfile(p))
    })
  }, [navigate])

  useEffect(() => {
    if (!tenant?.id) return
    const refreshBadge = () =>
      supabase.from('document_requests').select('id', { count: 'exact', head: true })
        .eq('municipality_id', tenant.id).eq('status', 'pending')
        .then(({ count }) => setPendingCount(count ?? 0))

    refreshBadge()

    const ch = supabase.channel(`pending-badge-${tenant.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'document_requests' },
        ({ new: row }) => { if (row?.municipality_id === tenant.id) refreshBadge() })
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [tenant?.id])

  useEffect(() => {
    if (!tenant?.id || !profile?.id) return

    const refreshComplaintBadge = () =>
      supabase.from('complaints')
        .select('id, status')
        .eq('municipality_id', tenant.id)
        .eq('assigned_to', profile.id)
        .neq('status', 'pending')
        .then(({ data }) => {
          const seen = getStaffSeenIds()
          const count = (data ?? []).filter(c =>
            c.status !== 'completed' && c.status !== 'closed' && c.status !== 'rejected' && !seen.has(c.id)
          ).length
          setNewComplaintCount(count)
        })

    refreshComplaintBadge()
    window.addEventListener('staff-badge-update', refreshComplaintBadge)

    const ch = supabase.channel(`staff-complaint-badge-${tenant.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'complaints' },
        ({ new: row }) => { if (row?.municipality_id === tenant.id && row?.assigned_to === profile.id) refreshComplaintBadge() })
      .subscribe()

    return () => {
      window.removeEventListener('staff-badge-update', refreshComplaintBadge)
      supabase.removeChannel(ch)
    }
  }, [tenant?.id, profile?.id])

  async function handleLogout() {
    await supabase.auth.signOut()
    navigate('/')
  }

  return (
    <div className="min-h-full" style={{ backgroundColor: '#eef2f7' }}>

      {/* Mobile header — เหมือนหน้าหลักประชาชน กันสับสนตอนสลับโหมด */}
      <header className="md:hidden text-white px-4 pt-3 pb-4 relative overflow-hidden shrink-0"
        style={{ background: 'linear-gradient(135deg, var(--color-primary-dark) 0%, var(--color-primary) 100%)' }}>
        <div className="flex items-center gap-3 relative z-10">
          <button onClick={() => navigate('/')} className="shrink-0 active:opacity-70 transition-opacity">
            {tenant?.logo_url
              ? <img src={tenant.logo_url} alt="โลโก้" className="w-11 h-11 rounded-full object-contain bg-white/10 p-0.5 border border-white/20" />
              : <div className="w-11 h-11 rounded-full border-2 border-white/40 bg-white/20 flex items-center justify-center text-lg font-bold">{tenant?.name?.[0] ?? '?'}</div>}
          </button>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-sm leading-tight truncate">{tenant?.name ?? 'Staff Portal'}</p>
            <p className="text-white/70 text-[11px] mt-0.5">สำหรับเจ้าหน้าที่</p>
          </div>
          {enabledKeys.includes('data-center') && (
            <button onClick={() => navigate('/data-center/staff')} aria-label="ศูนย์รวมข้อมูลดิจิทัล" className="p-1.5 text-white/85 hover:text-white transition-colors shrink-0">
              <Database size={19} />
            </button>
          )}
          <button onClick={() => navigate('/notifications')} aria-label="การแจ้งเตือน" className="p-1.5 text-white/85 hover:text-white transition-colors shrink-0">
            <Bell size={19} />
          </button>
          <button onClick={() => navigate('/profile')} className="p-1 shrink-0">
            {profile?.avatar_url ? (
              <img src={profile.avatar_url} alt="โปรไฟล์" className="w-7 h-7 rounded-full object-cover border-2 border-white/60" />
            ) : (
              <div className="w-7 h-7 rounded-full bg-white/20 border-2 border-white/60 flex items-center justify-center text-white text-xs font-bold">
                {(profile?.full_name || '?')[0].toUpperCase()}
              </div>
            )}
          </button>
        </div>
      </header>

        {/* PC header — staff themed */}
        <header className="hidden md:block relative w-full text-white overflow-hidden"
          style={{ background: 'linear-gradient(180deg, var(--color-primary) 0%, var(--color-primary-dark) 100%)' }}>
          <div className="absolute inset-0 opacity-25 pointer-events-none"
            style={{ backgroundImage: `url("${tenant?.header_image_url || 'https://images.unsplash.com/photo-1511497584788-876760111969?auto=format&fit=crop&q=80&w=1000'}")`, backgroundSize: 'cover', backgroundPosition: 'center' }} />
          <div className="absolute bottom-0 inset-x-0 h-12 pointer-events-none"
            style={{ background: 'linear-gradient(to top, var(--color-primary-dark), transparent)' }} />

          {/* Top row */}
          <div className="relative z-10 flex items-center justify-between px-6 py-3">
            <div className="flex items-center gap-3">
              <button onClick={() => navigate('/')} className="shrink-0 active:opacity-70 transition-opacity hover:scale-105 transition-transform">
                {tenant?.logo_url
                  ? <img src={tenant.logo_url} alt="" className="w-10 h-10 rounded-full border-2 border-white/40 bg-white/10 object-cover" />
                  : <div className="w-10 h-10 rounded-full bg-white/20 border-2 border-white/40 flex items-center justify-center text-lg font-bold">🏛️</div>}
              </button>
              <div>
                <span className="text-[10px] font-black bg-white/20 text-white px-2 py-0.5 rounded-full tracking-widest uppercase">ระบบเจ้าหน้าที่</span>
                <p className="text-sm font-bold text-white mt-0.5 leading-tight">{tenant?.name}</p>
              </div>
            </div>
            {profile && (
              <div className="flex items-center gap-2">
                <div className="text-right">
                  <p className="text-xs font-bold text-white">{profile.full_name}</p>
                  <p className="text-[10px] text-emerald-200">{ROLE_TH[profile.role] ?? profile.role}</p>
                </div>
                <div className="w-8 h-8 rounded-full bg-white/20 border border-white/40 flex items-center justify-center text-sm font-bold text-white shrink-0">
                  {profile.full_name?.[0]?.toUpperCase() ?? '?'}
                </div>
                <button onClick={() => navigate('/')}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold bg-white/10 hover:bg-white/20 transition-colors border border-white/20">
                  <Home size={13} />
                  เว็บหลัก
                </button>
                <button onClick={handleLogout}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold bg-white/10 hover:bg-white/20 transition-colors border border-white/20">
                  <LogOut size={13} />
                  ออกจากระบบ
                </button>
              </div>
            )}
          </div>

        </header>

        {/* Desktop sidebar + main */}
        <div className="md:flex">
          <aside className="hidden md:flex flex-col w-60 shrink-0 shadow-lg"
            style={{ backgroundColor: '#1a3a5c' }}>
            <nav className="flex-1 px-3 py-4 overflow-y-auto">
              <button onClick={() => setActiveModule('home')}
                className={`mb-2 flex min-h-9 w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/60 ${activeModule === 'home' ? 'bg-white/20 text-white shadow-sm' : 'text-white/80 hover:bg-white/10 hover:text-white'}`}>
                <Home size={16} strokeWidth={activeModule === 'home' ? 2.2 : 1.8} />
                <span className="flex-1 text-left text-xs">หน้าหลัก</span>
              </button>
              {enabledKeys.includes('data-center') && (
                <button onClick={() => navigate('/data-center/staff')}
                  className="mb-2 flex min-h-9 w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold transition-all text-white/80 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/60">
                  <Database size={16} strokeWidth={1.8} />
                  <span className="flex-1 text-left text-xs">ศูนย์รวมข้อมูลดิจิทัล</span>
                </button>
              )}
              {visibleStandaloneGroups.map(({ group, items }) => (
                <div key={group} className="mb-3">
                  <p className="mb-1 px-3 text-[10px] font-bold uppercase tracking-widest text-white/55">{group}</p>
                  <div className="space-y-0.5">
                    {items.map(({ key, label, Icon, externalUrl }) => {
                      const isActive = activeModule === key
                      const badge = key === 'inbox' && pendingCount > 0 ? pendingCount
                        : key === 'complaints' && newComplaintCount > 0 ? newComplaintCount
                        : null
                      return (
                        <button key={key} onClick={() => externalUrl ? navigate(externalUrl) : setActiveModule(key)}
                          className={`flex min-h-9 w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/60 ${isActive ? 'bg-white/20 text-white shadow-sm' : 'text-white/80 hover:bg-white/10 hover:text-white'}`}>
                          <Icon size={16} strokeWidth={isActive ? 2.2 : 1.8} />
                          <span className="flex-1 text-left text-xs">{label}</span>
                          {badge && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full text-white bg-amber-400">
                              {badge > 99 ? '99+' : badge}
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
              <div className="my-2 border-t" style={{ borderColor: 'rgba(255,255,255,0.1)' }} />
              {visibleGroups.map(({ group, items }) => (
                <div key={group} className="mb-3">
                  <p className="mb-1 px-3 text-[10px] font-bold uppercase tracking-widest text-white/55">{group}</p>
                  <div className="space-y-0.5">
                    {items.length === 0 ? (
                      <p className="px-3 py-1.5 text-[11px] italic text-white/35">ยังไม่มีเมนูงานในกองนี้</p>
                    ) : items.map(({ key, label, Icon, externalUrl }) => {
                      const isActive = activeModule === key
                      const badge = key === 'inbox' && pendingCount > 0 ? pendingCount
                        : key === 'complaints' && newComplaintCount > 0 ? newComplaintCount
                        : null
                      return (
                        <button key={key} onClick={() => externalUrl ? navigate(externalUrl) : setActiveModule(key)}
                          className={`flex min-h-9 w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/60 ${isActive ? 'bg-white/20 text-white shadow-sm' : 'text-white/80 hover:bg-white/10 hover:text-white'}`}>
                          <Icon size={16} strokeWidth={isActive ? 2.2 : 1.8} />
                          <span className="flex-1 text-left text-xs">{label}</span>
                          {badge && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full text-white bg-amber-400">
                              {badge > 99 ? '99+' : badge}
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </nav>
          </aside>

          {/* Main */}
          <main className={`flex-1 min-w-0 px-4 md:px-6 pb-24 md:pb-6 ${activeModule === 'home' ? 'pt-2 md:pt-5' : 'pt-5'}`}>
            <div className="max-w-5xl mx-auto space-y-4">
            <Suspense fallback={
              <div className="flex min-h-64 items-center justify-center" role="status" aria-label="กำลังโหลดโมดูลเจ้าหน้าที่">
                <Loader2 size={28} className="animate-spin text-blue-500" />
              </div>
            }>
            {activeModule === 'home' && (
              <StaffOperationalDashboard
                key={tenant?.id}
                visibleGroups={visibleHomeGroups}
                setActiveModule={setActiveModule}
                tenant={tenant}
                profile={profile}
                pendingCount={pendingCount}
                newComplaintCount={newComplaintCount}
                navigate={navigate}
                docTypes={getAllDocTypes()}
                complaintLabels={C_CAT}
                onCreateManagementEvent={() => {
                  setAutoCreateEventSignal(signal => signal + 1)
                  setActiveModule('events')
                }}
              />
            )}
            {activeModule === 'inbox'      && <InboxModule tenant={tenant} staffId={profile?.id} currentUserRole={profile?.role} />}
            {activeModule === 'complaints' && (
              ['admin', 'superadmin', 'staff'].includes(profile?.role)
                ? <ComplaintsManager tenant={tenant} currentUserRole={profile?.role} openComplaintId={mapOpenComplaintId} />
                : <ComplaintsStaffModule tenant={tenant} staffId={profile?.id} />
            )}
            {activeModule === 'events'     && <EventsManager tenant={tenant} currentUserRole={profile?.role ?? 'staff'} autoEditEventId={autoEditEventId} onAutoEditHandled={() => setAutoEditEventId(null)} autoCreateSignal={autoCreateEventSignal} autoCreateAudience="management" onAutoCreateHandled={() => setAutoCreateEventSignal(0)} />}
            {activeModule === 'projects'      && <CivilProjectAdmin tenant={tenant} currentUserRole={profile?.role ?? 'staff'} myDepartmentId={profile?.department_id ?? null} />}
            {activeModule === 'infra'      && <InfraWorkAdmin tenant={tenant} currentUserRole={profile?.role ?? 'staff'} myDepartmentId={profile?.department_id ?? null} />}
            {activeModule === 'report'       && <StaffReportWrapper tenant={tenant} />}
            {activeModule === 'civil-report'      && <CivilProjectReport tenant={tenant} />}
            {activeModule === 'posts'            && <PostsManager />}
            {activeModule === 'tourism'          && <TourismManager tenant={tenant} currentUserRole={profile?.role ?? 'staff'} myDepartmentId={profile?.department_id ?? null} />}
            {activeModule === 'tourism-reviews'  && <TourismReviewsAdmin tenant={tenant} />}
            {activeModule === 'fleet' && <FleetPage onBack={() => setActiveModule('home')} />}
            {activeModule === 'positions' && <PositionsManager tenant={tenant} currentUserRole={profile?.role ?? 'staff'} currentUserId={profile?.id} />}
            </Suspense>
            </div>
          </main>
        </div>

        {/* Mobile bottom nav */}
        <nav className="md:hidden fixed bottom-0 left-0 right-0 z-20 flex items-stretch"
          style={{
            background: 'linear-gradient(180deg, var(--color-primary) 0%, var(--color-primary-dark) 100%)',
            borderTop: '2px solid rgba(255,255,255,0.15)',
            boxShadow: '0 -4px 20px rgba(0,0,0,0.3)',
            borderTopLeftRadius: '20px',
            borderTopRightRadius: '20px',
            paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 6px)',
          }}>
          {[
            { key: 'home',       label: 'หน้าหลัก',   Icon: Home },
            { key: 'inbox',      label: 'คำขอเอกสาร', Icon: FileText },
            { key: 'complaints', label: 'คำร้อง',      Icon: MessageSquareWarning },
            { key: 'events',     label: 'ปฏิทินกิจกรรม', Icon: CalendarDays },
          ].filter(({ key }) => key === 'home' || visibleModules.some(m => m.key === key)).map(({ key, label, Icon }) => {
            const isActive = activeModule === key
            const badge = key === 'inbox' && pendingCount > 0 ? pendingCount
              : key === 'complaints' && newComplaintCount > 0 ? newComplaintCount
              : null
            return (
              <button key={key}
                onClick={() => setActiveModule(key)}
                className="flex-1 flex flex-col items-center justify-center gap-0.5 pt-2 pb-1 transition-all active:scale-90">
                <div className="relative w-10 h-9 rounded-xl flex items-center justify-center transition-all duration-200"
                  style={{ backgroundColor: isActive ? 'rgba(255,255,255,0.2)' : 'transparent' }}>
                  {isActive && (
                    <span className="absolute -top-0.5 left-1/2 -translate-x-1/2 w-4 h-[3px] rounded-full bg-white" />
                  )}
                  <Icon size={20} strokeWidth={isActive ? 2.2 : 1.6}
                    style={{ color: isActive ? '#fff' : 'rgba(255,255,255,0.45)' }} />
                  {badge && (
                    <span className="absolute -top-1 -right-1 min-w-[16px] h-4 rounded-full text-[9px] font-bold text-amber-900 flex items-center justify-center px-1 bg-amber-400">
                      {badge > 9 ? '9+' : badge}
                    </span>
                  )}
                </div>
                <span className="text-[10px] font-bold leading-tight"
                  style={{ color: isActive ? '#fff' : 'rgba(255,255,255,0.45)' }}>{label}</span>
              </button>
            )
          })}
          {/* รายงาน */}
          {(() => {
            const isActive = activeModule === 'report'
            return (
              <button onClick={() => setActiveModule('report')}
                className="flex-1 flex flex-col items-center justify-center gap-0.5 pt-2 pb-1 transition-all active:scale-90">
                <div className="relative w-10 h-9 rounded-xl flex items-center justify-center transition-all duration-200"
                  style={{ backgroundColor: isActive ? 'rgba(255,255,255,0.2)' : 'transparent' }}>
                  {isActive && (
                    <span className="absolute -top-0.5 left-1/2 -translate-x-1/2 w-4 h-[3px] rounded-full bg-amber-400" />
                  )}
                  <TrendingUp size={20} strokeWidth={isActive ? 2.2 : 1.6}
                    style={{ color: isActive ? '#fff' : 'rgba(255,255,255,0.45)' }} />
                </div>
                <span className="text-[10px] font-bold leading-tight"
                  style={{ color: isActive ? '#fff' : 'rgba(255,255,255,0.45)' }}>รายงาน</span>
              </button>
            )
          })()}
        </nav>

    </div>
  )
}
