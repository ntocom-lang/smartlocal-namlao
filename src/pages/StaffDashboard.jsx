import { lazy, Suspense, useState, useEffect, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  Inbox, FileText, MessageSquareWarning, LogOut,
  ChevronRight, X, Clock, CheckCircle2, XCircle, Loader2,
  Plus, Phone, MapPin, User, AlignLeft, Calendar, Hash, RefreshCw,
  Printer, Search, Hammer, LayoutDashboard, CalendarDays, TrendingUp, Images, Camera,
  Banknote, Luggage, Star, Car, Bell, Trash2, Database, BookOpen,
} from 'lucide-react'
import { supabase, signOutSafely } from '../lib/supabase'
import { fetchComplaintPrivateDetail, fetchRoleScopedComplaints } from '../lib/complaintPrivacy'
import { useTenant } from '../contexts/TenantContext'
import { useNotifications } from '../contexts/NotificationsContext'
import { notifyTelegram } from '../lib/notifyTelegram'
import { govDocFontCss, govEServiceOriginText, govPageCss } from '../lib/govDocStyle.js'
import { thaiDate, thaiDateFromDateInput } from '../lib/thaiDate'
import { buildBuildingPermitHtml } from '../lib/buildingPermitPrint'
import { buildWasteCollectionRequestHtml, collectionPointText } from '../lib/wasteCollectionRequestPrint'
import { uploadFile } from '../lib/driveStorage'
import { fetchAssignableStaff, groupStaffByDepartment } from '../lib/staffRoster'
import { BASE_DOCUMENT_TYPES } from '../lib/documentTypes'
import { MANAGED_MODULE_KEYS } from '../lib/staffModules'
import OdorAcknowledgePanel from '../components/staff/OdorAcknowledgePanel'
import PortalSwitcher from '../components/layout/PortalSwitcher'
import UserProfileBadge from '../components/layout/UserProfileBadge'

const CivilProjectAdmin = lazy(() => import('../components/admin/CivilProjectAdmin'))
const InfraWorkAdmin = lazy(() => import('../components/admin/InfraWorkAdmin'))
const CivilProjectReport = lazy(() => import('../components/admin/CivilProjectReport'))
const EventsManager = lazy(() => import('../components/admin/EventsManager'))
const ComplaintsManager = lazy(() => import('../components/admin/ComplaintsManager'))
// ใช้ modal ตัวเดียวกับหน้าจัดการคำร้องของแอดมิน ไม่ทำของตัวเองซ้ำ — มันคุมทุก action ด้วย
// currentUserRole อยู่แล้ว (ลบ/มอบหมาย/เปลี่ยนความเร่งด่วน/แก้สถานะ โผล่เฉพาะ admin,
// จัดการเอกสารเฉพาะ admin กับ staff) เจ้าหน้าที่จึงได้หน้าตาเดียวกันโดยไม่ได้สิทธิ์เพิ่ม
const ComplaintDetailModal = lazy(() =>
  import('../components/admin/ComplaintsManager').then(m => ({ default: m.ComplaintDetailModal })))
const ReportManager = lazy(() => import('../components/admin/ReportManager'))
const TourismManager = lazy(() => import('../components/admin/TourismManager'))
const TourismReviewsAdmin = lazy(() => import('../components/admin/TourismManager').then(module => ({ default: module.TourismReviewsAdmin })))
const PostsManager = lazy(() => import('../components/staff/PostsManager'))
const StaffOperationalDashboard = lazy(() => import('../components/staff/StaffOperationalDashboard'))
const FleetPage = lazy(() => import('./FleetPage'))
const BuildingPermitWizard = lazy(() => import('./BuildingPermitWizard'))
const WasteCollectionRequestWizard = lazy(() => import('./WasteCollectionRequestWizard'))

// ─── Config ───────────────────────────────────────────────────────────────────

// ลิสต์ประเภทย้ายไป src/lib/documentTypes.js แล้ว — หน้าตั้งค่าของแอดมิน (กอง/ผู้รับผิดชอบ/SLA)
// ต้องใช้ลิสต์เดียวกับหน้านี้เป๊ะ ไม่งั้นจะมีประเภทที่ประชาชนยื่นได้แต่แอดมินตั้งผู้รับผิดชอบไม่ได้
const DOC_TYPES = BASE_DOCUMENT_TYPES
let _customDocTypes = []
function getAllDocTypes() { return [...DOC_TYPES, ..._customDocTypes] }

const STATUS = {
  pending:    { label: 'รอดำเนินการ',    color: '#f59e0b', bg: '#fef3c7', Icon: Clock },
  processing: { label: 'กำลังดำเนินการ', color: '#3b82f6', bg: '#dbeafe', Icon: RefreshCw },
  completed:  { label: 'เสร็จสิ้น',      color: '#10b981', bg: '#d1fae5', Icon: CheckCircle2 },
  rejected:   { label: 'ปฏิเสธ',         color: '#ef4444', bg: '#fee2e2', Icon: XCircle },
}

// ป้ายปุ่มในคอลัมน์ "ดำเนินการ" ของตารางคำขอ — ต้องเปลี่ยนตามสถานะ ห้ามใช้คำว่า
// "ดำเนินการ" คำเดียวทุกแถว เพราะแถวที่ปิดงานแล้วจะขึ้น "เสร็จสิ้น" คู่กับปุ่ม "ดำเนินการ"
// ซึ่งอ่านแล้วเหมือนกดต่อได้ และคำนี้ยังไปชนกับค่าในคอลัมน์สถานะเอง (รอดำเนินการ /
// กำลังดำเนินการ) จนดูเหมือนสองคอลัมน์บอกเรื่องเดียวกัน
// ทุกป้ายเปิดแผ่นรายละเอียดเหมือนกันหมด — ตารางนี้เดินสถานะแบบ inline อย่างตารางคำร้องไม่ได้
// เพราะการปิดงานต้องใส่หมายเหตุเจ้าหน้าที่และสร้างไฟล์เอกสารก่อน
const INBOX_ACTION_LABELS = {
  pending:    'ตรวจสอบคำขอ',
  processing: 'ดำเนินการต่อ',
  completed:  'ดูรายละเอียด',
  rejected:   'ดูรายละเอียด',
}

// เมนูที่ข้ามกอง (ใช้ร่วมกันทุกกอง ไม่ผูกกับกองใดกองหนึ่ง) — จัดเป็นกลุ่มย่อยตามลักษณะงาน
// เพื่อให้หาเจอง่าย แทนที่จะเป็นลิสต์ยาวไม่มีหัวข้อ
const STANDALONE_GROUPS = [
  {
    group: 'งานบริการประชาชน',
    items: [
      { key: 'complaints', label: 'คำร้อง',     Icon: MessageSquareWarning, color: '#ef4444', bg: '#fee2e2' },
      { key: 'inbox',      label: 'คำขอบริการ/เอกสาร', Icon: FileText,       color: '#8b5cf6', bg: '#ede9fe' },
    ],
  },
  {
    group: 'ประชาสัมพันธ์และท่องเที่ยว',
    items: [
      { key: 'events',          label: 'ปฏิทินกิจกรรม',       Icon: CalendarDays, color: '#10b981', bg: '#d1fae5' },
      { key: 'posts',           label: 'ข่าวสาร/ภาพกิจกรรม',  Icon: Images,       color: '#059669', bg: '#d1fae5' },
      { key: 'tourism',         label: 'เที่ยว กิน พัก ชอป บริการ', Icon: Luggage,      color: '#d97706', bg: '#fef3c7' },
      { key: 'tourism-reviews', label: 'รีวิวสถานที่',        Icon: Star,         color: '#f59e0b', bg: '#fef3c7' },
    ],
  },
  {
    group: 'แผนงานและทรัพยากรกลาง',
    items: [
      // 'projects' (แผนงาน/โครงการ) กับ 'civil-report' (รายงานโครงการ) ถอดออกจากเมนูชั่วคราว
      // รอออกแบบใหม่ — คอมโพเนนต์ CivilProjectAdmin/CivilProjectReport กับ branch ที่ render
      // มันยังอยู่ครบ เอากลับมาแค่ใส่ 2 บรรทัดนี้คืน
      { key: 'report',        label: 'รายงาน',           Icon: TrendingUp,    color: '#f59e0b', bg: '#fef3c7' },
      // externalUrl (ไม่ใช่ activeModule) เพราะศูนย์ข้อมูลเป็นหน้าแยกที่ route /data-center/staff
      // เดิมคีย์นี้ไม่มีในลิสต์เลย ถูก hardcode เป็นปุ่มใน sidebar อย่างเดียว ผลคือหน้าแดชบอร์ด
      // (ที่ไล่เมนูจาก visibleGroups) หามันไม่เจอ — "เมนูใช้งานด่วน" เหลือ 2 ปุ่ม และบนมือถือที่ไม่มี
      // sidebar เหลือทางเข้าเดียวคือไอคอนเล็กๆ บน header ที่ไม่มีป้ายชื่อ
      { key: 'data-center', label: 'ศูนย์รวมข้อมูลดิจิทัล', Icon: Database, color: '#0284c7', bg: '#e0f2fe', externalUrl: '/data-center/staff' },
      { key: 'fleet',    label: 'ยานพาหนะ/น้ำมัน',  Icon: Car,           color: '#0369a1', bg: '#e0f2fe' },
    ],
  },
  // กลุ่ม 'บุคลากร' (เมนู 'positions' ทำเนียบตำแหน่ง) ถอดออก 2026-08-31 — ซ้ำกับหน้า
  // "จัดการผู้ใช้และการแต่งตั้ง" ฝั่งแอดมิน ส่วนการแก้แบบตำแหน่งย้ายไป SuperAdminPanel → แบบตำแหน่ง
  {
    group: 'คู่มือ',
    items: [
      // newTab: เปิดเอกสารคงที่ (static HTML) แท็บใหม่ — ต่างจาก externalUrl ที่ navigate() ในแท็บเดิม
      // (ใช้กับ route ภายในแอปเท่านั้น เพราะไฟล์ static ไม่มี route จับใน App.jsx)
      { key: 'manual-staff', label: 'คู่มือเจ้าหน้าที่', Icon: BookOpen, color: '#0369a1', bg: '#e0f2fe', newTab: '/manual-staff.html' },
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

// เมนูที่ช่างเห็นในหน้าเจ้าหน้าที่ (ช่างคือเจ้าหน้าที่กองช่าง เข้าหน้านี้ได้ ดู RequireAuth ใน App.jsx)
//
// จำเป็นต้องมีลิสต์นี้เพราะหน้านี้กรองเมนูด้วย tenant.enabled_modules อย่างเดียว ไม่ได้กรองตาม role
// เลย ถ้าเปิดประตูให้ technician โดยไม่มีตัวกรอง ช่างจะเห็นครบทุกโมดูลรวมถึงคำขอเอกสารของประชาชน
//
// เลือกจาก "สิ่งที่ RLS ฝั่ง DB เปิดให้ technician อ่านได้จริง" ไม่ใช่เดาจากชื่อเมนู:
//   - 'inbox' (คำขอเอกสาร) ไม่อยู่ในลิสต์โดยตั้งใจ — policy `read document_requests` มีเงื่อนไข
//     เฉพาะ superadmin/admin/officer/staff ไม่มี technician เลย โชว์เมนูไปก็กดเจอหน้าว่าง
//     ซึ่งแยกไม่ออกจาก "ไม่มีข้อมูล" = โกหกผู้ใช้
//   - 'fleet' ใช้คอลัมน์ profiles.fleet_role แยกต่างหาก ไม่ผูกกับ role หลัก ช่างที่ได้รับสิทธิ์
//     ยานพาหนะจึงใช้ได้ตามปกติ ส่วนคนที่ไม่ได้ตั้ง fleet_role จะเข้าไปแล้วไม่เห็นข้อมูลเอง
const TECHNICIAN_MODULE_KEYS = [
  'complaints',    // คำร้อง — RLS: complaints select by role scope ครอบ technician อยู่แล้ว
  'infra',         // บันทึกงานซ่อม — งานหลักของกองช่าง
  'events',        // ปฏิทินกิจกรรม
  'data-center',   // ศูนย์ข้อมูลดิจิทัล
  'fleet',         // ยานพาหนะ/น้ำมัน
  'manual-staff',  // คู่มือ
]


const inputCls = 'w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-200'

// ROLE_TH เดิมตรงนี้ถูกลบทิ้ง — ไม่มีใครเรียกใช้เลยสักจุด (dead code) แต่ยัง hardcode "สภาเทศบาล"
// ค้างไว้ ถ้าปล่อยไว้จะกลายเป็นแหล่งที่ผิดให้คนหยิบไปใช้ต่อ ต้องการ label ของ role ให้ import
// ROLE_LABELS จาก src/lib/staffRoster.js ซึ่งรู้จัก org_type แล้ว

function dateTH(s) {
  if (!s) return ''
  return new Date(s).toLocaleDateString('th-TH', {
    day: '2-digit', month: 'short', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

// เทียบ due_date (คอลัมน์ date ไม่มีเวลา) กับ "วันนี้ตามเวลาไทย" ด้วยสตริง YYYY-MM-DD ตรงๆ
// ไม่แปลงเป็น Date object เพราะ new Date('2026-09-07') ถูกตีความเป็น UTC เที่ยงคืน แล้วเครื่อง
// ที่ตั้งเป็น GMT+7 จะอ่านได้เป็นวันก่อนหน้า — กับดักเดิมที่เคยทำให้แบบ 4 พิมพ์วันที่ผิดไป 1 วัน
function todayISOInBangkok() {
  return new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10)
}
const OPEN_REQUEST_STATUSES = ['pending', 'processing']
function isOverdue(req) {
  if (!req?.due_date || !OPEN_REQUEST_STATUSES.includes(req.status)) return false
  return String(req.due_date).slice(0, 10) < todayISOInBangkok()
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

function TaskCard({ req, onClick }) {
  const docType = getAllDocTypes().find(d => d.value === req.document_type)
  const emoji = docType?.label.match(/^(\S+)/)?.[1] ?? '📄'
  const docLabel = docType?.label.replace(/^\S+\s*/, '') ?? req.document_type

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
        </div>
      </div>
      <ChevronRight size={16} className="text-gray-300 shrink-0 mt-1" />
    </button>
  )
}

// ─── Task Detail Sheet ────────────────────────────────────────────────────────

const FEE_INQUIRY_TYPES = ['tax_notice', 'waste_collection']

function TaskDetailSheet({
  req, onClose, onUpdate, acting, tenant, onInquiryUpdate, currentUserRole, onDelete,
  canAssign = false, assignees = [], assigning = false, assigneeName = null, onAssign,
}) {
  const [staffNote, setStaffNote]         = useState(req.staff_notes || '')
  const [confirmReject, setConfirmReject] = useState(false)
  const [rejectReason, setRejectReason]   = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const defaultFee = tenant?.fee_schedule?.[req.document_type] ?? 0
  const initialFee = req.fee_amount ?? defaultFee
  const [feeInput, setFeeInput]           = useState(initialFee > 0 ? String(initialFee) : '')
  const [settingFee, setSettingFee]       = useState(false)

  const docType     = getAllDocTypes().find(d => d.value === req.document_type)
  const isActive    = req.status === 'pending' || req.status === 'processing'
  const isFeeInquiry = FEE_INQUIRY_TYPES.includes(req.document_type)

  async function handleSetFee() {
    const amount = parseInt(feeInput)
    if (!amount || amount <= 0) { alert('กรุณาระบุยอดที่ถูกต้อง'); return }
    setSettingFee(true)
    try {
      const { error } = await supabase.from('document_requests')
        .update({ fee_amount: amount, payment_status: 'not_required', payment_slip_url: null })
        .eq('id', req.id)
      if (error) throw error
      notifyTelegram('fee_verified', req.id)
      onInquiryUpdate?.()
      onClose()
    } catch (err) {
      alert('เกิดข้อผิดพลาด: ' + err.message)
    } finally {
      setSettingFee(false)
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
            {req.document_type === 'waste_collection_request' && req.permit_form_data?.applicant?.age && (
              <InfoRow icon={<User size={14} />} label="อายุ" value={`${req.permit_form_data.applicant.age} ปี`} />
            )}
            {req.document_type === 'waste_collection_request' && req.permit_form_data?.bin_count && (
              <InfoRow icon={<Trash2 size={14} />} label="จำนวนถัง" value={`${req.permit_form_data.bin_count} ใบ`} />
            )}
            {/* หมุดจุดวางถังต้องเห็นในแดชบอร์ดที่สั่งงาน ไม่ใช่เห็นเฉพาะตอนพิมพ์ใบออกมา
                และต้องกดนำทางได้เลย เพราะคนที่ใช้คือพนักงานเก็บขนที่เปิดจากมือถือหน้างาน */}
            {req.document_type === 'waste_collection_request' && req.permit_form_data?.collection_point && (
              <InfoRow icon={<MapPin size={14} />} label="จุดวางถัง" value={
                <span className="flex flex-col gap-1">
                  {req.permit_form_data.collection_point.address && (
                    <span>{req.permit_form_data.collection_point.address}</span>
                  )}
                  <a href={`https://www.google.com/maps/dir/?api=1&destination=${req.permit_form_data.collection_point.lat},${req.permit_form_data.collection_point.lng}`}
                    target="_blank" rel="noopener noreferrer"
                    className="font-mono text-xs font-semibold text-blue-600 underline">
                    {Number(req.permit_form_data.collection_point.lat).toFixed(6)}, {Number(req.permit_form_data.collection_point.lng).toFixed(6)} — เปิดนำทาง
                  </a>
                </span>
              } />
            )}
            {req.document_type === 'waste_collection_request' && req.permit_form_data?.service_start_date && (
              <InfoRow icon={<Calendar size={14} />} label="เริ่มให้จัดเก็บ"
                value={thaiDateFromDateInput(req.permit_form_data.service_start_date)} />
            )}
            <InfoRow icon={<Hash size={14} />}       label="เลขอ้างอิง"    value={<span className="font-mono font-bold tracking-widest">{req.id?.slice(0, 8)?.toUpperCase() ?? '—'}</span>} />
            <InfoRow icon={<Calendar size={14} />}  label="วันที่ยื่น"     value={dateTH(req.created_at)} />
            {req.due_date && (
              <InfoRow icon={<Clock size={14} />} label="กำหนดเสร็จ" value={
                <span className={isOverdue(req) ? 'font-bold text-red-600' : ''}>
                  {thaiDateFromDateInput(String(req.due_date).slice(0, 10))}
                  {isOverdue(req) && ' — เกินกำหนดแล้ว'}
                </span>
              } />
            )}
          </div>

          {/* ผู้รับผิดชอบ — แสดงให้ทุกบทบาทเห็น แต่เปลี่ยนตัวได้เฉพาะแอดมิน/หัวหน้ากอง
              (trigger protect_document_request_scope ฝั่ง DB บังคับอีกชั้น) */}
          <div className="rounded-2xl border border-gray-200 overflow-hidden">
            <div className="px-4 py-2.5 bg-gray-50 flex items-center gap-2">
              <User size={14} className="text-gray-500 shrink-0" />
              <p className="text-xs font-bold text-gray-700">ผู้รับผิดชอบ</p>
            </div>
            <div className="px-4 py-3 bg-white space-y-2">
              {canAssign ? (
                <>
                  <select
                    value={req.assigned_to ?? ''}
                    disabled={assigning}
                    onChange={e => onAssign?.(req.id, e.target.value)}
                    className={inputCls + ' disabled:opacity-50'}>
                    <option value="">— ยังไม่มอบหมาย —</option>
                    {groupStaffByDepartment(assignees).map(group => (
                      <optgroup key={group.department_name} label={group.department_name}>
                        {group.members.map(p => (
                          <option key={p.id} value={p.id}>
                            {p.full_name || p.email}{p.is_dept_head ? ' (หัวหน้ากอง)' : ''}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  {/* คนที่ถูกมอบหมายไว้เดิมอาจไม่อยู่ในลิสต์แล้ว (ย้ายกอง/ถูกลดบทบาท/ปิดบัญชี)
                      ต้องบอกให้เห็น ไม่ใช่ปล่อยให้ select เด้งกลับเป็น "ยังไม่มอบหมาย" เงียบๆ
                      จนเข้าใจว่างานไม่มีเจ้าของทั้งที่ในฐานข้อมูลยังผูกอยู่กับคนเดิม */}
                  {req.assigned_to && !assignees.some(p => p.id === req.assigned_to) && (
                    <p className="text-[11px] font-semibold leading-relaxed text-amber-700">
                      ⚠️ ผู้รับผิดชอบเดิมไม่อยู่ในรายชื่อที่มอบหมายได้แล้ว (ย้ายกองหรือปิดบัญชี) กรุณาเลือกคนใหม่
                    </p>
                  )}
                  {assigning && <p className="text-[11px] text-gray-400">กำลังบันทึก...</p>}
                </>
              ) : (
                <p className={`text-sm ${req.assigned_to ? 'font-semibold text-gray-800' : 'font-semibold text-amber-600'}`}>
                  {req.assigned_to ? (assigneeName ?? '—') : 'ยังไม่มอบหมาย — รอหัวหน้ากองมอบหมาย'}
                </p>
              )}
            </div>
          </div>

          {isFeeInquiry && isActive && (
            <div className="rounded-2xl border border-blue-200 overflow-hidden">
              <div className="px-4 py-2.5 bg-blue-50 flex items-center gap-2">
                <Banknote size={14} className="text-blue-600 shrink-0" />
                <p className="text-xs font-bold text-blue-800">แจ้งผลยอดที่ตรวจสอบ</p>
              </div>
              <div className="px-4 py-3 bg-white space-y-3">
                <p className="text-xs text-gray-500 leading-relaxed">
                  ตรวจสอบยอดจากระบบงานของเทศบาลแล้วระบุที่นี่ ประชาชนจะเห็นเฉพาะยอดและคำแนะนำให้ชำระที่สำนักงานเทศบาล
                </p>
                <div className="flex gap-2">
                  <div className="flex-1 relative">
                    <input
                      type="number" min={1} max={999999}
                      value={feeInput}
                      onChange={e => setFeeInput(e.target.value)}
                      placeholder="ระบุยอดที่ตรวจสอบได้"
                      className={inputCls + ' pr-10'}
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">บาท</span>
                  </div>
                  <button
                    onClick={handleSetFee}
                    disabled={settingFee || !feeInput || parseInt(feeInput) <= 0}
                    className="px-4 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 active:scale-95 transition-all flex items-center gap-1.5 shrink-0"
                    style={{ backgroundColor: '#2563eb' }}>
                    {settingFee ? <Loader2 size={14} className="animate-spin" /> : <Banknote size={14} />}
                    แจ้งยอด
                  </button>
                </div>
              </div>
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
        {req.document_type === 'waste_collection_request' && req.permit_form_data && (
          <div className="px-4 pb-2 pt-3 border-t border-gray-100 shrink-0">
            <button onClick={() => {
              const html = buildWasteCollectionRequestHtml({
                form: req.permit_form_data,
                tenant,
                thDate: thaiDate(req.created_at),
                referenceNo: req.id?.slice(0, 8)?.toUpperCase() ?? '',
              })
              const w = window.open('', '_blank', 'width=860,height=1100')
              if (!w) return
              w.document.write(html)
              w.document.close()
              setTimeout(() => { w.focus(); w.print() }, 400)
            }}
              className="w-full py-3.5 rounded-2xl font-semibold text-white flex items-center justify-center gap-2 text-sm active:scale-[0.98] transition-all"
              style={{ backgroundColor: '#0e7490' }}>
              <Printer size={16} /> พิมพ์ใบแจ้งขออนุญาตเก็บขนขยะ
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
            {req.status === 'processing' && (
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

function NewRequestSheet({ tenant, staffId, onClose, onCreated, onSelectBuildingPermit, onSelectWasteCollection }) {
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
            <label className="text-xs font-semibold text-gray-500 mb-2 block">ประเภทบริการ/เอกสาร</label>
            <div className="grid grid-cols-2 gap-2">
              {getAllDocTypes().map(d => {
                const [emoji, ...rest] = d.label.split(' ')
                const isSel = form.document_type === d.value
                return (
                  <button key={d.value} type="button"
                    onClick={() => {
                      if (d.value === 'building_permit') onSelectBuildingPermit()
                      else if (d.value === 'waste_collection_request') onSelectWasteCollection()
                      else setForm(p => ({ ...p, document_type: d.value }))
                    }}
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
  const [showWasteWizard, setShowWasteWizard] = useState(false)
  const [search, setSearch]       = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const [assignees, setAssignees] = useState([])
  const [assigning, setAssigning] = useState(false)

  // เปลี่ยนตัวผู้รับผิดชอบได้เฉพาะแอดมินกับหัวหน้ากอง — ตรงกับ trigger
  // protect_document_request_scope ฝั่ง DB ไม่ใช่ซ่อนปุ่มเฉยๆ (กดได้ก็ error กลับมาอยู่ดี)
  const canAssign = ['admin', 'superadmin', 'officer'].includes(currentUserRole)

  useEffect(() => {
    if (!tenant?.id || !canAssign) return
    let cancelled = false
    fetchAssignableStaff(tenant.id).then(people => {
      if (!cancelled) setAssignees(people)
    })
    return () => { cancelled = true }
  }, [tenant?.id, canAssign])

  // ชื่อผู้รับผิดชอบสำหรับตาราง — คนที่ถูกมอบหมายไว้แล้วอาจไม่อยู่ใน assignees (ย้ายกอง/
  // ถูกลดบทบาท) จึงต้องเผื่อกรณีหาไม่เจอ ไม่ใช่แสดงว่างเปล่าจนดูเหมือนยังไม่มอบหมาย
  const assigneeNameOf = useCallback(id => {
    if (!id) return null
    const person = assignees.find(p => p.id === id)
    return person ? (person.full_name || person.email || 'ไม่ทราบชื่อ') : 'ผู้ใช้ที่ถูกย้าย/ปิดบัญชี'
  }, [assignees])

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
    const ch = supabase.channel(`inbox-${tenant.id}-${crypto.randomUUID()}`)
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
      const completedRequest = { ...req, staff_notes: staffNote || req.staff_notes }
      const html = buildDocHTML({ req: completedRequest, tenant, docDate })
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
      const { url, error: upErr } = await uploadFile('document-certs', blob, {
        subject: id,
        filename: `${id}.html`,
        municipality: tenant?.slug,
      })
      if (!upErr) {
        document_url = url
      }
    }

    // "รับเรื่อง" = รับงานเข้าตัวเองได้ก็ต่อเมื่อยังไม่มีเจ้าของเท่านั้น
    //
    // ของเดิมยัด assigned_to: staffId ลงไปทุกครั้งที่กดเปลี่ยนสถานะ ผลคือใครกดคนสุดท้าย
    // กลายเป็นเจ้าของงานแทนคนเดิมเงียบๆ และถ้าคนเดิมเป็น role 'staff' เขาจะมองไม่เห็นคำขอนั้น
    // อีกเลยทันที (policy "read document_requests" ให้ staff เห็นเฉพาะ assigned_to = ตัวเอง)
    // ตอนนี้ trigger protect_document_request_scope ปฏิเสธการเปลี่ยนตัวโดยคนที่ไม่ใช่
    // แอดมิน/หัวหน้ากองอยู่แล้ว ถ้ายังส่งค่าไปทุกครั้ง update จะ error ทั้งก้อน
    const claimAssignee = req && !req.assigned_to && staffId ? { assigned_to: staffId } : {}

    const { error: updateError } = await supabase.from('document_requests').update({
      status:        newStatus,
      staff_notes:   staffNote   || null,
      reject_reason: rejectReason || null,
      updated_at:    new Date().toISOString(),
      ...claimAssignee,
      ...(document_url ? { document_url, issued_at: new Date().toISOString() } : {}),
    }).eq('id', id)

    if (updateError) {
      setActing(false)
      alert('บันทึกไม่สำเร็จ: ' + updateError.message)
      return
    }

    setRequests(prev => prev.map(r =>
      r.id === id ? { ...r, status: newStatus, staff_notes: staffNote || null, document_url, ...claimAssignee } : r
    ))
    notifyTelegram('document_request_status_updated', id)
    setActing(false)
    setSelected(null)
  }

  // มอบหมาย/เปลี่ยนตัวผู้รับผิดชอบรายคำขอ — ปลายทางเดียวกับที่ trigger ตั้งให้อัตโนมัติตอน
  // คำขอเข้า ใช้ตอนคนลา งานล้น หรือประเภทที่ยังไม่ได้ตั้งผู้รับผิดชอบเริ่มต้นไว้
  //
  // ⚠️ ถ้ามอบหมายให้คนที่เป็น role 'staff' คนที่เคยเห็นคำขอนี้อาจมองไม่เห็นอีก (policy ให้
  // staff เห็นเฉพาะงานตัวเอง) หัวหน้ากองยังเห็นทั้งกองเสมอ จึงไม่มีเคสงานหายไปทั้งระบบ
  async function handleAssign(id, assigneeId) {
    setAssigning(true)
    const { error } = await supabase.from('document_requests')
      .update({ assigned_to: assigneeId || null, updated_at: new Date().toISOString() })
      .eq('id', id)
    setAssigning(false)
    if (error) { alert('มอบหมายไม่สำเร็จ: ' + error.message); return }
    setRequests(prev => prev.map(r => r.id === id ? { ...r, assigned_to: assigneeId || null } : r))
    setSelected(prev => prev && prev.id === id ? { ...prev, assigned_to: assigneeId || null } : prev)
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
          <h2 className="text-lg font-bold text-gray-800">คำขอบริการ/เอกสาร</h2>
          <p className="text-xs text-gray-400 mt-0.5">คำขอบริการและเอกสารจากประชาชน</p>
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
          placeholder="ค้นหาชื่อ หรือประเภทบริการ/เอกสาร..."
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
                  {/* ตัดคอลัมน์ "วัตถุประสงค์" กับ "โทรศัพท์" ออกแล้ว
                      - วัตถุประสงค์: purpose ของคำขอส่วนใหญ่ขึ้นต้นด้วยข้อความเดียวกับคอลัมน์
                        ประเภทบริการ พอโดน truncate ที่ 180px จึงเหลือแต่ส่วนที่ซ้ำ ส่วนที่ต่างจริง
                        (ประเภทสถานที่ วันเริ่มบริการ) ถูกตัดหายหมด
                      - โทรศัพท์: เป็นข้อมูลส่วนบุคคลที่ไม่จำเป็นต้องกางบนหน้าจอรายการซึ่งมัก
                        เปิดค้างไว้/ฉายให้คนอื่นเห็น ลดการเปิดเผยเกินจำเป็นตาม PDPA
                      ทั้งสองค่ายังดูได้ครบในแผ่นรายละเอียดเมื่อกดเข้าไปในคำขอนั้น */}
                  <th className="px-4 py-2.5 text-left text-[11px] font-bold text-white border-r border-white/10 whitespace-nowrap">ชื่อ-สกุลผู้ยื่น</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-bold text-white border-r border-white/10 whitespace-nowrap">ประเภทบริการ/เอกสาร</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-bold text-white border-r border-white/10 whitespace-nowrap">วันที่ยื่น</th>
                  {/* คอลัมน์ที่เพิ่มกลับมาหลังตัด "วัตถุประสงค์"/"โทรศัพท์" ออก — จำเป็นจริง
                      เพราะเป็นคอลัมน์เดียวที่ตอบว่า "งานนี้ใครถือ" ถ้าไม่มี หัวหน้ากองต้องกด
                      เปิดทีละใบเพื่อดู และงานที่ไม่มีเจ้าของจะไม่มีใครสังเกตเห็น */}
                  <th className="px-4 py-2.5 text-left text-[11px] font-bold text-white border-r border-white/10 whitespace-nowrap">ผู้รับผิดชอบ</th>
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
                      {/* nowrap ทั้งชื่อและประเภท — เดิมคอลัมน์แคบจนชื่อคนแตกเป็น 5 บรรทัด
                          ("นาย / ยุทธ / ศักดิ์ / กาศ / เกษม") แถวสูงเกินจำเป็นทั้งตาราง
                          ถ้าจอแคบจนไม่พอ ตารางมี overflow-x-auto ครอบอยู่ ให้เลื่อนแนวนอนแทน */}
                      <td className="px-4 py-2.5 font-semibold text-gray-800 text-sm border-r border-gray-200 whitespace-nowrap">{req.requester_name}</td>
                      <td className="px-4 py-2.5 text-gray-700 text-xs border-r border-gray-200 whitespace-nowrap">{docType?.label.replace(/^\S+\s*/, '') ?? req.document_type}</td>
                      <td className="px-4 py-2.5 text-gray-500 text-xs whitespace-nowrap border-r border-gray-200">{dateTH(req.created_at)}</td>
                      <td className="px-4 py-2.5 text-xs whitespace-nowrap border-r border-gray-200">
                        {req.assigned_to
                          ? <span className="text-gray-700">{assigneeNameOf(req.assigned_to)}</span>
                          : <span className="font-semibold text-amber-600">ยังไม่มอบหมาย</span>}
                      </td>
                      <td className="px-4 py-2.5 text-center border-r border-gray-200">
                        <div className="flex flex-col items-center gap-1">
                          <StatusBadge status={req.status} />
                          {isOverdue(req) && (
                            <span className="whitespace-nowrap rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-600">
                              เกินกำหนด
                            </span>
                          )}
                        </div>
                      </td>
                      {/* stopPropagation ที่ระดับ td แบบเดียวกับตารางคำร้อง — ปุ่มในช่องนี้
                          ต้องยิง handler ของตัวเอง ไม่ใช่ปล่อยให้คลิกทะลุไปโดน onClick ของ tr
                          (ของเดิมปุ่มไม่มี onClick เลย อาศัยคลิกทะลุอย่างเดียว จึงเป็นปุ่มหลอก) */}
                      <td className="px-4 py-2.5 text-center" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() => setSelected(req)}
                            className="whitespace-nowrap text-xs font-bold px-3 py-1 rounded border border-blue-600 text-blue-700 hover:bg-blue-600 hover:text-white transition-colors">
                            {INBOX_ACTION_LABELS[req.status] ?? 'ดูรายละเอียด'}
                          </button>
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
          onInquiryUpdate={() => { setSelected(null); setRefreshKey(k => k + 1) }}
          currentUserRole={currentUserRole} onDelete={handleDelete}
          canAssign={canAssign} assignees={assignees} assigning={assigning}
          assigneeName={assigneeNameOf(selected.assigned_to)} onAssign={handleAssign} />
      )}
      {showAdd && (
        <NewRequestSheet tenant={tenant} staffId={staffId}
          onClose={() => setShowAdd(false)}
          onCreated={r => setRequests(prev => [r, ...prev])}
          onSelectBuildingPermit={() => { setShowAdd(false); setShowPermitWizard(true) }}
          onSelectWasteCollection={() => { setShowAdd(false); setShowWasteWizard(true) }} />
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
      {/* คำขอเก็บขนขยะต้องใช้ฟิลด์ตามใบแจ้งจริง จึงไม่สร้างผ่านฟอร์ม walk-in แบบย่อ */}
      {showWasteWizard && (
        <div className="fixed inset-0 z-[60] bg-white overflow-y-auto">
          <WasteCollectionRequestWizard tenant={tenant} session={null} staffId={staffId}
            onBack={() => setShowWasteWizard(false)}
            onDone={() => { setShowWasteWizard(false); setRefreshKey(k => k + 1) }} />
        </div>
      )}
    </div>
  )
}

// ─── Document Templates ───────────────────────────────────────────────────────

const DOC_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Sarabun:ital,wght@0,400;0,600;0,700;1,400&display=swap');
  ${govPageCss()}
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { ${govDocFontCss()} color: #000; }
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
  tax_notice:       'ผลการตรวจสอบยอดภาษีที่ดินและสิ่งปลูกสร้าง',
  waste_collection: 'ผลการตรวจสอบค่าธรรมเนียมขยะ',
  waste_collection_request: 'แจ้งผลการขอรับบริการเก็บขนขยะมูลฝอย',
  other:            'หนังสือรับรอง',
}

// req.* เป็นข้อมูลที่ประชาชนกรอกเองตอนยื่นคำขอเอกสาร (CitizenDocRequest.jsx) — ต้อง escape
// ก่อนแปะใน HTML เสมอ เพราะไฟล์นี้ถูกเปิดตรงใน window.open และอัปโหลดเป็นไฟล์ .html
// ใน bucket document-certs แม้เป็น private ก็ต้อง escape กัน stored XSS/HTML injection
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
      return `<p>ตามที่ ${name}${idCard} ที่อยู่ ${addr} ขอสอบถามข้อมูลภาษีที่ดินและสิ่งปลูกสร้าง</p>
              <p class="no-indent" style="margin-left:3em; margin-top:6pt">
                ยอดที่ตรวจสอบได้: <strong>${req.fee_amount ? req.fee_amount.toLocaleString() + ' บาท' : 'ยังไม่ระบุยอด'}</strong><br/>
                วันที่ตรวจสอบ: ${thaiDate(new Date().toISOString().slice(0, 10))}
              </p>
              <p>กรุณาติดต่อชำระที่สำนักงานเทศบาล เอกสารนี้ไม่ใช่ใบเสร็จรับเงินหรือหลักฐานการชำระเงิน</p>
              ${req.staff_notes ? `<p>หมายเหตุ: ${escapeHtml(req.staff_notes)}</p>` : ''}`
    case 'waste_collection':
      return `<p>ตามที่ ${name}${idCard} ที่อยู่ ${addr} ขอสอบถามข้อมูลค่าธรรมเนียมขยะ</p>
              <p class="no-indent" style="margin-left:3em; margin-top:6pt">
                ยอดที่ตรวจสอบได้: <strong>${req.fee_amount ? req.fee_amount.toLocaleString() + ' บาท' : 'ยังไม่ระบุยอด'}</strong><br/>
                วันที่ตรวจสอบ: ${thaiDate(new Date().toISOString().slice(0, 10))}
              </p>
              <p>กรุณาติดต่อชำระที่สำนักงานเทศบาล เอกสารนี้ไม่ใช่ใบเสร็จรับเงินหรือหลักฐานการชำระเงิน</p>
              ${req.staff_notes ? `<p>หมายเหตุ: ${escapeHtml(req.staff_notes)}</p>` : ''}`
    case 'waste_collection_request': {
      // ไม่ใช่หนังสือรับรอง แต่เป็นหนังสือแจ้งผลว่ารับคำขอเข้าเส้นทางเก็บขนแล้ว —
      // ห้ามอัปโหลด "ใบคำขอที่ประชาชนกรอกเอง" มาเป็นเอกสารผลลัพธ์ เพราะประชาชนจะได้
      // ใบเดิมที่ตัวเองยื่นกลับไป ไม่ใช่คำตอบจาก อปท.
      const form = req.permit_form_data ?? {}
      const startDate = thaiDateFromDateInput(form.service_start_date)
      const placeType = form.place_type ? escapeHtml(form.place_type) : '-'
      const binCount = form.bin_count ? `${escapeHtml(String(form.bin_count))} ใบ` : '-'
      const point = collectionPointText(form.collection_point)
      return `<p>ตามที่ ${name}${idCard} ที่อยู่ ${addr} ได้ยื่นคำขอรับบริการเก็บขนขยะมูลฝอยจาก${orgName} นั้น</p>
              <p class="no-indent" style="margin-left:3em; margin-top:6pt">
                ประเภทสถานที่: <strong>${placeType}</strong><br/>
                จำนวนถังรองรับขยะ: <strong>${binCount}</strong><br/>
                ${point ? `จุดวางถัง (พิกัด): <strong>${escapeHtml(point)}</strong><br/>` : ''}
                เริ่มให้บริการเก็บขนตั้งแต่วันที่: <strong>${startDate || '-'}</strong>
              </p>
              <p>${orgName}ได้รับคำขอไว้และบรรจุสถานที่ดังกล่าวเข้าเส้นทางเก็บขนขยะมูลฝอยเรียบร้อยแล้ว ทั้งนี้ ผู้ขอรับบริการมีหน้าที่ชำระค่าธรรมเนียมเก็บขนขยะมูลฝอยตามอัตราที่กำหนดไว้ในข้อบัญญัติท้องถิ่น</p>
              ${req.staff_notes ? `<p>หมายเหตุ: ${escapeHtml(req.staff_notes)}</p>` : ''}`
    }
    default:
      return `<p>${escapeHtml(req.purpose) || 'ตามที่ได้รับการร้องขอ'}</p>
              ${req.staff_notes ? `<p>รายละเอียดเพิ่มเติม: ${escapeHtml(req.staff_notes)}</p>` : ''}`
  }
}

function buildDocHTML({ req, tenant, docDate }) {
  const orgName  = escapeHtml(tenant?.name ?? 'หน่วยงาน')
  const title    = DOC_TITLES[req.document_type] ?? DOC_TITLES.other
  const isFeeInquiry = FEE_INQUIRY_TYPES.includes(req.document_type)
  // หนังสือ "แจ้งผล" ไม่ใช่หนังสือรับรอง จึงห้ามลงท้ายว่าออกให้เพื่อเป็นหลักฐาน
  const isNotice = isFeeInquiry || req.document_type === 'waste_collection_request'
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
<p class="closing">${isFeeInquiry
  ? 'ข้อมูลนี้ใช้แจ้งผลการตรวจสอบเบื้องต้น ไม่ใช่ใบเสร็จรับเงินหรือหลักฐานการชำระเงิน'
  : req.document_type === 'waste_collection_request'
    ? 'จึงเรียนมาเพื่อทราบ และขอให้ติดต่อชำระค่าธรรมเนียมที่สำนักงานตามกำหนด'
    : 'จึงออกหนังสือรับรองฉบับนี้ให้เพื่อเป็นหลักฐาน'}</p>
<div class="signature">
  <div class="sig-line"></div>
  <p>(...............................................)</p>
  <p>${isNotice ? 'เจ้าหน้าที่ผู้ตรวจสอบข้อมูล' : 'ผู้มีอำนาจลงนาม'}</p>
  <p>${orgName}</p>
</div>
<div class="footer-note">
  ${escapeHtml(govEServiceOriginText(tenant))}<br>
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
// fallback ก่อน complaint_categories ของเทศบาลจะโหลดเสร็จ (หรือถ้าโหลดพลาด) — ครอบคลุม
// ค่าเดียวกับ DEFAULT_CATEGORIES ใน ComplaintCategory.jsx (ฟอร์มแจ้งเรื่องฝั่งประชาชน) กัน
// หมวดที่ไม่ได้ override ในตาราง (เช่น grievance) โผล่เป็นค่าดิบภาษาอังกฤษในแดชบอร์ดเจ้าหน้าที่
let C_CAT = {
  road: 'ถนน/ทางสาธารณะ', light: 'ไฟฟ้าส่องสว่าง', trash: 'ขยะ/ความสะอาด',
  water: 'น้ำประปา', flood: 'น้ำท่วม/ระบายน้ำ', tree: 'ต้นไม้/สวนสาธารณะ',
  noise: 'เหตุรำคาญ', other: 'อื่นๆ',
  drain: 'ท่อระบายน้ำ', manhole: 'ฝาท่อระบายน้ำ', waste_water: 'น้ำเสีย',
  suction: 'ดูดสิ่งปฏิกูล', canal: 'ลอกคลอง', building: 'ตรวจสอบอาคาร',
  mosquito: 'พ่นยุง', disease: 'ควบคุมโรคติดต่อ', pollution: 'กลิ่น/ควัน/มลพิษ',
  grievance: 'แจ้งเรื่องร้องทุกข์ร้องเรียน', corruption: 'แจ้งการทุจริต',
  tax: 'ภาษีและค่าธรรมเนียม', water_supply: 'สนับสนุนน้ำอุปโภค',
  animals: 'สุนัขจรจัด', phone_complaint: 'ร้องเรียนเสียง',
}
let C_CAT_META = {
  road:  { emoji: '🛣️', color: '#f1f5f9', textColor: '#475569' },
  light: { emoji: '💡', color: '#fef3c7', textColor: '#d97706' },
  trash: { emoji: '🗑️', color: '#dcfce7', textColor: '#16a34a' },
  water: { emoji: '🚰', color: '#dbeafe', textColor: '#2563eb' },
  flood: { emoji: '🌊', color: '#cffafe', textColor: '#0891b2' },
  tree:  { emoji: '🌳', color: '#d1fae5', textColor: '#059669' },
  noise: { emoji: '📢', color: '#f3e8ff', textColor: '#9333ea' },
  other: { emoji: '📝', color: '#f3f4f6', textColor: '#6b7280' },
  drain: { emoji: '🚰', color: '#dbeafe', textColor: '#2563eb' },
  manhole: { emoji: '🕳️', color: '#f1f5f9', textColor: '#475569' },
  waste_water: { emoji: '🚱', color: '#cffafe', textColor: '#0891b2' },
  suction: { emoji: '🚛', color: '#f1f5f9', textColor: '#475569' },
  canal: { emoji: '🌊', color: '#cffafe', textColor: '#0891b2' },
  building: { emoji: '🏗️', color: '#fef3c7', textColor: '#d97706' },
  mosquito: { emoji: '🦟', color: '#dcfce7', textColor: '#16a34a' },
  disease: { emoji: '🏥', color: '#fee2e2', textColor: '#dc2626' },
  pollution: { emoji: '🏭', color: '#f3f4f6', textColor: '#6b7280' },
  grievance: { emoji: '📣', color: '#fee2e2', textColor: '#dc2626' },
  corruption: { emoji: '⚖️', color: '#fee2e2', textColor: '#dc2626' },
  tax: { emoji: '💰', color: '#fef3c7', textColor: '#d97706' },
  water_supply: { emoji: '🚰', color: '#dbeafe', textColor: '#2563eb' },
  animals: { emoji: '🐕', color: '#f3e8ff', textColor: '#9333ea' },
  phone_complaint: { emoji: '📞', color: '#f3e8ff', textColor: '#9333ea' },
}

function StaffComplaintCategoryIcon({ category, size = 'md' }) {
  const meta = C_CAT_META[category] ?? C_CAT_META.other
  const icon = meta.emoji || '📝'
  const imageIcon = icon.startsWith('http://') || icon.startsWith('https://')
    || icon.startsWith('/') || icon.startsWith('data:image/')
  const boxSize = size === 'lg' ? 'w-12 h-12 rounded-2xl text-2xl' : 'w-10 h-10 rounded-xl text-xl'
  return (
    <span className={`${boxSize} shrink-0 inline-flex items-center justify-center shadow-sm`}
      style={{ backgroundColor: meta.color, color: meta.textColor }}>
      {imageIcon
        ? <img src={icon} alt="" className="w-7 h-7 object-contain" />
        : <span className="leading-none">{icon}</span>}
    </span>
  )
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

function ComplaintsStaffModule({ tenant, staffId, currentUserRole }) {
  const tenantId = tenant?.id
  const [complaints, setComplaints] = useState([])
  const [loading, setLoading]       = useState(true)
  // role 'officer' = หัวหน้ากอง เห็นคำร้องทั้งกอง ไม่ใช่แค่ที่มอบหมายให้ตัวเอง
  //
  // ไม่ได้เปิดสิทธิ์ใหม่ — RPC list_complaints_for_staff กับ RLS ให้ officer เห็นคำร้อง
  // หมวดปกติในกองตัวเองอยู่แล้ว (complaint_matches_my_department) แถวพวกนี้ถูกดึงมาถึง
  // client แล้วแต่ถูกกรองทิ้งเฉยๆ ตรงนี้แค่เลิกกรองทิ้ง เบอร์โทร/ชื่อผู้แจ้งยังถูก mask
  // ตาม role เหมือนเดิมเพราะ mask ทำใน RPC ไม่ใช่ที่นี่
  //
  // ไม่เช็ค is_dept_head — ตำแหน่งมาตรฐานทุกตัวที่ map ไป officer เป็น category
  // 'dept_head' ทั้งหมด (positions_personnel.sql) role นี้จึงแปลว่าหัวหน้ากองอยู่แล้ว
  // และ RLS เองก็ไม่เคยดู is_dept_head ถ้าเช็คเพิ่มตรงนี้จะกลายเป็นกับดัก: แอดมินตั้ง role
  // เป็นหัวหน้ากองแล้วลืมติ๊ก checkbox คนนั้นจะเห็นแค่งานตัวเองทั้งที่ป้ายบอกว่าเป็นหัวหน้ากอง
  // (is_dept_head ยังใช้อยู่ในโมดูลปฏิทินกิจกรรมและใช้จัดลำดับในลิสต์มอบหมายงาน)
  const seesWholeDepartment = currentUserRole === 'officer'

  // ดึงชื่อ ไอคอน และสีจากประเภทคำร้องที่ Admin กำหนด ใช้เป็นแหล่งเดียวกันทั้งระบบ
  const [, setCatVer] = useState(0)
  useEffect(() => {
    if (!tenant?.id) return
    supabase.from('complaint_categories').select('value, label, emoji, color, text_color').eq('municipality_id', tenant.id)
      .then(({ data }) => {
        if (data && data.length > 0) {
          for (const c of data) {
            C_CAT[c.value] = c.label
            C_CAT_META[c.value] = {
              emoji: c.emoji || C_CAT_META[c.value]?.emoji || '📝',
              color: c.color || C_CAT_META[c.value]?.color || '#f3f4f6',
              textColor: c.text_color || C_CAT_META[c.value]?.textColor || '#6b7280',
            }
          }
          setCatVer(v => v + 1)
        }
      })
  }, [tenant?.id])
  const [search, setSearch]         = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [updating, setUpdating]     = useState(null)
  const [selected, setSelected]     = useState(null)
  const [openingComplaintId, setOpeningComplaintId] = useState(null)
  const [assigneeNames, setAssigneeNames] = useState({})

  const loadAssignedComplaints = useCallback(async () => {
    if (!tenantId || !staffId) return
    const { data, error } = await fetchRoleScopedComplaints(tenantId)
    if (error) console.error('fetch assigned complaints error:', error.message)
    // ยังกรอง pending ออกทั้งสองกรณี — pending คือคำร้องที่แอดมินยังไม่กดรับเรื่อง
    // การเปิดให้เห็นเท่ากับรื้อขั้นตอนคัดกรองของแอดมิน (migration 080) ซึ่งเป็นคนละเรื่อง
    // กับการขยายขอบเขตจาก "งานตัวเอง" เป็น "งานทั้งกอง"
    setComplaints((data ?? []).filter((c) =>
      (seesWholeDepartment || c.assigned_to === staffId) && c.status !== 'pending'
    ))
    setLoading(false)
  }, [tenantId, staffId, seesWholeDepartment])

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
    const ch = supabase.channel(`complaints-staff-${tenant.id}-${crypto.randomUUID()}`)
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
      // DELETE (แอดมินลบคำร้องทิ้ง) — payload มีแค่ primary key เช็ค municipality_id/assigned_to
      // แบบ INSERT/UPDATE ไม่ได้ จึงกรองด้วย "id นี้อยู่ในรายการที่โหลดมาหรือเปล่า" แทน
      // ตัดออกจาก state ตรงๆ ไม่ refetch เพราะรู้อยู่แล้วว่าแถวนั้นหายไปแถวเดียว
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'complaints' },
        ({ old }) => {
          const deletedId = old?.id
          if (!deletedId) return
          setComplaints((prev) => prev.some((c) => c.id === deletedId)
            ? prev.filter((c) => c.id !== deletedId)
            : prev)
        })
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [tenant?.id, staffId, loadAssignedComplaints])

  async function fetchAll() {
    setLoading(true)
    await loadAssignedComplaints()
  }

  async function advanceStatus(id, next, workPhotos = null, techNote = null) {
    // Defense in depth: shared detail modal ถูกใช้ทั้ง Admin และหน้าผู้รับผิดชอบ
    // เจ้าหน้าที่ต้องจบงานที่ `done`; `closed`/legacy `completed` เป็นการตรวจรับของ Admin
    if (['closed', 'completed'].includes(next) && !['admin', 'superadmin'].includes(currentUserRole)) {
      console.error('final complaint closure requires admin or superadmin')
      return
    }
    setUpdating(id)
    const payload = { status: next, updated_at: new Date().toISOString() }
    if (workPhotos?.length > 0) payload.work_photos = workPhotos
    // เหมือน updateStatus() ใน ComplaintsManager.jsx: technician_note เก็บรายงานหน้างานของช่าง
    // เท่านั้น ห้ามให้หมายเหตุของสถานะอื่นมาทับ ไม่งั้นบันทึกการปฏิบัติงานหายถาวร
    if (techNote !== null && ['done', 'completed'].includes(next)) payload.technician_note = techNote
    const { error } = await supabase.from('complaints').update(payload).eq('id', id)
    if (!error) {
      setComplaints(prev => prev.map(c => c.id === id ? { ...c, ...payload } : c))
      notifyTelegram('complaint_status_updated', id)
      setSelected(null)
    }
    setUpdating(null)
  }

  const filtered = complaints.filter(c => {
    if (filterStatus !== 'all' && c.status !== filterStatus) return false
    if (search.trim()) {
      const q = search.toLowerCase()
      return [
        c.description,
        c.detail,
        C_CAT[c.category],
        c.profiles?.full_name,
        c.ref_no,
        c.complaint_number,
        c.location_name,
        c.village,
      ].some(value => String(value ?? '').toLowerCase().includes(q))
    }
    return true
  })

  // ชื่อผู้รับผิดชอบ — ดึงเฉพาะมุมมองหัวหน้ากอง มุมมองส่วนตัวผู้รับผิดชอบคือตัวเองทุกใบ
  // ไม่ต้องยิง query เพิ่มให้เปลืองเปล่า
  useEffect(() => {
    if (!tenantId || !seesWholeDepartment) return
    fetchAssignableStaff(tenantId).then((people) => {
      setAssigneeNames(Object.fromEntries(
        (people ?? []).map((p) => [p.id, p.full_name || p.email || '—'])
      ))
    })
  }, [tenantId, seesWholeDepartment])

  const filterItems = ['all', 'received', 'in_progress', 'done', 'completed', 'closed', 'rejected']
    .filter(status => status === 'all' || complaints.some(c => c.status === status))
  const statusCount = status => status === 'all'
    ? complaints.length
    : complaints.filter(c => c.status === status).length

  return (
    <div className="space-y-4 md:space-y-5">
      <OdorAcknowledgePanel tenantId={tenantId} staffId={staffId} />

      <section className="relative overflow-hidden rounded-3xl px-5 py-5 text-white shadow-lg shadow-blue-900/10 md:rounded-2xl md:px-6"
        style={{ background: 'linear-gradient(135deg, var(--color-primary-dark) 0%, var(--color-primary) 58%, #38bdf8 140%)' }}>
        <div className="absolute -right-8 -top-12 h-36 w-36 rounded-full bg-white/10" />
        <div className="absolute -bottom-12 right-20 h-28 w-28 rounded-full bg-cyan-300/10" />
        <div className="relative flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-[10px] font-bold tracking-wide text-white/90">
              <MessageSquareWarning size={12} /> งานบริการประชาชน
            </div>
            <h2 className="text-xl font-extrabold tracking-tight">
              {seesWholeDepartment ? 'งานคำร้องของกอง' : 'งานคำร้องของฉัน'}
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-white/75">
              {seesWholeDepartment
                ? 'ในฐานะหัวหน้ากอง เห็นคำร้องที่แอดมินรับเรื่องแล้วทั้งกอง ไม่เฉพาะที่มอบหมายให้ตัวเอง'
                : 'ติดตามและบันทึกผลเฉพาะงานที่ได้รับมอบหมาย'}
            </p>
          </div>
          <button onClick={fetchAll} disabled={loading}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/20 bg-white/15 text-white shadow-sm backdrop-blur transition hover:bg-white/25 active:scale-95 disabled:opacity-60"
            aria-label="รีเฟรชรายการคำร้อง">
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
        <div className="relative mt-4 flex items-center gap-2 text-xs text-white/80">
          <span className="rounded-xl bg-white px-3 py-1.5 font-extrabold text-blue-700 shadow-sm">{complaints.length}</span>
          <span>งานที่อยู่ในความรับผิดชอบ</span>
        </div>
      </section>

      <div className="-mx-4 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:px-0 [&::-webkit-scrollbar]:hidden">
        <div className="flex w-max gap-2">
        {filterItems.map(s => (
          <button key={s} onClick={() => setFilterStatus(s)}
            className={`inline-flex min-h-10 items-center gap-1.5 rounded-2xl border px-3.5 py-2 text-xs font-bold shadow-sm transition-all active:scale-95 ${filterStatus === s ? 'text-white border-transparent shadow-md' : 'bg-white text-slate-600 border-slate-200'}`}
            style={filterStatus === s ? { backgroundColor: C_STATUS[s]?.color ?? 'var(--color-primary)' } : undefined}>
            {s === 'all' ? 'ทั้งหมด' : C_STATUS[s]?.label ?? s}
            <span className={`min-w-5 rounded-full px-1.5 py-0.5 text-center text-[10px] ${filterStatus === s ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'}`}>
              {statusCount(s)}
            </span>
          </button>
        ))}
        </div>
      </div>

      <div className="relative rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 transition focus-within:ring-2 focus-within:ring-blue-300">
        <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="ค้นหาเลขที่ เรื่อง สถานที่ หรือผู้แจ้ง"
          className="min-h-12 w-full rounded-2xl bg-transparent py-3 pl-11 pr-11 text-sm text-slate-900 outline-none placeholder:text-slate-400" />
        {search && <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-slate-100 text-slate-500 active:scale-95" aria-label="ล้างคำค้น"><X size={15} /></button>}
      </div>

      {loading ? (
        <div className="flex min-h-52 flex-col items-center justify-center rounded-3xl bg-white text-slate-400 shadow-sm ring-1 ring-slate-100">
          <Loader2 size={28} className="animate-spin text-blue-500" />
          <p className="mt-3 text-xs font-medium">กำลังโหลดงานคำร้อง...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-3xl bg-white px-6 py-12 text-center shadow-sm ring-1 ring-slate-100">
          <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-emerald-50 text-emerald-500"><Inbox size={30} /></span>
          <p className="mt-4 text-sm font-bold text-slate-700">{search || filterStatus !== 'all' ? 'ไม่พบคำร้องที่ตรงเงื่อนไข' : 'ยังไม่มีงานคำร้อง'}</p>
          <p className="mt-1 text-xs text-slate-400">{search || filterStatus !== 'all' ? 'ลองเปลี่ยนสถานะหรือคำค้นหา' : 'งานใหม่จะแสดงเมื่อได้รับมอบหมายและรับเรื่องแล้ว'}</p>
        </div>
      ) : (
        <>
        {/* PC: ตารางแบบเดียวกับหน้าจัดการคำร้องของแอดมิน — จอกว้างอ่านทีละใบจากการ์ดไม่ไหว
            โดยเฉพาะมุมมองหัวหน้ากองที่มีคำร้องทั้งกอง ต้องกวาดตาเทียบหลายใบพร้อมกัน */}
        <div className="hidden overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 md:block">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] table-fixed border-collapse text-sm">
              <colgroup>
                <col style={{ width: 34 }} />
                <col style={{ width: 78 }} />
                <col style={{ width: 132 }} />
                <col style={{ width: 150 }} />
                <col style={{ width: 78 }} />
                <col style={{ width: 118 }} />
                {seesWholeDepartment && <col style={{ width: 112 }} />}
                <col style={{ width: 96 }} />
                <col style={{ width: 128 }} />
              </colgroup>
              <thead>
                <tr style={{ backgroundColor: '#2c5282' }}>
                  <th className="border-r border-white/10 px-2 py-2.5 text-center text-[11px] font-bold text-white">ที่</th>
                  <th className="border-r border-white/10 px-2 py-2.5 text-left text-[11px] font-bold text-white">เลขที่</th>
                  <th className="border-r border-white/10 px-2 py-2.5 text-left text-[11px] font-bold text-white">ประเภทคำร้อง</th>
                  <th className="border-r border-white/10 px-2 py-2.5 text-left text-[11px] font-bold text-white">สถานที่</th>
                  <th className="border-r border-white/10 px-2 py-2.5 text-left text-[11px] font-bold text-white">วันที่ยื่น</th>
                  <th className="border-r border-white/10 px-2 py-2.5 text-left text-[11px] font-bold text-white">ผู้แจ้ง</th>
                  {seesWholeDepartment && (
                    <th className="border-r border-white/10 px-2 py-2.5 text-left text-[11px] font-bold text-white">ผู้รับผิดชอบ</th>
                  )}
                  <th className="border-r border-white/10 px-2 py-2.5 text-left text-[11px] font-bold text-white">สถานะ</th>
                  <th className="px-2 py-2.5 text-center text-[11px] font-bold text-white">การดำเนินการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filtered.map((c, i) => {
                  const st = C_STATUS[c.status]
                  const nx = C_NEXT[c.status]
                  const meta = C_CAT_META[c.category] ?? C_CAT_META.other
                  const ref = c.ref_no || c.complaint_number || '—'
                  const location = c.location_name || c.village
                  return (
                    <tr key={c.id} onClick={() => openAssignedComplaint(c)}
                      aria-busy={openingComplaintId === c.id}
                      className="cursor-pointer transition-colors"
                      style={{ backgroundColor: i % 2 === 0 ? '#fff' : '#f5f8fc' }}
                      onMouseEnter={e => e.currentTarget.style.backgroundColor = '#dbeafe'}
                      onMouseLeave={e => e.currentTarget.style.backgroundColor = i % 2 === 0 ? '#fff' : '#f5f8fc'}>
                      <td className="border-r border-gray-200 px-2 py-2 text-center text-[11px] text-slate-400">{i + 1}</td>
                      <td className="border-r border-gray-200 px-2 py-2 text-[11px] font-semibold text-slate-600">{ref}</td>
                      <td className="border-r border-gray-200 px-2 py-2">
                        <span className="inline-flex min-w-0 items-center gap-1.5">
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: meta.textColor }} />
                          <span className="truncate text-xs font-bold text-slate-700">{C_CAT[c.category] ?? c.category}</span>
                        </span>
                      </td>
                      <td className="border-r border-gray-200 px-2 py-2">
                        {location ? (
                          <span className="inline-flex min-w-0 items-center gap-1 text-xs text-slate-600">
                            <MapPin size={11} className="shrink-0 text-orange-500" />
                            <span className="truncate">{location}</span>
                          </span>
                        ) : <span className="text-xs text-slate-300">—</span>}
                      </td>
                      <td className="border-r border-gray-200 px-2 py-2 text-[11px] text-slate-500">
                        {new Date(c.created_at).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })}
                      </td>
                      <td className="border-r border-gray-200 px-2 py-2">
                        <span className="block truncate text-xs text-slate-600">{c.profiles?.full_name || c.reporter_name || '—'}</span>
                      </td>
                      {seesWholeDepartment && (
                        <td className="border-r border-gray-200 px-2 py-2">
                          <span className="block truncate text-xs text-slate-600">
                            {c.assigned_to ? (assigneeNames[c.assigned_to] ?? '—') : <span className="text-slate-300">ยังไม่มอบหมาย</span>}
                          </span>
                        </td>
                      )}
                      <td className="border-r border-gray-200 px-2 py-2">
                        <span className="inline-block rounded-full px-2 py-0.5 text-[10px] font-extrabold"
                          style={{ backgroundColor: st?.bg, color: st?.color }}>{st?.label ?? c.status}</span>
                      </td>
                      <td className="px-2 py-2 text-center" onClick={(e) => e.stopPropagation()}>
                        {nx ? (
                          <button onClick={() => advanceStatus(c.id, nx.next)} disabled={updating === c.id}
                            className="min-h-8 w-full rounded-lg px-2 py-1.5 text-[11px] font-extrabold text-white shadow-sm transition active:scale-[0.98] disabled:opacity-50"
                            style={{ backgroundColor: nx.next === 'done' ? '#10b981' : 'var(--color-primary)' }}>
                            {updating === c.id ? <Loader2 size={13} className="mx-auto animate-spin" /> : nx.label}
                          </button>
                        ) : (
                          <button onClick={() => openAssignedComplaint(c)}
                            className="min-h-8 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-[11px] font-semibold text-slate-500 transition hover:bg-slate-50">
                            ดูรายละเอียด
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* มือถือ: การ์ดเหมือนเดิม */}
        <div className="grid gap-3 md:hidden">
          {filtered.map(c => {
            const st = C_STATUS[c.status]
            const nx = C_NEXT[c.status]
            const meta = C_CAT_META[c.category] ?? C_CAT_META.other
            const date = new Date(c.created_at).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })
            const ref = c.ref_no || c.complaint_number || 'ไม่ระบุเลขที่'
            const location = c.location_name || c.village
            return (
              <div key={c.id} onClick={() => openAssignedComplaint(c)} aria-busy={openingComplaintId === c.id}
                className="group relative cursor-pointer overflow-hidden rounded-3xl border border-slate-100 border-l-4 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md active:scale-[0.995]"
                style={{ borderLeftColor: meta.textColor }}>
                <div className="p-4">
                  <div className="flex items-start gap-3">
                    <StaffComplaintCategoryIcon category={c.category} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-extrabold text-slate-800">{C_CAT[c.category] ?? c.category}</p>
                          <p className="mt-0.5 text-[11px] font-medium text-slate-400">{ref} · {date}</p>
                        </div>
                        <span className="shrink-0 rounded-full px-2.5 py-1 text-[10px] font-extrabold"
                          style={{ backgroundColor: st?.bg, color: st?.color }}>{st?.label}</span>
                      </div>
                      <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-slate-600">
                        {c.description || c.detail || 'ไม่มีรายละเอียดเพิ่มเติม'}
                      </p>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 text-[11px] text-slate-500">
                    {location && (
                      <span className="inline-flex min-w-0 items-center gap-1">
                        <MapPin size={12} className="shrink-0 text-orange-500" />
                        <span className="max-w-44 truncate">{location}</span>
                      </span>
                    )}
                    {c.profiles?.full_name && (
                      <span className="inline-flex min-w-0 items-center gap-1">
                        <User size={12} className="shrink-0 text-blue-500" />
                        <span className="max-w-36 truncate">{c.profiles.full_name}</span>
                      </span>
                    )}
                    {(c.attachments?.length ?? 0) > 0 && (
                      <span className="ml-auto inline-flex items-center gap-1 rounded-lg bg-blue-50 px-2 py-1 font-semibold text-blue-600">
                        <Camera size={12} /> {c.attachments.length}
                      </span>
                    )}
                  </div>

                  <div className="mt-3 flex items-center gap-2">
                    {nx ? (
                      <button onClick={(e) => { e.stopPropagation(); advanceStatus(c.id, nx.next) }} disabled={updating === c.id}
                        className="min-h-10 flex-1 rounded-xl px-4 py-2 text-xs font-extrabold text-white shadow-sm transition active:scale-[0.98] disabled:opacity-50"
                        style={{ backgroundColor: nx.next === 'done' ? '#10b981' : 'var(--color-primary)' }}>
                        {updating === c.id ? <Loader2 size={15} className="mx-auto animate-spin" /> : nx.label}
                      </button>
                    ) : (
                      <span className="flex-1 text-[11px] font-medium text-slate-400">เปิดดูรายละเอียดและหลักฐาน</span>
                    )}
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-50 text-slate-400 transition group-hover:bg-blue-50 group-hover:text-blue-600">
                      {openingComplaintId === c.id
                        ? <Loader2 size={17} className="animate-spin" />
                        : <ChevronRight size={18} />}
                    </span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
        </>
      )}

      {selected && (
        <Suspense fallback={null}>
          <ComplaintDetailModal
            key={selected.id}
            complaint={selected}
            onClose={() => setSelected(null)}
            onUpdate={advanceStatus}
            updating={updating}
            currentUserRole={currentUserRole ?? 'staff'}
            currentUserId={staffId}
            onDelete={() => {}}
          />
        </Suspense>
      )}
    </div>
  )
}

function StaffReportWrapper({ tenant }) {
  const tenantId = tenant?.id
  const [complaints, setComplaints] = useState([])
  const [technicians, setTechnicians] = useState([])
  const [loading, setLoading] = useState(true)

  const loadReportData = useCallback(async () => {
    if (!tenantId) return
    const [{ data: complaintData, error }, { data: technicianData }] = await Promise.all([
      fetchRoleScopedComplaints(tenantId),
      supabase.from('profiles').select('id, full_name, email').eq('municipality_id', tenantId).eq('role', 'technician'),
    ])
    if (error) console.error('fetch complaint report data error:', error.message)
    setComplaints(complaintData ?? [])
    setTechnicians(technicianData ?? [])
    setLoading(false)
  }, [tenantId])

  useEffect(() => {
    if (!tenantId) return
    queueMicrotask(loadReportData)
  }, [tenantId, loadReportData])

  useEffect(() => {
    if (!tenantId) return
    const channel = supabase
      .channel(`staff-report-${tenantId}-${crypto.randomUUID()}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'complaints',
        filter: `municipality_id=eq.${tenantId}`,
      }, loadReportData)
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [tenantId, loadReportData])

  if (loading) return (
    <div className="flex min-h-72 flex-col items-center justify-center rounded-3xl bg-white text-slate-400 shadow-sm">
      <Loader2 size={28} className="animate-spin text-blue-500" />
      <p className="mt-3 text-xs font-semibold">กำลังประมวลผลรายงานล่าสุด...</p>
    </div>
  )
  return <ReportManager complaints={complaints} tenant={tenant} technicians={technicians} />
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function StaffDashboard() {
  const navigate = useNavigate()
  const location = useLocation()
  const { tenant } = useTenant()
  const { unreadCount } = useNotifications()
  const [activeModule, setActiveModule] = useState(location.state?.module ?? 'home')
  const [mapOpenComplaintId] = useState(location.state?.openComplaintId ?? null)
  const [autoEditEventId, setAutoEditEventId] = useState(location.state?.editEventId ?? null)
  const [autoCreateEventSignal, setAutoCreateEventSignal] = useState(0)
  const [profile, setProfile]           = useState(null)
  const [pendingCount, setPendingCount] = useState(0)
  const [newComplaintCount, setNewComplaintCount] = useState(0)
  // null = ยังไม่รู้ ใช้กันไม่ให้ badge ของแอดมินโชว์ตัวเลขผิดระหว่างรอผลหมวดเฉพาะกิจ
  const [adhocCategories, setAdhocCategories] = useState(null)

  const allModuleKeys = MODULES.map(m => m.key)
  // คีย์ที่ตั้งเปิด-ปิดรายหน่วยงานได้ มาจากลิสต์กลางที่ ModuleManager (หน้า admin) ใช้ร่วมกัน
  // คีย์ที่ไม่อยู่ในลิสต์นั้นจะเปิดให้ทุก อปท. เสมอ เพราะไม่มี UI ให้ตั้งค่า
  // (เดิม hardcode ไว้ที่นี่คนละชุดกับหน้า admin — fleet/posts/positions/infra/manual-staff
  //  จึงเปิดค้างให้ทุก อปท. และ tourism ที่ติ๊กปิดได้ก็ไม่หายจากเมนูจริง)
  const managedKeys = MANAGED_MODULE_KEYS
  const baseEnabledKeys = tenant?.enabled_modules
    ? [...tenant.enabled_modules, ...allModuleKeys.filter(k => !managedKeys.includes(k))]
    : allModuleKeys
  // เดิม 'events' ถูกบังคับเปิดตรงนี้เสมอ ไม่ขึ้นกับ ModuleManager — ผลคือติ๊กปิด "ปฏิทินกิจกรรม"
  // ในหน้า admin แล้วเมนูไม่หาย (ปุ่มหลอก) ตอนนี้ยกออกให้ไปขึ้นกับ enabled_modules เหมือนโมดูลอื่น
  //
  // สิทธิ์พิเศษของ council ยังอยู่ แต่ต้องอยู่ "ใต้" การตั้งค่าระดับ อปท. เสมอ — ถ้าหน่วยงานปิด
  // ศูนย์ข้อมูลดิจิทัล/รายงานไว้ สมาชิกสภาก็ต้องไม่เห็น ไม่งั้นการปิดโมดูลจะไม่มีความหมายจริง
  // (เดิม push เข้า alwaysEnabled ทำให้ council ทะลุการตั้งค่าของ อปท. ไปได้)
  const role = profile?.role
  const councilExtraKeys = role === 'council'
    ? ['data-center', 'report'].filter(k => baseEnabledKeys.includes(k))
    : []
  const enabledKeys = Array.from(new Set([...baseEnabledKeys, ...councilExtraKeys]))
  // ตัดอีกชั้นสำหรับช่าง — ต้องผ่านทั้ง enabled_modules ของ อปท. และลิสต์ที่ช่างมีสิทธิ์จริง
  // (ทำเป็นชั้นแยก ไม่ไปยุ่งกับ enabledKeys เดิม เพื่อไม่ให้กระทบ role อื่น)
  // 'fleet' ไม่ได้ผูกกับ role หลัก แต่ผูกกับ profiles.fleet_role อีกคอลัมน์หนึ่ง เงื่อนไขต้องตรงกับ
  // hasAccess ใน FleetPage เป๊ะๆ (fleet_role ใดก็ได้ หรือเป็น admin/superadmin ของ อปท.)
  // ของเดิมกรองด้วย enabled_modules อย่างเดียว เจ้าหน้าที่ที่ไม่ได้ถูกตั้ง fleet_role จึงเห็นเมนู
  // "ยานพาหนะ/น้ำมัน" แล้วกดไปเจอ "ไม่มีสิทธิ์เข้าใช้ระบบ" — เมนูหลอกแบบเดียวกับ defect P1 ของ
  // Fleet ที่เพิ่งแก้ไป (ปุ่มจองรถโผล่ให้ fleet_viewer) และขัดกับ TEST_ROLE_MATRIX ที่ระบุว่า
  // demo-staff "ต้องไม่เห็นเมนูยานพาหนะ"
  const hasFleetAccess = Boolean(profile?.fleet_role) || role === 'admin' || role === 'superadmin'
  const roleScopedKeys = role === 'technician'
    ? enabledKeys.filter(k => TECHNICIAN_MODULE_KEYS.includes(k))
    : enabledKeys
  const scopedKeys = hasFleetAccess ? roleScopedKeys : roleScopedKeys.filter(k => k !== 'fleet')
  const visibleStandaloneGroups = STANDALONE_GROUPS
    .map(g => ({ ...g, items: g.items.filter(m => scopedKeys.includes(m.key)) }))
    .filter(g => g.items.length > 0)
  const visibleGroups = MODULE_GROUPS
    .map(g => ({ ...g, items: g.items.filter(m => scopedKeys.includes(m.key)) }))
    // ช่างไม่ต้องเห็นหัวข้อกองอื่นที่ยังไม่มีเมนูงาน (สำนักปลัด/กองคลัง ฯลฯ) — เป็นแค่ความรก
    .filter(g => g.items.length > 0 || (g.alwaysShow && role !== 'technician'))
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

  // (ถอด prefetch complaint_categories ระดับ root ออก 2026-09-02 พร้อมกับ "งานรอรับเรื่อง"
  //  ที่เป็นผู้ใช้เพียงรายเดียว — ComplaintsStaffModule ดึงชุดเดียวกันเองตอนเปิดแท็บคำร้องอยู่แล้ว)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) { navigate('/auth', { state: { from: '/staff' } }); return }
      supabase.from('profiles').select('*').eq('id', data.session.user.id).single()
        .then(({ data: p }) => setProfile(p))
    })
  }, [navigate])

  useEffect(() => {
    if (!tenant?.id) return
    // เหตุผลที่ไม่รีเซ็ตเป็น 0 ตอน error — ดูคอมเมนต์ของ refreshComplaintBadge ข้างล่าง
    const refreshBadge = () =>
      supabase.from('document_requests').select('id', { count: 'exact', head: true })
        .eq('municipality_id', tenant.id).eq('status', 'pending')
        .then(({ count, error }) => {
          if (error) { console.error('document request badge count error:', error.message); return }
          setPendingCount(count ?? 0)
        })

    refreshBadge()

    const ch = supabase.channel(`pending-badge-${tenant.id}-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'document_requests' },
        ({ new: row }) => { if (row?.municipality_id === tenant.id) refreshBadge() })
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [tenant?.id])

  // หมวดเฉพาะกิจของเทศบาลนี้ — ใช้ตัดออกจากคิวรับเรื่องของแอดมิน (เหตุผลอยู่ใน badge ข้างล่าง)
  useEffect(() => {
    if (!tenant?.id) return
    supabase.from('complaint_categories').select('value')
      .eq('municipality_id', tenant.id).eq('is_adhoc', true)
      .then(({ data, error }) => {
        // ตอน error ตั้งเป็น [] ไม่ใช่ค้างที่ null — badge จะได้ไม่ดับไปเฉยๆ ผลคือนับเกิน
        // (รวมหมวดเฉพาะกิจเข้ามา) ซึ่งเป็นทิศที่ปลอดภัยกว่าสำหรับตัวเตือน
        if (error) console.error('adhoc categories fetch error:', error.message)
        setAdhocCategories(error ? [] : (data ?? []).map(c => c.value))
      })
  }, [tenant?.id])

  useEffect(() => {
    if (!tenant?.id || !profile?.id) return

    const isAdmin = ['admin', 'superadmin'].includes(profile.role)
    // แอดมินต้องรอให้รู้รายชื่อหมวดเฉพาะกิจก่อน ไม่งั้น badge จะโชว์ตัวเลขสูงเกินจริงแวบหนึ่ง
    if (isAdmin && adhocCategories === null) return

    // แอดมินไม่เคยถูก assign คำร้อง เงื่อนไข assigned_to จึงทำให้ badge เป็น 0 ตลอดกาล
    // คิวของแอดมินคือคำร้องที่ยัง status='pending' ทั้งเทศบาล — trigger auto_assign_complaint
    // (migration 080) มอบหมายช่างตามหมวดให้แล้วแต่จงใจไม่ขยับ status ส่วนช่างกรอง pending ทิ้ง
    // คำร้องจึงค้างไม่ถึงมือใครเลยจนกว่าแอดมินจะกดรับเรื่อง
    // ฝั่งแอดมินใช้ head:true นับอย่างเดียว ไม่ดึงแถวลง client = ไม่มี PII ติดมา และไม่ต้องใช้
    // seen ids เพราะพอกดรับเรื่องแล้ว status เปลี่ยน ตัวเลขลดเองโดยไม่ต้องจำสถานะบนเครื่อง
    //
    // ⚠️ ต้องตัดหมวดเฉพาะกิจ (complaint_categories.is_adhoc) ออกเสมอ — OdorAcknowledgePanel
    // จงใจแยกขาดจาก status pipeline ผู้รับผิดชอบกด "รับทราบ" แล้วเขียนแค่ extra_data.acknowledged_at
    // ไม่เคยแตะ status ⇒ คำร้องเฉพาะกิจค้าง pending ตลอดไปแม้จัดการเสร็จแล้ว ถ้านับรวมเข้ามา
    // badge จะไม่มีวันลงถึง 0 แล้วคนจะเลิกมองมัน ซึ่งแย่กว่าไม่มี badge
    // อีกทั้งหมวดเฉพาะกิจออกแบบให้ "ส่งตรงถึงผู้รับผิดชอบโดยไม่ผ่านแอดมิน" อยู่แล้ว
    // (migration 20260827120000) จึงไม่ควรอยู่ในคิวรับเรื่องของแอดมินตั้งแต่แรก
    const adminPendingQuery = () => {
      const q = supabase.from('complaints')
        .select('id', { count: 'exact', head: true })
        .eq('municipality_id', tenant.id)
        .eq('status', 'pending')
      return adhocCategories.length > 0
        ? q.not('category', 'in', `(${adhocCategories.map(v => `"${v}"`).join(',')})`)
        : q
    }

    // badge มีหน้าที่เตือน การเดาค่าเป็น 0 ตอน query พังจึงเป็นค่าที่อันตรายที่สุดที่จะเดา —
    // มันแปลว่า "ไม่มีอะไรต้องทำ" ทั้งที่จริงคือ "ไม่รู้" ตอน error ให้คงค่าเดิมไว้แล้ว log
    // ตัวเลขค้างยังดีกว่าไฟเขียวปลอม และทำให้แยกออกว่า 0 คือศูนย์จริงหรือ query พัง
    const refreshComplaintBadge = () => isAdmin
      ? adminPendingQuery().then(({ count, error }) => {
          if (error) { console.error('admin complaint badge count error:', error.message); return }
          setNewComplaintCount(count ?? 0)
        })
      : supabase.from('complaints')
          .select('id, status')
          .eq('municipality_id', tenant.id)
          .eq('assigned_to', profile.id)
          .neq('status', 'pending')
          .then(({ data, error }) => {
            if (error) { console.error('staff complaint badge fetch error:', error.message); return }
            const seen = getStaffSeenIds()
            const count = (data ?? []).filter(c =>
              c.status !== 'completed' && c.status !== 'closed' && c.status !== 'rejected' && !seen.has(c.id)
            ).length
            setNewComplaintCount(count)
          })

    refreshComplaintBadge()
    window.addEventListener('staff-badge-update', refreshComplaintBadge)

    const ch = supabase.channel(`staff-complaint-badge-${tenant.id}-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'complaints' },
        ({ eventType, new: row }) => {
          // DELETE ส่ง payload.new มาว่างเปล่า เช็ค municipality_id/assigned_to ไม่ได้ ตัวนับจึงไม่เคย
          // อัปเดตหลังลบคำร้อง — นับใหม่ไปเลย (RPC นับอย่างเดียว ไม่หนัก และเกิดไม่บ่อย)
          if (eventType === 'DELETE') { refreshComplaintBadge(); return }
          if (row?.municipality_id !== tenant.id) return
          if (!isAdmin && row?.assigned_to !== profile.id) return
          refreshComplaintBadge()
        })
      .subscribe()

    return () => {
      window.removeEventListener('staff-badge-update', refreshComplaintBadge)
      supabase.removeChannel(ch)
    }
  }, [tenant?.id, profile?.id, profile?.role, adhocCategories])

  async function handleLogout() {
    await signOutSafely('/')
    navigate('/')
  }

  return (
    <div className="min-h-full" style={{ backgroundColor: '#eef2f7' }}>

      {/* Mobile header — เดิมทำหน้าตาให้เหมือนหน้าประชาชน "กันสับสนตอนสลับโหมด" แต่กลับย้อนศร:
          เจ้าหน้าที่แยกไม่ออกว่าตัวเองอยู่โหมดไหน (ฝั่ง PC มีป้าย "ระบบเจ้าหน้าที่" ชัดเจนแต่มือถือไม่มี)
          2026-09-02 จึงใส่ป้าย "ระบบเจ้าหน้าที่" ชุดเดียวกับ PC ส่วนโลโก้ยังกลับหน้าแรกเหมือนเดิม */}
      <header className="md:hidden text-white px-4 pt-3 pb-4 relative overflow-hidden shrink-0"
        style={{ background: 'linear-gradient(135deg, var(--color-primary-dark) 0%, var(--color-primary) 100%)' }}>
        <div className="flex items-center gap-3 relative z-10">
          {/* กดโลโก้ = กลับหน้าแรกฝั่งประชาชน (พฤติกรรมเดิมของทุกหน้าในระบบ) — ป้าย "ระบบเจ้าหน้าที่"
              ข้างล่างทำหน้าที่บอกโหมดแทน จึงไม่ต้องมีปุ่มออกแยกอีกปุ่ม */}
          <button onClick={() => navigate('/')} aria-label="กลับหน้าแรก" className="shrink-0 active:opacity-70 transition-opacity">
            {tenant?.logo_url
              ? <img src={tenant.logo_url} alt="โลโก้" className="w-11 h-11 rounded-full object-contain bg-white/10 p-0.5 border border-white/20" />
              : <div className="w-11 h-11 rounded-full border-2 border-white/40 bg-white/20 flex items-center justify-center text-lg font-bold">{tenant?.name?.[0] ?? '?'}</div>}
          </button>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-sm leading-tight truncate">{tenant?.name ?? 'Staff Portal'}</p>
            <span className="mt-1 inline-block rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest">ระบบเจ้าหน้าที่</span>
          </div>
          {enabledKeys.includes('data-center') && (
            <button onClick={() => navigate('/data-center/staff')} aria-label="ศูนย์รวมข้อมูลดิจิทัล" className="p-1.5 text-white/85 hover:text-white transition-colors shrink-0">
              <Database size={19} />
            </button>
          )}
          <button onClick={() => navigate('/notifications')} aria-label="การแจ้งเตือน" className="relative p-1.5 text-white/85 hover:text-white transition-colors shrink-0">
            <Bell size={19} />
            {unreadCount > 0 && (
              <span className="absolute top-0 right-0 min-w-3.5 h-3.5 px-0.5 rounded-full bg-red-500 text-white text-[8px] font-bold flex items-center justify-center">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
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
            <div className="flex items-center gap-2 flex-wrap justify-end">
              <UserProfileBadge tone="onDark" />
              <PortalSwitcher className="flex" />
              <button onClick={handleLogout}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold bg-white/10 hover:bg-white/20 transition-colors border border-white/20">
                <LogOut size={13} />
                ออกจากระบบ
              </button>
            </div>
          </div>

        </header>

        {/* Desktop sidebar + main */}
        <div className="md:flex">
          <aside className="hidden md:flex flex-col w-60 shrink-0 shadow-lg"
            style={{ backgroundColor: '#1a3a5c' }}>
            <nav className="flex-1 px-3 py-4 overflow-y-auto">
              <button onClick={() => setActiveModule('home')}
                className={`mb-2 flex min-h-9 w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/60 ${activeModule === 'home' ? 'bg-white/20 text-white shadow-sm' : 'text-white/80 hover:bg-white/10 hover:text-white'}`}>
                <LayoutDashboard size={16} strokeWidth={activeModule === 'home' ? 2.2 : 1.8} />
                <span className="flex-1 text-left text-xs">แดชบอร์ด</span>
              </button>
              {/* ศูนย์รวมข้อมูลดิจิทัลย้ายไปอยู่ในกลุ่ม "แผนงานและทรัพยากรกลาง" ของ STANDALONE_GROUPS
                  แล้ว (2026-09-02) — ปุ่ม hardcode ตรงนี้จึงถูกถอดออก ไม่งั้นขึ้นซ้ำ 2 บรรทัด */}
              {visibleStandaloneGroups.map(({ group, items }) => (
                <div key={group} className="mb-3">
                  <p className="mb-1 px-3 text-[10px] font-bold uppercase tracking-widest text-white/55">{group}</p>
                  <div className="space-y-0.5">
                    {items.map(({ key, label, Icon, externalUrl, newTab }) => {
                      const isActive = activeModule === key
                      const badge = key === 'inbox' && pendingCount > 0 ? pendingCount
                        : key === 'complaints' && newComplaintCount > 0 ? newComplaintCount
                        : null
                      return (
                        <button key={key} onClick={() => newTab ? window.open(newTab, "_blank", "noopener,noreferrer") : externalUrl ? navigate(externalUrl) : setActiveModule(key)}
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
                    ) : items.map(({ key, label, Icon, externalUrl, newTab }) => {
                      const isActive = activeModule === key
                      const badge = key === 'inbox' && pendingCount > 0 ? pendingCount
                        : key === 'complaints' && newComplaintCount > 0 ? newComplaintCount
                        : null
                      return (
                        <button key={key} onClick={() => newTab ? window.open(newTab, "_blank", "noopener,noreferrer") : externalUrl ? navigate(externalUrl) : setActiveModule(key)}
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
                profile={profile}
                pendingCount={pendingCount}
                navigate={navigate}
                onCreateManagementEvent={() => {
                  setAutoCreateEventSignal(signal => signal + 1)
                  setActiveModule('events')
                }}
              />
            )}
            {activeModule === 'inbox'      && <InboxModule tenant={tenant} staffId={profile?.id} currentUserRole={profile?.role} />}
            {activeModule === 'complaints' && (
              // 'staff' ตัดออกจากรายชื่อนี้แล้ว — คำอธิบายบทบาท (ดู ROLE_DESCRIPTIONS ใน AdminDashboard.jsx)
              // บอกว่า "ใช้เมนูงานที่ได้รับมอบหมาย" แต่โค้ดเดิมให้ staff เห็น/จัดการคำร้องทั้งหมดเหมือน admin
              // — ไม่ตรงกับคำอธิบาย แก้ให้ staff ตกไปแตะ ComplaintsStaffModule (เฉพาะงานที่มอบหมายให้ตัวเอง)
              // เหมือนบทบาทอื่นที่ไม่ใช่ admin/superadmin
              ['admin', 'superadmin'].includes(profile?.role)
                ? (
                  <div className="space-y-4">
                    <header className="flex items-center gap-3 px-1">
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-cyan-400 text-white shadow-md shadow-blue-500/20">
                        <MessageSquareWarning size={21} strokeWidth={2.2} />
                      </span>
                      <div className="min-w-0">
                        <p className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-blue-600">ระบบเจ้าหน้าที่</p>
                        <h1 className="truncate text-lg font-extrabold tracking-tight text-slate-900">จัดการคำร้องประชาชน</h1>
                        <p className="text-[11px] text-slate-500">รับเรื่อง ตรวจสอบ มอบหมาย และติดตามผล</p>
                      </div>
                    </header>
                    <ComplaintsManager tenant={tenant} currentUserRole={profile?.role} openComplaintId={mapOpenComplaintId} />
                  </div>
                )
                : <ComplaintsStaffModule tenant={tenant} staffId={profile?.id}
                    currentUserRole={profile?.role} />
            )}
            {activeModule === 'events'     && <EventsManager tenant={tenant} currentUserRole={profile?.role ?? 'staff'} autoEditEventId={autoEditEventId} onAutoEditHandled={() => setAutoEditEventId(null)} autoCreateSignal={autoCreateEventSignal} autoCreateAudience="management" onAutoCreateHandled={() => setAutoCreateEventSignal(0)} />}
            {activeModule === 'projects'      && <CivilProjectAdmin tenant={tenant} currentUserRole={profile?.role ?? 'staff'} myDepartmentId={profile?.department_id ?? null} />}
            {activeModule === 'infra'      && <InfraWorkAdmin tenant={tenant} currentUserRole={profile?.role ?? 'staff'} myDepartmentId={profile?.department_id ?? null} />}
            {activeModule === 'report'       && <StaffReportWrapper tenant={tenant} />}
            {activeModule === 'civil-report'      && <CivilProjectReport tenant={tenant} />}
            {activeModule === 'posts'            && <PostsManager currentUserRole={profile?.role ?? 'staff'} myDepartmentId={profile?.department_id ?? null} />}
            {activeModule === 'tourism'          && <TourismManager tenant={tenant} currentUserRole={profile?.role ?? 'staff'} currentUserId={profile?.id ?? null} myDepartmentId={profile?.department_id ?? null} />}
            {activeModule === 'tourism-reviews'  && <TourismReviewsAdmin tenant={tenant} />}
            {activeModule === 'fleet' && <FleetPage onBack={() => setActiveModule('home')} />}
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
            { key: 'home',       label: 'แดชบอร์ด',   Icon: LayoutDashboard },
            { key: 'inbox',      label: 'คำขอบริการ/เอกสาร', Icon: FileText },
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
          {/* รายงาน — ต้องกรองด้วย visibleModules เหมือนปุ่มอื่น ไม่งั้นเป็นปุ่มหลอกใน อปท.
              ที่ปิดโมดูลรายงานไว้ (หลักการ: ปิดโมดูลแล้วต้องหายทั้งระบบ) */}
          {visibleModules.some(m => m.key === 'report') && (() => {
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
