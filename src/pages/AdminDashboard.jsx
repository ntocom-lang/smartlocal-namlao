import { useEffect, useState, useCallback, useRef, lazy, Suspense } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts'
import {
  RefreshCw, Clock, Loader2, Check,
  CheckCircle2, ChevronRight, ChevronLeft,
  Search, Phone, Trash2, Plus, PhoneCall, LogOut, Users, Shield, MapPin, GripVertical, Briefcase,
  X, Home, LayoutGrid, Tag, ChevronUp, ChevronDown, Pencil, Wrench, Camera, Repeat,
  TrendingUp, AlertTriangle, Printer, UserCircle2, BookOpen, Bell, ExternalLink, Settings, Download, Banknote, Star, MessageSquare, Car, Terminal, Database, CalendarDays, KeyRound
} from 'lucide-react'
import { supabase, signOutSafely } from '../lib/supabase'
import { compressImage } from '../lib/imageUtils'
import { attachReporterProfiles } from '../lib/attachReporterProfiles'
import { workingDaysBetween, workingDaysSince } from '../lib/workingDays'
import { uploadFile } from '../lib/driveStorage'
import { tenantDefaultSubdistrict } from '../lib/tenantSubdistrict'
import { NAME_TITLES, splitThaiFullName, joinThaiFullName } from '../lib/thaiName'
import { accountProviders, providerLabel, phoneToLoginEmail, normalizeThaiPhone } from '../lib/authProviders'
import { useTenant } from '../contexts/TenantContext'
import CivilProjectAdmin from '../components/admin/CivilProjectAdmin'
// lazy: หน้ารายงานโครงการเปิดเฉพาะตอนเลือกเมนู ไม่ต้องโหลดมาพร้อมแผงควบคุม
const CivilProjectReport = lazy(() => import('../components/admin/CivilProjectReport'))
import SystemSettingsAdmin from '../components/admin/SystemSettingsAdmin'
import HolidaysAdmin from '../components/admin/HolidaysAdmin'
import ResetPasswordModal from '../components/admin/ResetPasswordModal'
import FeeSettingsAdmin from '../components/admin/FeeSettingsAdmin'
// โหลดแบบ lazy — EventsManager เป็น chunk 60KB ที่ของเดิม import แบบ static ทำให้ถูกดาวน์โหลด
// ทุกครั้งที่เปิดแผงควบคุม Admin ทั้งที่เมนูปฏิทินกิจกรรมถูกถอดออกไปแล้ว จึงเข้าไม่ถึงเลย
const EventsManagerComponent = lazy(() => import('../components/admin/EventsManager'))
// lazy: InboxModule เป็น named export ที่อยู่กลางไฟล์ StaffDashboard.jsx (1,900+ บรรทัด)
// การ import แบบ static จึงลากทั้งหน้าเจ้าหน้าที่ รวมถึง OdorAcknowledgePanel และ
// buildingPermitPrint ที่ห้อยอยู่กับมัน เข้ามาในสายที่ต้องโหลดตอนเปิดแผงควบคุม Admin
// ทางที่ถูกกว่าคือย้าย InboxModule ออกเป็นไฟล์ของตัวเอง แต่มันอ้างถึงของใน module scope
// ของ StaffDashboard ถึง 22 ตัว (StatusBadge, TaskCard, TaskDetailSheet, buildDocHTML ฯลฯ)
// การแยกจึงเป็น refactor ก้อนใหญ่ที่เสี่ยงเกินกว่าผลที่ได้ — ใช้ dynamic import แทน ได้ผล
// เรื่องเวลาโหลดเท่ากันโดยไม่ต้องขยับโครงสร้างไฟล์
const InboxModule = lazy(() => import('./StaffDashboard').then(m => ({ default: m.InboxModule })))

// ต้องตรงกับ uuid ใน supabase/migrations/147_dev_journal.sql (ntocom@gmail.com) —
// ใช้กรองเมนู "ผู้พัฒนาระบบ" ให้เห็นเฉพาะบัญชีนี้ ไม่ผูกกับ role เพราะ superadmin
// ของแต่ละเทศบาลเป็นคนละคนกัน ความปลอดภัยจริงอยู่ที่ RLS ของตาราง dev_journal
const DEV_USER_ID = 'b3e7c083-05ee-4664-ba42-e866729923ef'
// lazy: ตัวนี้เป็นก้อนที่แพงที่สุด — มันลาก recharts (chunk PieChart ~355 KB) ตามมาด้วย
// ทั้งที่กราฟถูกใช้เฉพาะในหน้ารายงานเท่านั้น
const ReportManagerComponent = lazy(() => import('../components/admin/ReportManager'))
import AuditLogViewer from '../components/admin/AuditLogViewer'
import { ROLE_LABELS, ROLE_DESCRIPTIONS, fetchAssignableStaff, groupStaffByDepartment } from '../lib/staffRoster'
import FleetSetup from '../components/fleet/FleetSetup'
import { adminUpdateUser } from '../lib/adminUpdateUser'
import { CategoryIcon } from '../lib/categoryIcon'

// ─── Status config ────────────────────────────────────────────────────────────
const STATUS = {
  pending:     { label: 'รอดำเนินการ',    color: '#f59e0b', bg: '#fef3c7', text: '#92400e' },
  received:    { label: 'รับเรื่องแล้ว',   color: '#3b82f6', bg: '#dbeafe', text: '#1e40af' },
  in_progress: { label: 'กำลังดำเนินการ', color: '#8b5cf6', bg: '#ede9fe', text: '#5b21b6' },
  done:        { label: 'รอปิดเรื่อง',    color: '#f97316', bg: '#fff7ed', text: '#9a3412' },
  completed:   { label: 'ปิดเรื่องแล้ว',  color: '#10b981', bg: '#d1fae5', text: '#065f46' },
  closed:      { label: 'ปิดเรื่องแล้ว',  color: '#10b981', bg: '#d1fae5', text: '#065f46' },
  rejected:    { label: 'ปฏิเสธ',         color: '#ef4444', bg: '#fee2e2', text: '#991b1b' },
}

const STATUS_FLOW = ['pending', 'received', 'in_progress', 'done', 'completed']
const STATUS_FLOW_LABEL = {
  pending:     { label: 'รอดำเนินการ',    desc: 'ประชาชนส่งคำร้องเข้าระบบ' },
  received:    { label: 'รับเรื่องแล้ว',   desc: 'เจ้าหน้าที่รับเรื่องและตรวจสอบ' },
  in_progress: { label: 'กำลังดำเนินการ', desc: 'อยู่ระหว่างดำเนินการแก้ไข' },
  done:        { label: 'รอปิดเรื่อง',    desc: 'เจ้าหน้าที่ดำเนินการเสร็จ รอ admin ปิดเรื่อง' },
  completed:   { label: 'ปิดเรื่องแล้ว',  desc: 'ปิดเรื่องและแจ้งผลประชาชนแล้ว' },
}

const NEXT_ACTION = {
  pending:     { label: 'รับเรื่อง',  next: 'received' },
  done:        { label: 'ปิดเรื่อง', next: 'completed' },
}

let CATEGORY_LABEL = {
  road: 'ถนน/ทางสาธารณะ', light: 'ไฟฟ้าส่องสว่าง',
  trash: 'ขยะ/ความสะอาด', water: 'น้ำประปา',
  flood: 'น้ำท่วม/ระบายน้ำ', tree: 'ต้นไม้/สวนสาธารณะ',
  noise: 'เหตุรำคาญ', disease: 'ควบคุมโรคติดต่อ', other: 'อื่นๆ',
}

let CATEGORY_EMOJI = {
  road: '🛣️', light: '💡', trash: '🗑️', water: '🚰',
  flood: '🌊', tree: '🌳', noise: '📢', drain: '🕳️',
  waste_water: '💧', suction: '🚛', manhole: '⚙️', vendor: '🏪',
  building: '🏗️', mosquito: '🦟', pollution: '🌫️', corruption: '⚖️',
  tax: '📋', canal: '🏞️', animals: '🐕', disease: '🏥', other: '📝',
}


// ─── User Manager ─────────────────────────────────────────────────────────────
// ROLE_LABELS/ROLE_DESCRIPTIONS ย้ายไป src/lib/staffRoster.js แล้ว (import ด้านบน) — ใช้ร่วมกับ
// ComplaintsManager.jsx กัน role label เพี้ยนกันคนละจุดเหมือนที่เคยเป็นมาก่อน

const NON_CITIZEN_ROLES = ['staff', 'officer', 'technician', 'admin', 'superadmin', 'council', 'viewer']
const USER_PAGE_SIZE = 50
const USER_SORT_KEYS = new Set(['created_at', 'full_name', 'email', 'providers', 'role', 'assignment'])
const PERSONNEL_CARD_PALETTES = [
  { color: '#2563eb', soft: '#eff6ff', border: '#bfdbfe' },
  { color: '#7c3aed', soft: '#f5f3ff', border: '#ddd6fe' },
  { color: '#0891b2', soft: '#ecfeff', border: '#a5f3fc' },
  { color: '#059669', soft: '#ecfdf5', border: '#a7f3d0' },
  { color: '#d97706', soft: '#fffbeb', border: '#fde68a' },
  { color: '#db2777', soft: '#fdf2f8', border: '#fbcfe8' },
]

// chip "เชื่อมต่อบัญชี" ใช้ทั้งในตาราง (compact), การ์ดมือถือ และแท็บข้อมูลบัญชีในหน้ารายละเอียด
function ProviderChips({ user, compact = false }) {
  const keys = accountProviders(user)
  if (keys.length === 0) return <span className="text-xs text-gray-300 italic">ไม่พบข้อมูล</span>
  return (
    <div className="flex flex-wrap gap-1">
      {keys.map((key) => {
        const b = providerLabel(key)
        return (
          <span
            key={key}
            title={b.label}
            className={compact
              ? 'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold whitespace-nowrap'
              : 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold'}
            style={{ backgroundColor: b.bg, color: b.color }}
          >
            {b.icon} {compact ? b.short : b.label}
          </span>
        )
      })}
    </div>
  )
}

function UserSortHeader({ label, sortKey, sortConfig, onSort, className = '' }) {
  const isActive = sortConfig.key === sortKey
  const nextDirectionLabel = isActive && sortConfig.direction === 'asc' ? 'จากมากไปน้อย' : 'จากน้อยไปมาก'
  return (
    <th
      aria-sort={isActive ? (sortConfig.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={`border-r border-white/10 text-white ${className}`}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="flex w-full items-center gap-1 px-2 py-2.5 text-left font-bold transition-colors hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/80"
        title={`กดเพื่อเรียง${label} ${nextDirectionLabel}`}
      >
        <span>{label}</span>
        {isActive
          ? (sortConfig.direction === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />)
          : <span aria-hidden="true" className="text-[10px] text-white/45">↕</span>}
      </button>
    </th>
  )
}

function userSortValue(user, key) {
  if (key === 'providers') {
    return accountProviders(user).map((provider) => providerLabel(provider).label).join(' ')
  }
  if (key === 'role') return ROLE_LABELS[user.role]?.label ?? user.role ?? ''
  if (key === 'assignment') return `${user.department_name ?? ''} ${user.position_name ?? ''}`.trim()
  if (key === 'created_at') return user.created_at ? new Date(user.created_at).getTime() : 0
  return user[key] ?? ''
}

function canManageUser(currentUserRole, currentUserId, targetUser) {
  if (!targetUser || !currentUserId || targetUser.id === currentUserId) return false
  if (currentUserRole === 'superadmin') return targetUser.role !== 'superadmin'
  if (currentUserRole === 'admin') return !['admin', 'superadmin'].includes(targetUser.role)
  return false
}

function UserManager({ tenant, currentUserRole, currentUserId }) {
  const [subTab, setSubTab] = useState('staff') // 'staff' | 'citizen'
  const [users, setUsers] = useState([])
  const [depts, setDepts] = useState([])
  const [positions, setPositions] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(null)
  const [editingNameId, setEditingNameId] = useState(null)
  const [editingNameValue, setEditingNameValue] = useState('')
  // การแต่งตั้งบุคลากรทำที่หน้ารายละเอียดผู้ใช้เพียงจุดเดียว
  const [editingAddressId, setEditingAddressId] = useState(null)
  const [editingAddressValue, setEditingAddressValue] = useState('')
  const [viewingUserId, setViewingUserId] = useState(null)
  // derive จาก users list เสมอ (ไม่เก็บ snapshot แยก) กัน UI ค้างข้อมูลเก่าหลังแก้ไขในหน้ารายละเอียด
  const viewingUser = viewingUserId ? users.find(u => u.id === viewingUserId) : null
  const [deletingUser, setDeletingUser] = useState(null)
  // ผู้ใช้ที่กำลังจะตั้งรหัสผ่านใหม่ให้ (ประชาชนลืมรหัสแล้วเดินมาที่สำนักงาน) — ระบบไม่มีทางกู้
  // บัญชีอื่นเลย บัญชีเบอร์โทรรีเซ็ตทางอีเมลไม่ได้อยู่แล้ว ส่วนบัญชีอีเมลก็ส่งลิงก์ไปไม่ถึงถ้ายัง
  // ไม่ได้ตั้ง custom SMTP (built-in ของ Supabase ปฏิเสธการส่งไปยังอีเมลนอกทีมโปรเจกต์)
  const [resetPasswordUser, setResetPasswordUser] = useState(null)
  const [deleteLoading, setDeleteLoading] = useState(false)
  // ลบไม่สำเร็จเพราะยังมีงานค้าง (guard ใน delete_user_by_id) — โชว์เหตุผลใน modal เดิม
  // พร้อมทางออกไปหน้าโอนงาน แทนที่จะแค่ alert() เฉยๆ แล้วให้ผู้ใช้เดาเอง
  const [deleteBlockedReason, setDeleteBlockedReason] = useState('')
  const [handoverStaff, setHandoverStaff] = useState(null)
  // บัญชีที่จะ "เก็บไว้" เมื่อรวมบัญชีซ้ำ (คนเดียวสมัคร 2 ครั้งด้วยคนละ provider) — บัญชีที่จะยุบ
  // เลือกในโมดัลอีกที ดู MergeDuplicateModal
  const [mergeKeepUser, setMergeKeepUser] = useState(null)
  // ค่าเริ่มต้นต้องตรงกับ ORDER BY จริงใน get_users_with_email() (full_name ASC) ไม่งั้นลูกศร
  // บนหัวตารางจะขึ้นผิดทิศทาง (ข้อมูลที่ได้มาเรียงตามชื่อแล้ว แต่ลูกศรจะโชว์ว่ายังไม่ได้กดเรียง)
  const [sortConfig, setSortConfig] = useState({ key: 'full_name', direction: 'asc' })
  const [serverSortReady, setServerSortReady] = useState(true)

  const [search, setSearch] = useState('')
  const [filterRole, setFilterRole] = useState('')
  const [filterDept, setFilterDept] = useState('') // '' = ทั้งหมด, 'none' = ไม่ระบุกอง, มิฉะนั้นคือ department_id
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(USER_PAGE_SIZE)
  const [citizenCount, setCitizenCount] = useState(null)
  const [staffCount, setStaffCount] = useState(null)
  const fetchSequence = useRef(0)

  useEffect(() => {
    if (!tenant?.id) return
    Promise.all([
      supabase.from('departments').select('id, name, short_name')
        .eq('municipality_id', tenant.id).eq('is_active', true).order('sort_order'),
      supabase.from('positions').select('id, name, role, category, department_hint').order('sort_order'),
    ]).then(([{ data: departmentRows }, { data: positionRows }]) => {
      setDepts(departmentRows ?? [])
      setPositions(positionRows ?? [])
    })
  }, [tenant?.id])

  // จำนวนจริงทั้งหมดของแต่ละแท็บ (ไม่ใช่แค่ users.length ที่จำกัดแค่หน้าละ USER_PAGE_SIZE คน — ถ้ามีเกินนั้น
  // ตัวเลขในรายการจะน้อยกว่าความจริง) — ใช้ RPC get_user_role_counts แทนนับตรงจาก client เพราะต้อง mirror
  // เงื่อนไขเดียวกับ get_users_with_email (รวมบัญชี municipality_id เป็น NULL ที่ผูกผ่านคำร้อง) ไม่งั้น
  // ตัวเลข badge จะไม่ตรงกับรายการจริงที่กดเข้าไปดู (เจอจริงตอนทดสอบ: นับตรงได้ 37 แต่รายการจริงมี 38)
  useEffect(() => {
    if (!tenant?.id || !['admin', 'superadmin'].includes(currentUserRole)) return
    supabase.rpc('get_user_role_counts', { p_municipality_id: tenant.id })
      .then(({ data, error }) => {
        if (error) return
        setStaffCount(data?.staff ?? 0)
        setCitizenCount(data?.citizen ?? 0)
      })
  }, [tenant?.id, currentUserRole])

  const fetchUsers = useCallback(async (opts = {}) => {
    if (!['admin', 'superadmin'].includes(currentUserRole) || !tenant?.id) return
    const searchTerm = (opts.search ?? '').trim()
    const requestedPage = Math.max(0, opts.page ?? 0)
    const requestedSortKey = USER_SORT_KEYS.has(opts.sortKey ?? sortConfig.key) ? (opts.sortKey ?? sortConfig.key) : 'full_name'
    const requestedSortDirection = (opts.sortDirection ?? sortConfig.direction) === 'desc' ? 'desc' : 'asc'
    const requestId = ++fetchSequence.current
    setLoading(true)
    try {
      // p_limit ไม่ใส่ +1 แบบเดิม เพราะ get_users_with_email clamp ค่าไว้ที่ 100 สูงสุดในตัว RPC เอง
      // (LEAST(GREATEST(p_limit,1),100)) — ถ้า pageSize=100 แล้วขอ 101 จะโดน clamp เหลือ 100 เสมอ ทำให้
      // ตรวจ "มีหน้าถัดไปไหม" ด้วยการเทียบจำนวนที่ได้คืนมาผิดพลาดได้ ใช้ staffCount/citizenCount ที่มีอยู่แล้ว
      // (นับจริงจาก get_user_role_counts) เป็นตัวคำนวณจำนวนหน้าแทน แม่นกว่าและไม่ต้อง query ซ้ำ
      const rpcParams = {
        p_municipality_id: tenant.id,
        p_roles: subTab === 'citizen' ? ['citizen'] : (filterRole ? [filterRole] : NON_CITIZEN_ROLES),
        p_search: searchTerm || null,
        p_limit: pageSize,
        p_offset: requestedPage * pageSize,
      }
      let usedLegacyRpc = false
      let { data, error } = await supabase.rpc('get_users_with_email_sorted', {
        ...rpcParams,
        p_sort_key: requestedSortKey,
        p_sort_direction: requestedSortDirection,
      })
      // ระหว่าง deploy แบบ DB-first หาก schema cache ยังไม่เห็น RPC ใหม่ ให้รายการเดิมยังเปิดได้
      // (แต่จะเรียงได้ถูกต้องเฉพาะข้อมูลในหน้าปัจจุบันจนกว่า migration จะถูก apply)
      if (error?.code === 'PGRST202') {
        usedLegacyRpc = true
        const legacyResult = await supabase.rpc('get_users_with_email', rpcParams)
        data = legacyResult.data
        error = legacyResult.error
      }
      if (requestId !== fetchSequence.current) return
      setServerSortReady(!usedLegacyRpc)
      if (error) {
        console.error('get_users_with_email:', error.message)
        setUsers([])
        return
      }
      setUsers(data ?? [])
    } finally {
      if (requestId === fetchSequence.current) setLoading(false)
    }
  }, [tenant?.id, currentUserRole, subTab, filterRole, pageSize, sortConfig])

  // ค้นหา/กรอง/แบ่งหน้าใน SQL เพื่อไม่ดึง PII ทั้งหมดมาที่ Browser — RPC จำกัดหน้าละ
  // USER_PAGE_SIZE อยู่แล้ว ทั้งสองแท็บจึงโหลดหน้าแรกได้ทันทีโดยไม่ต้องรอพิมพ์ค้นหาก่อน
  useEffect(() => {
    const t = setTimeout(() => fetchUsers({ search, page }), search.trim() ? 400 : 0)
    return () => clearTimeout(t)
  }, [search, subTab, page, filterRole, fetchUsers])

  const updateManagedUser = adminUpdateUser

  async function updateName(userId) {
    const name = editingNameValue.trim()
    if (!name) return
    setSaving(userId)
    const { error } = await updateManagedUser(userId, { full_name: name })
    if (error) {
      alert(`บันทึกไม่สำเร็จ: ${error.message}`)
    } else {
      setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, full_name: name } : u))
      setEditingNameId(null)
    }
    setSaving(null)
  }

  async function updateAddress(userId) {
    const val = editingAddressValue.trim()
    setSaving(userId)
    const { error } = await updateManagedUser(userId, { address: val || null })
    if (error) {
      alert(`บันทึกไม่สำเร็จ: ${error.message}`)
    } else {
      setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, address: val || null } : u))
      setEditingAddressId(null)
    }
    setSaving(null)
  }

  // บันทึกทุกแท็บ (บัญชี/ส่วนตัว/การแต่งตั้ง) ในหน้ารายละเอียดพร้อมกันครั้งเดียว
  async function saveUserEdits(user, changes) {
    if (changes.role === 'officer' && !changes.department_id) {
      return { ok: false, error: 'หัวหน้ากองต้องระบุกอง/หน่วยงานที่สังกัดก่อนบันทึก' }
    }
    setSaving(user.id)
    const needsMuni = ['admin', 'staff', 'technician', 'officer', 'viewer', 'council'].includes(changes.role)
    const payload = { ...changes, municipality_id: needsMuni ? (user.municipality_id || tenant?.id) : null }
    const clearsAssignment = ['citizen', 'superadmin'].includes(changes.role)
    const effectivePayload = clearsAssignment
      ? { ...payload, department_id: null, position_id: null, is_dept_head: false }
      : payload
    const { error } = await updateManagedUser(user.id, effectivePayload)
    setSaving(null)
    if (error) {
      const msg = error.code === '23505' ? 'เลขบัตรประชาชนนี้ถูกใช้กับบัญชีอื่นแล้ว' : error.message
      return { ok: false, error: msg }
    }
    const dept = depts.find(d => d.id === effectivePayload.department_id)
    const position = positions.find(p => p.id === effectivePayload.position_id)
    setUsers((prev) => prev.map((u) => u.id === user.id ? {
      ...u,
      ...effectivePayload,
      department_name: dept?.name ?? null,
      position_name: clearsAssignment ? null : (position?.name ?? null),
    } : u))
    return { ok: true }
  }

  // แยกออกจาก saveUserEdits เพราะ auth.users.email เปลี่ยนผ่าน edge function
  // (Supabase Admin API) เท่านั้น ไม่ใช่ admin_update_user RPC ธรรมดา
  async function updateUserEmail(user, newEmail) {
    setSaving(user.id)
    const { data, error } = await supabase.functions.invoke('admin-update-login-email', {
      body: { user_id: user.id, email: newEmail },
    })
    setSaving(null)
    if (error || !data?.ok) {
      return { ok: false, error: data?.error || error?.message || 'unknown error' }
    }
    setUsers((prev) => prev.map((u) => u.id === user.id ? { ...u, email: newEmail } : u))
    return { ok: true }
  }

  async function deleteUser(userId) {
    setDeleteLoading(true)
    const { error } = await supabase.rpc('delete_user_by_id', { p_user_id: userId })
    setDeleteLoading(false)
    if (error) {
      // guard ฝั่ง DB (20260827100000) โยน exception ที่ขึ้นต้นด้วยข้อความนี้เสมอเมื่อบล็อกเพราะมีงาน
      // ค้าง — แยกออกจาก error อื่น (สิทธิ์ไม่พอ ฯลฯ) เพื่อเสนอทางออก "โอนงานก่อน" แทนแค่ alert()
      if (error.message?.startsWith('ไม่สามารถลบผู้ใช้นี้ได้ เนื่องจาก')) {
        setDeleteBlockedReason(error.message)
      } else {
        alert(`ลบไม่สำเร็จ: ${error.message}`)
      }
    } else {
      setUsers((prev) => prev.filter((u) => u.id !== userId))
      setDeletingUser(null)
      setDeleteBlockedReason('')
      if (viewingUserId === userId) setViewingUserId(null) // กันหน้ารายละเอียดค้างชี้ user ที่ลบไปแล้ว
    }
  }

  // หลังรวมบัญชีสำเร็จต้องโหลดรายการใหม่ ไม่ใช่แค่กรองบัญชีที่ถูกยุบออกจาก state — เพราะ providers
  // ของบัญชีที่เก็บไว้เปลี่ยนไปด้วย (auth.identities ของ LINE/Google ย้ายมาผูกกับบัญชีนี้แล้ว) ถ้าไม่
  // โหลดใหม่ chip "เชื่อมต่อบัญชี" จะยังเป็นค่าเก่า ดูเหมือนช่องทาง login ที่เพิ่งรวมเข้ามาหายไป
  function handleMerged(mergedId) {
    setMergeKeepUser(null)
    if (viewingUserId === mergedId) setViewingUserId(null)
    fetchUsers({ search, page })
  }

  const handleSort = (key) => {
    if (!USER_SORT_KEYS.has(key)) return
    setSortConfig(current => ({
      key,
      direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc'
    }))
    setPage(0)
  }

  // การ์ดกลุ่ม "กอง/หน่วยงาน" แทนกลุ่มตำแหน่งเดิม — เข้าใจง่ายกว่า เพราะตรงกับโครงสร้างหน่วยงานจริง
  // ที่แอดมินคุ้นเคยอยู่แล้ว (กองคลัง, กองช่าง, สำนักปลัด ฯลฯ) ไม่ต้องแปลจากหมวดตำแหน่งนามธรรม
  const deptCards = [
    ...depts.map((d, index) => ({
      value: d.id,
      label: d.name,
      shortName: d.short_name,
      count: users.filter(u => u.department_id === d.id).length,
      palette: PERSONNEL_CARD_PALETTES[index % PERSONNEL_CARD_PALETTES.length],
    })),
    {
      value: 'none', label: 'ไม่ระบุกอง', shortName: 'รอตรวจสอบ',
      count: users.filter(u => !u.department_id).length,
      palette: { color: '#64748b', soft: '#f8fafc', border: '#cbd5e1' },
    },
  ]

  const activeTabCount = subTab === 'citizen' ? citizenCount : staffCount
  const assignedOnPage = users.filter(u => u.department_id).length
  const departmentHeadOnPage = users.filter(u => u.is_dept_head).length

  const filteredOnPage = users.filter((u) => {
    const q = search.toLowerCase()
    const matchSearch = !q || (u.full_name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q) || (u.phone || '').includes(q)
    const matchRole = !filterRole || u.role === filterRole
    const matchDept = !filterDept || (filterDept === 'none' ? !u.department_id : u.department_id === filterDept)
    return matchSearch && matchRole && matchDept
  })
  const filtered = serverSortReady ? filteredOnPage : [...filteredOnPage].sort((a, b) => {
    const { key, direction } = sortConfig;
    let aVal = userSortValue(a, key)
    let bVal = userSortValue(b, key)

    // fallback ฝั่ง client ใช้เฉพาะช่วงที่ production ยังไม่ apply RPC ใหม่
    if (typeof aVal === 'string') aVal = aVal.toLocaleLowerCase('th')
    if (typeof bVal === 'string') bVal = bVal.toLocaleLowerCase('th')

    // ชื่อภาษาไทยขึ้นก่อนภาษาอังกฤษเสมอ (ตรงกับที่ get_users_with_email() เรียงมาจาก server) —
    // ไม่งั้น string comparison ปกติของ JS จะเอาอักษรละตินขึ้นก่อน เพราะ code point ของอักษรไทยสูงกว่า
    if (key === 'full_name') {
      const isThai = (s) => /^[ก-๙]/.test(s)
      const aThai = isThai(aVal), bThai = isThai(bVal)
      if (aThai !== bThai) return aThai ? -1 : 1
    }

    const comparison = typeof aVal === 'string' && typeof bVal === 'string'
      ? aVal.localeCompare(bVal, 'th', { numeric: true, sensitivity: 'base' })
      : (aVal < bVal ? -1 : (aVal > bVal ? 1 : 0))
    if (comparison !== 0) return direction === 'asc' ? comparison : -comparison
    return (a.full_name || a.email || '').localeCompare(b.full_name || b.email || '', 'th')
  })

  if (viewingUser) {
    return (
      <UserDetailPage
        user={viewingUser}
        onBack={() => setViewingUserId(null)}
        currentUserRole={currentUserRole}
        currentUserId={currentUserId}
        tenant={tenant}
        depts={depts}
        positions={positions}
        saving={saving}
        deletingUser={deletingUser} setDeletingUser={setDeletingUser} deleteLoading={deleteLoading} deleteUser={deleteUser}
        deleteBlockedReason={deleteBlockedReason} setDeleteBlockedReason={setDeleteBlockedReason}
        handoverStaff={handoverStaff} setHandoverStaff={setHandoverStaff}
        mergeKeepUser={mergeKeepUser} setMergeKeepUser={setMergeKeepUser} onMerged={handleMerged}
        saveUserEdits={saveUserEdits}
        updateUserEmail={updateUserEmail}
        resetPasswordUser={resetPasswordUser} setResetPasswordUser={setResetPasswordUser}
      />
    )
  }

  return (
    <div className="space-y-4">
      <section className="relative overflow-hidden rounded-[28px] bg-gradient-to-br from-slate-950 via-blue-950 to-indigo-800 px-5 py-5 text-white shadow-xl shadow-blue-950/15 md:px-7 md:py-6">
        <div className="pointer-events-none absolute -right-16 -top-20 h-48 w-48 rounded-full bg-cyan-400/20 blur-3xl" />
        <div className="pointer-events-none absolute bottom-0 left-1/3 h-28 w-56 rounded-full bg-violet-500/20 blur-3xl" />
        <div className="relative flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3 pr-10 md:gap-4 md:pr-0">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/20 bg-white/10 shadow-inner backdrop-blur-sm md:h-14 md:w-14">
              <Users size={25} strokeWidth={1.8} />
            </div>
            <div>
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-cyan-300/30 bg-cyan-300/10 px-2.5 py-1 text-[10px] font-bold tracking-[0.16em] text-cyan-100">
                  PERSONNEL CENTER
                </span>
                <span className="text-xs text-blue-100/70">ข้อมูลบุคลากรกลางของหน่วยงาน</span>
              </div>
              <h3 className="text-lg font-black leading-snug tracking-tight md:text-2xl">
                <span className="md:hidden">จัดการผู้ใช้<br />และการแต่งตั้ง</span>
                <span className="hidden md:inline">จัดการผู้ใช้และการแต่งตั้ง</span>
              </h3>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-blue-100/75 md:text-sm">
                จัดสังกัด ตำแหน่ง และสิทธิ์การใช้งานจากจุดเดียว ลดข้อมูลซ้ำและตรวจสอบสายงานได้ชัดเจน
              </p>
            </div>
          </div>
          <button
            onClick={() => fetchUsers({ search, page })}
            className="group absolute right-0 top-0 flex h-10 items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/10 px-3 text-xs font-semibold text-white backdrop-blur-sm transition-all hover:bg-white/20 active:scale-95 md:static md:px-3.5"
            title="รีเฟรชข้อมูล"
          >
            <RefreshCw size={15} className="transition-transform duration-500 group-hover:rotate-180" />
            <span className="hidden md:inline">อัปเดตข้อมูล</span>
          </button>
        </div>

        <div className="relative mt-5 grid grid-cols-3 gap-2 md:max-w-xl md:gap-3">
          {[
            { label: subTab === 'staff' ? 'เจ้าหน้าที่ทั้งหมด' : 'ประชาชนทั้งหมด', value: activeTabCount ?? '—', color: 'text-cyan-200' },
            { label: subTab === 'staff' ? 'มีสังกัดในหน้านี้' : 'บัญชีในหน้านี้', value: subTab === 'staff' ? assignedOnPage : users.length, color: 'text-emerald-200' },
            { label: subTab === 'staff' ? 'หัวหน้ากองในหน้านี้' : 'ผลการค้นหา', value: subTab === 'staff' ? departmentHeadOnPage : filtered.length, color: 'text-violet-200' },
          ].map(item => (
            <div key={item.label} className="rounded-2xl border border-white/10 bg-white/[0.08] px-3 py-3 backdrop-blur-sm">
              <p className={`text-xl font-black leading-none md:text-2xl ${item.color}`}>{item.value}</p>
              <p className="mt-1.5 text-[9px] font-medium leading-tight text-white/65 md:text-[11px]">{item.label}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="overflow-hidden rounded-[24px] border border-slate-200/80 bg-white shadow-lg shadow-slate-200/60">

      {/* แท็บย่อย: เจ้าหน้าที่ / ประชาชน — แยก query กันโหลดผู้ใช้ทั้งหมดมาทีเดียว (แต่ละแท็บโหลดหน้าแรกทันที) */}
      <div className="border-b border-slate-100 bg-gradient-to-r from-slate-50 via-white to-blue-50/60 px-4 py-3 md:px-5">
        <div className="inline-flex rounded-2xl border border-slate-200 bg-white p-1 shadow-sm">
        {[
          { key: 'staff', label: 'เจ้าหน้าที่', count: staffCount, Icon: Briefcase },
          { key: 'citizen', label: 'ประชาชน', count: citizenCount, Icon: UserCircle2 },
        ].map(({ key, label, count, Icon }) => (
          <button key={key} onClick={() => {
            fetchSequence.current += 1
            setSubTab(key)
            setSearch('')
            setFilterRole('')
            setPage(0)
            setUsers([])
            setFilterDept('')
            setLoading(true)
          }}
            className={`flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-bold transition-all md:px-4 md:text-sm ${
              subTab === key
                ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-200'
                : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
            }`}>
            <Icon size={15} />
            {label}
            {count != null && (
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${subTab === key ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-400'}`}>{count}</span>
            )}
          </button>
        ))}
        </div>
      </div>

      {/* การ์ดกลุ่ม "กอง/หน่วยงาน" (เฉพาะแท็บเจ้าหน้าที่) */}
      {subTab === 'staff' && (
        <div className="px-4 pt-4 md:px-5">
          <div className="mb-2.5 flex items-center justify-between">
            <div>
              <p className="text-xs font-extrabold text-slate-700">เลือกกอง / หน่วยงาน</p>
              <p className="text-[10px] text-slate-400">กรองรายชื่อจากโครงสร้างหน่วยงานจริง</p>
            </div>
            {filterDept && <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[10px] font-bold text-blue-600">กำลังกรอง</span>}
          </div>
          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-4">
          {deptCards.map(c => {
            const isActive = filterDept === c.value
            return (
              <button
                key={c.value}
                type="button"
                onClick={() => { setFilterDept(prev => prev === c.value ? '' : c.value); setPage(0) }}
                className="group relative flex min-h-[72px] items-center gap-3 overflow-hidden rounded-2xl border px-3 py-3 text-left transition-all hover:-translate-y-0.5 hover:shadow-md active:scale-[0.98]"
                style={{
                  borderColor: isActive ? c.palette.color : c.palette.border,
                  background: isActive ? c.palette.soft : '#ffffff',
                  boxShadow: isActive ? `0 8px 24px ${c.palette.color}22` : undefined,
                }}
              >
                <span className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: c.palette.color }} />
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-transform group-hover:scale-105"
                  style={{ backgroundColor: isActive ? c.palette.color : c.palette.soft, color: isActive ? '#fff' : c.palette.color }}>
                  <Briefcase size={17} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-extrabold leading-snug text-slate-800">{c.label}</span>
                  <span className="mt-1 block truncate text-[9px] font-medium text-slate-400">{c.shortName || 'หน่วยงานภายใน'}</span>
                </span>
                <span className="min-w-7 shrink-0 rounded-full px-2 py-1 text-center text-[11px] font-black"
                  style={{ backgroundColor: isActive ? c.palette.color : c.palette.soft, color: isActive ? '#fff' : c.palette.color }}>
                  {c.count}
                </span>
              </button>
            )
          })}
          </div>
        </div>
      )}

      {/* ตัวกรอง */}
      <div className="mx-4 my-4 flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-slate-50/80 p-2.5 md:mx-5">
        <div className="relative w-full md:flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-blue-500" />
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(0)
            }}
            placeholder={subTab === 'citizen' ? 'ค้นหาชื่อ, เบอร์โทร, เลขบัตร (ไม่บังคับ)...' : 'ค้นหาชื่อ, อีเมล, เบอร์...'}
            className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
          />
        </div>
        {subTab === 'staff' && (
        <select
          value={filterRole}
          onChange={(e) => { setFilterRole(e.target.value); setPage(0) }}
          aria-label="กรองตามบทบาทและสิทธิ์ระบบ"
          title="บทบาทและสิทธิ์ระบบ"
          className="w-full shrink-0 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold text-slate-600 shadow-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100 md:w-auto md:py-2"
        >
          <option value="">บทบาททั้งหมด</option>
          {[
            'staff', 'viewer', 'council', 'officer', 'technician', 'admin',
            ...(currentUserRole === 'superadmin' ? ['superadmin'] : []),
          ].map((role) => <option key={role} value={role}>บทบาท: {ROLE_LABELS[role].label}</option>)}
        </select>
        )}
        {(search || filterRole || filterDept) && (
          <button
            onClick={() => {
              setSearch('')
              setFilterRole('')
              setFilterDept('')
              setPage(0)
            }}
            className="flex shrink-0 items-center gap-1 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-500 transition-colors hover:bg-rose-100"
          >
            <X size={12} /> ล้าง
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-slate-400">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
            <Loader2 size={22} className="animate-spin" />
          </span>
          <p className="text-xs font-medium">กำลังเรียกข้อมูลบุคลากร...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="mx-4 mb-5 flex flex-col items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-gradient-to-b from-slate-50 to-white px-5 py-12 text-center md:mx-5">
          <span className="mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br from-blue-100 to-violet-100 text-blue-600 shadow-inner">
            <UserCircle2 size={30} strokeWidth={1.7} />
          </span>
          <p className="text-sm font-extrabold text-slate-700">
            {users.length === 0
              ? (subTab === 'citizen' ? 'ยังไม่มีประชาชนสมัครใช้งาน' : 'ยังไม่มีรายชื่อเจ้าหน้าที่')
              : 'ไม่พบผู้ใช้ที่ค้นหา'}
          </p>
          <p className="mt-1 max-w-sm text-xs leading-relaxed text-slate-400">
            {users.length === 0
              ? 'ข้อมูลจะแสดงเมื่อมีบัญชีที่เชื่อมกับหน่วยงานนี้'
              : 'ลองเปลี่ยนคำค้นหา บทบาท หรือกองที่เลือก'}
          </p>
          {(search || filterRole || filterDept) && (
            <button onClick={() => { setSearch(''); setFilterRole(''); setFilterDept(''); setPage(0) }}
              className="mt-4 rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-blue-700">
              แสดงรายการทั้งหมด
            </button>
          )}
        </div>
      ) : (
        <>
        <div className="space-y-2.5 px-3 pb-4 md:hidden">
          {filtered.map((u, i) => {
            const rs = ROLE_LABELS[u.role] ?? ROLE_LABELS.citizen
            const canManage = canManageUser(currentUserRole, currentUserId, u)
            return (
              <div key={u.id} className="relative flex cursor-pointer flex-col gap-2 overflow-hidden rounded-2xl border border-slate-200 bg-white px-3.5 py-3 shadow-sm transition-all hover:border-blue-200 hover:shadow-md"
                onClick={(e) => { if (e.target.closest('button, select, input, a, label')) return; setViewingUserId(u.id) }}>
                <span className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: rs.color }} />
                {/* แถว 1: avatar + ชื่อ + badge */}
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-400 font-mono w-5 text-right shrink-0">{i + 1}</span>
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-sm font-black text-white shadow-sm"
                       style={{ background: `linear-gradient(135deg, ${rs.color}, ${rs.color}bb)` }}>
                    {(u.full_name || u.email || '?')[0].toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="font-medium text-gray-800 text-sm">
                        {u.full_name || '—'}
                        {u.staff_title && <span className="text-gray-400 font-normal"> ({u.staff_title})</span>}
                      </p>
                    </div>
                    <p className="text-xs text-gray-400 break-all mt-0.5">{u.email || '—'}</p>
                    {u.phone && <p className="text-xs text-gray-500 mt-0.5">📞 {u.phone}</p>}
                    {u.id_card && (
                      <p className="text-xs font-mono text-gray-400 mt-0.5">
                        🪪 {u.id_card.replace(/(\d{1})(\d{4})(\d{5})(\d{2})(\d{1})/, '$1-$2-$3-$4-$5')}
                      </p>
                    )}
                    {canManage && (
                      <div className="flex items-center gap-1 mt-0.5">
                        <p className="text-xs text-gray-400">
                          {u.address || <span className="italic text-gray-300">ยังไม่ระบุที่อยู่</span>}
                        </p>
                      </div>
                    )}
                  </div>
                  <span className="shrink-0 rounded-full px-2 py-1 text-[10px] font-bold"
                        style={{ backgroundColor: rs.bg, color: rs.color }}>
                    {rs.label}
                  </span>
                </div>
                {subTab === 'staff' && (
                  <div className="ml-[60px] mt-1 flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 px-2.5 py-2">
                    <span className="text-xs font-semibold text-slate-600">{u.department_name || 'ไม่ระบุกอง'}</span>
                    {u.is_dept_head && <span className="text-[11px] font-semibold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">หัวหน้ากอง</span>}
                    <span className="text-xs text-gray-400">
                      {u.position_name || <span className="italic text-gray-300">ไม่ระบุตำแหน่งในทำเนียบ</span>}
                    </span>
                  </div>
                )}
                <div className="ml-[60px] mt-1">
                  <ProviderChips user={u} compact />
                </div>
                <div className="ml-[60px] mt-1 flex items-center gap-2">
                  <button onClick={() => setViewingUserId(u.id)} className="rounded-lg bg-blue-50 px-2.5 py-1.5 text-xs font-bold text-blue-600 transition-colors hover:bg-blue-100 hover:text-blue-700">
                    {canManage ? 'แต่งตั้ง / แก้ไขข้อมูล' : 'ดูรายละเอียด'}
                  </button>
                  {canManage && subTab === 'staff' && (
                    <button
                      onClick={() => setHandoverStaff(u)}
                      className="p-1.5 rounded text-gray-300 hover:text-orange-500 hover:bg-orange-50 transition-colors"
                      title="โอนงาน"
                    >
                      <Repeat size={13} />
                    </button>
                  )}
                  {canManage && (
                    <button
                      onClick={() => setDeletingUser(u)}
                      className="p-1.5 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                      title="ลบผู้ใช้งาน"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
                {editingNameId === u.id && (
                  <div className="flex items-center gap-2 pl-12">
                    <input
                      autoFocus
                      value={editingNameValue}
                      onChange={(e) => setEditingNameValue(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') updateName(u.id); if (e.key === 'Escape') setEditingNameId(null) }}
                      placeholder="ชื่อ-นามสกุล"
                      className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:border-blue-400 bg-white text-gray-900"
                    />
                    <button
                      onClick={() => updateName(u.id)}
                      disabled={saving === u.id}
                      className="text-xs bg-blue-500 text-white px-3 py-1.5 rounded-lg font-medium disabled:opacity-50"
                    >
                      บันทึก
                    </button>
                    <button
                      onClick={() => setEditingNameId(null)}
                      className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1.5"
                    >
                      ยกเลิก
                    </button>
                  </div>
                )}
                {editingAddressId === u.id && (
                  <div className="flex items-center gap-2 pl-12">
                    <input
                      autoFocus
                      value={editingAddressValue}
                      onChange={(e) => setEditingAddressValue(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') updateAddress(u.id); if (e.key === 'Escape') setEditingAddressId(null) }}
                      placeholder="ที่อยู่"
                      className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:border-blue-400 bg-white text-gray-900"
                    />
                    <button
                      onClick={() => updateAddress(u.id)}
                      disabled={saving === u.id}
                      className="text-xs bg-blue-500 text-white px-3 py-1.5 rounded-lg font-medium disabled:opacity-50"
                    >
                      บันทึก
                    </button>
                    <button
                      onClick={() => setEditingAddressId(null)}
                      className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1.5"
                    >
                      ยกเลิก
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
        
        <div className="mx-5 mb-5 hidden overflow-hidden rounded-2xl border border-slate-200 md:block">
          <div className="overflow-x-auto">
          <table className="w-full text-sm text-left text-gray-600 table-fixed border-collapse">
            <thead>
              <tr className="bg-gradient-to-r from-slate-900 via-blue-950 to-indigo-900">
                <UserSortHeader label="ลำดับ" sortKey="created_at" sortConfig={sortConfig} onSort={handleSort} className="w-[5%] text-[11px]" />
                <UserSortHeader label="ชื่อ-นามสกุล" sortKey="full_name" sortConfig={sortConfig} onSort={handleSort} className="w-[22%] text-[13px]" />
                <UserSortHeader label="อีเมล" sortKey="email" sortConfig={sortConfig} onSort={handleSort} className="w-[22%] text-[11px]" />
                <UserSortHeader label="เชื่อมต่อบัญชี" sortKey="providers" sortConfig={sortConfig} onSort={handleSort} className="w-[13%] text-[11px]" />
                <UserSortHeader label="บทบาท/สิทธิ์" sortKey="role" sortConfig={sortConfig} onSort={handleSort} className="w-[15%] text-[13px]" />
                <UserSortHeader label="สังกัดและตำแหน่ง" sortKey="assignment" sortConfig={sortConfig} onSort={handleSort} className="w-[23%] border-r-0 text-[11px]" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {filtered.map((u, i) => {
                const rs = ROLE_LABELS[u.role] ?? ROLE_LABELS.citizen
                return (
                  <tr key={u.id}
                    className="cursor-pointer transition-colors hover:bg-blue-50/80"
                    style={{ backgroundColor: i % 2 === 0 ? '#fff' : '#f8fafc' }}
                    onClick={(e) => { if (e.target.closest('button, select, input, a, label')) return; setViewingUserId(u.id) }}>
                    <td className="px-2 py-3 text-xs text-gray-400 font-mono border-r border-gray-200">{page * pageSize + i + 1}</td>
                    <td className="px-2 py-3 border-r border-gray-200">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="flex flex-col min-w-0">
                          {editingNameId === u.id ? (
                            <div className="flex items-center gap-2">
                              <input
                                autoFocus
                                value={editingNameValue}
                                onChange={(e) => setEditingNameValue(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') updateName(u.id); if (e.key === 'Escape') setEditingNameId(null) }}
                                placeholder="ชื่อ-นามสกุล"
                                className="flex-1 text-sm border border-gray-200 rounded px-2 py-1 focus:outline-none focus:border-blue-400 bg-white text-gray-900"
                              />
                              <button onClick={() => updateName(u.id)} disabled={saving === u.id} className="text-xs text-blue-600 font-medium">บันทึก</button>
                              <button onClick={() => setEditingNameId(null)} className="text-xs text-gray-400">ยกเลิก</button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="font-medium text-gray-800 truncate">{u.full_name || '—'}</span>
                              {u.staff_title && <span className="text-xs text-gray-400 shrink-0">({u.staff_title})</span>}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    {/* อีเมล */}
                    <td className="px-2 py-3 overflow-hidden border-r border-gray-200">
                      <span className="text-xs text-gray-600 break-all">{u.email || <span className="italic text-gray-300">ยังไม่ระบุ</span>}</span>
                    </td>
                    {/* เชื่อมต่อบัญชี: มาจาก auth.identities ผ่าน RPC ดูรายละเอียดเพิ่มในแท็บ "ข้อมูลบัญชี" */}
                    <td className="px-2 py-3 overflow-hidden border-r border-gray-200">
                      <ProviderChips user={u} compact />
                    </td>
                    {/* บทบาท/สิทธิ์: role badge เท่านั้น */}
                    <td className="px-2 py-3 overflow-hidden border-r border-gray-200">
                      <span className="text-[10px] font-medium px-2 py-0.5 rounded-full inline-block" style={{ backgroundColor: rs.bg, color: rs.color }}>
                        {rs.label}
                      </span>
                    </td>
                    {/* สังกัดและตำแหน่งเป็นข้อมูลสรุป การแต่งตั้ง/แก้สิทธิ์ทำในหน้ารายละเอียดเพียงจุดเดียว */}
                    <td className="px-2 py-3 overflow-hidden border-r border-gray-200">
                      {subTab === 'staff' ? (
                        <div className="flex flex-col items-start gap-1 w-full">
                          <span className="text-[11px] text-gray-500 truncate">{u.department_name || 'ไม่ระบุกอง'}</span>
                          {u.is_dept_head && <span className="text-[10px] font-semibold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded-full">หัวหน้ากอง</span>}
                          <span className="text-[11px] text-gray-400 truncate">{u.position_name || 'ไม่ระบุตำแหน่งในทำเนียบ'}</span>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          </div>
        </div>
      </>
      )}

      {!loading && users.length > 0 && (() => {
        // มี count ที่แม่นยำ (จาก get_user_role_counts) เฉพาะตอนไม่มีตัวกรองแคบผลลัพธ์ลง —
        // ถ้ากรองอยู่ ไม่รู้จำนวนจริงหลังกรอง เลยใช้ heuristic "ได้ครบหน้าพอดีไหม" แทนแค่เปิด/ปิดปุ่มถัดไป
        const filtersActive = Boolean(search.trim() || filterRole || (subTab === 'staff' && filterDept))
        const tabTotal = subTab === 'citizen' ? citizenCount : staffCount
        const totalPages = !filtersActive && tabTotal != null ? Math.max(1, Math.ceil(tabTotal / pageSize)) : null
        const canGoNext = totalPages != null ? page + 1 < totalPages : users.length === pageSize
        return (
          <div className="px-4 py-3 border-t border-gray-100 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <span>แสดง</span>
              <select value={pageSize}
                onChange={e => { setPageSize(Number(e.target.value)); setPage(0) }}
                className="bg-white border border-gray-200 rounded-lg px-2 py-1 text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-200">
                {[10, 20, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
              <span>รายการ · หน้า {page + 1}{totalPages != null ? ` / ${totalPages}` : ''}</span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-500 disabled:opacity-40"
              >
                ก่อนหน้า
              </button>
              <button
                onClick={() => setPage(p => p + 1)}
                disabled={!canGoNext}
                className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-500 disabled:opacity-40"
              >
                ถัดไป
              </button>
            </div>
          </div>
        )
      })()}

      </section>
      <DeleteUserConfirmModal
        deletingUser={deletingUser} setDeletingUser={setDeletingUser} deleteLoading={deleteLoading} deleteUser={deleteUser}
        deleteBlockedReason={deleteBlockedReason}
        onOpenHandover={(u) => { setHandoverStaff(u); setDeletingUser(null); setDeleteBlockedReason('') }}
        onClose={() => { setDeletingUser(null); setDeleteBlockedReason('') }}
      />
      {handoverStaff && (
        <HandoverWorkloadModal oldStaff={handoverStaff} tenant={tenant} onClose={() => setHandoverStaff(null)} />
      )}

    </div>
  )
}

// ─── User Detail Page (แท็บ, ต่อเพิ่มได้เรื่อยๆ แค่เพิ่ม entry ใน USER_DETAIL_TABS) ─────

// ใช้ร่วมกันทั้งจากตารางและหน้ารายละเอียด กันเขียนซ้ำ
// deleteBlockedReason มาจาก guard ฝั่ง DB (delete_user_by_id, 20260827100000) เมื่อผู้ใช้นี้ยังเป็น
// ผู้รับผิดชอบเริ่มต้นของหมวดคำร้อง หรือยังมีคำร้องที่เปิดอยู่ — สลับปุ่มยืนยันลบเป็นทางลัดไปหน้าโอนงานแทน
function DeleteUserConfirmModal({ deletingUser, deleteLoading, deleteUser, deleteBlockedReason, onOpenHandover, onClose }) {
  if (!deletingUser) return null
  const blocked = !!deleteBlockedReason
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4" onClick={() => !deleteLoading && onClose()}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-col items-center text-center gap-3">
          <div className={`w-14 h-14 rounded-full flex items-center justify-center ${blocked ? 'bg-orange-100' : 'bg-red-100'}`}>
            {blocked ? <Repeat size={24} className="text-orange-500" /> : <Trash2 size={24} className="text-red-500" />}
          </div>
          <h3 className="text-lg font-semibold text-gray-800">
            {blocked ? 'ยังลบไม่ได้ — มีงานค้างอยู่' : 'ยืนยันการลบผู้ใช้งาน'}
          </h3>
          {blocked ? (
            <p className="text-sm text-orange-700 bg-orange-50 border border-orange-100 rounded-xl px-3 py-2 leading-relaxed text-left">
              {deleteBlockedReason}
            </p>
          ) : (
            <p className="text-sm text-gray-500 leading-relaxed">
              คุณกำลังจะลบ <strong className="text-gray-800">{deletingUser.full_name || deletingUser.email || 'ผู้ใช้นี้'}</strong> ออกจากระบบถาวร<br />
              ข้อมูลทั้งหมดจะหายไปและไม่สามารถกู้คืนได้
            </p>
          )}
          <div className="flex gap-3 w-full mt-2">
            <button
              onClick={onClose}
              disabled={deleteLoading}
              className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              ยกเลิก
            </button>
            {blocked ? (
              <button
                onClick={() => onOpenHandover(deletingUser)}
                className="flex-1 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium transition-colors flex items-center justify-center gap-2"
              >
                <Repeat size={15} /> โอนงานก่อนแล้วค่อยลบ
              </button>
            ) : (
              <button
                onClick={() => deleteUser(deletingUser.id)}
                disabled={deleteLoading}
                className="flex-1 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {deleteLoading ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                {deleteLoading ? 'กำลังลบ...' : 'ลบออกจากระบบ'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// โอนงานทั้งหมด (ผู้รับผิดชอบเริ่มต้นของหมวดคำร้อง + คำร้องที่ยังเปิดอยู่) จาก oldStaff ไปเจ้าหน้าที่คนใหม่
// ในคลิกเดียว ผ่าน RPC reassign_staff_workload (20260827110000) — ใช้ก่อนลบบัญชีที่ถูก guard บล็อกไว้
// หรือกดเองล่วงหน้าตอนรู้ว่าจะมีคนย้าย/พ้นตำแหน่งก็ได้ ไม่ต้องรอให้ลบไม่ผ่านก่อน
function HandoverWorkloadModal({ oldStaff, tenant, onClose }) {
  const [techs, setTechs] = useState([])
  const [newStaffId, setNewStaffId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

  useEffect(() => {
    if (!tenant?.id) return
    fetchAssignableStaff(tenant.id).then((rows) => setTechs(rows.filter((t) => t.id !== oldStaff.id)))
  }, [tenant?.id, oldStaff.id])

  const techGroups = groupStaffByDepartment(techs)

  async function confirm() {
    if (!newStaffId) return
    setBusy(true)
    setError('')
    const { data, error: rpcError } = await supabase.rpc('reassign_staff_workload', {
      p_old_staff_id: oldStaff.id,
      p_new_staff_id: newStaffId,
      p_category: null,
      p_municipality_id: tenant?.id,
    })
    setBusy(false)
    if (rpcError) {
      setError(rpcError.message)
    } else {
      setResult(data)
    }
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4" onClick={() => !busy && onClose()}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
        {result ? (
          <div className="flex flex-col items-center text-center gap-3">
            <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center">
              <Check size={24} className="text-green-500" />
            </div>
            <h3 className="text-lg font-semibold text-gray-800">โอนงานสำเร็จ</h3>
            <p className="text-sm text-gray-500 leading-relaxed">
              อัปเดตหมวดคำร้องเริ่มต้น {result.category_assignments_updated} รายการ<br />
              โอนคำร้องที่เปิดอยู่ {result.complaints_updated} รายการ
            </p>
            <button onClick={onClose} className="w-full py-2.5 rounded-xl bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium transition-colors">
              เสร็จสิ้น
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center text-center gap-3">
            <div className="w-14 h-14 rounded-full bg-orange-100 flex items-center justify-center">
              <Repeat size={24} className="text-orange-500" />
            </div>
            <h3 className="text-lg font-semibold text-gray-800">โอนงาน</h3>
            <p className="text-sm text-gray-500 leading-relaxed">
              โอนงานทั้งหมดของ <strong className="text-gray-800">{oldStaff.full_name || oldStaff.email || 'ผู้ใช้นี้'}</strong> ให้เจ้าหน้าที่คนใหม่
              — ครอบคลุมทั้งหมวดคำร้องที่ตั้งเป็นผู้รับผิดชอบเริ่มต้น และคำร้องที่ยังเปิดอยู่ (คำร้องที่ปิด/รับทราบแล้วจะไม่ถูกแตะ เพื่อรักษาประวัติ)
            </p>
            <select
              value={newStaffId}
              onChange={(e) => setNewStaffId(e.target.value)}
              disabled={busy}
              className="w-full text-sm border border-orange-200 rounded-xl px-3 py-2 bg-white text-gray-700 focus:outline-none"
            >
              <option value="">— เลือกผู้รับโอนงาน —</option>
              {techGroups.map((g) => (
                <optgroup key={g.department_name} label={g.department_name}>
                  {g.members.map((t) => (
                    <option key={t.id} value={t.id}>
                      {(t.full_name || t.email) + (t.is_dept_head ? ' ⭐' : '')} · {ROLE_LABELS[t.role]?.label ?? t.role}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            {error && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 w-full text-left">{error}</p>
            )}
            <div className="flex gap-3 w-full mt-1">
              <button
                onClick={onClose}
                disabled={busy}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                ยกเลิก
              </button>
              <button
                onClick={confirm}
                disabled={busy || !newStaffId}
                className="flex-1 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {busy ? <Loader2 size={15} className="animate-spin" /> : <Repeat size={15} />}
                {busy ? 'กำลังโอนงาน...' : 'ยืนยันโอนงาน'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ป้ายไทยของ key ใน rows_to_move ที่ merge_duplicate_profile คืนมา — โชว์เฉพาะ key ที่ > 0 เท่านั้น
// (ปกติ 41 key แต่ส่วนใหญ่เป็น 0) key ที่ไม่มีในนี้ตกไป fallback เป็นชื่อดิบ ไม่ต้องไล่เพิ่มทุกครั้ง
// ที่ DB เพิ่มตาราง — แค่อ่านยากขึ้นนิดเดียว ไม่ใช่บั๊ก
const MERGE_ROW_LABELS = {
  complaints_user_id: 'เรื่องร้องเรียนที่แจ้งไว้',
  complaints_assigned_to: 'เรื่องร้องเรียนที่รับผิดชอบ',
  category_assignments_technician_id: 'หมวดคำร้องที่เป็นผู้รับผิดชอบเริ่มต้น',
  document_requests_user_id: 'คำร้องขอเอกสารที่ยื่นไว้',
  document_requests_assigned_to: 'คำร้องขอเอกสารที่รับผิดชอบ',
  documents_uploaded_by: 'เอกสารที่อัปโหลด',
  drive_files_owner_user_id: 'ไฟล์แนบบน Google Drive',
  events_created_by: 'กิจกรรมที่สร้าง',
  posts_created_by: 'ข่าวประชาสัมพันธ์ที่สร้าง',
  push_subscriptions_user_id: 'อุปกรณ์ที่รับการแจ้งเตือน',
  satisfaction_responses_user_id: 'แบบประเมินความพึงพอใจที่ตอบ',
  business_registrations_user_id: 'คำขอจดทะเบียนพาณิชย์',
  tourism_reviews_user_id: 'รีวิวแหล่งท่องเที่ยว',
}

// รวมบัญชีซ้ำ: คนเดียวสมัคร 2 ครั้งด้วยคนละช่องทาง (เจอบ่อยกับ LINE เพราะ LINE ไม่ส่งอีเมลมาให้
// Supabase จึงเชื่อมเข้าบัญชีเดิมอัตโนมัติไม่ได้ ต้องมาเชื่อมทีหลังด้วยมือ)
// keepUser = บัญชีที่เปิดหน้ารายละเอียดอยู่ (ตรึงไว้ ไม่ให้เลือกสลับ) — บัญชีที่เลือกในโมดัลคือบัญชีที่จะ
// ถูกยุบและลบทิ้ง ทิศทางกลับกันไม่ได้ จึงบังคับให้กด "ตรวจสอบก่อนรวม" (dry run ฝั่ง DB) ดูจำนวนแถวจริง
// ก่อนเสมอ ปุ่มยืนยันจะ enable ก็ต่อเมื่อ preview ตรงกับบัญชีที่เลือกอยู่จริง
function MergeDuplicateModal({ keepUser, tenant, currentUserRole, currentUserId, onClose, onMerged }) {
  const [search, setSearch] = useState(keepUser.full_name || '')
  const [candidates, setCandidates] = useState([])
  // เริ่มที่ true เพราะ effect ด้านล่างยิงค้นหาทันทีตอนเปิดโมดัล (ด้วยชื่อของบัญชีที่เก็บไว้)
  const [searching, setSearching] = useState(true)
  const [mergeId, setMergeId] = useState('')
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(null)

  useEffect(() => {
    if (!tenant?.id) return
    let cancelled = false
    const t = setTimeout(async () => {
      setSearching(true)
      const { data, error: rpcError } = await supabase.rpc('get_users_with_email', {
        p_municipality_id: tenant.id,
        p_roles: [...NON_CITIZEN_ROLES, 'citizen'],
        p_search: search.trim() || null,
        p_limit: 50,
        p_offset: 0,
      })
      if (cancelled) return
      setSearching(false)
      if (rpcError) { setError(rpcError.message); return }
      // ยุบได้เฉพาะบัญชีที่สิทธิ์ของผู้ใช้ปัจจุบันจัดการได้จริง (กติกาเดียวกับปุ่มลบ) — ฝั่ง DB
      // ก็ตรวจซ้ำอีกชั้น ตรงนี้แค่ไม่ให้เลือกสิ่งที่จะโดนปฏิเสธอยู่ดี
      setCandidates((data ?? []).filter((u) => canManageUser(currentUserRole, currentUserId, u) && u.id !== keepUser.id))
    }, search.trim() ? 400 : 0)
    return () => { cancelled = true; clearTimeout(t) }
  }, [search, tenant?.id, currentUserRole, currentUserId, keepUser.id])

  const selected = candidates.find((u) => u.id === mergeId) ?? null
  const previewMatches = preview && preview.merge_id === mergeId

  async function runPreview() {
    setBusy(true); setError(''); setPreview(null)
    const { data, error: rpcError } = await supabase.rpc('merge_duplicate_profile', {
      p_keep_id: keepUser.id, p_merge_id: mergeId, p_dry_run: true,
    })
    setBusy(false)
    if (rpcError) setError(rpcError.message)
    else setPreview(data)
  }

  async function confirmMerge() {
    setBusy(true); setError('')
    const { data, error: rpcError } = await supabase.rpc('merge_duplicate_profile', {
      p_keep_id: keepUser.id, p_merge_id: mergeId, p_dry_run: false,
    })
    setBusy(false)
    if (rpcError) setError(rpcError.message)
    else setDone(data)
  }

  const movedRows = previewMatches
    ? Object.entries(preview.rows_to_move ?? {}).filter(([, v]) => Number(v) > 0)
    : []
  const conflict = previewMatches ? (preview.identity_provider_conflict ?? null) : null

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4" onClick={() => !busy && onClose()}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        {done ? (
          <div className="flex flex-col items-center text-center gap-3">
            <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center">
              <Check size={24} className="text-green-500" />
            </div>
            <h3 className="text-lg font-semibold text-gray-800">รวมบัญชีสำเร็จ</h3>
            <p className="text-sm text-gray-500 leading-relaxed">
              ข้อมูลทั้งหมดย้ายมาอยู่ที่บัญชีของ <strong className="text-gray-800">{keepUser.full_name || keepUser.email}</strong> แล้ว
              และเจ้าตัวจะ login ด้วยช่องทางไหนก็เข้าบัญชีเดียวกันนี้
            </p>
            <button onClick={() => onMerged(done.deleted)} className="w-full py-2.5 rounded-xl bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium transition-colors">
              เสร็จสิ้น
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-full bg-violet-100 flex items-center justify-center shrink-0">
                <Users size={22} className="text-violet-500" />
              </div>
              <div className="min-w-0">
                <h3 className="text-lg font-semibold text-gray-800">รวมบัญชีซ้ำ</h3>
                <p className="text-xs text-gray-400">ใช้เมื่อคนเดียวสมัครไว้หลายบัญชีคนละช่องทาง</p>
              </div>
            </div>

            <div className="rounded-xl border border-green-100 bg-green-50 px-3 py-2.5">
              <p className="text-[11px] font-semibold text-green-700 mb-1">บัญชีที่เก็บไว้ (ข้อมูลทั้งหมดจะมารวมที่นี่)</p>
              <p className="text-sm font-medium text-gray-800 truncate">{keepUser.full_name || keepUser.email || '—'}</p>
              <div className="mt-1"><ProviderChips user={keepUser} compact /></div>
            </div>

            <div className="rounded-xl border border-red-100 bg-red-50 px-3 py-2.5">
              <p className="text-[11px] font-semibold text-red-700 mb-1.5">บัญชีที่จะยุบ (จะถูกลบทิ้งหลังย้ายข้อมูลแล้ว)</p>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                disabled={busy}
                placeholder="ค้นหาชื่อ / อีเมล / เบอร์โทร"
                className="w-full text-sm border border-red-200 rounded-lg px-3 py-2 mb-2 bg-white text-gray-700 focus:outline-none"
              />
              <select
                value={mergeId}
                onChange={(e) => { setMergeId(e.target.value); setPreview(null); setError('') }}
                disabled={busy}
                className="w-full text-sm border border-red-200 rounded-lg px-3 py-2 bg-white text-gray-700 focus:outline-none"
              >
                <option value="">{searching ? '— กำลังค้นหา... —' : `— เลือกบัญชีที่จะยุบ (${candidates.length}) —`}</option>
                {candidates.map((u) => (
                  <option key={u.id} value={u.id}>
                    {(u.full_name || '(ไม่มีชื่อ)')} · {u.email || 'ไม่มีอีเมล'} · {ROLE_LABELS[u.role]?.label ?? u.role}
                  </option>
                ))}
              </select>
              {selected && <div className="mt-2"><ProviderChips user={selected} compact /></div>}
            </div>

            {previewMatches && (
              <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-xs text-gray-600 space-y-1.5">
                <p className="font-semibold text-gray-700">ผลตรวจสอบก่อนรวม</p>
                {conflict?.length ? (
                  <p className="text-red-600">
                    ทั้งสองบัญชีมีช่องทาง login ซ้ำกัน ({conflict.join(', ')}) — รวมอัตโนมัติไม่ได้
                    เพราะระบบเลือกแทนไม่ได้ว่าจะเก็บอันไหน
                  </p>
                ) : (
                  <p className="text-green-700">ช่องทาง login ไม่ชนกัน — ย้ายมารวมได้</p>
                )}
                {movedRows.length === 0 ? (
                  <p>บัญชีที่จะยุบยังไม่มีข้อมูลผูกอยู่เลย — ยุบได้ทันที ไม่มีอะไรสูญหาย</p>
                ) : (
                  <ul className="space-y-0.5">
                    {movedRows.map(([k, v]) => (
                      <li key={k}>• {MERGE_ROW_LABELS[k] ?? k} <strong className="text-gray-800">{v}</strong> รายการ</li>
                    ))}
                  </ul>
                )}
                <p className="text-gray-400">ประวัติในบันทึกการใช้งาน (audit log) จะยังคงชื่อผู้กระทำเดิมไว้ ไม่ถูกแก้ย้อนหลัง</p>
              </div>
            )}

            {error && <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>}

            <div className="flex gap-3 mt-1">
              <button onClick={onClose} disabled={busy} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50">
                ยกเลิก
              </button>
              {previewMatches && !conflict?.length ? (
                <button
                  onClick={confirmMerge}
                  disabled={busy}
                  className="flex-1 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {busy ? <Loader2 size={15} className="animate-spin" /> : <Users size={15} />}
                  {busy ? 'กำลังรวม...' : 'ยืนยันรวมบัญชี'}
                </button>
              ) : (
                <button
                  onClick={runPreview}
                  disabled={busy || !mergeId}
                  className="flex-1 py-2.5 rounded-xl bg-gray-700 hover:bg-gray-800 text-white text-sm font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {busy ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
                  {busy ? 'กำลังตรวจสอบ...' : 'ตรวจสอบก่อนรวม'}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function AccountInfoTab(props) {
  const { user, isEditing, draft, setDraft } = props

  // บัญชีที่สมัครด้วย LINE จะไม่มีอีเมลติดมาเลย ถ้า channel ยังไม่ได้รับอนุมัติสิทธิ์ขอ email
  // จาก LINE (ของโปรเจกต์นี้เป็นแบบนั้น) บัญชีพวกนี้จึงล็อกอินด้วยรหัสผ่านไม่ได้ ไม่มีชื่อผู้ใช้
  // ให้พิมพ์ และเจ้าหน้าที่ก็ตั้งรหัสผ่านชั่วคราวให้แล้วก็ยังใช้ไม่ได้อยู่ดี
  //
  // ทางแก้ไม่ใช่ไปขออีเมลจากประชาชน (กลุ่มผู้ใช้หลักคือผู้สูงอายุที่ไม่มีอีเมลและไม่ควรต้องไปสมัคร)
  // แต่ใช้ "เบอร์โทร" เป็นชื่อผู้ใช้แทน ซึ่งเป็นกลไกที่ระบบนี้ใช้อยู่แล้วกับคนที่สมัครด้วยเบอร์
  // (phoneToLoginEmail แปลงเป็นอีเมลปลอมที่ไม่ต้องมีกล่องจดหมายจริง)
  //
  // การเซ็ตอีเมลผ่าน admin-update-login-email ปลอดภัยกับบัญชี OAuth: GoTrue ฝั่ง adminUserUpdate
  // สร้างแถว identity ของ provider 'email' ให้เองเมื่อยังไม่มี และ identity ของ LINE เดิมไม่ถูกแตะ
  // เจ้าตัวจึงยังกดปุ่ม LINE เข้าได้เหมือนเดิม ได้ทางเข้าเพิ่มมาอีกทางโดยไม่เสียทางเดิม
  const loginPhone = normalizeThaiPhone(draft?.phone ?? user.phone ?? '')
  const canUsePhoneAsLogin = !user.email && /^0\d{8,9}$/.test(loginPhone)

  return (
    <div className="space-y-5">
      <PersonalInfoField
        label="อีเมล (ใช้ login)"
        isEditing={isEditing}
        displayValue={user.email}
        editValue={draft?.email ?? ''}
        placeholder="name@gmail.com"
        onChange={(e) => setDraft(d => ({ ...d, email: e.target.value }))}
      />

      {!user.email && (
        <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 leading-relaxed">
          <p className="font-semibold mb-1">บัญชีนี้ยังล็อกอินด้วยรหัสผ่านไม่ได้</p>
          ไม่มีชื่อผู้ใช้ให้พิมพ์คู่กับรหัสผ่าน ถ้าวันหนึ่งเจ้าตัวเข้า LINE ไม่ได้ จะกู้บัญชีไม่ได้เลย
          {canUsePhoneAsLogin ? (
            isEditing ? (
              <button
                type="button"
                onClick={() => setDraft(d => ({ ...d, email: phoneToLoginEmail(loginPhone) }))}
                className="mt-2 w-full py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold transition-colors"
              >
                ใช้เบอร์ {loginPhone} เป็นชื่อผู้ใช้
              </button>
            ) : (
              <p className="mt-1">กด &ldquo;แก้ไข&rdquo; แล้วจะมีปุ่มตั้งเบอร์ {loginPhone} เป็นชื่อผู้ใช้ให้</p>
            )
          ) : (
            <p className="mt-1">บัญชีนี้ยังไม่มีเบอร์โทรในระบบด้วย ต้องกรอกเบอร์ให้ก่อนจึงจะตั้งชื่อผู้ใช้ได้</p>
          )}
        </div>
      )}

      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">ช่องทางเชื่อมต่อบัญชี</p>
        <ProviderChips user={user} />
      </div>
      <div className="flex gap-6 text-xs text-gray-400 border-t border-gray-100 pt-4">
        <div>
          <span className="block text-gray-300 mb-0.5">ลงทะเบียน</span>
          <span className="text-gray-500">
            {user.created_at ? new Date(user.created_at).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' }) : '—'}
          </span>
        </div>
        <div>
          <span className="block text-gray-300 mb-0.5">เข้าสู่ระบบล่าสุด</span>
          <span className="text-gray-500">
            {user.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
          </span>
        </div>
      </div>
    </div>
  )
}

function PersonalInfoField({ label, isEditing, displayValue, editValue, onChange, mono, placeholder, whitespacePre }) {
  return (
    <div>
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">{label}</p>
      {isEditing ? (
        <input
          value={editValue}
          onChange={onChange}
          placeholder={placeholder}
          className={`w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-400 bg-white text-gray-900 ${mono ? 'font-mono tracking-wide' : ''}`}
        />
      ) : (
        <p className={`text-sm text-gray-800 ${mono ? 'font-mono tracking-wide' : ''} ${whitespacePre ? 'whitespace-pre-wrap' : ''}`}>
          {displayValue || <span className="italic text-gray-300">—</span>}
        </p>
      )}
    </div>
  )
}

function formatStructuredAddress(u) {
  const parts = []
  if (u.address_detail) parts.push(u.address_detail)
  if (u.address_moo) parts.push(`หมู่ ${u.address_moo}`)
  if (u.address_subdistrict) parts.push(`ต.${u.address_subdistrict}`)
  if (u.address_district) parts.push(`อ.${u.address_district}`)
  if (u.address_province) parts.push(`จ.${u.address_province}`)
  return parts.join(' ') || null
}

function AddressField({ user, isEditing, draft, setDraft }) {
  if (!isEditing) {
    return (
      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">ที่อยู่</p>
        <p className="text-sm text-gray-800 whitespace-pre-wrap">
          {formatStructuredAddress(user) || user.address || <span className="italic text-gray-300">—</span>}
        </p>
      </div>
    )
  }
  const set = (key) => (e) => setDraft(d => ({ ...d, [key]: e.target.value }))
  return (
    <div>
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">ที่อยู่</p>
      <div className="grid grid-cols-2 gap-2 mb-2">
        <input value={draft.address_province} onChange={set('address_province')} placeholder="จังหวัด"
          className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-400 bg-white text-gray-900" />
        <input value={draft.address_district} onChange={set('address_district')} placeholder="อำเภอ"
          className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-400 bg-white text-gray-900" />
        <input value={draft.address_subdistrict} onChange={set('address_subdistrict')} placeholder="ตำบล"
          className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-400 bg-white text-gray-900" />
        <input value={draft.address_moo} onChange={(e) => setDraft(d => ({ ...d, address_moo: e.target.value.replace(/\D/g, '').slice(0, 2) }))} placeholder="หมู่ที่"
          className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-400 bg-white text-gray-900" />
      </div>
      <input value={draft.address_detail} onChange={set('address_detail')} placeholder="บ้านเลขที่ / รายละเอียดที่อยู่อื่นๆ"
        className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-400 bg-white text-gray-900" />
    </div>
  )
}

function PersonalInfoTab(props) {
  const { user, isEditing, draft, setDraft } = props
  // ชื่อที่ auto-fill มาจาก Google/LINE login ไม่มีคำนำหน้าไทยติดมาด้วย — เอกสาร/คำร้องที่พิมพ์
  // ใช้ full_name ตรงๆ ไม่มีคำนำหน้าก็จะไม่โชว์บนกระดาษ ใช้ตัวแยก/รวมเดียวกับ ProfilePage.jsx
  // (หน้าแก้โปรไฟล์ของประชาชนเอง) ให้แอดมินกรอกแยกช่องคำนำหน้า/ชื่อ/นามสกุล กันลืมใส่คำนำหน้า
  const nameParts = splitThaiFullName(draft?.full_name ?? '')
  function setNamePart(key, value) {
    const next = { ...nameParts, [key]: value }
    setDraft(d => ({ ...d, full_name: joinThaiFullName(next.title, next.first, next.last) }))
  }
  const missingTitle = !splitThaiFullName(user.full_name ?? '').title && !!(user.full_name ?? '').trim()
  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">ชื่อ-นามสกุล</p>
        {isEditing ? (
          <div className="flex gap-1.5">
            <select value={nameParts.title} onChange={(e) => setNamePart('title', e.target.value)}
              className="w-20 shrink-0 text-sm text-gray-900 bg-white border border-gray-200 rounded-lg px-2 py-2 focus:outline-none focus:border-blue-400">
              <option value="">เลือก</option>
              {NAME_TITLES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <input value={nameParts.first} onChange={(e) => setNamePart('first', e.target.value)} placeholder="ชื่อ"
              className="flex-1 min-w-0 text-sm text-gray-900 bg-white border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-400" />
            <input value={nameParts.last} onChange={(e) => setNamePart('last', e.target.value)} placeholder="นามสกุล"
              className="flex-1 min-w-0 text-sm text-gray-900 bg-white border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-400" />
          </div>
        ) : (
          <p className="text-sm text-gray-800">{user.full_name || <span className="italic text-gray-300">—</span>}</p>
        )}
        {!isEditing && missingTitle && (
          <p className="mt-1 text-xs font-semibold text-amber-600">⚠️ ยังไม่มีคำนำหน้า — จะไม่แสดงบนเอกสาร/คำร้องที่พิมพ์</p>
        )}
        {isEditing && !nameParts.title && (nameParts.first || nameParts.last) && (
          <p className="mt-1 text-xs font-semibold text-amber-600">⚠️ ยังไม่ได้เลือกคำนำหน้า</p>
        )}
      </div>
      <PersonalInfoField
        label="เบอร์โทรศัพท์"
        isEditing={isEditing}
        displayValue={user.phone}
        editValue={draft?.phone ?? ''}
        placeholder="0812345678"
        onChange={(e) => setDraft(d => ({ ...d, phone: e.target.value.replace(/\D/g, '').slice(0, 10) }))}
      />
      <PersonalInfoField
        label="เลขบัตรประชาชน"
        isEditing={isEditing}
        mono
        displayValue={user.id_card ? user.id_card.replace(/(\d{1})(\d{4})(\d{5})(\d{2})(\d{1})/, '$1-$2-$3-$4-$5') : null}
        editValue={draft?.id_card ?? ''}
        placeholder="1234567890123"
        onChange={(e) => setDraft(d => ({ ...d, id_card: e.target.value.replace(/\D/g, '').slice(0, 13) }))}
      />
      <AddressField user={user} isEditing={isEditing} draft={draft} setDraft={setDraft} />
    </div>
  )
}

function AppointmentTab({ user, depts, positions, currentUserRole, isEditing, draft, setDraft }) {
  const activeDeptId = isEditing ? draft.department_id : (user.department_id ?? '')
  const activePositionId = isEditing ? draft.position_id : (user.position_id ?? '')
  const selectedPosition = positions.find(position => position.id === activePositionId)

  function handlePositionChange(positionId) {
    const position = positions.find(item => item.id === positionId)
    const suggestedRole = position?.role
    const maySuggestRole = suggestedRole
      && suggestedRole !== draft.role
      && (!['admin', 'superadmin'].includes(suggestedRole) || currentUserRole === 'superadmin')
      && !['admin', 'superadmin'].includes(draft.role)

    // เดิม auto-apply บทบาทแนะนำเงียบๆ ทันทีที่เลือกตำแหน่ง (แค่มีข้อความเล็กๆ บอกไว้) ทำให้แอดมิน
    // ไม่ทันสังเกตว่า "บทบาทและสิทธิ์ระบบ" ที่แท็บอื่นถูกเปลี่ยนไปด้วย กว่าจะรู้ตัวก็หลังบันทึกไปแล้ว
    // เปลี่ยนเป็นต้องกดยืนยันก่อนเสมอ (แพทเทิร์นเดียวกับ HR-triggered provisioning ของระบบ IAM ทั่วไป
    // เช่น SAP GRC ที่ตำแหน่งใหม่ "เสนอ" สิทธิ์ได้ แต่ต้องผ่านขั้นตอนอนุมัติ ไม่ auto-apply ทันที)
    if (maySuggestRole) {
      const roleLabel = ROLE_LABELS[suggestedRole]?.label ?? suggestedRole
      const confirmed = confirm(
        `ตำแหน่ง "${position.name}" มักมีบทบาทและสิทธิ์ระบบเป็น "${roleLabel}"\n\n` +
        `ต้องการเปลี่ยนบทบาทและสิทธิ์ระบบตามคำแนะนำนี้ด้วยหรือไม่?\n` +
        `(เลือก "ยกเลิก" เพื่อคงบทบาทเดิมไว้ก่อน ไปปรับเองทีหลังได้ที่แท็บ "สิทธิ์การใช้งาน")`
      )
      setDraft(current => ({
        ...current,
        position_id: positionId,
        role: confirmed ? suggestedRole : current.role,
      }))
      return
    }

    setDraft(current => ({ ...current, position_id: positionId }))
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3">
        <p className="text-sm font-bold text-indigo-800">การแต่งตั้ง = ตำแหน่งในหน่วยงาน</p>
        <p className="mt-1 text-xs leading-5 text-indigo-600">
          ส่วนสิทธิ์การเข้าใช้งานแอป ย้ายไปแท็บ "สิทธิ์การใช้งาน" แล้ว — บันทึกครั้งเดียวรวมทุกแท็บ
        </p>
      </div>
      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">ตำแหน่ง (ทำเนียบกลาง)</p>
        {isEditing ? (
          <select value={draft.position_id} onChange={(e) => handlePositionChange(e.target.value)}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 text-gray-700 focus:outline-none bg-white">
            <option value="">— ยังไม่แต่งตั้งตำแหน่ง —</option>
            {positions.map(position => <option key={position.id} value={position.id}>{position.name}</option>)}
          </select>
        ) : (
          <p className="text-sm text-gray-800">{user.position_name || 'ยังไม่แต่งตั้งตำแหน่ง'}</p>
        )}
        {selectedPosition?.department_hint && (
          <p className="mt-1 text-xs text-gray-400">กองที่มักสังกัด: {selectedPosition.department_hint}</p>
        )}
        {selectedPosition?.role && (
          <p className="mt-1 text-xs text-indigo-500">บทบาทแนะนำ: {ROLE_LABELS[selectedPosition.role]?.label ?? selectedPosition.role}</p>
        )}
      </div>
      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">กอง/หน่วยงาน</p>
        {isEditing ? (
          <select value={draft.department_id}
            onChange={(e) => setDraft(d => ({ ...d, department_id: e.target.value }))}
            className="text-sm border border-gray-200 rounded-lg px-3 py-2 text-gray-700 focus:outline-none bg-white">
            <option value="">— ไม่ระบุกอง —</option>
            {depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        ) : (
          <p className="text-sm text-gray-800">{user.department_name || 'ไม่ระบุกอง'}</p>
        )}
      </div>
      {activeDeptId && (
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">หัวหน้ากอง</p>
          {isEditing ? (
            <>
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input type="checkbox" checked={!!draft.is_dept_head}
                  onChange={() => setDraft(d => ({ ...d, is_dept_head: !d.is_dept_head }))} className="w-4 h-4" />
                เป็นหัวหน้ากอง
              </label>
              {/* แยกจากบทบาท "หัวหน้ากอง" ชัดๆ กันสับสนหลังเปลี่ยนชื่อ role — ตัวติ๊กนี้ไม่เกี่ยวกับ
                  สิทธิ์เห็นคำร้อง (บทบาทเป็นตัวกำหนด) ใช้กับปฏิทินกิจกรรมและการเรียงลำดับเท่านั้น */}
              <p className="mt-1.5 text-[11px] leading-relaxed text-gray-400">
                ใช้กับการอนุมัติกิจกรรมของกอง และทำให้ชื่อขึ้นก่อนในรายการมอบหมายงาน
                — สิทธิ์เห็นคำร้องทั้งกองมาจากบทบาท "หัวหน้ากอง" ไม่ได้มาจากช่องนี้
              </p>
            </>
          ) : (
            <p className="text-sm text-gray-800">{user.is_dept_head ? 'ใช่' : 'ไม่ใช่'}</p>
          )}
        </div>
      )}
      {user.staff_name && (
        <div className="border-t border-gray-100 pt-4">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">ผูกกับข้อมูลสาธารณะ (หน้าเว็บ)</p>
          <p className="text-sm text-gray-800">{user.staff_name}{user.staff_title ? ` (${user.staff_title})` : ''}</p>
        </div>
      )}
    </div>
  )
}

// แยกออกจาก AppointmentTab ตามที่ขอ — การแต่งตั้ง (ตำแหน่งในหน่วยงาน) กับสิทธิ์ (การเข้าใช้งานแอป)
// เป็นคนละเรื่องกัน แอดมินสับสนว่าทำไมอยู่หน้าเดียวกัน ค่า draft.role ยังใช้ร่วมกับ AppointmentTab
// (การเลือกตำแหน่งมี "บทบาทแนะนำ" เสนอ role มาให้อัตโนมัติ) แต่แก้ไข/แสดงผลแยกกันคนละแท็บ
function PermissionsTab({ user, currentUserRole, isEditing, draft, setDraft }) {
  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-purple-100 bg-purple-50 px-4 py-3">
        <p className="text-sm font-bold text-purple-800">สิทธิ์ = การเข้าใช้งานแอป</p>
        <p className="mt-1 text-xs leading-5 text-purple-600">
          กำหนดว่าเข้าเมนูไหนได้บ้าง แยกจากตำแหน่งในหน่วยงาน (แท็บ "การแต่งตั้ง") — บันทึกครั้งเดียวรวมทุกแท็บ
        </p>
      </div>
      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">บทบาทและสิทธิ์ระบบ</p>
        {isEditing ? (
          <select value={draft.role} onChange={(e) => setDraft(current => ({ ...current, role: e.target.value }))}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 text-gray-700 focus:outline-none bg-white">
            <option value="citizen">ประชาชน — ใช้บริการประชาชนเท่านั้น</option>
            <option value="staff">เจ้าหน้าที่ — ใช้เมนูงานที่ได้รับมอบหมาย</option>
            <option value="viewer">ผู้บริหาร — ดูภาพรวมและข้อมูลประกอบการตัดสินใจ</option>
            <option value="council">สภาเทศบาล — ดูงานที่เกี่ยวข้องกับสภา</option>
            <option value="officer">หัวหน้ากอง — จัดการงานของกองที่สังกัด</option>
            <option value="technician">ปฏิบัติงาน — บันทึกงานที่รับผิดชอบ</option>
            {currentUserRole === 'superadmin' && <option value="admin">แอดมินระบบ — ดูแลทั้งเทศบาล</option>}
            {currentUserRole === 'superadmin' && <option value="superadmin">Super Admin — ดูแลทุกเทศบาล</option>}
          </select>
        ) : (
          <p className="text-sm text-gray-800">{ROLE_LABELS[user.role]?.label ?? user.role}</p>
        )}
        <p className="mt-1 text-xs leading-5 text-gray-500">
          {ROLE_DESCRIPTIONS[isEditing ? draft.role : user.role] ?? 'ระบบเสนอค่าตามตำแหน่ง แต่ผู้ดูแลตรวจและปรับได้ก่อนบันทึก'}
        </p>
        {isEditing && draft.role === 'officer' && !draft.department_id && (
          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">
            ต้องเลือกกอง/หน่วยงานก่อนแต่งตั้งเป็นหัวหน้ากอง (ไปเลือกที่แท็บ "การแต่งตั้ง")
          </p>
        )}
      </div>
    </div>
  )
}

// เพิ่มแท็บใหม่ในอนาคต: เพิ่ม entry ตรงนี้ + เขียน component ใหม่ ไม่ต้องแก้โครงสร้าง UserDetailPage เลย
const USER_DETAIL_TABS = [
  { key: 'account',     label: 'ข้อมูลบัญชี',    Component: AccountInfoTab },
  { key: 'personal',    label: 'ข้อมูลส่วนตัว',   Component: PersonalInfoTab },
  { key: 'appointment', label: 'การแต่งตั้ง',    Component: AppointmentTab },
  { key: 'permissions', label: 'สิทธิ์การใช้งาน', Component: PermissionsTab },
]

// tenantDefaultSubdistrict ย้ายไป src/lib/thaiAddress.js แล้ว (ใช้ร่วมกับ ProfilePage.jsx) — import ไว้
// ด้านบนของไฟล์แทน กันตรรกะเพี้ยนไปคนละแบบระหว่าง 2 หน้าที่ต้องเดาตำบลของ tenant เหมือนกัน

function UserDetailPage(props) {
  const {
    user, onBack, currentUserRole, currentUserId, tenant, saving, deletingUser, setDeletingUser, deleteLoading, deleteUser,
    deleteBlockedReason, setDeleteBlockedReason, handoverStaff, setHandoverStaff,
    mergeKeepUser, setMergeKeepUser, onMerged,
    saveUserEdits, updateUserEmail,
    resetPasswordUser, setResetPasswordUser,
  } = props
  const [activeTab, setActiveTab] = useState('appointment')
  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState(null)
  const [saveError, setSaveError] = useState('')
  const rs = ROLE_LABELS[user.role] || ROLE_LABELS.citizen
  const ActiveComponent = USER_DETAIL_TABS.find(t => t.key === activeTab)?.Component ?? AccountInfoTab
  const canEdit = canManageUser(currentUserRole, currentUserId, user)
  const canDelete = canEdit
  const isSaving = saving === user.id

  function startEdit() {
    setDraft({
      full_name: user.full_name || '',
      email: user.email || '',
      phone: user.phone || '',
      id_card: user.id_card || '',
      address_province: user.address_province || tenant?.province || '',
      address_district: user.address_district || tenant?.district || '',
      address_subdistrict: user.address_subdistrict || tenantDefaultSubdistrict(tenant),
      address_moo: user.address_moo || '',
      address_detail: user.address_detail || '',
      role: user.role,
      position_id: user.position_id || '',
      department_id: user.department_id || '',
      is_dept_head: !!user.is_dept_head,
    })
    setSaveError('')
    setIsEditing(true)
  }

  function cancelEdit() {
    setIsEditing(false)
    setDraft(null)
    setSaveError('')
  }

  async function confirmSave() {
    if (draft.id_card && !/^\d{13}$/.test(draft.id_card)) {
      setSaveError('เลขบัตรประชาชนต้องเป็นตัวเลข 13 หลัก')
      return
    }

    // อีเมล login จริง (auth.users.email) เปลี่ยนแยกจากฟิลด์อื่น — ต้องผ่าน edge function
    // ที่เรียก Supabase Admin API เท่านั้น (admin_update_user ธรรมดาแตะ auth.users ไม่ได้)
    const newEmail = draft.email.trim().toLowerCase()
    if (newEmail && newEmail !== (user.email || '').toLowerCase()) {
      // บัญชีที่ยังไม่เคยมีอีเมล (สมัครด้วย LINE) ไม่มี "อีเมลเดิม" ให้เสีย — เป็นการเพิ่มทางเข้า
      // ไม่ใช่การเปลี่ยน ถ้าใช้ข้อความเตือนอันเดียวกันเจ้าหน้าที่จะลังเลไม่กล้ากดทั้งที่ไม่มีอะไรเสีย
      const label = user.full_name || user.email || 'บัญชีนี้'
      const message = user.email
        ? `ยืนยันเปลี่ยนอีเมลที่ใช้ login ของ "${label}" เป็น "${newEmail}"?\n\nอีเมลเดิมจะใช้ login ไม่ได้อีกทันที`
        : `ยืนยันตั้งชื่อผู้ใช้ของ "${label}" เป็น "${newEmail}"?\n\nช่องทางเดิม (LINE/Google) ยังใช้เข้าได้ตามปกติ\nขั้นถัดไปให้กด "ตั้งรหัสผ่านชั่วคราว" แล้วพิมพ์บัตรให้เจ้าตัว`
      if (!confirm(message)) return

      const emailResult = await updateUserEmail(user, newEmail)
      if (!emailResult.ok) {
        // ข้อความจาก GoTrue เป็นภาษาอังกฤษ เคสที่เจ้าหน้าที่เจอบ่อยสุดคือเบอร์ซ้ำกับบัญชีอื่น
        // (คนเดียวกันมีทั้งบัญชี LINE และบัญชีเบอร์โทร) ซึ่งต้องไปยุบบัญชีรวมกันแทน ไม่ใช่ตั้งซ้ำ
        const dup = /already been registered|already exists|duplicate/i.test(emailResult.error || '')
        setSaveError(dup
          ? 'ชื่อผู้ใช้นี้มีบัญชีอื่นใช้อยู่แล้ว — น่าจะเป็นคนเดียวกันที่มีสองบัญชี ให้ใช้ "ยุบบัญชีซ้ำ" รวมกันแทน'
          : 'เปลี่ยนอีเมลไม่สำเร็จ: ' + emailResult.error)
        return
      }
    }

    const changes = {
      full_name: draft.full_name.trim() || null,
      phone: draft.phone.trim() || null,
      id_card: draft.id_card.trim() || null,
      address_province: draft.address_province.trim() || null,
      address_district: draft.address_district.trim() || null,
      address_subdistrict: draft.address_subdistrict.trim() || null,
      address_moo: draft.address_moo.trim() || null,
      address_detail: draft.address_detail.trim() || null,
      role: draft.role,
      position_id: draft.position_id || null,
      department_id: draft.department_id || null,
      is_dept_head: draft.department_id ? draft.is_dept_head : false,
    }
    const result = await saveUserEdits(user, changes)
    if (result.ok) {
      setIsEditing(false)
      setDraft(null)
      setSaveError('')
    } else {
      setSaveError(result.error)
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 font-medium px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors shrink-0">
            <ChevronLeft size={16} /> ย้อนกลับ
          </button>
          <div className="flex items-center gap-3 min-w-0">
            {user.avatar_url ? (
              <img src={user.avatar_url} alt="avatar" className="w-9 h-9 rounded-full object-cover shrink-0 border border-gray-100" />
            ) : (
              <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0" style={{ backgroundColor: rs.color }}>
                {(user.full_name || user.email || '?')[0].toUpperCase()}
              </div>
            )}
            <h3 className="font-semibold text-gray-800 truncate">รายละเอียดข้อมูลผู้ใช้งาน: {user.full_name || user.email || '—'}</h3>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isEditing ? (
            <>
              <button onClick={cancelEdit} disabled={isSaving} className="text-xs font-medium text-gray-500 hover:text-gray-700 px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50">
                ยกเลิก
              </button>
              <button onClick={confirmSave} disabled={isSaving} className="flex items-center gap-1.5 text-xs font-medium text-white bg-blue-500 hover:bg-blue-600 px-4 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                {isSaving ? 'กำลังบันทึก...' : 'บันทึก'}
              </button>
            </>
          ) : (
            <>
              {canEdit && (
                <button onClick={startEdit} className="flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-700 hover:bg-blue-50 px-3 py-1.5 rounded-lg transition-colors">
                  <Pencil size={14} /> {activeTab === 'appointment' ? 'แก้ไขการแต่งตั้ง' : 'แก้ไขข้อมูล'}
                </button>
              )}
              {canDelete && user.role !== 'citizen' && (
                <button
                  onClick={() => setHandoverStaff(user)}
                  className="flex items-center gap-1.5 text-xs font-medium text-orange-500 hover:text-orange-600 hover:bg-orange-50 px-3 py-1.5 rounded-lg transition-colors"
                >
                  <Repeat size={14} /> โอนงานให้ผู้อื่น
                </button>
              )}
              {/* ปุ่มนี้ผูกกับบัญชีที่ "เก็บไว้" จึงไม่ใช้ canManageUser กับ user คนนี้ (บัญชีนี้ไม่ถูกลบ)
                  — สิทธิ์จัดการถูกเช็คกับบัญชีที่จะยุบในโมดัลและซ้ำอีกชั้นที่ RPC */}
              {['admin', 'superadmin'].includes(currentUserRole) && (
                <button
                  onClick={() => setMergeKeepUser(user)}
                  className="flex items-center gap-1.5 text-xs font-medium text-violet-600 hover:text-violet-700 hover:bg-violet-50 px-3 py-1.5 rounded-lg transition-colors"
                >
                  <Users size={14} /> รวมบัญชีซ้ำ
                </button>
              )}
              {canEdit && (
                <button
                  onClick={() => setResetPasswordUser(user)}
                  className="flex items-center gap-1.5 text-xs font-medium text-amber-600 hover:text-amber-700 hover:bg-amber-50 px-3 py-1.5 rounded-lg transition-colors"
                >
                  <KeyRound size={14} /> ตั้งรหัสผ่านใหม่
                </button>
              )}
              {canDelete && (
                <button
                  onClick={() => setDeletingUser(user)}
                  className="flex items-center gap-1.5 text-xs font-medium text-red-500 hover:text-red-600 hover:bg-red-50 px-3 py-1.5 rounded-lg transition-colors"
                >
                  <Trash2 size={14} /> ลบผู้ใช้งาน
                </button>
              )}
            </>
          )}
        </div>
      </div>
      <div className="px-5 border-b border-gray-100 flex gap-1 overflow-x-auto">
        {USER_DETAIL_TABS.map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key)}
            className={`px-4 py-3 text-sm font-semibold border-b-2 transition-colors whitespace-nowrap ${
              activeTab === t.key ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="p-6 max-w-xl">
        {saveError && (
          <div className="mb-4 text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{saveError}</div>
        )}
        <ActiveComponent {...props} isEditing={isEditing} draft={draft} setDraft={setDraft} />
      </div>
      <DeleteUserConfirmModal
        deletingUser={deletingUser} setDeletingUser={setDeletingUser} deleteLoading={deleteLoading} deleteUser={deleteUser}
        deleteBlockedReason={deleteBlockedReason}
        onOpenHandover={(u) => { setHandoverStaff(u); setDeletingUser(null); setDeleteBlockedReason('') }}
        onClose={() => { setDeletingUser(null); setDeleteBlockedReason('') }}
      />
      {handoverStaff && (
        <HandoverWorkloadModal oldStaff={handoverStaff} tenant={tenant} onClose={() => setHandoverStaff(null)} />
      )}
      {mergeKeepUser && (
        <MergeDuplicateModal
          keepUser={mergeKeepUser}
          tenant={tenant}
          currentUserRole={currentUserRole}
          currentUserId={currentUserId}
          onClose={() => setMergeKeepUser(null)}
          onMerged={onMerged}
        />
      )}
      {resetPasswordUser && (
        <ResetPasswordModal user={resetPasswordUser} onClose={() => setResetPasswordUser(null)} />
      )}
    </div>
  )
}

// ─── Emergency Contacts Manager ───────────────────────────────────────────────
function SortableContact({ c, i, total, onDelete, onMove, onEdit, editingId, editingForm, onEditChange, onEditSave }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: c.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.45 : 1,
    zIndex: isDragging ? 10 : undefined,
    position: 'relative',
  }
  const isEditing = editingId === c.id
  return (
    <div ref={setNodeRef} style={style}
         className={`px-4 py-3 bg-white ${i < total - 1 ? 'border-b border-gray-50' : ''}`}>
      <div className="flex items-center gap-2">
        <button {...attributes} {...listeners}
                className="p-1 text-gray-300 hover:text-gray-500 cursor-grab active:cursor-grabbing touch-none shrink-0">
          <GripVertical size={16} />
        </button>
        <div className="w-10 h-10 rounded-full flex items-center justify-center text-xl shrink-0"
             style={{ backgroundColor: c.bg }}>
          {c.emoji}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-gray-800 text-sm">{c.label}</p>
          <p className="text-[13px] text-gray-400">{c.number}</p>
        </div>
        <div className="flex flex-col gap-0">
          <button onClick={() => onMove(i, -1)} disabled={i === 0}
                  className="p-0.5 rounded text-gray-300 hover:text-gray-600 disabled:opacity-20 transition-colors">
            <ChevronUp size={14} />
          </button>
          <button onClick={() => onMove(i, 1)} disabled={i === total - 1}
                  className="p-0.5 rounded text-gray-300 hover:text-gray-600 disabled:opacity-20 transition-colors">
            <ChevronDown size={14} />
          </button>
        </div>
        <a href={`tel:${c.number}`}
           className="p-2 rounded-xl text-gray-400 hover:text-green-600 hover:bg-green-50 transition-colors">
          <PhoneCall size={15} />
        </a>
        <button onClick={() => onEdit(c)}
                className="p-2 rounded-xl text-gray-400 hover:text-blue-500 hover:bg-blue-50 transition-colors">
          <Pencil size={15} />
        </button>
        <button onClick={() => onDelete(c.id)}
                className="p-2 rounded-xl text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors">
          <Trash2 size={15} />
        </button>
      </div>
      {isEditing && (
        <div className="mt-3 ml-12 space-y-2">
          <input
            autoFocus
            value={editingForm.label}
            onChange={(e) => onEditChange('label', e.target.value)}
            placeholder="ชื่อสายด่วน"
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2"
            style={{ '--tw-ring-color': 'var(--color-primary)' }}
          />
          <input
            value={editingForm.number}
            onChange={(e) => onEditChange('number', e.target.value)}
            placeholder="เบอร์โทร"
            type="tel"
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2"
            style={{ '--tw-ring-color': 'var(--color-primary)' }}
          />
          <div className="flex gap-2">
            <button onClick={onEditSave}
                    className="px-4 py-1.5 rounded-xl text-sm font-medium text-white"
                    style={{ backgroundColor: 'var(--color-primary)' }}>
              บันทึก
            </button>
            <button onClick={() => onEdit(null)}
                    className="px-4 py-1.5 rounded-xl text-sm font-medium text-gray-500 border border-gray-200">
              ยกเลิก
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

const EMERGENCY_EMOJIS = [
  '📞','👮','🚒','🏥','🚑','⚡','💧','🏛️','🪖','🆘',
  '🩺','🛣️','💡','⛽','🌳','🔥','🚔','🚨','🛡️','☎️',
  '📟','🔧','🏗️','🚧','⚠️','🌊','🌪️','🦺','🧯','🔑',
]

function EmergencyManager({ tenant }) {
  const [contacts, setContacts] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ label: '', number: '', emoji: '📞', color: '#1d4ed8', bg: '#dbeafe' })
  const [editingId, setEditingId] = useState(null)
  const [editingForm, setEditingForm] = useState({ label: '', number: '' })
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
  )

  const fetchContacts = useCallback(async () => {
    if (!tenant?.id) return
    setLoading(true)
    try {
      const { data } = await supabase
        .from('emergency_contacts')
        .select('*')
        .eq('municipality_id', tenant.id)
        .order('display_order')
      setContacts(data ?? [])
    } finally {
      setLoading(false)
    }
  }, [tenant?.id])

  useEffect(() => {
    fetchContacts()
    const safety = setTimeout(() => setLoading(false), 12000)
    return () => clearTimeout(safety)
  }, [fetchContacts])

  async function saveOrder(ordered) {
    await Promise.all(
      ordered.map((c, i) =>
        supabase.from('emergency_contacts').update({ display_order: i + 1 }).eq('id', c.id)
      )
    )
  }

  function handleDragEnd({ active, over }) {
    if (!over || active.id === over.id) return
    const oldIdx = contacts.findIndex((c) => c.id === active.id)
    const newIdx = contacts.findIndex((c) => c.id === over.id)
    const next = arrayMove(contacts, oldIdx, newIdx)
    setContacts(next)
    saveOrder(next)
  }

  function handleMove(idx, dir) {
    const next = arrayMove(contacts, idx, idx + dir)
    setContacts(next)
    saveOrder(next)
  }

  function guessEmoji(label) {
    const t = label.toLowerCase()
    if (/ตำรวจ|สภ|สถานีตำรวจ|police/.test(t))          return '👮'
    if (/ดับเพลิง|ไฟไหม้|fire/.test(t))                  return '🚒'
    if (/โรงพยาบาล|พยาบาล|หมอ|แพทย์|hospital/.test(t)) return '🏥'
    if (/กู้ภัย|กู้ชีพ|ambulance|ฉุกเฉิน/.test(t))       return '🚑'
    if (/ไฟฟ้า|pea|การไฟฟ้า/.test(t))                   return '⚡'
    if (/ประปา|น้ำ|water/.test(t))                       return '💧'
    if (/เทศบาล|อบต|อบจ|สำนักงาน/.test(t))              return '🏛️'
    if (/ป่าไม้|สิ่งแวดล้อม|env/.test(t))                return '🌳'
    if (/ทหาร|army|military/.test(t))                    return '🪖'
    if (/ภัยพิบัติ|disaster/.test(t))                    return '🆘'
    if (/สาธารณสุข|อนามัย|health/.test(t))               return '🩺'
    if (/ถนน|ทาง|road/.test(t))                          return '🛣️'
    if (/ไฟ|light|โคม/.test(t))                          return '💡'
    if (/แก๊ส|gas/.test(t))                              return '⛽'
    return '📞'
  }

  async function addContact() {
    if (!form.label.trim() || !form.number.trim()) return
    setSaving(true)
    const { data } = await supabase.from('emergency_contacts').insert({
      municipality_id: tenant.id,
      label: form.label.trim(),
      number: form.number.trim(),
      emoji: form.emoji,
      color: form.color,
      bg: form.bg,
      display_order: contacts.length + 1,
    }).select().single()
    if (data) setContacts((prev) => [...prev, data])
    setForm({ label: '', number: '', emoji: '📞', color: '#1d4ed8', bg: '#dbeafe' })
    setSaving(false)
  }

  async function deleteContact(id) {
    const contact = contacts.find((c) => c.id === id)
    if (!window.confirm(`ลบ "${contact?.label}" ออกจากรายการเบอร์ฉุกเฉิน?`)) return
    await supabase.from('emergency_contacts').delete().eq('id', id)
    setContacts((prev) => prev.filter((c) => c.id !== id))
  }

  function handleEdit(c) {
    if (!c) { setEditingId(null); return }
    setEditingId(c.id)
    setEditingForm({ label: c.label, number: c.number })
  }

  async function saveContactEdit() {
    if (!editingForm.label.trim() || !editingForm.number.trim()) return
    const { error } = await supabase.from('emergency_contacts')
      .update({ label: editingForm.label.trim(), number: editingForm.number.trim() })
      .eq('id', editingId)
    if (error) return
    setContacts((prev) => prev.map((c) => c.id === editingId ? { ...c, ...editingForm } : c))
    setEditingId(null)
  }

  return (
    <div className="space-y-4">
      {/* Add form */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
        {showEmojiPicker && <div className="fixed inset-0 z-40" onClick={() => setShowEmojiPicker(false)} />}
        <p className="font-semibold text-gray-700 text-sm">เพิ่มสายด่วนใหม่</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {/* Emoji picker */}
          <div className="relative">
            <button type="button"
              onClick={() => setShowEmojiPicker((v) => !v)}
              className="w-full flex items-center justify-center gap-2 border border-gray-200 rounded-xl px-3 py-2 bg-gray-50 hover:bg-gray-100 transition-colors"
              title="เลือก emoji">
              <span className="text-2xl">{form.emoji}</span>
              <span className="text-xs text-gray-400">เปลี่ยน</span>
            </button>
            {showEmojiPicker && (
              <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-gray-200 rounded-2xl shadow-xl p-3 grid grid-cols-6 gap-1.5 w-56">
                {EMERGENCY_EMOJIS.map((e) => (
                  <button key={e} type="button"
                    onClick={() => { setForm((f) => ({ ...f, emoji: e })); setShowEmojiPicker(false) }}
                    className={`text-xl rounded-xl p-1.5 hover:bg-gray-100 transition-colors ${form.emoji === e ? 'bg-blue-50 ring-2 ring-blue-300' : ''}`}>
                    {e}
                  </button>
                ))}
              </div>
            )}
          </div>
          <input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value, emoji: guessEmoji(e.target.value) })}
            className="border border-gray-200 rounded-xl px-3 py-2 text-sm col-span-1 text-gray-800"
            placeholder="ชื่อ เช่น ตำรวจ" />
          <input value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })}
            className="border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800"
            placeholder="เบอร์โทร เช่น 191" />
          <button onClick={addContact} disabled={saving || !form.label || !form.number}
            className="flex items-center justify-center gap-1 px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-50"
            style={{ backgroundColor: 'var(--color-primary)' }}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            เพิ่ม
          </button>
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-8 text-gray-400">
          <Loader2 size={20} className="animate-spin" />
        </div>
      ) : contacts.length === 0 ? (
        <div className="text-center py-8 text-gray-400 text-sm">
          ยังไม่มีข้อมูลสายด่วน — เพิ่มจากแบบฟอร์มด้านบน
        </div>
      ) : (
        <>
          {/* Mobile: DnD sortable cards */}
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={contacts.map((c) => c.id)} strategy={verticalListSortingStrategy}>
              <div className="md:hidden bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                {contacts.map((c, i) => (
                  <SortableContact key={c.id} c={c} i={i} total={contacts.length}
                    onDelete={deleteContact} onMove={handleMove} onEdit={handleEdit}
                    editingId={editingId} editingForm={editingForm}
                    onEditChange={(field, val) => setEditingForm((p) => ({ ...p, [field]: val }))}
                    onEditSave={saveContactEdit} />
                ))}
              </div>
            </SortableContext>
          </DndContext>
          {/* Desktop table */}
          <div className="hidden md:block border border-gray-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 w-16">ลำดับ</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 w-16">สัญลักษณ์</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">ชื่อ / หน่วยงาน</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">เบอร์โทร</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 w-28">จัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {contacts.map((c, i) => (
                  <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-xs text-gray-400">{i + 1}</td>
                    <td className="px-4 py-3 text-2xl">{c.emoji}</td>
                    <td className="px-4 py-3">
                      {editingId === c.id ? (
                        <input value={editingForm.label} onChange={e => setEditingForm(p => ({ ...p, label: e.target.value }))}
                          className="border border-gray-300 rounded-lg px-2 py-1 text-sm text-gray-800 focus:outline-none w-full max-w-xs" />
                      ) : (
                        <span className="font-medium text-gray-800">{c.label}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {editingId === c.id ? (
                        <div className="flex items-center gap-2">
                          <input value={editingForm.number} onChange={e => setEditingForm(p => ({ ...p, number: e.target.value }))}
                            className="border border-gray-300 rounded-lg px-2 py-1 text-sm text-gray-800 focus:outline-none w-32" />
                          <button onClick={saveContactEdit}
                            className="px-2.5 py-1 rounded-lg text-xs font-semibold text-white bg-green-500 hover:bg-green-600">บันทึก</button>
                          <button onClick={() => setEditingId(null)}
                            className="px-2.5 py-1 rounded-lg text-xs text-gray-500 border border-gray-200 hover:bg-gray-50">ยกเลิก</button>
                        </div>
                      ) : (
                        <a href={`tel:${c.number}`} className="text-blue-600 hover:underline font-mono">{c.number}</a>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1.5">
                        <button onClick={() => handleEdit(c)}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors" title="แก้ไข">
                          <Pencil size={14} />
                        </button>
                        <button onClick={() => deleteContact(c.id)}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors" title="ลบ">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

// ─── Staff Manager ───────────────────────────────────────────────────────────
// เก็บคอมโพเนนต์เดิมไว้ชั่วคราวเป็น rollback ระหว่าง migration เท่านั้น
// ไม่มีเมนูหรือ route ให้ผู้ใช้เปิด และห้ามเปิดกลับหลังตรวจ migration ผ่าน
const LEGACY_STAFF_PAGE_ENABLED = false

const STAFF_ROLE_LABEL = {
  mayor: 'นายกเทศมนตรี',
  deputy_mayor: 'รองนายกเทศมนตรี',
  clerk: 'ปลัดเทศบาล',
  dept_head: 'หัวหน้าส่วนราชการ/ผู้อำนวยการกอง',
  staff: 'เจ้าหน้าที่',
}

const EMPTY_STAFF_FORM = { name: '', title: '', role: 'mayor', phone: '' }

function StaffManager({ tenant }) {
  const [staff, setStaff] = useState([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(null)
  const [error, setError] = useState(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [form, setForm] = useState(EMPTY_STAFF_FORM)
  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState(EMPTY_STAFF_FORM)

  useEffect(() => {
    if (!tenant?.id) return
    setLoading(true)
    const safety = setTimeout(() => setLoading(false), 12000)
    supabase
      .from('staff')
      .select('*')
      .eq('municipality_id', tenant.id)
      .order('display_order')
      .then(({ data, error: err }) => {
        if (err) setError(err.message)
        setStaff(data ?? [])
      })
      .finally(() => { clearTimeout(safety); setLoading(false) })
  }, [tenant?.id])

  async function addStaff() {
    const name = form.name.trim()
    const title = form.title.trim()
    const phone = form.phone?.trim() || null
    if (!name || !title || !tenant?.id) return
    setSaving(true)
    setError(null)
    const { data, error: err } = await supabase
      .from('staff')
      .insert({ municipality_id: tenant.id, name, title, role: form.role, phone, display_order: staff.length })
      .select()
      .single()
    if (err) {
      setError('เพิ่มไม่สำเร็จ: ' + err.message)
    } else {
      setStaff((prev) => [...prev, data])
      setForm(EMPTY_STAFF_FORM)
      setShowAddForm(false)
    }
    setSaving(false)
  }

  async function saveEdit(id) {
    const name = editForm.name.trim()
    const title = editForm.title.trim()
    const phone = editForm.phone?.trim() || null
    if (!name || !title) { setEditingId(null); return }
    const { error: err } = await supabase
      .from('staff')
      .update({ name, title, role: editForm.role, phone })
      .eq('id', id)
    if (err) { setError('แก้ไขไม่สำเร็จ: ' + err.message); return }
    setStaff((prev) => prev.map((s) => s.id === id ? { ...s, name, title, role: editForm.role, phone } : s))
    setEditingId(null)
  }

  async function deleteStaff(id, name) {
    if (!window.confirm(`ลบ "${name}" ออกจากรายชื่อผู้บริหาร?`)) return
    setDeleting(id)
    const { error: err } = await supabase.from('staff').delete().eq('id', id)
    if (err) { setError('ลบไม่สำเร็จ: ' + err.message) }
    else { setStaff((prev) => prev.filter((s) => s.id !== id)) }
    setDeleting(null)
  }

  async function handlePhotoUpload(staffId, file) {
    if (!file) return
    setUploading(staffId)
    setError(null)
    const ext = file.name.split('.').pop().toLowerCase()
    const compressed = await compressImage(file, 400)
    const { url, error: uploadErr } = await uploadFile('complaint-attachments', compressed, {
      subject: `staff/${staffId}`,
      filename: `photo_${Date.now()}.${ext}`,
      municipality: tenant?.slug,
    })
    if (uploadErr) {
      setError('อัปโหลดรูปไม่สำเร็จ: ' + uploadErr.message)
      setUploading(null)
      return
    }
    const { error: updateErr } = await supabase
      .from('staff')
      .update({ photo_url: url })
      .eq('id', staffId)
    if (updateErr) {
      setError('บันทึกข้อมูลไม่สำเร็จ: ' + updateErr.message)
    } else {
      setStaff((prev) => prev.map((s) => s.id === staffId ? { ...s, photo_url: url } : s))
    }
    setUploading(null)
  }

  async function removePhoto(staffId) {
    const { error: updateErr } = await supabase
      .from('staff')
      .update({ photo_url: null })
      .eq('id', staffId)
    if (!updateErr) {
      setStaff((prev) => prev.map((s) => s.id === staffId ? { ...s, photo_url: null } : s))
    }
  }

  if (loading) return <div className="flex justify-center py-12"><Loader2 size={24} className="animate-spin text-gray-300" /></div>

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-gray-700 flex items-center gap-2">
          <UserCircle2 size={18} style={{ color: 'var(--color-primary)' }} />
          จัดการรูปผู้บริหาร
        </h2>
        <button
          onClick={() => { setShowAddForm((v) => !v); setForm(EMPTY_STAFF_FORM) }}
          className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-xl font-medium text-white"
          style={{ backgroundColor: 'var(--color-primary)' }}>
          <Plus size={15} /> เพิ่มบุคลากร
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">⚠️ {error}</div>
      )}

      {/* Add form */}
      {showAddForm && (
        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 space-y-3">
          <p className="text-sm font-semibold text-blue-800">เพิ่มบุคลากรใหม่</p>
          <div className="grid gap-2 sm:grid-cols-3">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">ชื่อ-นามสกุล *</label>
              <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="เช่น นายสมชาย ใจดี"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 bg-white focus:outline-none focus:ring-2"
                style={{ '--tw-ring-color': 'var(--color-primary)' }} />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">ตำแหน่ง *</label>
              <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="เช่น นายกเทศมนตรีตำบลน้ำเลา"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 bg-white focus:outline-none focus:ring-2"
                style={{ '--tw-ring-color': 'var(--color-primary)' }} />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">เบอร์โทรศัพท์ติดต่อ</label>
              <input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                placeholder="เช่น โทร. 053-276491 ต่อ 886"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 bg-white focus:outline-none focus:ring-2"
                style={{ '--tw-ring-color': 'var(--color-primary)' }} />
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">ประเภท</label>
            <select value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 bg-white focus:outline-none">
              {Object.entries(STAFF_ROLE_LABEL).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowAddForm(false)}
              className="px-4 py-2 text-sm rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50">
              ยกเลิก
            </button>
            <button onClick={addStaff} disabled={saving || !form.name.trim() || !form.title.trim()}
              className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-xl font-medium text-white disabled:opacity-50"
              style={{ backgroundColor: 'var(--color-primary)' }}>
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
              บันทึก
            </button>
          </div>
        </div>
      )}

      {/* List */}
      {staff.length === 0 ? (
        <div className="text-center py-12 text-gray-400 text-sm">
          <UserCircle2 size={36} className="mx-auto mb-3 text-gray-200" />
          <p>ยังไม่มีข้อมูลผู้บริหาร</p>
          <p className="text-xs mt-1">กด "เพิ่มบุคลากร" ด้านบนเพื่อเริ่มต้น</p>
        </div>
      ) : (
        <>
          {/* Mobile: card list */}
          <div className="md:hidden space-y-3">
            {staff.map((person) => (
              <div key={person.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
                {editingId === person.id ? (
                  <div className="space-y-3">
                    <div className="grid gap-2 sm:grid-cols-3">
                      <div>
                        <label className="text-xs text-gray-500 mb-1 block">ชื่อ-นามสกุล</label>
                        <input value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                          className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 bg-white focus:outline-none focus:ring-2"
                          style={{ '--tw-ring-color': 'var(--color-primary)' }} />
                      </div>
                      <div>
                        <label className="text-xs text-gray-500 mb-1 block">ตำแหน่ง</label>
                        <input value={editForm.title} onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
                          className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 bg-white focus:outline-none focus:ring-2"
                          style={{ '--tw-ring-color': 'var(--color-primary)' }} />
                      </div>
                      <div>
                        <label className="text-xs text-gray-500 mb-1 block">เบอร์ติดต่อ</label>
                        <input value={editForm.phone} onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))}
                          className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 bg-white focus:outline-none focus:ring-2"
                          style={{ '--tw-ring-color': 'var(--color-primary)' }} />
                      </div>
                    </div>
                    <select value={editForm.role} onChange={(e) => setEditForm((f) => ({ ...f, role: e.target.value }))}
                      className="border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 bg-white focus:outline-none">
                      {Object.entries(STAFF_ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => setEditingId(null)} className="px-4 py-2 text-sm rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50">ยกเลิก</button>
                      <button onClick={() => saveEdit(person.id)} className="px-4 py-2 text-sm rounded-xl font-medium text-white" style={{ backgroundColor: 'var(--color-primary)' }}>บันทึก</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-4">
                    <div className="shrink-0">
                      {person.photo_url ? (
                        <img src={person.photo_url} alt={person.name} className="w-16 h-16 rounded-full object-cover object-top ring-2 ring-gray-100" />
                      ) : (
                        <div className="w-16 h-16 rounded-full flex items-center justify-center font-bold text-white text-lg"
                          style={{ background: 'linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%)' }}>
                          {person.name.trim().split(' ').map((w) => w[0]).join('').slice(0, 2)}
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-gray-800 text-sm truncate">{person.name}</p>
                      <p className="text-xs text-gray-500 truncate">{person.title}</p>
                      <span className="inline-block text-[13px] px-2 py-0.5 rounded-full mt-1 text-white" style={{ backgroundColor: 'var(--color-primary)' }}>
                        {STAFF_ROLE_LABEL[person.role] ?? person.role}
                      </span>
                    </div>
                    <div className="flex flex-col gap-1.5 shrink-0">
                      <label className={`cursor-pointer flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-xl font-medium text-white ${uploading === person.id ? 'opacity-60 cursor-wait' : ''}`}
                        style={{ backgroundColor: 'var(--color-primary)' }}>
                        {uploading === person.id ? <Loader2 size={11} className="animate-spin" /> : <Camera size={11} />}
                        {person.photo_url ? 'เปลี่ยนรูป' : 'อัปโหลดรูป'}
                        <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
                          disabled={uploading === person.id}
                          onChange={(e) => { const f = e.target.files?.[0]; if (f) handlePhotoUpload(person.id, f) }} />
                      </label>
                      <button onClick={() => { setEditingId(person.id); setEditForm({ name: person.name, title: person.title, role: person.role, phone: person.phone || '' }) }}
                        className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-xl font-medium text-gray-600 border border-gray-200 hover:bg-gray-50">
                        <Pencil size={11} /> แก้ไข
                      </button>
                      {person.photo_url && (
                        <button onClick={() => removePhoto(person.id)} className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-xl font-medium text-orange-500 border border-orange-200 hover:bg-orange-50">
                          <X size={11} /> ลบรูป
                        </button>
                      )}
                      <button onClick={() => deleteStaff(person.id, person.name)} disabled={deleting === person.id}
                        className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-xl font-medium text-red-500 border border-red-200 hover:bg-red-50 disabled:opacity-50">
                        {deleting === person.id ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />} ลบ
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
          {/* Desktop table */}
          <div className="hidden md:block border border-gray-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 w-16">ลำดับ</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 w-16">รูป</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">ชื่อ-นามสกุล</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">ตำแหน่ง</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">เบอร์ติดต่อ</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">ประเภท</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500">จัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {staff.map((person, i) => {
                  const isEditing = editingId === person.id
                  return (
                    <tr key={person.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 text-xs text-gray-400">{i + 1}</td>
                      <td className="px-4 py-3">
                        {person.photo_url ? (
                          <img src={person.photo_url} alt={person.name} className="w-9 h-9 rounded-full object-cover object-top ring-1 ring-gray-200" />
                        ) : (
                          <div className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-white text-xs"
                            style={{ background: 'linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%)' }}>
                            {person.name.trim().split(' ').map((w) => w[0]).join('').slice(0, 2)}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <input value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                            className="border border-gray-200 rounded-lg px-2 py-1 text-sm text-gray-900 bg-white focus:outline-none" />
                        ) : (
                          <span className="font-medium text-gray-800">{person.name}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <input value={editForm.title} onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
                            className="border border-gray-200 rounded-lg px-2 py-1 text-sm text-gray-900 bg-white focus:outline-none" />
                        ) : (
                          <span className="text-gray-600">{person.title}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <input value={editForm.phone} onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))}
                            className="border border-gray-200 rounded-lg px-2 py-1 text-sm text-gray-900 bg-white focus:outline-none" />
                        ) : (
                          <span className="text-gray-600 font-mono text-xs">{person.phone || '-'}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <select value={editForm.role} onChange={(e) => setEditForm((f) => ({ ...f, role: e.target.value }))}
                            className="border border-gray-200 rounded-lg px-2 py-1 text-sm text-gray-900 bg-white focus:outline-none">
                            {Object.entries(STAFF_ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                          </select>
                        ) : (
                          <span className="text-xs font-semibold px-2 py-0.5 rounded-full text-white" style={{ backgroundColor: 'var(--color-primary)' }}>
                            {STAFF_ROLE_LABEL[person.role] ?? person.role}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <div className="flex justify-end items-center gap-1.5">
                            <button onClick={() => saveEdit(person.id)}
                              className="px-2 py-1 rounded bg-green-600 text-white text-xs font-semibold hover:bg-green-700">
                              บันทึก
                            </button>
                            <button onClick={() => setEditingId(null)}
                              className="px-2 py-1 rounded bg-gray-400 text-white text-xs font-semibold hover:bg-gray-500">
                              ยกเลิก
                            </button>
                          </div>
                        ) : (
                          <div className="flex justify-end items-center gap-1.5">
                            <label className={`cursor-pointer flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg font-medium text-white ${uploading === person.id ? 'opacity-60 cursor-wait' : ''}`}
                              style={{ backgroundColor: 'var(--color-primary)' }} title={person.photo_url ? 'เปลี่ยนรูป' : 'อัปโหลดรูป'}>
                              {uploading === person.id ? <Loader2 size={11} className="animate-spin" /> : <Camera size={11} />}
                              รูป
                              <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
                                disabled={uploading === person.id}
                                onChange={(e) => { const f = e.target.files?.[0]; if (f) handlePhotoUpload(person.id, f) }} />
                            </label>
                            <button onClick={() => { setEditingId(person.id); setEditForm({ name: person.name, title: person.title, role: person.role, phone: person.phone || '' }) }}
                              className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors" title="แก้ไข">
                              <Pencil size={14} />
                            </button>
                            <button onClick={() => deleteStaff(person.id, person.name)} disabled={deleting === person.id}
                              className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-50" title="ลบ">
                              {deleting === person.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

// ─── Location Manager ─────────────────────────────────────────────────────────
function LocationManager({ tenant }) {
  const [locations, setLocations] = useState([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [editingName, setEditingName] = useState('')

  async function fetchLocations() {
    if (!tenant?.id) return
    setLoading(true)
    setError(null)
    try {
      const { data, error: err } = await supabase
        .from('locations')
        .select('*')
        .eq('municipality_id', tenant.id)
        .order('sort_order')
      if (err) setError('ไม่สามารถโหลดข้อมูลได้: ' + err.message)
      setLocations(data ?? [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchLocations() }, [tenant?.id])

  async function addLocation() {
    const name = newName.trim()
    if (!name || !tenant?.id) return
    setSaving(true)
    setError(null)
    const { data, error: err } = await supabase.from('locations').insert({
      municipality_id: tenant.id,
      name,
      sort_order: locations.length,
    }).select().single()
    if (err) {
      setError('เพิ่มไม่สำเร็จ: ' + err.message)
    } else if (data) {
      setLocations((prev) => [...prev, data])
      setNewName('')
    }
    setSaving(false)
  }

  async function deleteLocation(id) {
    const loc = locations.find((l) => l.id === id)
    if (!window.confirm(`ลบ "${loc?.name}" ออกจากรายการสถานที่?`)) return
    const { error: err } = await supabase.from('locations').delete().eq('id', id)
    if (err) { setError('ลบไม่สำเร็จ: ' + err.message); return }
    setLocations((prev) => prev.filter((l) => l.id !== id))
  }

  async function saveEdit(id) {
    const name = editingName.trim()
    if (!name) { setEditingId(null); return }
    const { error: err } = await supabase.from('locations').update({ name }).eq('id', id)
    if (err) { setError('แก้ไขไม่สำเร็จ: ' + err.message); return }
    setLocations((prev) => prev.map((l) => l.id === id ? { ...l, name } : l))
    setEditingId(null)
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-4">
      <h2 className="font-semibold text-gray-700">จัดการสถานที่เกิดเหตุ</h2>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
          ⚠️ {error}
          {error.includes('does not exist') && (
            <p className="mt-1 text-xs text-red-500">กรุณารัน migration 009 ใน Supabase SQL Editor ก่อน</p>
          )}
        </div>
      )}

      {/* Add form */}
      <div className="flex gap-2">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addLocation()}
          placeholder="ชื่อสถานที่ เช่น หมู่ 3 บ้านท่าข้าม"
          className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 bg-white focus:outline-none focus:ring-2"
          style={{ '--tw-ring-color': 'var(--color-primary)' }}
        />
        <button
          onClick={addLocation}
          disabled={saving || !newName.trim()}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium text-white disabled:opacity-50"
          style={{ backgroundColor: 'var(--color-primary)' }}
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          เพิ่ม
        </button>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-8"><Loader2 size={22} className="animate-spin text-gray-300" /></div>
      ) : locations.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-8">ยังไม่มีสถานที่ กรุณาเพิ่มสถานที่ด้านบน</p>
      ) : (
        <>
          {/* Mobile */}
          <div className="md:hidden space-y-2">
            {locations.map((loc) => (
              <div key={loc.id} className="flex items-center gap-3 bg-gray-50 rounded-xl px-3 py-2.5">
                <GripVertical size={15} className="text-gray-300 shrink-0" />
                <MapPin size={14} className="text-gray-400 shrink-0" />
                {editingId === loc.id ? (
                  <input autoFocus value={editingName} onChange={(e) => setEditingName(e.target.value)}
                    onBlur={() => saveEdit(loc.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(loc.id); if (e.key === 'Escape') setEditingId(null) }}
                    className="flex-1 text-sm text-gray-800 bg-white border border-gray-300 rounded-lg px-2 py-1 focus:outline-none focus:ring-2"
                    style={{ '--tw-ring-color': 'var(--color-primary)' }} />
                ) : (
                  <span className="flex-1 text-sm text-gray-700">{loc.name}</span>
                )}
                <button onClick={() => { setEditingId(loc.id); setEditingName(loc.name) }}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-blue-500 hover:bg-blue-50 transition-colors">
                  <Pencil size={14} />
                </button>
                <button onClick={() => deleteLocation(loc.id)}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
          {/* Desktop table */}
          <div className="hidden md:block border border-gray-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 w-16">ลำดับ</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">ชื่อสถานที่เกิดเหตุ</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 w-28">จัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {locations.map((loc, i) => (
                  <tr key={loc.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-xs text-gray-400">{i + 1}</td>
                    <td className="px-4 py-3">
                      {editingId === loc.id ? (
                        <input autoFocus value={editingName} onChange={(e) => setEditingName(e.target.value)}
                          onBlur={() => saveEdit(loc.id)}
                          onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(loc.id); if (e.key === 'Escape') setEditingId(null) }}
                          className="border border-gray-300 rounded-lg px-2 py-1 text-sm text-gray-800 focus:outline-none focus:ring-1 w-full max-w-sm"
                          style={{ '--tw-ring-color': 'var(--color-primary)' }} />
                      ) : (
                        <span className="text-sm text-gray-800">{loc.name}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1.5">
                        <button onClick={() => { setEditingId(loc.id); setEditingName(loc.name) }}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors" title="แก้ไข">
                          <Pencil size={14} />
                        </button>
                        <button onClick={() => deleteLocation(loc.id)}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors" title="ลบ">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

// ─── Category Manager ─────────────────────────────────────────────────────────
const EMOJI_GROUPS = [
  { label: 'สาธารณูปโภค', emojis: ['💡','⚡','🔌','🛣️','🛤️','🏗️','🚧','🏢','🏠','🌉','🚿','🔧','🔨','⛏️','🪛','🔩','🪜','🪝'] },
  { label: 'น้ำ / สิ่งแวดล้อม', emojis: ['💧','🌊','🌧️','☔','🚰','🪣','🌬️','💨','🌫️','🔥','🌱','🌳','🌲','🌿','🍃','🌾','🌵','🪴'] },
  { label: 'ความสะอาด', emojis: ['🗑️','♻️','🧹','🚽','🪠','🚛','💩','🧺','🧴','🧼','🪥','🛁','🚮'] },
  { label: 'สัตว์', emojis: ['🐕','🐾','🐈','🦟','🦗','🐛','🐝','🦂','🐀','🦎','🐓','🐟','🦆'] },
  { label: 'เสียง / ร้องเรียน', emojis: ['🔊','📣','📢','🔔','🔕','💬','😤','🤬','📞','☎️','🗣️'] },
  { label: 'บริการสาธารณะ', emojis: ['🚒','🚑','🚔','👮','🛡️','📋','📝','🧾','💰','⚖️','📦','🏥','🚦','📌','📍','🗺️'] },
  { label: 'ทั่วไป', emojis: ['❓','✅','❗','⚠️','🚨','🚩','🔴','🟡','🟢','⭐','🔹','🔸','📊','💼','📮','🏷️','🎫','📮'] },
]

function EmojiPickerModal({ cat, onSelect, onClose, iconStyle }) {
  const [search, setSearch] = useState('')
  const [customInput, setCustomInput] = useState(cat?.emoji || '')

  const allEmojis = EMOJI_GROUPS.flatMap(g => g.emojis)
  const searchResult = search.trim()
    ? allEmojis.filter(e => e.includes(search.trim()))
    : null

  return (
    <div className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white w-full sm:max-w-sm rounded-t-3xl sm:rounded-2xl shadow-2xl max-h-[80vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <CategoryIcon emoji={customInput || cat?.emoji || '📝'} size={26} style={iconStyle} />
            <div>
              <p className="text-sm font-bold text-gray-800">เลือกไอคอน</p>
              <p className="text-xs text-gray-400">{cat?.label}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>

        {/* Search */}
        <div className="px-4 pt-3 pb-2">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="ค้นหา emoji หรือพิมพ์เอง..."
            className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
        </div>

        {/* Emoji grid */}
        <div className="flex-1 overflow-y-auto px-4 pb-3 space-y-3">
          {searchResult ? (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {searchResult.length > 0
                ? searchResult.map((e, i) => (
                    <button key={i} onClick={() => { setCustomInput(e); onSelect(cat.id, e) }}
                      className="w-10 h-10 text-xl rounded-xl hover:bg-blue-50 flex items-center justify-center transition-colors active:scale-90">
                      {e}
                    </button>
                  ))
                : <p className="text-xs text-gray-400 py-4 w-full text-center">ไม่พบ emoji ที่ตรงกัน</p>
              }
            </div>
          ) : (
            EMOJI_GROUPS.map((group) => (
              <div key={group.label}>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">{group.label}</p>
                <div className="flex flex-wrap gap-1">
                  {group.emojis.map((e, i) => (
                    <button key={i} onClick={() => { setCustomInput(e); onSelect(cat.id, e) }}
                      className={`w-10 h-10 text-xl rounded-xl flex items-center justify-center transition-colors active:scale-90 ${cat?.emoji === e ? 'bg-blue-100 ring-2 ring-blue-400' : 'hover:bg-gray-100'}`}>
                      {e}
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Custom input + save */}
        <div className="border-t border-gray-100 px-4 py-3 flex items-center gap-2 bg-gray-50">
          <span className="text-xs text-gray-500 shrink-0">พิมพ์เอง:</span>
          <input
            type="text"
            value={customInput}
            onChange={e => setCustomInput(e.target.value)}
            placeholder="emoji หรือ URL รูป"
            className="flex-1 text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
          <button
            onClick={() => onSelect(cat.id, customInput)}
            disabled={!customInput.trim()}
            className="px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-blue-500 hover:bg-blue-600 disabled:opacity-40 transition-colors">
            บันทึก
          </button>
        </div>
      </div>
    </div>
  )
}

const COLOR_PRESETS = [
  { color: '#FEF3C7', textColor: '#D97706' },
  { color: '#DBEAFE', textColor: '#2563EB' },
  { color: '#D1FAE5', textColor: '#059669' },
  { color: '#FEE2E2', textColor: '#DC2626' },
  { color: '#E0E7FF', textColor: '#4338CA' },
  { color: '#FDF4FF', textColor: '#7C3AED' },
  { color: '#F3F4F6', textColor: '#374151' },
]

const DEFAULT_SEED = [
  { value: 'light',            label: 'ไฟฟ้าสาธารณะ',              emoji: '💡', color: '#FEF3C7', textColor: '#D97706' },
  { value: 'road',             label: 'ซ่อมแซมถนน',               emoji: '🛣️', color: '#F3F4F6', textColor: '#374151' },
  { value: 'mosquito',         label: 'พ่นยุง',                   emoji: '🦟', color: '#D1FAE5', textColor: '#059669' },
  { value: 'tree',             label: 'ตัดต้นไม้',                emoji: '🌳', color: '#D1FAE5', textColor: '#059669' },
  { value: 'trash',            label: 'ขยะ / ความสะอาด',         emoji: '🗑️', color: '#F3F4F6', textColor: '#374151' },
  { value: 'water_supply',     label: 'สนับสนุนน้ำอุปโภค',        emoji: '🚿', color: '#DBEAFE', textColor: '#2563EB' },
  { value: 'borrow_equipment', label: 'ยืมพัสดุ',                 emoji: '📦', color: '#E0E7FF', textColor: '#4338CA' },
  { value: 'corruption',       label: 'แจ้งการทุจริต',            emoji: '⚖️', color: '#FEE2E2', textColor: '#DC2626' },
  { value: 'grievance',        label: 'แจ้งเรื่องร้องทุกข์ร้องเรียน', emoji: '📣', color: '#FEF3C7', textColor: '#D97706' },
  { value: 'odor',             label: 'กลิ่นเหม็นรบกวน (มลพิษทางอากาศ)', emoji: '💨', color: '#ECFCCB', textColor: '#4D7C0F' },
  { value: 'other',            label: 'อื่นๆ',                    emoji: '📝', color: '#E0E7FF', textColor: '#4338CA' },
]

const EMOJI_HINTS = [
  { keywords: ['ไฟ', 'แสงสว่าง', 'ไฟฟ้า'],                   emoji: '💡' },
  { keywords: ['ถนน', 'ทางเท้า', 'ซ่อม', 'ลาดยาง'],          emoji: '🛣️' },
  { keywords: ['ยุง', 'พ่นยุง'],                              emoji: '🦟' },
  { keywords: ['ต้นไม้', 'ตัดต้น', 'กิ่งไม้', 'สวน'],        emoji: '🌳' },
  { keywords: ['ขยะ', 'ความสะอาด', 'มูลฝอย'],                emoji: '🗑️' },
  { keywords: ['ร้องทุกข์', 'ร้องทุกข์ร้องเรียน'],            emoji: '📣' },
  { keywords: ['ทุจริต', 'ร้องเรียน', 'ประพฤติ'],             emoji: '⚖️' },
  { keywords: ['น้ำอุปโภค', 'สนับสนุนน้ำ', 'น้ำดื่ม'],       emoji: '🚿' },
  { keywords: ['ผู้ป่วย', 'รับส่ง', 'พยาบาล', 'รถพยาบาล'],   emoji: '🚑' },
  { keywords: ['พัสดุ', 'ยืม', 'ครุภัณฑ์', 'อุปกรณ์'],       emoji: '📦' },
  { keywords: ['อื่น', 'ทั่วไป'],                             emoji: '📝' },
  { keywords: ['น้ำเสีย', 'บำบัดน้ำ'],                        emoji: '💧' },
  { keywords: ['ท่อ', 'ระบาย', 'คูน้ำ'],                     emoji: '🚰' },
  { keywords: ['ฝาท่อ'],                                      emoji: '🔩' },
  { keywords: ['ดูด', 'สิ่งปฏิกูล', 'บ่อเกรอะ'],             emoji: '🚛' },
  { keywords: ['รำคาญ', 'เสียงดัง', 'เหตุ'],                  emoji: '📢' },
  { keywords: ['ขาย', 'หาบเร่', 'แผงลอย'],                   emoji: '🛒' },
  { keywords: ['อาคาร', 'สิ่งก่อสร้าง', 'ก่อสร้าง'],         emoji: '🏢' },
  { keywords: ['ควัน', 'กลิ่น', 'มลพิษ'],                    emoji: '🌫️' },
  { keywords: ['ภาษี', 'ค่าธรรมเนียม'],                       emoji: '📋' },
  { keywords: ['คลอง', 'ลอก', 'ร่องน้ำ'],                    emoji: '🏞️' },
  { keywords: ['สุนัข', 'แมว', 'สัตว์', 'จรจัด'],            emoji: '🐕' },
  { keywords: ['ไฟป่า', 'เพลิง', 'ไฟไหม้'],                  emoji: '🔥' },
  { keywords: ['จราจร', 'รถติด', 'สัญญาณ'],                   emoji: '🚦' },
  { keywords: ['สาธารณสุข', 'สุขภาพ', 'โรค'],                emoji: '🏥' },
  { keywords: ['เด็ก', 'เยาวชน'],                             emoji: '👦' },
  { keywords: ['ผู้สูงอายุ', 'ผู้พิการ', 'คนชรา'],            emoji: '🧓' },
  { keywords: ['กีฬา', 'สนามกีฬา', 'ออกกำลัง'],              emoji: '⚽' },
  { keywords: ['ศาสนา', 'วัด', 'มัสยิด', 'โบสถ์'],           emoji: '⛩️' },
]

function guessEmoji(label) {
  const text = label.trim()
  if (!text) return null
  for (const { keywords, emoji } of EMOJI_HINTS) {
    if (keywords.some((k) => text.includes(k))) return emoji
  }
  return null
}

function SlaInput({ value, onCommit }) {
  const [local, setLocal] = useState(value)
  useEffect(() => { setLocal(value) }, [value])
  return (
    <div className="flex items-center gap-1 justify-center">
      <input
        type="number"
        min="1"
        max="365"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={(e) => onCommit?.(e.target.value)}
        className="w-12 text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-900 text-center focus:outline-none focus:border-amber-400"
      />
      <span className="text-xs text-gray-400">วัน</span>
    </div>
  )
}

function SortableCatItem({ cat, idx, total, onDelete, onMove, onEdit, onToggleActive, onToggleAdhoc, onEditEmoji, iconStyle, techGroups = [], techId = '', slaDays = 3, onTechChange, onSlaChange, savingAssign = false }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: cat.id })
  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState(cat.label)

  function startEdit() { setDraft(cat.label); setIsEditing(true) }
  function cancelEdit() { setDraft(cat.label); setIsEditing(false) }
  function confirmEdit() {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== cat.label) onEdit(cat.id, trimmed)
    setIsEditing(false)
  }
  function handleKeyDown(e) {
    if (e.key === 'Enter') { e.preventDefault(); confirmEdit() }
    if (e.key === 'Escape') cancelEdit()
  }

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      className={`rounded-xl px-3 py-2.5 space-y-2 ${cat.is_active === false ? 'bg-gray-100 opacity-60' : 'bg-gray-50'}`}
    >
      <div className="flex items-center gap-2">
        {/* drag handle */}
        <button
          {...attributes} {...listeners}
          className="cursor-grab active:cursor-grabbing p-1 rounded text-gray-300 hover:text-gray-500 transition-colors shrink-0 touch-none"
        >
          <GripVertical size={16} />
        </button>
        {/* ปุ่มขึ้น/ลง */}
        <div className="flex flex-col gap-0.5 shrink-0">
          <button onClick={() => onMove(idx, -1)} disabled={idx === 0}
            className="p-0.5 rounded text-gray-300 hover:text-gray-600 disabled:opacity-20 transition-colors">
            <ChevronUp size={13} />
          </button>
          <button onClick={() => onMove(idx, 1)} disabled={idx === total - 1}
            className="p-0.5 rounded text-gray-300 hover:text-gray-600 disabled:opacity-20 transition-colors">
            <ChevronDown size={13} />
          </button>
        </div>
        <button
          onClick={() => onEditEmoji?.(cat)}
          title="เปลี่ยนไอคอน"
          className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 hover:ring-2 hover:ring-blue-400 transition-all active:scale-90"
          style={{ backgroundColor: cat.color }}
        ><CategoryIcon emoji={cat.emoji} size={18} style={iconStyle} /></button>

        {/* label — inline edit */}
        {isEditing ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={confirmEdit}
            onKeyDown={handleKeyDown}
            className="flex-1 text-sm text-gray-800 bg-white border border-gray-300 rounded-lg px-2 py-1 focus:outline-none focus:ring-2"
            style={{ '--tw-ring-color': 'var(--color-primary)' }}
          />
        ) : (
          <button
            onClick={startEdit}
            className="flex-1 flex items-center gap-1.5 group text-left"
          >
            <span className="text-sm text-gray-700 group-hover:text-gray-900">{cat.label}</span>
            <Pencil size={11} className="text-gray-300 group-hover:text-gray-500 shrink-0 transition-colors" />
          </button>
        )}

        <button
          onClick={() => onToggleActive?.(cat.id, cat.is_active !== false)}
          className={`px-2 py-1 rounded-full text-[12px] font-bold shrink-0 transition-colors ${cat.is_active === false ? 'bg-gray-200 text-gray-500 hover:bg-green-100 hover:text-green-700' : 'bg-green-100 text-green-700 hover:bg-gray-200 hover:text-gray-500'}`}
        >
          {cat.is_active === false ? 'ปิด' : 'เปิด'}
        </button>
        <button
          onClick={() => onToggleAdhoc?.(cat.id, !!cat.is_adhoc)}
          title="สลับปกติ/เฉพาะกิจ"
          className={`px-2 py-1 rounded-full text-[12px] font-bold shrink-0 transition-colors ${cat.is_adhoc ? 'bg-lime-100 text-lime-700 hover:bg-gray-200 hover:text-gray-500' : 'bg-gray-200 text-gray-500 hover:bg-lime-100 hover:text-lime-700'}`}
        >
          {cat.is_adhoc ? '💨 เฉพาะกิจ' : 'ปกติ'}
        </button>
        <button onClick={() => onDelete(cat.id)}
          className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors shrink-0">
          <Trash2 size={14} />
        </button>
      </div>

      {/* assignment row */}
      <div className="flex items-center gap-2 pl-14">
        {savingAssign && <Loader2 size={12} className="animate-spin text-gray-300 shrink-0" />}
        <select
          value={techId}
          onChange={(e) => onTechChange?.(e.target.value)}
          title={cat.is_active && !techId ? 'หมวดนี้เปิดให้แจ้งได้แต่ยังไม่มีผู้รับผิดชอบ คำร้องจะไม่ถูกมอบหมายให้ใคร' : undefined}
          className={`flex-1 min-w-0 text-xs rounded-lg px-2 py-1.5 focus:outline-none ${
            cat.is_active && !techId
              ? 'border border-red-400 bg-red-50 text-red-700'
              : 'border border-gray-200 bg-white text-gray-700'
          }`}
        >
          <option value="">— ไม่ระบุ —</option>
          {techGroups.map((g) => (
            <optgroup key={g.department_name} label={g.department_name}>
              {g.members.map((t) => (
                <option key={t.id} value={t.id}>
                  {(t.full_name || t.email) + (t.is_dept_head ? ' ⭐' : '')} · {ROLE_LABELS[t.role]?.label ?? t.role}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <SlaInput value={slaDays} onCommit={onSlaChange} />
      </div>
    </div>
  )
}

function SortableDesktopRow({ cat, idx, draft, assign, isSaving, techGroups = [], onSetDraft, onSaveRow, onCancelRow, onStartLabelEdit, onToggleActive, onToggleAdhoc, onDeleteCat, onEditEmoji, iconStyle }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: cat.id })
  const color = COLOR_PRESETS[cat.color_idx ?? 0] ?? COLOR_PRESETS[0]
  const editingLabel = !!draft?.editingLabel
  const hasDraft = !!draft && !editingLabel
  const currentTechId = draft?.technician_id ?? assign?.technician_id ?? ''
  const currentSla = draft?.sla_days ?? assign?.sla_days ?? 3

  return (
    <tr
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      className={`transition-colors ${cat.is_active === false ? 'opacity-50' : ''} ${editingLabel ? 'bg-amber-50' : hasDraft ? 'bg-amber-50/60' : 'hover:bg-gray-50'}`}
    >
      <td className="px-2 py-3 w-8">
        <button
          {...attributes} {...listeners}
          className="cursor-grab active:cursor-grabbing p-1 rounded text-gray-300 hover:text-gray-500 transition-colors touch-none"
          title="ลากเพื่อเปลี่ยนลำดับ"
        >
          <GripVertical size={15} />
        </button>
      </td>
      <td className="px-2 py-3 text-xs text-gray-400 w-8">{idx + 1}</td>
      <td className="px-4 py-3">
        {editingLabel ? (
          <input
            autoFocus
            value={draft.label ?? cat.label}
            onChange={(e) => onSetDraft(cat.value, { label: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); onSaveRow(cat) }
              if (e.key === 'Escape') onCancelRow(cat.value)
            }}
            className="w-full text-sm text-gray-800 bg-white border border-amber-300 rounded-lg px-2 py-1 focus:outline-none"
          />
        ) : (
          <div className="flex items-center gap-2">
            <button
              onClick={() => onEditEmoji?.(cat)}
              title="เปลี่ยนไอคอน"
              className="hover:bg-gray-100 rounded-lg p-1 transition-colors active:scale-90 shrink-0"
            ><CategoryIcon emoji={cat.emoji} size={22} style={iconStyle} /></button>
            <span className="font-medium text-gray-800">{cat.label}</span>
          </div>
        )}
      </td>
      <td className="px-4 py-3">
        <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full"
          style={{ backgroundColor: color.color, color: color.textColor }}>
          <CategoryIcon emoji={cat.emoji} size={13} style={iconStyle} /> {cat.label}
        </span>
      </td>
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-1.5">
          {isSaving && <Loader2 size={12} className="animate-spin text-gray-300 shrink-0" />}
          <select
            value={currentTechId}
            onChange={(e) => onSetDraft(cat.value, { technician_id: e.target.value })}
            title={cat.is_active && !currentTechId ? 'หมวดนี้เปิดให้แจ้งได้แต่ยังไม่มีผู้รับผิดชอบ คำร้องจะไม่ถูกมอบหมายให้ใคร' : undefined}
            className={`text-xs rounded-lg px-2 py-1.5 focus:outline-none max-w-40 ${
              cat.is_active && !currentTechId
                ? 'border border-red-400 bg-red-50 text-red-700'
                : 'border border-gray-200 bg-white text-gray-700'
            }`}
          >
            <option value="">— ไม่ระบุ —</option>
            {techGroups.map((g) => (
              <optgroup key={g.department_name} label={g.department_name}>
                {g.members.map((t) => (
                  <option key={t.id} value={t.id}>
                    {(t.full_name || t.email) + (t.is_dept_head ? ' ⭐' : '')} · {ROLE_LABELS[t.role]?.label ?? t.role}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
      </td>
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-1 justify-center">
          <input
            type="number" min="1" max="365"
            value={currentSla}
            onChange={(e) => onSetDraft(cat.value, { sla_days: e.target.value })}
            className="w-12 text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-900 text-center focus:outline-none focus:border-amber-400"
          />
          <span className="text-xs text-gray-400">วัน</span>
        </div>
      </td>
      <td className="px-4 py-3 text-center">
        <button
          onClick={() => onToggleActive(cat.id, cat.is_active !== false)}
          className={`px-3 py-1 rounded-full text-xs font-bold transition-colors ${cat.is_active === false ? 'bg-gray-200 text-gray-500 hover:bg-green-100 hover:text-green-700' : 'bg-green-100 text-green-700 hover:bg-gray-200 hover:text-gray-500'}`}
        >
          {cat.is_active === false ? 'ปิด' : 'เปิด'}
        </button>
      </td>
      <td className="px-4 py-3 text-center">
        <button
          onClick={() => onToggleAdhoc(cat.id, !!cat.is_adhoc)}
          title="สลับปกติ/เฉพาะกิจ"
          className={`px-3 py-1 rounded-full text-xs font-bold transition-colors ${cat.is_adhoc ? 'bg-lime-100 text-lime-700 hover:bg-gray-200 hover:text-gray-500' : 'bg-gray-200 text-gray-500 hover:bg-lime-100 hover:text-lime-700'}`}
        >
          {cat.is_adhoc ? '💨 เฉพาะกิจ' : 'ปกติ'}
        </button>
      </td>
      <td className="px-4 py-3">
        {editingLabel ? (
          <div className="flex justify-end gap-1.5">
            <button onClick={() => onSaveRow(cat)} disabled={isSaving}
              className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-white bg-amber-500 hover:bg-amber-600 disabled:opacity-50 transition-colors">
              {isSaving ? <Loader2 size={12} className="animate-spin" /> : 'บันทึก'}
            </button>
            <button onClick={() => onCancelRow(cat.value)} disabled={isSaving}
              className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 transition-colors">
              ยกเลิก
            </button>
          </div>
        ) : (
          <div className="flex justify-end gap-1.5">
            <button onClick={() => onStartLabelEdit(cat)}
              className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors" title="แก้ไขชื่อ">
              <Pencil size={14} />
            </button>
            <button onClick={() => onDeleteCat(cat.id)}
              className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors" title="ลบ">
              <Trash2 size={14} />
            </button>
          </div>
        )}
      </td>
    </tr>
  )
}

function CategoryManager({ tenant }) {
  const { patchTenant } = useTenant()
  const [iconStyle, setIconStyle] = useState(tenant?.category_icon_style || 'color')
  const [iconStyleSaving, setIconStyleSaving] = useState(false)
  const [cats, setCats] = useState([])
  const [techs, setTechs] = useState([])
  const [assignMap, setAssignMap] = useState({}) // { catValue: { technician_id, sla_days } }
  const [savingAssign, setSavingAssign] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [seeding, setSeeding] = useState(false)
  const [error, setError] = useState(null)
  const [form, setForm] = useState({ label: '', emoji: '📝', colorIdx: 6, emojiTouched: false })
  const [rowDrafts, setRowDrafts] = useState({}) // { catValue: { label?, technician_id?, sla_days?, editingLabel? } }
  const [savingAll, setSavingAll] = useState(false)
  const [iconPickerCat, setIconPickerCat] = useState(null)
  // แยกแท็ป "ปกติ" กับ "เฉพาะกิจ" (เช่นหมวดกลิ่นเหม็นรบกวนที่ส่งตรงผู้รับผิดชอบ ไม่ผ่านแอดมิน) — ใช้คอลัมน์
  // complaint_categories.is_adhoc แยกกลุ่มให้แอดมินตั้งหมวดใหม่เป็นเฉพาะกิจได้เองในอนาคตโดยไม่ต้องแก้โค้ด
  const [categoryTab, setCategoryTab] = useState('normal') // 'normal' | 'adhoc'

  // รูปแบบไอคอนหมวดหมู่ ระดับ อปท. — 'native' emoji ตัวอักษรธรรมดา, 'color' OpenMoji สี (ค่าเริ่มต้น),
  // 'outline' OpenMoji เส้นขาวดำ (dataset เดียวกับสี คนละโฟลเดอร์ CDN) มีผลกับทุกจุดที่ใช้ CategoryIcon
  async function setCategoryIconStyle(nextStyle) {
    if (nextStyle === iconStyle) return
    setIconStyleSaving(true)
    setIconStyle(nextStyle) // optimistic
    try {
      const { error: err } = await supabase
        .from('municipalities').update({ category_icon_style: nextStyle }).eq('id', tenant.id)
      if (err) throw err
      patchTenant({ category_icon_style: nextStyle })
    } catch (err) {
      setIconStyle(tenant?.category_icon_style || 'color')
      setError('เปลี่ยนรูปแบบไอคอนไม่สำเร็จ: ' + err.message)
    } finally {
      setIconStyleSaving(false)
    }
  }

  async function updateCatEmoji(catId, emoji) {
    if (!emoji?.trim()) return
    const { error: err } = await supabase.from('complaint_categories').update({ emoji: emoji.trim() }).eq('id', catId)
    if (err) { setError('บันทึกไม่สำเร็จ: ' + err.message); return }
    setCats((prev) => prev.map((c) => c.id === catId ? { ...c, emoji: emoji.trim() } : c))
    setIconPickerCat(null)
  }

  function setDraft(catValue, patch) {
    setRowDrafts((prev) => ({ ...prev, [catValue]: { ...(prev[catValue] ?? {}), ...patch } }))
  }
  function isRowEditing(catValue) { return !!rowDrafts[catValue] }
  function cancelRow(catValue) {
    setRowDrafts((prev) => { const n = { ...prev }; delete n[catValue]; return n })
  }
  async function saveAll() {
    const pending = cats.filter(c => rowDrafts[c.value])
    if (!pending.length) return
    setSavingAll(true)
    await Promise.all(pending.map(cat => saveRow(cat)))
    setSavingAll(false)
  }
  function startLabelEdit(cat) {
    setRowDrafts((prev) => ({ ...prev, [cat.value]: { ...(prev[cat.value] ?? {}), editingLabel: true, label: cat.label } }))
  }
  async function saveRow(cat) {
    const d = rowDrafts[cat.value]
    if (!d) return
    setSavingAssign(cat.value)
    const ops = []
    const newLabel = d.label?.trim()
    if (d.editingLabel && newLabel && newLabel !== cat.label) ops.push(editCat(cat.id, newLabel))
    const techChanged = d.technician_id !== undefined
    const slaChanged = d.sla_days !== undefined
    if (techChanged || slaChanged) {
      const slaVal = slaChanged ? Math.max(1, parseInt(d.sla_days) || 1) : undefined
      ops.push(
        supabase.from('category_assignments').upsert({
          municipality_id: tenant.id,
          category: cat.value,
          ...(techChanged ? { technician_id: d.technician_id || null } : {}),
          ...(slaChanged ? { sla_days: slaVal } : {}),
        }, { onConflict: 'municipality_id,category' }).then(() => {
          setAssignMap((prev) => ({
            ...prev,
            [cat.value]: {
              ...(prev[cat.value] ?? { sla_days: 3 }),
              ...(techChanged ? { technician_id: d.technician_id ?? '' } : {}),
              ...(slaChanged ? { sla_days: slaVal } : {}),
            },
          }))
        })
      )
    }
    await Promise.all(ops)
    setRowDrafts((prev) => { const n = { ...prev }; delete n[cat.value]; return n })
    setSavingAssign(null)
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor,   { activationConstraint: { delay: 200, tolerance: 5 } }),
  )

  async function handleDragEnd({ active, over }) {
    if (!over || active.id === over.id) return
    const oldIdx = cats.findIndex((c) => c.id === active.id)
    const newIdx = cats.findIndex((c) => c.id === over.id)
    const reordered = arrayMove(cats, oldIdx, newIdx)
    setCats(reordered)
    await Promise.all(reordered.map((cat, i) =>
      supabase.from('complaint_categories').update({ sort_order: i }).eq('id', cat.id)
    ))
  }

  async function fetchCats() {
    if (!tenant?.id) return
    setLoading(true)
    setError(null)
    try {
      const [catsRes, assignRes] = await Promise.all([
        supabase.from('complaint_categories').select('*').eq('municipality_id', tenant.id).order('sort_order'),
        supabase.from('category_assignments').select('category,technician_id,sla_days').eq('municipality_id', tenant.id),
      ])
      if (catsRes.error) setError('โหลดข้อมูลไม่ได้: ' + catsRes.error.message)
      setCats(catsRes.data ?? [])
      const aMap = {}
      for (const a of assignRes.data ?? []) {
        aMap[a.category] = { technician_id: a.technician_id ?? '', sla_days: a.sla_days ?? 3 }
      }
      setAssignMap(aMap)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchCats()
    const safety = setTimeout(() => setLoading(false), 12000)
    return () => clearTimeout(safety)
  }, [tenant?.id])

  useEffect(() => {
    if (!tenant?.id) return
    // ใช้ helper กลางร่วมกับ dropdown มอบหมายรายคำร้องใน ComplaintsManager.jsx กัน pool คนไม่ตรงกัน
    fetchAssignableStaff(tenant.id).then(setTechs)
  }, [tenant?.id])
  // จัดกลุ่มตามกอง ใช้ render เป็น <optgroup> — คนหลักสิบ/ร้อยคนจะได้ไม่ต้องไล่หาในลิสต์แบนราบยาวๆ
  const techGroups = groupStaffByDepartment(techs)
  const visibleCats = cats.filter((c) => categoryTab === 'adhoc' ? !!c.is_adhoc : !c.is_adhoc)
  // นับจากทุกหมวดที่ is_active ไม่ใช่แค่แท็บที่เปิดอยู่ — หมวดเฉพาะกิจที่ไม่มีผู้รับผิดชอบ
  // อันตรายกว่าหมวดปกติด้วยซ้ำ (RLS ให้เห็นเฉพาะ assigned_to ถ้า NULL คือไม่มีใครเห็นเลย)
  const unassignedActiveCats = cats.filter((c) => c.is_active && !assignMap[c.value]?.technician_id)

  async function handleTechChange(catValue, techId) {
    setSavingAssign(catValue)
    setAssignMap((prev) => ({ ...prev, [catValue]: { ...(prev[catValue] ?? { sla_days: 3 }), technician_id: techId } }))
    await supabase.from('category_assignments').upsert({
      municipality_id: tenant.id,
      category: catValue,
      technician_id: techId || null,
    }, { onConflict: 'municipality_id,category' })
    setSavingAssign(null)
  }

  async function handleSlaChange(catValue, rawDays) {
    const days = Math.max(1, parseInt(rawDays) || 1)
    setSavingAssign(catValue)
    setAssignMap((prev) => ({ ...prev, [catValue]: { ...(prev[catValue] ?? { technician_id: '' }), sla_days: days } }))
    await supabase.from('category_assignments').upsert({
      municipality_id: tenant.id,
      category: catValue,
      sla_days: days,
    }, { onConflict: 'municipality_id,category' })
    setSavingAssign(null)
  }

  async function addCat() {
    const label = form.label.trim()
    const emoji = form.emoji.trim() || '📝'
    if (!label || !tenant?.id) return
    const value = `cat_${Date.now().toString(36)}`
    setSaving(true)
    setError(null)
    const preset = COLOR_PRESETS[form.colorIdx]
    const { data, error: err } = await supabase.from('complaint_categories').insert({
      municipality_id: tenant.id,
      value,
      label,
      emoji,
      color:      preset.color,
      text_color: preset.textColor,
      sort_order: cats.length,
      is_adhoc:   categoryTab === 'adhoc', // เพิ่มระหว่างอยู่แท็บไหน ก็สร้างเป็นประเภทงานนั้นไปเลย กันงง
    }).select().single()
    if (err) {
      setError('เพิ่มไม่สำเร็จ: ' + err.message)
    } else if (data) {
      setCats((prev) => [...prev, data])
      setForm({ label: '', emoji: '📝', colorIdx: 6, emojiTouched: false })
    }
    setSaving(false)
  }

  async function deleteCat(id) {
    const cat = cats.find((c) => c.id === id)
    if (!window.confirm(`ลบประเภท "${cat?.label}" ออกจากระบบ?\n\nคำร้องที่มีอยู่แล้วจะไม่หายไป แต่จะไม่มีประเภทนี้ให้เลือกในอนาคต`)) return
    const { error: err } = await supabase.from('complaint_categories').delete().eq('id', id)
    if (err) { setError('ลบไม่สำเร็จ: ' + err.message); return }
    setCats((prev) => prev.filter((c) => c.id !== id))
  }

  async function editCat(id, newLabel) {
    const { error: err } = await supabase.from('complaint_categories').update({ label: newLabel }).eq('id', id)
    if (err) { setError('แก้ไขไม่สำเร็จ: ' + err.message); return }
    setCats((prev) => prev.map((c) => c.id === id ? { ...c, label: newLabel } : c))
  }

  async function toggleActive(id, current) {
    const { error: err } = await supabase.from('complaint_categories').update({ is_active: !current }).eq('id', id)
    if (err) { setError('บันทึกไม่สำเร็จ: ' + err.message); return }
    setCats((prev) => prev.map((c) => c.id === id ? { ...c, is_active: !current } : c))
  }

  async function toggleAdhoc(id, current) {
    const { error: err } = await supabase.from('complaint_categories').update({ is_adhoc: !current }).eq('id', id)
    if (err) { setError('บันทึกไม่สำเร็จ: ' + err.message); return }
    setCats((prev) => prev.map((c) => c.id === id ? { ...c, is_adhoc: !current } : c))
  }

  async function moveCat(idx, dir) {
    const swapIdx = idx + dir
    if (swapIdx < 0 || swapIdx >= cats.length) return
    const a = cats[idx]
    const b = cats[swapIdx]
    await Promise.all([
      supabase.from('complaint_categories').update({ sort_order: b.sort_order }).eq('id', a.id),
      supabase.from('complaint_categories').update({ sort_order: a.sort_order }).eq('id', b.id),
    ])
    setCats((prev) => {
      const next = [...prev]
      next[idx]     = { ...a, sort_order: b.sort_order }
      next[swapIdx] = { ...b, sort_order: a.sort_order }
      return next.sort((x, y) => x.sort_order - y.sort_order)
    })
  }

  async function seedDefaults() {
    if (!tenant?.id) return
    setSeeding(true)
    setError(null)
    const rows = DEFAULT_SEED.map((d, i) => ({ ...d, text_color: d.textColor, municipality_id: tenant.id, sort_order: i }))
      .map(({ textColor, ...rest }) => rest)
    const { error: err } = await supabase.from('complaint_categories').upsert(rows, { onConflict: 'municipality_id,value' })
    if (err) setError('โหลดค่าเริ่มต้นไม่สำเร็จ: ' + err.message)
    else await fetchCats()
    setSeeding(false)
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-4">
      {iconPickerCat && (
        <EmojiPickerModal
          cat={iconPickerCat}
          onSelect={updateCatEmoji}
          onClose={() => setIconPickerCat(null)}
          iconStyle={iconStyle}
        />
      )}
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-gray-700">จัดการประเภทคำร้อง</h2>
        {cats.length === 0 && !loading && (
          <button
            onClick={seedDefaults}
            disabled={seeding}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            {seeding ? <Loader2 size={12} className="animate-spin" /> : <Tag size={12} />}
            โหลดค่าเริ่มต้น
          </button>
        )}
      </div>

      {/* รูปแบบไอคอน — มีผลกับไอคอนหมวดหมู่ทุกจุดที่แสดงผล (ฟอร์มยื่นคำร้อง, หน้าเลือกหมวดหมู่, ที่นี่) */}
      <div>
        <p className="text-xs font-semibold text-gray-500 mb-1.5">รูปแบบไอคอน</p>
        <div className="inline-flex rounded-xl border border-gray-200 p-1 bg-gray-50">
          {[
            { key: 'native',  label: 'Emoji ธรรมดา' },
            { key: 'color',   label: 'สีสัน' },
            { key: 'outline', label: 'เส้นขอบ' },
          ].map(opt => (
            <button key={opt.key} type="button" disabled={iconStyleSaving}
              onClick={() => setCategoryIconStyle(opt.key)}
              className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all disabled:opacity-50"
              style={iconStyle === opt.key
                ? { backgroundColor: 'var(--color-primary)', color: '#fff' }
                : { color: '#6b7280' }}>
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
          ⚠️ {error}
        </div>
      )}

      {/* Add form */}
      <div className="space-y-3 bg-gray-50 rounded-2xl p-4">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">เพิ่มประเภทใหม่</p>
        <div className="flex gap-2">
          <input
            type="text"
            value={form.emoji}
            onChange={(e) => setForm((p) => ({ ...p, emoji: e.target.value, emojiTouched: true }))}
            placeholder="emoji"
            className="w-16 border border-gray-200 rounded-xl px-2 py-2 text-center text-lg bg-white text-gray-900 focus:outline-none focus:ring-2"
            style={{ '--tw-ring-color': 'var(--color-primary)' }}
          />
          <input
            type="text"
            value={form.label}
            onChange={(e) => {
              const label = e.target.value
              const suggested = guessEmoji(label)
              setForm((p) => ({
                ...p,
                label,
                emoji: p.emojiTouched ? p.emoji : (suggested ?? p.emoji),
              }))
            }}
            placeholder="ชื่อประเภท เช่น ไฟฟ้าสาธารณะ"
            className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 bg-white focus:outline-none focus:ring-2"
            style={{ '--tw-ring-color': 'var(--color-primary)' }}
          />
        </div>
        {/* Color picker */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">สี:</span>
          {COLOR_PRESETS.map((p, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setForm((prev) => ({ ...prev, colorIdx: i }))}
              className="w-6 h-6 rounded-full border-2 transition-transform"
              style={{
                backgroundColor: p.color,
                borderColor: form.colorIdx === i ? p.textColor : 'transparent',
                transform: form.colorIdx === i ? 'scale(1.25)' : 'scale(1)',
              }}
            />
          ))}
          {/* preview */}
          <span
            className="ml-auto text-xs font-medium px-2 py-0.5 rounded-full"
            style={{ backgroundColor: COLOR_PRESETS[form.colorIdx].color, color: COLOR_PRESETS[form.colorIdx].textColor }}
          >
            {form.emoji || '📝'} {form.label || 'ตัวอย่าง'}
          </span>
        </div>
        <button
          onClick={addCat}
          disabled={saving || !form.label.trim()}
          className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-sm font-medium text-white disabled:opacity-50"
          style={{ backgroundColor: 'var(--color-primary)' }}
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          เพิ่มประเภท
        </button>
      </div>

      {/* Global save bar */}
      {Object.keys(rowDrafts).some(k => !rowDrafts[k].editingLabel || rowDrafts[k].technician_id !== undefined || rowDrafts[k].sla_days !== undefined) && (
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-xl">
          <span className="text-sm text-amber-700 font-medium">
            มีการเปลี่ยนแปลง {Object.keys(rowDrafts).length} รายการที่ยังไม่ได้บันทึก
          </span>
          <div className="flex items-center gap-2">
            <button onClick={() => setRowDrafts({})} disabled={savingAll}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-600 bg-white border border-gray-200 hover:bg-gray-50 disabled:opacity-50 transition-colors">
              ยกเลิกทั้งหมด
            </button>
            <button onClick={saveAll} disabled={savingAll}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-bold text-white bg-amber-500 hover:bg-amber-600 disabled:opacity-50 transition-colors">
              {savingAll ? <Loader2 size={12} className="animate-spin" /> : null}
              บันทึกทั้งหมด
            </button>
          </div>
        </div>
      )}

      {/* แท็ปแยก "ปกติ"/"เฉพาะกิจ" — เฉพาะกิจ = ส่งตรงผู้รับผิดชอบ ไม่ผ่านแอดมิน (เช่นกลิ่นเหม็นรบกวน) */}
      <div className="flex gap-1.5">
        <button onClick={() => setCategoryTab('normal')}
          className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors ${
            categoryTab === 'normal' ? 'text-white border-transparent' : 'text-gray-600 bg-white border-gray-200 hover:bg-gray-50'
          }`}
          style={categoryTab === 'normal' ? { backgroundColor: 'var(--color-primary)' } : {}}>
          ปกติ ({cats.filter((c) => !c.is_adhoc).length})
        </button>
        <button onClick={() => setCategoryTab('adhoc')}
          className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors ${
            categoryTab === 'adhoc' ? 'text-white border-transparent' : 'text-lime-700 bg-lime-50 border-lime-200 hover:bg-lime-100'
          }`}
          style={categoryTab === 'adhoc' ? { backgroundColor: '#65a30d' } : {}}>
          💨 เฉพาะกิจ ({cats.filter((c) => c.is_adhoc).length})
        </button>
      </div>

      {/* เตือนหมวดที่เปิดใช้แต่ยังไม่มีผู้รับผิดชอบ — คำร้องหมวดนั้นจะตกจุดบอดทันที
          trigger auto_assign_complaint ดึง technician_id จาก category_assignments ถ้าไม่มีแถว
          assigned_to จะเป็น NULL (ช่าง/staff กรองไม่เห็น) และ due_date ก็เป็น NULL ด้วย
          (SELECT INTO ที่ไม่ match ทิ้ง v_sla ไว้เป็น NULL แล้ว date + NULL = NULL) จึงไม่ถูก
          นับเป็นงานเกินกำหนดในจอช่างหรือหน้ารายงานอีก = มองไม่เห็นซ้อนสองชั้น */}
      {!loading && unassignedActiveCats.length > 0 && (
        <div className="mb-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5">
          <p className="text-xs font-bold text-amber-900">
            ⚠️ มี {unassignedActiveCats.length} หมวดที่เปิดให้ประชาชนแจ้งได้ แต่ยังไม่ได้ตั้งผู้รับผิดชอบ
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-amber-800">
            คำร้องที่เข้ามาในหมวดเหล่านี้จะไม่ถูกมอบหมายให้ใครโดยอัตโนมัติ เจ้าหน้าที่และช่างจะมองไม่เห็น
            และจะไม่ถูกนับเป็นงานเกินกำหนดในรายงานด้วย — เลือกผู้รับผิดชอบในช่องที่ขึ้นกรอบแดง
            หรือปิดหมวดนั้นไปก่อน
          </p>
          <p className="mt-1.5 text-[11px] font-semibold text-amber-900">
            {unassignedActiveCats.map((c) => c.label).join(' · ')}
          </p>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-8"><Loader2 size={22} className="animate-spin text-gray-300" /></div>
      ) : cats.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-6">
          ยังไม่มีประเภทคำร้อง — กด <strong>โหลดค่าเริ่มต้น</strong> หรือเพิ่มเองด้านบน
        </p>
      ) : visibleCats.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-6">
          {categoryTab === 'adhoc' ? 'ยังไม่มีประเภทคำร้องเฉพาะกิจ' : 'ยังไม่มีประเภทคำร้องปกติ'}
        </p>
      ) : (
        <>
          {/* Mobile: DnD sortable cards */}
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={visibleCats.map((c) => c.id)} strategy={verticalListSortingStrategy}>
              <div className="md:hidden space-y-2">
                {visibleCats.map((cat, idx) => (
                  <SortableCatItem key={cat.id} cat={cat} idx={idx} total={visibleCats.length}
                    onDelete={deleteCat} onMove={moveCat} onEdit={editCat} onToggleActive={toggleActive}
                    onToggleAdhoc={toggleAdhoc}
                    onEditEmoji={setIconPickerCat}
                    iconStyle={iconStyle}
                    techGroups={techGroups}
                    techId={assignMap[cat.value]?.technician_id ?? ''}
                    slaDays={assignMap[cat.value]?.sla_days ?? 3}
                    onTechChange={(tid) => handleTechChange(cat.value, tid)}
                    onSlaChange={(d) => handleSlaChange(cat.value, d)}
                    savingAssign={savingAssign === cat.value}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
          {/* Desktop table — DnD sortable */}
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={visibleCats.map((c) => c.id)} strategy={verticalListSortingStrategy}>
              <div className="hidden md:block border border-gray-200 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-2 py-3 w-8" />
                      <th className="px-2 py-3 text-left text-xs font-semibold text-gray-500 w-8">#</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">ประเภท</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">ป้ายสี</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">ช่างรับผิดชอบ</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 w-24">ระยะเวลา</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 w-20">สถานะ</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 w-24">ประเภทงาน</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 w-20">จัดการ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {visibleCats.map((cat, idx) => (
                      <SortableDesktopRow
                        key={cat.id}
                        cat={cat}
                        idx={idx}
                        draft={rowDrafts[cat.value]}
                        assign={assignMap[cat.value]}
                        isSaving={savingAssign === cat.value || savingAll}
                        techGroups={techGroups}
                        onSetDraft={setDraft}
                        onSaveRow={saveRow}
                        onCancelRow={cancelRow}
                        onStartLabelEdit={startLabelEdit}
                        onToggleActive={toggleActive}
                        onToggleAdhoc={toggleAdhoc}
                        onDeleteCat={deleteCat}
                        onEditEmoji={setIconPickerCat}
                        iconStyle={iconStyle}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </SortableContext>
          </DndContext>
        </>
      )}
    </div>
  )
}

// ─── Print Report (แบบฟอร์มราชการ) ────────────────────────────────────────────
function handlePrint({ view, month, year, viewLabel, total, completed, rejected, active, rate, avgDays, catData, trend, tenant }) {
  const today = new Date()
  const thaiDate = `${today.getDate()} ${['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'][today.getMonth()]} ${today.getFullYear() + 543}`

  const trendRows = trend.map(t => `
    <tr>
      <td style="padding:6px 12px;border:1px solid #ddd;text-align:center">${t.label}</td>
      <td style="padding:6px 12px;border:1px solid #ddd;text-align:center">${t.submitted}</td>
      <td style="padding:6px 12px;border:1px solid #ddd;text-align:center">${t.completed}</td>
      <td style="padding:6px 12px;border:1px solid #ddd;text-align:center">${t.submitted - t.completed}</td>
    </tr>`).join('')

  const catRows = catData.map((c, i) => `
    <tr>
      <td style="padding:6px 12px;border:1px solid #ddd;text-align:center">${i + 1}</td>
      <td style="padding:6px 12px;border:1px solid #ddd">${c.emoji} ${c.name}</td>
      <td style="padding:6px 12px;border:1px solid #ddd;text-align:center">${c.count}</td>
      <td style="padding:6px 12px;border:1px solid #ddd;text-align:center">${total > 0 ? Math.round(c.count / total * 100) : 0}%</td>
    </tr>`).join('')

  const trendHeader = view === 'month' ? 'สัปดาห์' : view === 'year' ? 'เดือน' : 'ปี'

  const html = `<!DOCTYPE html><html lang="th"><head>
  <meta charset="UTF-8">
  <title>รายงาน ${viewLabel} - ${tenant?.name}</title>
  <style>
    @page { size: A4; margin: 2cm 2.5cm; }
    body { font-family: 'TH Sarabun New', Sarabun, sans-serif; font-size: 16pt; color: #000; line-height: 1.6; }
    h1 { font-size: 20pt; text-align: center; margin: 0 0 4px; }
    .sub { text-align: center; font-size: 14pt; margin-bottom: 20px; }
    .memo { display: grid; grid-template-columns: 120px 1fr; gap: 4px 8px; margin-bottom: 20px; font-size: 15pt; }
    .memo b { font-weight: 600; }
    .section { margin: 16px 0 8px; font-size: 16pt; font-weight: 700; border-bottom: 1px solid #000; padding-bottom: 2px; }
    .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 12px 0; }
    .stat-box { border: 1px solid #aaa; padding: 8px 10px; text-align: center; }
    .stat-box .num { font-size: 22pt; font-weight: 900; }
    .stat-box .lbl { font-size: 13pt; }
    table { width: 100%; border-collapse: collapse; font-size: 14pt; margin: 8px 0; }
    th { background: #e8e8e8; padding: 7px 12px; border: 1px solid #ddd; text-align: center; }
    .sign { margin-top: 60px; display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
    .sign-box { text-align: center; }
    .sign-line { border-top: 1px solid #000; width: 220px; margin: 60px auto 4px; }
    .sign-label { font-size: 13pt; }
    @media print { button { display: none; } }
  </style>
</head><body>

  <h1>บันทึกข้อความ</h1>
  <p class="sub">รายงานสรุปผลการดำเนินงานการรับเรื่องร้องทุกข์ผ่านระบบออนไลน์</p>

  <div class="memo">
    <b>ส่วนราชการ</b><span>${tenant?.name ?? 'หน่วยงาน'}</span>
    <b>วันที่</b><span>${thaiDate}</span>
    <b>เรื่อง</b><span>รายงานสรุปผลการรับคำร้อง ${viewLabel}</span>
    <b>เรียน</b><span>ผู้บังคับบัญชา</span>
  </div>

  <p style="text-indent:2.5em">ตามที่ ${tenant?.name ?? 'หน่วยงาน'} ได้เปิดให้บริการรับเรื่องร้องทุกข์ผ่านระบบบริการออนไลน์ เพื่ออำนวยความสะดวกแก่ประชาชนนั้น ขอรายงานผลการดำเนินงาน${viewLabel} ดังนี้</p>

  <div class="section">๑. สรุปสถิติคำร้อง</div>
  <div class="stats">
    <div class="stat-box"><div class="num">${total}</div><div class="lbl">คำร้องทั้งหมด</div></div>
    <div class="stat-box"><div class="num" style="color:#10b981">${completed}</div><div class="lbl">ดำเนินการแล้วเสร็จ</div></div>
    <div class="stat-box"><div class="num" style="color:#f59e0b">${active}</div><div class="lbl">อยู่ระหว่างดำเนินการ</div></div>
    <div class="stat-box"><div class="num" style="color:#ef4444">${rejected}</div><div class="lbl">ปฏิเสธคำร้อง</div></div>
  </div>
  <p>อัตราการปิดงาน <b>${rate}%</b>${avgDays !== null ? ` &nbsp;|&nbsp; เฉลี่ยระยะเวลาดำเนินการ <b>${avgDays} วันทำการ</b>` : ''}</p>

  <div class="section">๒. แนวโน้มการรับคำร้อง</div>
  <table>
    <thead><tr>
      <th>${trendHeader}</th><th>คำร้องที่รับ</th><th>ดำเนินการแล้วเสร็จ</th><th>คงค้าง</th>
    </tr></thead>
    <tbody>${trendRows}</tbody>
  </table>

  <div style="page-break-inside:avoid">
  <div class="section">๓. ประเภทคำร้องที่พบบ่อย</div>
  <table>
    <thead><tr><th>ลำดับ</th><th>ประเภทคำร้อง</th><th>จำนวน (ราย)</th><th>คิดเป็น (%)</th></tr></thead>
    <tbody>${catRows || '<tr><td colspan="4" style="text-align:center;padding:12px;border:1px solid #ddd">ไม่มีข้อมูล</td></tr>'}</tbody>
  </table>
  </div>

  <p style="margin-top:16px;text-indent:2.5em">จึงเรียนมาเพื่อโปรดทราบ</p>

  <div class="sign">
    <div class="sign-box">
      <div class="sign-line"></div>
      <div class="sign-label">ผู้รายงาน</div>
      <div class="sign-label">ตำแหน่ง .................................</div>
      <div class="sign-label">วันที่ ${thaiDate}</div>
    </div>
    <div class="sign-box">
      <div class="sign-line"></div>
      <div class="sign-label">ผู้บังคับบัญชา</div>
      <div class="sign-label">ตำแหน่ง .................................</div>
      <div class="sign-label">วันที่ .................................</div>
    </div>
  </div>

</body></html>`

  const w = window.open('', '_blank', 'width=900,height=700')
  w.document.write(html)
  w.document.close()
  w.focus()
  setTimeout(() => w.print(), 500)
}

// ─── Report Manager ───────────────────────────────────────────────────────────
// ระยะเวลาดำเนินการของคำร้อง 1 เรื่อง นับเป็น "วันทำการ" (ตัดเสาร์-อาทิตย์และวันหยุดนักขัตฤกษ์)
// ต้องให้ค่าตรงกับ ReportManager ซึ่งคำนวณตัวเลขชุดเดียวกัน
const resolutionDays = c => workingDaysBetween(c.created_at, c.updated_at) ?? 0

const MONTHS_TH = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.']
const MONTHS_FULL_TH = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน',
  'กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม']

function ReportManager({ complaints, tenant, technicians = [] }) {
  const now = new Date()
  const [view, setView]   = useState('month') // 'month' | 'year' | 'all'
  const [month, setMonth] = useState(now.getMonth())
  const [year, setYear]   = useState(now.getFullYear())

  const years = [...new Set(complaints.map(c => new Date(c.created_at).getFullYear()))]
  if (!years.includes(now.getFullYear())) years.push(now.getFullYear())
  years.sort((a, b) => b - a)

  // กรองข้อมูลตาม view
  const viewData = complaints.filter(c => {
    const d = new Date(c.created_at)
    if (view === 'month') return d.getMonth() === month && d.getFullYear() === year
    if (view === 'year')  return d.getFullYear() === year
    return true
  })

  const total     = viewData.length
  const completed = viewData.filter(c => c.status === 'completed').length
  const rejected  = viewData.filter(c => c.status === 'rejected').length
  const active    = total - completed - rejected
  const rate      = total > 0 ? Math.round(completed / total * 100) : 0

  // เฉลี่ยวันปิดงาน
  const closedData = complaints.filter(c => {
    if (c.status !== 'completed') return false
    const d = new Date(c.updated_at)
    if (view === 'month') return d.getMonth() === month && d.getFullYear() === year
    if (view === 'year')  return d.getFullYear() === year
    return true
  })
  const avgDays = closedData.length > 0
    ? Math.round(closedData.reduce((s, c) => s + resolutionDays(c), 0) / closedData.length)
    : null

  // เทียบเดือนที่แล้ว (เฉพาะ view === 'month')
  const prevMonth = month === 0 ? 11 : month - 1
  const prevYear  = month === 0 ? year - 1 : year
  const prevData  = view === 'month'
    ? complaints.filter(c => { const d = new Date(c.created_at); return d.getMonth() === prevMonth && d.getFullYear() === prevYear })
    : []
  const prevTotal     = prevData.length
  const prevCompleted = prevData.filter(c => c.status === 'completed').length
  const prevRate      = prevTotal > 0 ? Math.round(prevCompleted / prevTotal * 100) : 0
  const prevClosedData = complaints.filter(c => {
    if (c.status !== 'completed') return false
    const d = new Date(c.updated_at)
    return d.getMonth() === prevMonth && d.getFullYear() === prevYear
  })
  const prevAvgDays = prevClosedData.length > 0
    ? Math.round(prevClosedData.reduce((s, c) => s + resolutionDays(c), 0) / prevClosedData.length)
    : null

  // SLA compliance — breakdown ระยะเวลาปิดงาน
  const slaIn3    = closedData.filter(c => resolutionDays(c) <= 3).length
  const slaIn7    = closedData.filter(c => resolutionDays(c) <= 7).length
  const slaIn14   = closedData.filter(c => resolutionDays(c) <= 14).length
  const slaOver14 = closedData.length - slaIn14
  const slaRate7  = closedData.length > 0 ? Math.round(slaIn7 / closedData.length * 100) : null

  // ผลงานช่าง — lookup ชื่อจาก technicians array ด้วย assigned_to UUID
  const techMap = {}
  complaints.filter(c => c.status === 'completed' && c.assigned_to).forEach(c => {
    const tech = technicians.find(t => t.id === c.assigned_to)
    const name = tech?.full_name || tech?.email || null
    if (!name) return
    if (!techMap[name]) techMap[name] = { name, completed: 0, totalDays: 0 }
    techMap[name].completed++
    techMap[name].totalDays += resolutionDays(c)
  })
  const techLeaderboard = Object.values(techMap)
    .map(t => ({ ...t, avgDays: Math.round(t.totalDays / t.completed) }))
    .sort((a, b) => b.completed - a.completed)
    .slice(0, 5)

  // กราฟแนวโน้ม
  const trend = view === 'all'
    ? years.slice().reverse().map(y => {
        const cs = complaints.filter(c => new Date(c.created_at).getFullYear() === y)
        return { label: String(y + 543), submitted: cs.length, completed: cs.filter(c => c.status === 'completed').length }
      })
    : view === 'year'
    ? Array.from({ length: 12 }, (_, i) => {
        const cs = complaints.filter(c => {
          const d = new Date(c.created_at)
          return d.getMonth() === i && d.getFullYear() === year
        })
        return { label: MONTHS_TH[i], submitted: cs.length, completed: cs.filter(c => c.status === 'completed').length }
      })
    : Array.from({ length: 4 }, (_, i) => {
        const weekStart = i * 7 + 1
        const weekEnd   = i === 3 ? 31 : weekStart + 6
        const cs = complaints.filter(c => {
          const d = new Date(c.created_at)
          return d.getMonth() === month && d.getFullYear() === year && d.getDate() >= weekStart && d.getDate() <= weekEnd
        })
        return { label: `สัปดาห์ ${i + 1}`, submitted: cs.length, completed: cs.filter(c => c.status === 'completed').length }
      })

  // ประเภทคำร้อง
  const catCount = {}
  viewData.forEach(c => { catCount[c.category] = (catCount[c.category] || 0) + 1 })
  const catDataAll = Object.entries(catCount)
    .map(([cat, count]) => ({ name: CATEGORY_LABEL[cat] ?? cat, emoji: CATEGORY_EMOJI[cat] ?? '📄', count }))
    .sort((a, b) => b.count - a.count)
  const catData = catDataAll.slice(0, 6)
  const otherCount = catDataAll.slice(6).reduce((s, d) => s + d.count, 0)
  const catPieData = otherCount > 0 ? [...catData, { name: 'อื่นๆ', emoji: '📄', count: otherCount }] : catData

  const CAT_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#94a3b8']

  // เกณฑ์ค้างงานนับเป็นวันทำการ — คำร้องที่ยื่นก่อนวันหยุดยาวจะไม่ถูกตีว่าค้าง
  // ทั้งที่สำนักงานยังไม่ได้เปิดทำการ
  // คำร้องค้างนานเกิน 15 วันทำการ
  const overdue = complaints
    .filter(c => !['completed','rejected'].includes(c.status) &&
      workingDaysSince(c.created_at, now) > 15)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    .slice(0, 6)

  // รับเรื่องแล้ว (received) แต่ช่างยังไม่รับงานต่อเกิน 7 วันทำการ
  const noTechAction = complaints
    .filter(c => c.status === 'received' &&
      workingDaysSince(c.updated_at, now) > 7)
    .sort((a, b) => new Date(a.updated_at) - new Date(b.updated_at))
    .slice(0, 6)

  const rateColor = rate >= 70 ? '#10b981' : rate >= 40 ? '#f59e0b' : '#ef4444'

  const viewLabel = view === 'month'
    ? `${MONTHS_FULL_TH[month]} ${year + 543}`
    : view === 'year' ? `ปี ${year + 543}`
    : 'ทั้งหมด'

  return (
    <div className="space-y-5 pb-32">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-base font-bold text-gray-800 flex items-center gap-2">
            <TrendingUp size={18} style={{ color: 'var(--color-primary)' }} />
            รายงานสรุป
          </h2>
          <p className="text-xs text-gray-400 mt-0.5">{viewLabel} · {tenant?.name}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* View tabs */}
          <div className="flex rounded-xl border border-gray-200 overflow-hidden bg-white text-xs font-medium">
            {[['month','รายเดือน'],['year','รายปี'],['all','ทั้งหมด']].map(([v, label]) => (
              <button key={v} onClick={() => setView(v)}
                className={`px-3 py-2 transition-colors ${view === v ? 'text-white' : 'text-gray-600 hover:bg-gray-50'}`}
                style={view === v ? { backgroundColor: 'var(--color-primary)' } : {}}>
                {label}
              </button>
            ))}
          </div>
          {view !== 'all' && (
            <select value={year} onChange={e => setYear(+e.target.value)}
              className="text-sm border border-gray-200 rounded-xl px-3 py-2 bg-white text-gray-700 focus:outline-none">
              {years.map(y => <option key={y} value={y}>{y + 543}</option>)}
            </select>
          )}
          {view === 'month' && (
            <select value={month} onChange={e => setMonth(+e.target.value)}
              className="text-sm border border-gray-200 rounded-xl px-3 py-2 bg-white text-gray-700 focus:outline-none">
              {MONTHS_TH.map((m, i) => <option key={i} value={i}>{m}</option>)}
            </select>
          )}
          <button onClick={() => {
            const rows = [
              ['เลขที่','วันที่','ผู้ร้อง','โทรศัพท์','ประเภท','รายละเอียด','สถานที่','สถานะ'],
              ...viewData.map(c => [
                c.id.slice(0,8).toUpperCase(),
                new Date(c.created_at).toLocaleDateString('th-TH'),
                c.profiles?.full_name ?? '',
                c.profiles?.phone ?? c.phone ?? '',
                CATEGORY_LABEL[c.category] ?? c.category ?? '',
                (c.description ?? '').replace(/\n/g,' '),
                [c.location_name, c.village].filter(Boolean).join(', '),
                STATUS[c.status]?.label ?? c.status,
              ])
            ]
            const csv = '﻿' + rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n')
            const a = document.createElement('a')
            a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
            a.download = `คำร้อง_${viewLabel}_${tenant?.name ?? ''}.csv`
            a.click()
          }} className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors">
            <Download size={15} /> Export CSV
          </button>
          <button onClick={() => handlePrint({ view, month, year, viewLabel, total, completed, rejected, active, rate, avgDays, catData, trend, tenant })}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors">
            <Printer size={15} /> พิมพ์
          </button>
          {(view !== 'month' || month !== now.getMonth() || year !== now.getFullYear()) && (
            <button onClick={() => { setView('month'); setMonth(now.getMonth()); setYear(now.getFullYear()) }}
              className="flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-medium bg-white border border-gray-200 text-gray-400 hover:text-red-500 transition-colors">
              <X size={12} /> ล้าง
            </button>
          )}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'คำร้องที่รับเข้า', value: total,    color: '#64748b', sub: 'รายการ',           delta: view === 'month' ? total - prevTotal : null,                                    unit: '' },
          { label: 'ปิดงานแล้ว',       value: completed, color: '#10b981', sub: 'รายการ',           delta: view === 'month' ? completed - prevCompleted : null,                            unit: '' },
          { label: 'อัตราปิดงาน',      value: `${rate}%`, color: rateColor, sub: rate >= 70 ? '✅ ดี' : rate >= 40 ? '⚠️ ปานกลาง' : '🔴 ต่ำ', delta: view === 'month' && prevTotal > 0 ? rate - prevRate : null, unit: '%' },
          { label: 'เฉลี่ยวันปิดงาน',  value: avgDays !== null ? avgDays : '—', color: '#8b5cf6', sub: avgDays !== null ? 'วันทำการ' : 'ไม่มีข้อมูล', delta: view === 'month' && avgDays !== null && prevAvgDays !== null ? prevAvgDays - avgDays : null, unit: 'วันทำการ' },
        ].map(({ label, value, color, sub, delta, unit }) => (
          <div key={label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <p className="text-2xl font-black leading-none" style={{ color }}>{value}</p>
            <p className="text-[13px] text-gray-400 mt-1">{sub}</p>
            <p className="text-xs font-medium text-gray-600 mt-0.5">{label}</p>
            {delta !== null && (
              <p className={`text-[11px] font-semibold mt-1.5 ${delta > 0 ? 'text-green-500' : delta < 0 ? 'text-red-400' : 'text-gray-400'}`}>
                {delta > 0 ? '↑' : delta < 0 ? '↓' : '='} {delta !== 0 ? `${Math.abs(delta)}${unit} จากเดือนก่อน` : 'เท่าเดิม'}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* SLA compliance */}
      {closedData.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <Clock size={14} className="text-blue-500" />
              SLA — ระยะเวลาแก้ไขปัญหา (วันทำการ)
            </h3>
            {slaRate7 !== null && (
              <span className={`text-sm font-bold px-3 py-1 rounded-full ${slaRate7 >= 70 ? 'bg-green-50 text-green-600' : slaRate7 >= 40 ? 'bg-yellow-50 text-yellow-600' : 'bg-red-50 text-red-500'}`}>
                {slaRate7 >= 70 ? '✅' : slaRate7 >= 40 ? '⚠️' : '🔴'} {slaRate7}% แก้ภายใน 7 วันทำการ
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: '0–3 วันทำการ', count: slaIn3,            color: '#10b981', bg: '#d1fae5', emoji: '🟢' },
              { label: '4–7 วันทำการ', count: slaIn7 - slaIn3,  color: '#3b82f6', bg: '#dbeafe', emoji: '🔵' },
              { label: '8–14 วันทำการ', count: slaIn14 - slaIn7, color: '#f59e0b', bg: '#fef3c7', emoji: '🟡' },
              { label: '15+ วันทำการ',  count: slaOver14,          color: '#ef4444', bg: '#fee2e2', emoji: '🔴' },
            ].map(({ label, count, color, bg, emoji }) => (
              <div key={label} className="rounded-2xl p-4 text-center" style={{ backgroundColor: bg }}>
                <p className="text-xs mb-1">{emoji}</p>
                <p className="text-2xl font-black" style={{ color }}>{count}</p>
                <p className="text-xs font-semibold mt-1" style={{ color }}>{label}</p>
                <p className="text-[11px] mt-0.5" style={{ color, opacity: 0.7 }}>
                  {closedData.length > 0 ? `${Math.round(count / closedData.length * 100)}%` : '—'}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Trend chart */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">
          {view === 'all' ? 'แนวโน้มรายปี' : view === 'year' ? `แนวโน้มรายเดือน ปี ${year + 543}` : `แนวโน้มรายสัปดาห์ ${MONTHS_FULL_TH[month]} ${year + 543}`}
        </h3>
        {complaints.length === 0 ? (
          <div className="flex items-center justify-center h-40 text-gray-400 text-sm">ยังไม่มีข้อมูล</div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={trend} barGap={4} barSize={16}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9ca3af' }} />
              <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} allowDecimals={false} />
              <Tooltip
                formatter={(val, name) => [val, name === 'submitted' ? 'รับเข้า' : 'เสร็จสิ้น']}
                contentStyle={{ borderRadius: 12, border: '1px solid #f3f4f6', fontSize: 12 }}
              />
              <Legend iconType="circle" iconSize={8}
                formatter={v => <span className="text-xs text-gray-600">{v === 'submitted' ? 'รับเข้า' : 'เสร็จสิ้น'}</span>} />
              <Bar dataKey="submitted" name="submitted" fill="var(--color-primary)" radius={[4,4,0,0]} opacity={0.75} />
              <Bar dataKey="completed" name="completed" fill="#10b981" radius={[4,4,0,0]} opacity={0.85} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Category breakdown — full width */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">
          {view === 'all' ? 'ประเภทคำร้องทั้งหมด' : view === 'year' ? `ประเภทคำร้องปี ${year + 543}` : `ประเภทคำร้อง${MONTHS_FULL_TH[month]}นี้`}
        </h3>
        {catData.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">ไม่มีข้อมูล</p>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={catPieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={48}
                  outerRadius={78}
                  dataKey="count"
                  nameKey="name"
                  paddingAngle={2}
                  label={({ cx, cy, midAngle, outerRadius, count }) => {
                    const RADIAN = Math.PI / 180
                    const x = cx + (outerRadius + 14) * Math.cos(-midAngle * RADIAN)
                    const y = cy + (outerRadius + 14) * Math.sin(-midAngle * RADIAN)
                    return (
                      <text x={x} y={y} textAnchor="middle" dominantBaseline="central"
                        fontSize={11} fontWeight={700} fill="#374151">
                        {count}
                      </text>
                    )
                  }}
                  labelLine={{ stroke: '#d1d5db', strokeWidth: 1 }}
                >
                  {catPieData.map((_, i) => (
                    <Cell key={i} fill={CAT_COLORS[i % CAT_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value, name) => [`${value} รายการ`, name]}
                  contentStyle={{ borderRadius: 12, border: '1px solid #f3f4f6', fontSize: 12 }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-2.5 mt-2">
              {catData.map(({ name, emoji, count }, i) => (
                <div key={i}>
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <span className="text-gray-700 font-medium flex items-center gap-2 truncate">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: CAT_COLORS[i % CAT_COLORS.length] }} />
                      <span>{emoji}</span> {name}
                    </span>
                    <span className="text-gray-500 shrink-0 ml-2 font-semibold">{count}</span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all"
                      style={{
                        width: `${count / catData[0].count * 100}%`,
                        backgroundColor: CAT_COLORS[i % CAT_COLORS.length],
                        opacity: 0.75,
                      }} />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Technician leaderboard */}
      {techLeaderboard.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
            <Wrench size={14} className="text-orange-500" />
            ผลงานช่าง
            <span className="text-xs font-normal text-gray-400 ml-auto">ตลอดทุกช่วงเวลา</span>
          </h3>
          <div className="space-y-3">
            {techLeaderboard.map((t, i) => {
              const medals = ['🥇','🥈','🥉']
              return (
                <div key={t.name} className="flex items-center gap-3">
                  <div className="w-7 text-center text-base shrink-0">{medals[i] ?? `${i + 1}.`}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800 truncate">{t.name}</p>
                    <div className="w-full bg-gray-100 rounded-full h-1.5 mt-1.5">
                      <div className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${(t.completed / techLeaderboard[0].completed) * 100}%`, backgroundColor: '#f97316' }} />
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold text-gray-800">{t.completed} งาน</p>
                    <p className="text-[11px] text-gray-400">เฉลี่ย {t.avgDays} วันทำการ/งาน</p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 2-col alert widgets — แสดงเฉพาะ รายเดือน */}
      {view === 'month' && (
        <div className="grid md:grid-cols-2 gap-4">
          {/* รับเรื่องแล้ว แต่ช่างยังไม่รับงาน */}
          <div className="bg-white rounded-2xl border border-orange-100 shadow-sm p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-1 flex items-center gap-2">
              <Clock size={14} className="text-orange-500" />
              รอช่างรับงานเกิน 7 วันทำการ
            </h3>
            <p className="text-xs text-gray-400 mb-4">ค้างเกิน 7 วันทำการหลังรับเรื่อง · ทั้งระบบ {noTechAction.length} รายการ</p>
            {noTechAction.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-gray-400">
                <CheckCircle2 size={28} className="text-green-400 mb-2" />
                <p className="text-sm text-green-600 font-medium">ช่างรับงานทุกรายการแล้ว</p>
              </div>
            ) : (
              <div className="space-y-0 divide-y divide-gray-50">
                {noTechAction.map(c => {
                  const days = workingDaysSince(c.updated_at, now)
                  return (
                    <div key={c.id} className="flex items-center gap-3 py-2.5">
                      <span className="text-lg shrink-0">{CATEGORY_EMOJI[c.category] ?? '📄'}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-gray-700 truncate">
                          {CATEGORY_LABEL[c.category] ?? c.category}
                        </p>
                        <p className="text-[11px] text-gray-400 mt-0.5 truncate">
                          {c.assigned_to_name
                            ? `ช่าง: ${c.assigned_to_name}`
                            : c.assigned_to ? 'มอบหมายแล้ว ยังไม่รับงาน' : 'ยังไม่ได้มอบหมายช่าง'}
                        </p>
                      </div>
                      <span className="text-xs font-bold text-orange-500 shrink-0 bg-orange-50 px-2 py-0.5 rounded-lg">
                        {days} วันทำการ
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* คำร้องค้างเกิน 7 วัน */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-1 flex items-center gap-2">
              <AlertTriangle size={14} className="text-amber-500" />
              คำร้องค้างเกิน 15 วันทำการ
            </h3>
            <p className="text-xs text-gray-400 mb-4">ค้างเกิน 15 วันทำการ · ทั้งระบบ {overdue.length} รายการ</p>
            {overdue.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-gray-400">
                <CheckCircle2 size={28} className="text-green-400 mb-2" />
                <p className="text-sm text-green-600 font-medium">ไม่มีคำร้องค้าง</p>
              </div>
            ) : (
              <div className="space-y-0 divide-y divide-gray-50">
                {overdue.map(c => {
                  const days = workingDaysSince(c.created_at, now)
                  const s = STATUS[c.status]
                  return (
                    <div key={c.id} className="flex items-center gap-3 py-2.5">
                      <span className="text-lg shrink-0">{CATEGORY_EMOJI[c.category] ?? '📄'}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-gray-700 truncate">
                          {CATEGORY_LABEL[c.category] ?? c.category}
                        </p>
                        <span className="text-[13px] px-1.5 py-0.5 rounded-full font-medium"
                          style={{ backgroundColor: s?.bg, color: s?.text }}>
                          {s?.label}
                        </span>
                      </div>
                      <span className="text-xs font-bold text-red-500 shrink-0 bg-red-50 px-2 py-0.5 rounded-lg">
                        {days} วันทำการ
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main page ─────────────────────────────────────────────────────────────────
const PAGE_LABELS = {
  dashboard: 'หน้าหลัก',
  complaints: 'รายการคำร้อง',
  events: 'ปฏิทินกิจกรรม',
  'doc-requests': 'คำขอเอกสาร',
  report: 'รายงานสรุป',
  categories: 'ประเภทคำร้อง',
  'fee-settings': 'ค่าธรรมเนียม',
  emergency: 'สายด่วน',
  locations: 'สถานที่เกิดเหตุ',
  'system-settings': 'ตั้งค่าระบบ',
  users: 'จัดการผู้ใช้และการแต่งตั้ง',
  'civil-project': 'โครงการโยธา',
  'civil-report': 'รายงานโยธา',
  'audit-log': 'บันทึกกิจกรรม',
  'satisfaction': 'ผลการประเมิน',
  'fleet-setup': 'ตั้งค่ายานพาหนะ',
}

function getAdminMenuGroups(currentUserRole, currentUserId) {
  const canManageContent = currentUserRole !== 'viewer'
  const canManageSystem = currentUserRole === 'admin' || currentUserRole === 'superadmin'

  return [
    {
      group: 'ติดตามผลและประเมินบริการ',
      description: 'รายงานผลการให้บริการและเสียงสะท้อนจากประชาชน',
      accent: '#22c55e',
      items: [
        { key: 'report', label: 'รายงาน', Icon: TrendingUp, color: '#059669', bg: '#d1fae5', show: true },
        { key: 'satisfaction', label: 'ผลการประเมิน', Icon: Star, color: '#d97706', bg: '#fef3c7', show: true },
      ],
    },
    // ถอดเมนู "ปฏิทินกิจกรรม" ออกจากแผงควบคุม Admin แล้ว (กลุ่ม "ข้อมูลเผยแพร่และกำหนดการ"
    // เหลือรายการเดียวคือ events จึงถอดทั้งกลุ่ม) — โค้ดโมดูลยังอยู่ครบ ทั้ง import
    // EventsManagerComponent และ branch `activePage === 'events'` ด้านล่าง เอากลับมาได้ทันที
    // ด้วยการใส่กลุ่มนี้คืน ทางเข้าอื่นของปฏิทินกิจกรรมยังใช้งานได้ตามเดิม: หน้าเจ้าหน้าที่
    // (StaffDashboard โมดูล events) และ route /events
    {
      group: 'ข้อมูลบริการประชาชน',
      description: 'ข้อมูลอ้างอิงที่ใช้รับเรื่อง คิดค่าธรรมเนียม และติดต่อฉุกเฉิน',
      accent: '#0ea5e9',
      items: [
        { key: 'categories', label: 'ประเภทคำร้อง', Icon: Tag, color: '#d97706', bg: '#fef3c7', show: canManageContent },
        { key: 'emergency', label: 'สายด่วน', Icon: Phone, color: '#ef4444', bg: '#fee2e2', show: canManageContent },
        { key: 'locations', label: 'สถานที่เกิดเหตุ', Icon: MapPin, color: '#0891b2', bg: '#e0f2fe', show: canManageContent },
        { key: 'fee-settings', label: 'ค่าธรรมเนียม', Icon: Banknote, color: '#10b981', bg: '#d1fae5', show: canManageSystem },
        { key: 'fleet-setup', label: 'ยานพาหนะ', Icon: Car, color: '#0369a1', bg: '#e0f2fe', show: canManageSystem },
      ],
    },
    {
      group: 'ระบบ สิทธิ์ และการตรวจสอบ',
      description: 'การตั้งค่าหลัก บัญชีผู้ใช้ สิทธิ์ และประวัติการดำเนินการ',
      accent: '#6366f1',
      items: [
        { key: 'system-settings', label: 'ตั้งค่าระบบ', Icon: Settings, color: '#3b82f6', bg: '#dbeafe', show: canManageSystem },
        { key: 'users', label: 'จัดการผู้ใช้และการแต่งตั้ง', Icon: Shield, color: '#7c3aed', bg: '#ede9fe', show: canManageSystem },
        { key: 'audit-log', label: 'บันทึกกิจกรรม', Icon: BookOpen, color: '#ef4444', bg: '#fee2e2', show: canManageSystem },
      ],
    },
    {
      group: 'คู่มือและเครื่องมือ',
      description: 'เอกสารช่วยเหลือและพื้นที่สำหรับดูแลการพัฒนาระบบ',
      accent: '#64748b',
      items: [
        { key: 'manual', label: 'คู่มือผู้ดูแล', Icon: BookOpen, color: '#059669', bg: '#d1fae5', show: true, isExternal: true, href: '/manual-admin.html' },
        { key: 'data-center', label: 'ศูนย์รวมข้อมูลดิจิทัล', Icon: Database, color: '#4338ca', bg: '#e0e7ff', show: true, navTo: '/data-center/staff' },
        { key: 'dev-journal', label: 'ผู้พัฒนาระบบ', Icon: Terminal, color: '#1e293b', bg: '#f1f5f9', show: currentUserId === DEV_USER_ID, isDevLink: true },
      ],
    },
  ]
}

// ─── SatisfactionAdmin ────────────────────────────────────────────────────────
const RATING_LABELS = { 5: 'ยอดเยี่ยม', 4: 'ดี', 3: 'พอสมควร', 2: 'แย่', 1: 'แย่มาก' }
const RATING_COLORS = { 5: '#22c55e', 4: '#3b82f6', 3: '#f59e0b', 2: '#f97316', 1: '#ef4444' }
const RATING_EMOJI  = { 5: '😄', 4: '😊', 3: '😐', 2: '😢', 1: '😡' }

// ที่มาของคะแนนมี 3 แบบ น้ำหนักความน่าเชื่อถือไม่เท่ากัน จึงต้องแยกให้เห็นก่อนเอาไปอ้างอิง
//   verified    — ผูกกับคำร้อง และผู้ให้คะแนนคือผู้ยื่นคำร้องที่ล็อกอินแล้ว (ตรวจสอบย้อนกลับได้)
//   linked_anon — ผูกกับคำร้อง แต่ให้คะแนนผ่านการค้นด้วยเลขอ้างอิงโดยไม่ล็อกอิน
//   general     — แบบประเมินภาพรวมหน่วยงาน (หน้า /satisfaction) ไม่ผูกคำร้อง ไม่ระบุตัวตนโดยเจตนา
function ratingSource(r) {
  if (!r.complaint_id) return 'general'
  return r.is_verified ? 'verified' : 'linked_anon'
}

const SOURCE_TABS = [
  { key: 'all',      label: 'ทั้งหมด' },
  { key: 'verified', label: 'ยืนยันตัวตนแล้ว' },
  { key: 'general',  label: 'ประเมินภาพรวม' },
]

function SatisfactionAdmin({ tenant }) {
  const [ratings, setRatings]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [sourceTab, setSourceTab] = useState('all')

  useEffect(() => {
    if (!tenant?.id) return
    setLoading(true)
    supabase.from('satisfaction_ratings')
      .select('*')
      .eq('municipality_id', tenant.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => { setRatings(data ?? []); setLoading(false) })
  }, [tenant?.id])

  const bySource = {
    verified:    ratings.filter(r => ratingSource(r) === 'verified'),
    linked_anon: ratings.filter(r => ratingSource(r) === 'linked_anon'),
    general:     ratings.filter(r => ratingSource(r) === 'general'),
  }
  const filtered = sourceTab === 'all' ? ratings : bySource[sourceTab]
  const sourceLabel = SOURCE_TABS.find(t => t.key === sourceTab)?.label ?? 'ทั้งหมด'

  const avg = filtered.length ? (filtered.reduce((s, r) => s + r.rating, 0) / filtered.length).toFixed(1) : '-'
  const counts = [5,4,3,2,1].map(v => ({ v, count: filtered.filter(r => r.rating === v).length }))

  function thDate(iso) {
    const d = new Date(iso)
    return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  function handlePrint() {
    const now = new Date().toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' })
    const avgScore = filtered.length ? (filtered.reduce((s, r) => s + r.rating, 0) / filtered.length).toFixed(2) : '-'
    const bars = [5,4,3,2,1].map(v => {
      const c = filtered.filter(r => r.rating === v).length
      const pct = filtered.length ? Math.round(c / filtered.length * 100) : 0
      return `<tr>
        <td>${RATING_EMOJI[v]} ${RATING_LABELS[v]}</td>
        <td style="width:260px">
          <div style="background:#e5e7eb;border-radius:4px;overflow:hidden;height:14px">
            <div style="width:${pct}%;background:${RATING_COLORS[v]};height:14px"></div>
          </div>
        </td>
        <td style="text-align:center;width:50px">${c}</td>
        <td style="text-align:center;width:60px">${pct}%</td>
      </tr>`
    }).join('')

    const html = `<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8">
<title>ผลการประเมินความพึงพอใจ</title>
<style>
  @page { size: A4; margin: 2cm; }
  body { font-family: 'Sarabun', sans-serif; font-size: 14px; color: #111; }
  h2 { text-align:center; font-size:18px; margin:0 0 4px; font-weight:700; }
  p.sub { text-align:center; font-size:13px; color:#555; margin:0 0 20px; }
  .stats { display:flex; gap:16px; margin-bottom:20px; }
  .stat-box { flex:1; border:1px solid #e5e7eb; border-radius:8px; padding:12px; text-align:center; }
  .stat-num { font-size:28px; font-weight:900; color:#1a3a5c; }
  .stat-lbl { font-size:12px; color:#6b7280; margin-top:2px; }
  table { width:100%; border-collapse:collapse; font-size:13px; margin-bottom:20px; }
  th { background:#1a3a5c; color:#fff; padding:7px 10px; text-align:left; }
  td { padding:6px 10px; border-bottom:1px solid #e5e7eb; vertical-align:top; }
  tr:nth-child(even) td { background:#f8fafc; }
  .section { font-size:15px; font-weight:700; color:#1a3a5c; margin:20px 0 8px; border-left:4px solid #1a3a5c; padding-left:8px; }
  .footer { margin-top:20px; font-size:12px; color:#9ca3af; text-align:right; }
  @media print { button { display:none; } }
</style></head><body>
<h2>${tenant?.name ?? 'หน่วยงาน'}</h2>
<p class="sub">รายงานผลการประเมินความพึงพอใจการให้บริการ &nbsp;|&nbsp; ชุดข้อมูล: ${sourceLabel} &nbsp;|&nbsp; วันที่พิมพ์ ${now}</p>
<div class="stats">
  <div class="stat-box"><div class="stat-num">${avgScore}</div><div class="stat-lbl">คะแนนเฉลี่ย (จาก 5)</div></div>
  <div class="stat-box"><div class="stat-num">${filtered.length}</div><div class="stat-lbl">ผู้ประเมินทั้งหมด</div></div>
  <div class="stat-box"><div class="stat-num" style="color:#22c55e">${filtered.filter(r=>r.rating>=4).length}</div><div class="stat-lbl">พึงพอใจ (ดี/ยอดเยี่ยม)</div></div>
  <div class="stat-box"><div class="stat-num" style="color:#ef4444">${filtered.filter(r=>r.rating<=2).length}</div><div class="stat-lbl">ไม่พึงพอใจ (แย่/แย่มาก)</div></div>
</div>
<div class="section">สัดส่วนคะแนน</div>
<table><thead><tr><th>ระดับ</th><th>สัดส่วน</th><th style="width:50px;text-align:center">จำนวน</th><th style="width:60px;text-align:center">ร้อยละ</th></tr></thead>
<tbody>${bars}</tbody></table>
<div class="section">ที่มาของคะแนน</div>
<table><thead><tr><th>ที่มา</th><th style="width:90px;text-align:center">จำนวน</th><th>ระดับความน่าเชื่อถือ</th></tr></thead>
<tbody>
  <tr><td>ผูกคำร้อง — ผู้ยื่นคำร้องยืนยันตัวตนแล้ว</td><td style="text-align:center">${bySource.verified.length}</td><td>ตรวจสอบย้อนกลับได้ถึงเลขคำร้อง</td></tr>
  <tr><td>ผูกคำร้อง — ให้คะแนนด้วยเลขอ้างอิงโดยไม่ล็อกอิน</td><td style="text-align:center">${bySource.linked_anon.length}</td><td>ยืนยันตัวผู้ให้คะแนนไม่ได้</td></tr>
  <tr><td>ประเมินภาพรวมหน่วยงาน (ไม่ผูกคำร้อง)</td><td style="text-align:center">${bySource.general.length}</td><td>ไม่ระบุตัวตนโดยเจตนา</td></tr>
</tbody></table>
<div class="footer">ออกจากระบบบริการออนไลน์ SmartLocal &nbsp;|&nbsp; ${tenant?.name ?? ''}</div>
</body></html>`

    const w = window.open('', '_blank', 'width=900,height=700')
    w.document.write(html)
    w.document.close()
    setTimeout(() => w.print(), 500)
  }

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 size={28} className="animate-spin text-gray-400" /></div>

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-800">ผลการประเมินความพึงพอใจ</h2>
          <p className="text-xs text-gray-400 mt-0.5">สรุปความคิดเห็นจากประชาชน</p>
        </div>
        <button onClick={handlePrint}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-white shadow-sm transition-colors"
          style={{ backgroundColor: '#1a3a5c' }}>
          <Printer size={14} /> พิมพ์
        </button>
      </div>

      {/* แยกชุดข้อมูลตามที่มา — คะแนนที่ยืนยันตัวผู้ให้คะแนนได้กับที่ยืนยันไม่ได้ไม่ควรถูกเฉลี่ย
          รวมกันเงียบๆ แล้วเอาไปอ้างอิงในรายงาน ตัวเลือกที่เลือกไว้มีผลกับทั้งการ์ด กราฟ และไฟล์พิมพ์ */}
      <div className="bg-white rounded-2xl p-3 shadow-sm border border-gray-100">
        <div className="flex flex-wrap gap-2">
          {SOURCE_TABS.map(t => {
            const n = t.key === 'all' ? ratings.length : bySource[t.key].length
            const active = sourceTab === t.key
            return (
              <button key={t.key} onClick={() => setSourceTab(t.key)}
                className="px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors"
                style={{
                  backgroundColor: active ? '#1a3a5c' : '#f8fafc',
                  color: active ? '#fff' : '#475569',
                  borderColor: active ? '#1a3a5c' : '#e2e8f0',
                }}>
                {t.label} ({n})
              </button>
            )
          })}
        </div>
        {bySource.linked_anon.length > 0 && (
          <p className="text-[11px] text-gray-500 mt-2 leading-relaxed">
            มีคะแนนที่ผูกคำร้องแต่ให้ผ่านการค้นด้วยเลขอ้างอิงโดยไม่ล็อกอินอีก {bySource.linked_anon.length} รายการ
            — นับรวมอยู่ใน "ทั้งหมด" แต่ยืนยันตัวผู้ให้คะแนนไม่ได้ ควรใช้ชุด "ยืนยันตัวตนแล้ว" เมื่อต้องอ้างอิงในรายงาน
          </p>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 flex flex-col items-center gap-1">
          <Star size={22} className="text-yellow-400" />
          <p className="text-3xl font-black text-gray-800">{avg}</p>
          <p className="text-xs text-gray-400">คะแนนเฉลี่ย</p>
        </div>
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 flex flex-col items-center gap-1">
          <MessageSquare size={22} className="text-blue-400" />
          <p className="text-3xl font-black text-gray-800">{filtered.length}</p>
          <p className="text-xs text-gray-400">{sourceTab === 'all' ? 'ผู้ประเมินทั้งหมด' : `ผู้ประเมิน (${sourceLabel})`}</p>
        </div>
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 flex flex-col items-center gap-1">
          <span className="text-2xl">😄</span>
          <p className="text-3xl font-black text-green-600">{counts[0].count}</p>
          <p className="text-xs text-gray-400">ยอดเยี่ยม</p>
        </div>
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 flex flex-col items-center gap-1">
          <span className="text-2xl">😡</span>
          <p className="text-3xl font-black text-red-500">{counts[4].count}</p>
          <p className="text-xs text-gray-400">แย่มาก</p>
        </div>
      </div>

      {/* Bar chart */}
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 space-y-3">
        <p className="text-sm font-bold text-gray-700">สัดส่วนคะแนน</p>
        {counts.map(({ v, count }) => (
          <div key={v} className="flex items-center gap-3">
            <span className="text-base w-5 text-center">{RATING_EMOJI[v]}</span>
            <span className="text-xs font-semibold text-gray-600 w-16 shrink-0">{RATING_LABELS[v]}</span>
            <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all"
                style={{ width: filtered.length ? `${(count / filtered.length) * 100}%` : '0%', backgroundColor: RATING_COLORS[v] }} />
            </div>
            <span className="text-xs font-bold text-gray-500 w-6 text-right">{count}</span>
          </div>
        ))}
      </div>

    </div>
  )
}

export default function AdminDashboard() {
  const { tenant } = useTenant()
  const navigate = useNavigate()
  const location = useLocation()
  const [complaints, setComplaints] = useState([])
  const [loading, setLoading] = useState(true)
  const [activePage, setActivePage] = useState(location.state?.page ?? 'dashboard')
  const [currentUserRole, setCurrentUserRole] = useState(null)
  const [currentUserId, setCurrentUserId] = useState(null)
  const [currentUserAvatar, setCurrentUserAvatar] = useState(null)
  const [currentUserName, setCurrentUserName] = useState(null)
  const [technicians, setTechnicians] = useState([])

  // ดึงหมวดหมู่คำร้องที่ Admin สร้างเอง merge กับ CATEGORY_LABEL/EMOJI
  const [, setCatVer] = useState(0) // force re-render หลัง merge
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
      setCurrentUserId(data.session.user.id)
      supabase.from('profiles').select('role, avatar_url, full_name').eq('id', data.session.user.id).single()
        .then(({ data: p }) => {
          const r = p?.role ?? 'citizen'
          setCurrentUserRole(r)
          setCurrentUserAvatar(p?.avatar_url ?? null)
          setCurrentUserName(p?.full_name ?? null)
          if (r === 'viewer' && !location.state?.page) setActivePage('dashboard')
          if (r === 'council' && !location.state?.page) setActivePage('dashboard')
          return r
        })
    })
  }, [])

  const fetchTechnicians = useCallback(async () => {
    if (!tenant?.id) return
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .eq('municipality_id', tenant.id)
      .eq('role', 'technician')
      .order('full_name')
    setTechnicians(data ?? [])
  }, [tenant?.id])

  useEffect(() => { fetchTechnicians() }, [fetchTechnicians])

  async function handleLogout() {
    await signOutSafely('/admin/login')
    navigate('/admin/login')
  }

  // silent = true สำหรับ realtime refetch — ไม่ยิง setLoading ไม่งั้นหน้ารายงานจะกลับไปขึ้น
  // สถานะกำลังโหลดทุกครั้งที่มีคำร้องเข้าหรือเจ้าหน้าที่ขยับสถานะ
  const fetchComplaints = useCallback(async ({ silent = false } = {}) => {
    if (!tenant?.id || currentUserRole === null) return
    if (!silent) setLoading(true)
    try {
      const { data, error } = await supabase
        .from('complaints')
        .select('*')
        .eq('municipality_id', tenant.id)
        .order('created_at', { ascending: false })
      if (error) console.error('fetch complaints error:', error.message)
      setComplaints(data ? await attachReporterProfiles(data, 'id, full_name, email, phone, role') : [])
    } finally {
      if (!silent) setLoading(false)
    }
  }, [tenant?.id, currentUserRole])

  useEffect(() => {
    fetchComplaints()
    const safety = setTimeout(() => setLoading(false), 12000)
    return () => clearTimeout(safety)
  }, [fetchComplaints])

  // Realtime: complaints state ก้อนนี้ป้อนหน้ารายงาน (ReportManagerComponent) เท่านั้น
  // เดิมไม่มี subscription เลย ตัวเลขจึงค้างจนกว่าจะ reload — ต่างจากหน้ารายงานฝั่ง staff
  // ที่มี channel staff-report- อยู่แล้ว
  useEffect(() => {
    if (!tenant?.id || currentUserRole === null) return
    const ch = supabase.channel(`admin-report-${tenant.id}-${crypto.randomUUID()}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'complaints',
        filter: `municipality_id=eq.${tenant.id}`,
      }, () => fetchComplaints({ silent: true }))
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [tenant?.id, currentUserRole, fetchComplaints])

  const adminMenuGroups = getAdminMenuGroups(currentUserRole, currentUserId)
    .map(group => ({ ...group, items: group.items.filter(item => item.show) }))
    .filter(group => group.items.length > 0)

  return (
    <div className="min-h-full" style={{ backgroundColor: '#eef2f7' }}>

      {/* PC header */}
      <header className="hidden md:block relative w-full text-white overflow-hidden"
        style={{ background: 'linear-gradient(180deg, var(--color-primary) 0%, var(--color-primary-dark) 100%)' }}>
        <div className="absolute inset-0 opacity-25 pointer-events-none"
          style={{ backgroundImage: `url("${tenant?.header_image_url || 'https://images.unsplash.com/photo-1511497584788-876760111969?auto=format&fit=crop&q=80&w=1000'}")`, backgroundSize: 'cover', backgroundPosition: 'center' }} />
        <div className="absolute bottom-0 inset-x-0 h-12 pointer-events-none"
          style={{ background: 'linear-gradient(to top, var(--color-primary-dark), transparent)' }} />

        {/* Top row */}
        <div className="relative z-10 flex items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/')} className="shrink-0 active:opacity-70 hover:scale-105 transition-transform">
              {tenant?.logo_url
                ? <img src={tenant.logo_url} alt="" className="w-10 h-10 rounded-full border-2 border-white/40 bg-white/10 object-cover" />
                : <div className="w-10 h-10 rounded-full bg-white/20 border-2 border-white/40 flex items-center justify-center text-lg font-bold">🏛️</div>}
            </button>
            <div>
              <span className="text-[10px] font-black bg-white/20 text-white px-2 py-0.5 rounded-full tracking-widest uppercase">แผงควบคุม Admin</span>
              <p className="text-sm font-bold text-white mt-0.5 leading-tight">{tenant?.name}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* ชื่อคนที่ล็อกอินต้องเห็นตลอด ไม่ใช่แค่ตำแหน่ง — เจ้าหน้าที่ที่ไปนั่ง PC เครื่องอื่น
                จะได้รู้ตัวก่อนกดอนุมัติอะไรที่ audit_logs บันทึกชื่อคนกดเอาไว้
                (ของเดิมโชว์แค่ตำแหน่งกับตัวอักษร "A" ที่ hardcode ไว้ ไม่ได้มาจากชื่อจริงด้วยซ้ำ) */}
            <div className="text-right min-w-0">
              <p className="text-xs font-bold text-white truncate max-w-[14rem]">{currentUserName || 'ไม่ทราบชื่อ'}</p>
              <p className="text-[10px] text-white/70 leading-tight">{ROLE_LABELS[currentUserRole]?.label ?? 'ผู้ดูแลระบบ'}</p>
            </div>
            {currentUserAvatar
              ? <img src={currentUserAvatar} alt="" className="w-8 h-8 rounded-full object-cover border border-white/40 shrink-0" />
              : <div className="w-8 h-8 rounded-full bg-white/20 border border-white/40 flex items-center justify-center text-sm font-bold text-white shrink-0">{(currentUserName || '?')[0].toUpperCase()}</div>}
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
        </div>

      </header>

      {/* Mobile header — เหมือนหน้าหลักประชาชน กันสับสนตอนสลับโหมด */}
      <header className="md:hidden text-white px-4 pt-3 pb-4 relative overflow-hidden"
        style={{ background: 'linear-gradient(135deg, var(--color-primary-dark) 0%, var(--color-primary) 100%)' }}>
        <div className="flex items-center gap-3 relative z-10">
          <button onClick={() => navigate('/')} className="shrink-0 active:opacity-70 transition-opacity">
            {tenant?.logo_url
              ? <img src={tenant.logo_url} alt="โลโก้" className="w-11 h-11 rounded-full object-contain bg-white/10 p-0.5 border border-white/20" />
              : <div className="w-11 h-11 rounded-full border-2 border-white/40 bg-white/20 flex items-center justify-center text-lg font-bold">{tenant?.name?.[0] ?? '?'}</div>}
          </button>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-sm leading-tight truncate">{tenant?.name}</p>
            <p className="text-white/70 text-[11px] mt-0.5 truncate">แผงควบคุม Admin{currentUserName ? ` · ${currentUserName}` : ''}</p>
          </div>
          <button onClick={() => navigate('/notifications')} aria-label="การแจ้งเตือน" className="p-1.5 text-white/85 hover:text-white transition-colors shrink-0">
            <Bell size={19} />
          </button>
          <button onClick={() => navigate('/profile')} className="p-1 shrink-0">
            {currentUserAvatar ? (
              <img src={currentUserAvatar} alt="โปรไฟล์" className="w-7 h-7 rounded-full object-cover border-2 border-white/60" />
            ) : (
              <div className="w-7 h-7 rounded-full bg-white/20 border-2 border-white/60 flex items-center justify-center text-white text-xs font-bold">
                {(currentUserName || '?')[0].toUpperCase()}
              </div>
            )}
          </button>
        </div>
      </header>

      {/* Desktop sidebar + content */}
      <div className="md:flex">
        <aside className="hidden md:flex flex-col w-64 shrink-0 shadow-xl"
          style={{ background: 'linear-gradient(180deg, #173a5e 0%, #102a45 100%)' }}>
          <nav className="flex-1 px-3 py-3 overflow-y-auto">
            <button onClick={() => setActivePage('dashboard')}
              className="relative w-full flex min-h-10 items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all mb-1 overflow-hidden"
              style={activePage === 'dashboard'
                ? { backgroundColor: 'rgba(255,255,255,0.16)', color: '#fff', boxShadow: '0 8px 24px rgba(0,0,0,0.12)' }
                : { color: 'rgba(255,255,255,0.72)' }}>
              {activePage === 'dashboard' && <span className="absolute inset-y-2 left-0 w-1 rounded-r-full bg-cyan-300" />}
              <LayoutGrid size={16} />
              <span className="flex-1 text-left">หน้าหลัก</span>
            </button>
            {(currentUserRole === 'admin' || currentUserRole === 'superadmin') && (
              <button onClick={() => navigate('/staff')}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors mb-4 hover:bg-white/10"
                style={{ color: 'rgba(255,255,255,0.62)' }}>
                <Users size={16} />
                <span className="flex-1 text-left">แดชบอร์ดสำหรับเจ้าหน้าที่</span>
                <ExternalLink size={11} className="opacity-40" />
              </button>
            )}
            {adminMenuGroups.map(({ group, accent, items }) => (
                <section key={group} className="mb-4">
                  <div className="flex items-center gap-2 px-3 pt-1 pb-1.5">
                    <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: accent }} />
                    <p className="text-[10px] font-bold uppercase tracking-[0.12em]"
                      style={{ color: 'rgba(255,255,255,0.42)' }}>{group}</p>
                  </div>
                  <div className="space-y-0.5">
                    {items.map(({ key, label, Icon, color, isExternal, href, isDevLink, navTo, newTab }) => {
                      const isActive = activePage === key
                      if (isExternal) return (
                        <a key={key} href={href} target="_blank" rel="noopener noreferrer"
                          className="w-full flex min-h-9 items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-colors hover:bg-white/10"
                          style={{ color: 'rgba(255,255,255,0.62)' }}>
                          <Icon size={15} style={{ color }} />
                          <span className="flex-1 text-left">{label}</span>
                          <ExternalLink size={11} className="opacity-40" />
                        </a>
                      )
                      if (isDevLink || navTo) return (
                        <button key={key} onClick={() => newTab ? window.open(navTo, '_blank') : navigate(navTo ?? '/dev-journal')}
                          className="w-full flex min-h-9 items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-colors hover:bg-white/10"
                          style={{ color: 'rgba(255,255,255,0.62)' }}>
                          <Icon size={15} className="text-slate-300" />
                          <span className="flex-1 text-left">{label}</span>
                          <ChevronRight size={12} className="opacity-35" />
                        </button>
                      )
                      return (
                        <button key={key} onClick={() => setActivePage(key)}
                          className="relative w-full flex min-h-9 items-center gap-3 px-3 py-2 rounded-xl text-sm font-semibold transition-all overflow-hidden hover:bg-white/10"
                          style={isActive
                            ? { backgroundColor: 'rgba(255,255,255,0.16)', color: '#fff', boxShadow: '0 6px 18px rgba(0,0,0,0.1)' }
                            : { color: 'rgba(255,255,255,0.7)' }}>
                          {isActive && <span className="absolute inset-y-2 left-0 w-1 rounded-r-full" style={{ backgroundColor: accent }} />}
                          <Icon size={15} style={isActive ? { color } : undefined} />
                          <span className="flex-1 text-left">{label}</span>
                        </button>
                      )
                    })}
                  </div>
                </section>
              ))}
          </nav>
          <div className="px-2 py-3 shrink-0 border-t" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
            <button onClick={handleLogout}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors hover:bg-white/10"
              style={{ color: 'rgba(255,255,255,0.55)' }}>
              <LogOut size={16} />
              ออกจากระบบ
            </button>
          </div>
        </aside>

      {/* ─── Content ─── */}
      <div className="flex-1 min-w-0 px-4 py-4 pb-24 md:py-6 md:pb-8 md:px-6 space-y-4 md:space-y-6 max-w-5xl mx-auto">

      {/* Org banner — desktop only (mobile ใช้ gradient header ด้านบนแทน) */}
      <div className="hidden md:flex items-center gap-3 bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-3">
        <button onClick={() => navigate('/')} className="shrink-0 active:opacity-70 hover:scale-105 transition-transform">
          {tenant?.logo_url
            ? <img src={tenant.logo_url} alt="" className="w-10 h-10 rounded-full object-cover" />
            : <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center text-xl">🏛️</div>}
        </button>
        <p className="font-bold text-gray-800 text-sm leading-tight">{tenant?.name}</p>
      </div>

      {/* Page header — mobile only */}
      <div className="md:hidden flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-800">แผงควบคุมผู้ดูแลระบบ</h1>
        <div className="flex items-center gap-2">
          <div className="md:hidden flex items-center gap-2">
            <button onClick={() => navigate('/')}
              className="p-2 rounded-xl text-gray-400 border border-gray-200 bg-white hover:bg-gray-50 transition-colors">
              <Home size={15} />
            </button>
            <button onClick={handleLogout}
              className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium border border-red-200 text-red-500 bg-white hover:bg-red-50 transition-colors">
              <LogOut size={15} />
              ออก
            </button>
          </div>
        </div>
      </div>

      {/* Tab navigation — replaced by sidebar on desktop */}
      <div className="hidden">
        {currentUserRole === 'viewer' && (
          <button onClick={() => setActivePage('report')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${activePage === 'report' ? 'text-white shadow-sm' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
            style={activePage === 'report' ? { backgroundColor: '#10b981' } : {}}>
            <TrendingUp size={15} /> รายงาน
          </button>
        )}
        {currentUserRole !== 'viewer' && currentUserRole !== 'council' && (
          <button onClick={() => setActivePage('categories')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${activePage === 'categories' ? 'text-white shadow-sm' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
            style={activePage === 'categories' ? { backgroundColor: '#d97706' } : {}}>
            <Tag size={15} /> ประเภทคำร้อง
          </button>
        )}
        {(currentUserRole === 'admin' || currentUserRole === 'superadmin') && (
          <button onClick={() => setActivePage('users')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${activePage === 'users' ? 'text-white shadow-sm' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
            style={activePage === 'users' ? { backgroundColor: '#7c3aed' } : {}}>
            <Shield size={15} /> จัดการผู้ใช้และการแต่งตั้ง
          </button>
        )}
        {currentUserRole !== 'viewer' && currentUserRole !== 'council' && (
          <button onClick={() => setActivePage('report')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${activePage === 'report' ? 'text-white shadow-sm' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
            style={activePage === 'report' ? { backgroundColor: '#10b981' } : {}}>
            <TrendingUp size={15} /> รายงาน
          </button>
        )}
        {currentUserRole !== 'viewer' && currentUserRole !== 'council' && (
          <button onClick={() => setActivePage('more')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${activePage === 'more' ? 'text-white shadow-sm' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
            style={activePage === 'more' ? { backgroundColor: '#6b7280' } : {}}>
            <LayoutGrid size={15} /> อื่นๆ
          </button>
        )}
      </div>

      {/* ─── Mobile Admin Bottom Tab Bar ─── */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex items-stretch"
        style={{
          background: 'linear-gradient(180deg, var(--color-primary) 0%, var(--color-primary-dark) 100%)',
          borderTop: '2px solid rgba(255,255,255,0.15)',
          boxShadow: '0 -4px 20px rgba(0,0,0,0.3)',
          borderTopLeftRadius: '20px',
          borderTopRightRadius: '20px',
          paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 6px)',
        }}>
        {[
          { key: 'dashboard',   label: 'หน้าหลัก',        Icon: Home,        show: true },
          { key: 'report',      label: 'รายงาน',           Icon: TrendingUp,  show: true },
          { key: 'satisfaction',label: 'ประเมิน',          Icon: Star,        show: true },
          { key: 'audit-log',   label: 'บันทึกกิจกรรม',   Icon: BookOpen,    show: currentUserRole === 'admin' || currentUserRole === 'superadmin' },
          { key: 'data-center', label: 'ข้อมูลดิจิทัล',   Icon: Database,    show: true, navTo: '/data-center/staff' },
          { key: 'dev-journal', label: 'ผู้พัฒนา',         Icon: Terminal,    show: currentUserId === DEV_USER_ID, isDevLink: true },
        ].filter(i => i.show).map(({ key, label, Icon, isDevLink, navTo, newTab }) => {
          const isActive = activePage === key
          return (
            <button key={key} onClick={() => newTab ? window.open(navTo, '_blank') : (isDevLink || navTo) ? navigate(navTo ?? '/dev-journal') : setActivePage(key)}
              className="flex-1 flex flex-col items-center justify-center gap-0.5 pt-2 pb-1 transition-all active:scale-90">
              <div className="relative w-10 h-9 rounded-xl flex items-center justify-center transition-all duration-200"
                style={{ backgroundColor: isActive ? 'rgba(255,255,255,0.2)' : 'transparent' }}>
                {isActive && (
                  <span className="absolute -top-0.5 left-1/2 -translate-x-1/2 w-4 h-[3px] rounded-full bg-white" />
                )}
                <Icon size={20} strokeWidth={isActive ? 2.2 : 1.6}
                  style={{ color: isActive ? '#fff' : 'rgba(255,255,255,0.45)' }} />
              </div>
              <span className="text-[10px] font-bold leading-tight"
                style={{ color: isActive ? '#fff' : 'rgba(255,255,255,0.45)' }}>
                {label}
              </span>
            </button>
          )
        })}
      </div>

      {activePage === 'dashboard' ? (
        <div className="space-y-6">
          {/* All menu items */}
          <div className="space-y-4">
            <p className="text-[11px] font-bold uppercase tracking-widest text-gray-400">รายการทั้งหมด</p>
            {adminMenuGroups.map(({ group, description, accent, items }) => (
                <section key={group} className="rounded-2xl border border-gray-200/80 bg-white/60 p-3 md:p-4">
                  <div className="mb-3 flex items-start gap-2.5">
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: accent }} />
                    <div>
                      <h2 className="text-sm font-bold text-gray-800">{group}</h2>
                      <p className="mt-0.5 text-[11px] text-gray-400">{description}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 md:grid-cols-5 gap-2">
                    {items.map(({ key, label, Icon, color, bg, isExternal, href, isDevLink, navTo, newTab }) =>
                      isExternal ? (
                        <a key={key} href={href} target="_blank" rel="noopener noreferrer"
                          className="group flex min-h-24 flex-col items-center justify-center gap-2 rounded-2xl border border-gray-100 bg-white p-3 shadow-sm transition-all hover:-translate-y-0.5 hover:border-gray-200 hover:shadow-md active:scale-95">
                          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: bg }}>
                            <Icon size={18} style={{ color }} />
                          </div>
                          <p className="text-[11px] font-semibold text-gray-700 text-center leading-tight">{label}</p>
                        </a>
                      ) : (isDevLink || navTo) ? (
                        <button key={key} onClick={() => newTab ? window.open(navTo, '_blank') : navigate(navTo ?? '/dev-journal')}
                          className="group flex min-h-24 flex-col items-center justify-center gap-2 rounded-2xl border border-gray-100 bg-white p-3 shadow-sm transition-all hover:-translate-y-0.5 hover:border-gray-200 hover:shadow-md active:scale-95">
                          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: bg }}>
                            <Icon size={18} style={{ color }} />
                          </div>
                          <p className="text-[11px] font-semibold text-gray-700 text-center leading-tight">{label}</p>
                        </button>
                      ) : (
                        <button key={key} onClick={() => setActivePage(key)}
                          className="group flex min-h-24 flex-col items-center justify-center gap-2 rounded-2xl border border-gray-100 bg-white p-3 shadow-sm transition-all hover:-translate-y-0.5 hover:border-gray-200 hover:shadow-md active:scale-95">
                          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: bg }}>
                            <Icon size={18} style={{ color }} />
                          </div>
                          <p className="text-[11px] font-semibold text-gray-700 text-center leading-tight">{label}</p>
                        </button>
                      )
                    )}
                  </div>
                </section>
              ))}
          </div>

          {loading && (
            <div className="flex items-center justify-center py-10">
              <Loader2 size={24} className="animate-spin text-gray-400" />
            </div>
          )}
        </div>
      ) : activePage === 'doc-requests' ? (
        <Suspense fallback={
          <div className="flex items-center justify-center py-10">
            <Loader2 size={24} className="animate-spin text-gray-400" />
          </div>
        }>
          <InboxModule tenant={tenant} staffId={currentUserId} />
        </Suspense>
      ) : activePage === 'events' ? (
        // Suspense เฉพาะจุด ไม่พึ่งตัวที่ครอบ route อยู่ใน App.jsx — ถ้าใช้ตัวนั้น ทั้งหน้าแผงควบคุม
        // จะหายไปเป็นจอเปล่าระหว่างดาวน์โหลด chunk แทนที่จะขึ้น spinner เฉพาะส่วนเนื้อหา
        <Suspense fallback={
          <div className="flex items-center justify-center py-10">
            <Loader2 size={24} className="animate-spin text-gray-400" />
          </div>
        }>
          <EventsManagerComponent tenant={tenant} currentUserRole={currentUserRole} />
        </Suspense>
      ) : activePage === 'satisfaction' ? (
        <SatisfactionAdmin tenant={tenant} />
      ) : activePage === 'report' ? (
        <Suspense fallback={
          <div className="flex items-center justify-center py-10">
            <Loader2 size={24} className="animate-spin text-gray-400" />
          </div>
        }>
          <ReportManagerComponent complaints={complaints} tenant={tenant} technicians={technicians} />
        </Suspense>
      ) : activePage === 'staff' ? (
        LEGACY_STAFF_PAGE_ENABLED
          ? <StaffManager tenant={tenant} />
          : <UserManager tenant={tenant} currentUserRole={currentUserRole} currentUserId={currentUserId} />
      ) : activePage === 'emergency' ? (
        <EmergencyManager tenant={tenant} />
      ) : activePage === 'users' ? (
        <UserManager tenant={tenant} currentUserRole={currentUserRole} currentUserId={currentUserId} />
      ) : activePage === 'locations' ? (
        <LocationManager tenant={tenant} />
      ) : activePage === 'categories' ? (
        // หน้า "ผู้รับผิดชอบแต่ละประเภทคำร้อง" (activePage 'assignments', AssignmentManager component)
        // ถูกลบไปแล้ว — เป็น UI ซ้ำซ้อนกับส่วนตั้งผู้รับผิดชอบ+SLA ที่ฝังอยู่ใน CategoryManager นี้อยู่แล้ว
        // (เขียนตาราง category_assignments ตัวเดียวกัน) เมนูไปหน้านั้นถูกปิด (show:false) มานานแล้วด้วย
        <CategoryManager tenant={tenant} />
      ) : activePage === 'civil-report' ? (
        <Suspense fallback={
          <div className="flex items-center justify-center py-10">
            <Loader2 size={24} className="animate-spin text-gray-400" />
          </div>
        }>
          <CivilProjectReport tenant={tenant} />
        </Suspense>
      ) : activePage === 'fee-settings' ? (
        <FeeSettingsAdmin tenant={tenant} />
      ) : activePage === 'holidays' ? (
        <HolidaysAdmin tenant={tenant} currentUserRole={currentUserRole} />
      ) : activePage === 'system-settings' ? (
        <SystemSettingsAdmin tenant={tenant} onUpdateTenant={() => window.location.reload()} />
      ) : activePage === 'audit-log' ? (
        <AuditLogViewer tenant={tenant} />
      ) : activePage === 'fleet-setup' ? (
        <FleetSetup tenant={tenant} />
      ) : activePage === 'more' ? (
        /* ─── อื่นๆ page ─── */
        <div className="space-y-4">
          <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wide">เมนูเพิ่มเติม</h2>

          {/* Mobile: icon grid */}
          <div className="md:hidden grid grid-cols-2 gap-3">
            {currentUserRole !== 'viewer' && (
              <button onClick={() => setActivePage('categories')}
                className="flex flex-col items-center gap-3 bg-white rounded-2xl shadow-sm border border-gray-100 p-5 hover:bg-gray-50 active:scale-95 transition-all text-center">
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ backgroundColor: '#fef3c7' }}>
                  <Tag size={24} style={{ color: '#d97706' }} />
                </div>
                <div>
                  <p className="text-sm font-bold text-gray-800">ประเภทคำร้อง</p>
                  <p className="text-[13px] text-gray-400 mt-0.5">จัดการหมวดหมู่</p>
                </div>
              </button>
            )}
            {(currentUserRole === 'admin' || currentUserRole === 'superadmin') && (
              <button onClick={() => setActivePage('users')}
                className="flex flex-col items-center gap-3 bg-white rounded-2xl shadow-sm border border-gray-100 p-5 hover:bg-gray-50 active:scale-95 transition-all text-center">
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ backgroundColor: '#ede9fe' }}>
                  <Shield size={24} style={{ color: '#7c3aed' }} />
                </div>
                <div>
                  <p className="text-sm font-bold text-gray-800">จัดการผู้ใช้และการแต่งตั้ง</p>
                  <p className="text-[13px] text-gray-400 mt-0.5">ตำแหน่ง สังกัด บทบาท และสิทธิ์</p>
                </div>
              </button>
            )}
            <button onClick={() => setActivePage('emergency')}
              className="flex flex-col items-center gap-3 bg-white rounded-2xl shadow-sm border border-gray-100 p-5 hover:bg-gray-50 active:scale-95 transition-all text-center">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ backgroundColor: '#fee2e2' }}>
                <Phone size={24} style={{ color: '#ef4444' }} />
              </div>
              <div>
                <p className="text-sm font-bold text-gray-800">สายด่วนฉุกเฉิน</p>
                <p className="text-[13px] text-gray-400 mt-0.5">จัดการเบอร์ติดต่อ</p>
              </div>
            </button>
            <button onClick={() => setActivePage('locations')}
              className="flex flex-col items-center gap-3 bg-white rounded-2xl shadow-sm border border-gray-100 p-5 hover:bg-gray-50 active:scale-95 transition-all text-center">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ backgroundColor: '#e0f2fe' }}>
                <MapPin size={24} style={{ color: '#0891b2' }} />
              </div>
              <div>
                <p className="text-sm font-bold text-gray-800">สถานที่เกิดเหตุ</p>
                <p className="text-[13px] text-gray-400 mt-0.5">จัดการหมู่บ้าน / ตำบล</p>
              </div>
            </button>
            {(currentUserRole === 'admin' || currentUserRole === 'superadmin') && (
              <button onClick={() => setActivePage('fleet-setup')}
                className="flex flex-col items-center gap-3 bg-white rounded-2xl shadow-sm border border-gray-100 p-5 hover:bg-gray-50 active:scale-95 transition-all text-center">
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ backgroundColor: '#e0f2fe' }}>
                  <Car size={24} style={{ color: '#0369a1' }} />
                </div>
                <div>
                  <p className="text-sm font-bold text-gray-800">ตั้งค่ายานพาหนะ</p>
                  <p className="text-[13px] text-gray-400 mt-0.5">กอง งบประมาณ สิทธิ์</p>
                </div>
              </button>
            )}
            {(currentUserRole === 'admin' || currentUserRole === 'superadmin') && (
              <button onClick={() => setActivePage('system-settings')}
                className="flex flex-col items-center gap-3 bg-white rounded-2xl shadow-sm border border-gray-100 p-5 hover:bg-gray-50 active:scale-95 transition-all text-center">
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ backgroundColor: '#dbeafe' }}>
                  <Settings size={24} style={{ color: '#3b82f6' }} />
                </div>
                <div>
                  <p className="text-sm font-bold text-gray-800">ตั้งค่าระบบ</p>
                  <p className="text-[13px] text-gray-400 mt-0.5">ชื่อระบบ</p>
                </div>
              </button>
            )}
            <a href="/manual-admin.html" target="_blank" rel="noopener noreferrer"
              className="flex flex-col items-center gap-3 bg-white rounded-2xl shadow-sm border border-gray-100 p-5 hover:bg-gray-50 active:scale-95 transition-all text-center">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ backgroundColor: '#d1fae5' }}>
                <BookOpen size={24} style={{ color: '#059669' }} />
              </div>
              <div>
                <p className="text-sm font-bold text-gray-800">คู่มือผู้ดูแล</p>
                <p className="text-[13px] text-gray-400 mt-0.5">คู่มือการใช้งานระบบ</p>
              </div>
            </a>
          </div>

          {/* Desktop: settings table */}
          <div className="hidden md:block bg-white border border-gray-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500">เมนู</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500">คำอธิบาย</th>
                  <th className="px-5 py-3 text-right text-xs font-semibold text-gray-500 w-28">เข้าใช้งาน</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {[
                  { key: 'categories',  Icon: Tag,    color: '#d97706', bg: '#fef3c7', label: 'ประเภทคำร้อง', desc: 'จัดการหมวดหมู่ + ผู้รับผิดชอบ', show: currentUserRole !== 'viewer' },
                  { key: 'emergency',   Icon: Phone,       color: '#ef4444', bg: '#fee2e2', label: 'สายด่วนฉุกเฉิน',  desc: 'จัดการรายชื่อและเบอร์ติดต่อ',     show: currentUserRole !== 'viewer' },
                  { key: 'locations',   Icon: MapPin,      color: '#0891b2', bg: '#e0f2fe', label: 'สถานที่เกิดเหตุ', desc: 'จัดการหมู่บ้าน / ตำบลในพื้นที่',  show: currentUserRole !== 'viewer' },
                  { key: 'holidays',    Icon: CalendarDays, color: '#0d9488', bg: '#ccfbf1', label: 'วันหยุดราชการ',  desc: 'ใช้คำนวณ SLA คำร้องเป็นวันทำการ',   show: currentUserRole === 'admin' || currentUserRole === 'superadmin' },
                  { key: 'fleet-setup',      Icon: Car,         color: '#0369a1', bg: '#e0f2fe', label: 'ตั้งค่ายานพาหนะ', desc: 'กอง/หน่วยงาน งบประมาณ สิทธิ์ผู้ใช้', show: currentUserRole === 'admin' || currentUserRole === 'superadmin' },
                  { key: 'system-settings',  Icon: Settings,    color: '#3b82f6', bg: '#dbeafe', label: 'ตั้งค่าระบบ',    desc: 'ตั้งค่าชื่อระบบและข้อมูลพื้นฐาน',   show: currentUserRole === 'admin' || currentUserRole === 'superadmin' },
                  { key: 'users',           Icon: Shield,      color: '#7c3aed', bg: '#ede9fe', label: 'จัดการผู้ใช้และการแต่งตั้ง', desc: 'ตำแหน่ง สังกัด บทบาท และสิทธิ์', show: currentUserRole === 'admin' || currentUserRole === 'superadmin' },
                ].filter(r => r.show).map(({ key, Icon, color, bg, label, desc }) => (
                  <tr key={key} className="hover:bg-gray-50 transition-colors cursor-pointer" onClick={() => setActivePage(key)}>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: bg }}>
                          <Icon size={16} style={{ color }} />
                        </div>
                        <span className="font-semibold text-gray-800">{label}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-gray-500">{desc}</td>
                    <td className="px-5 py-3.5 text-right">
                      <button className="flex items-center gap-1.5 ml-auto text-xs font-semibold px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-100 transition-colors">
                        เปิด <ChevronRight size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
                <tr className="hover:bg-gray-50 transition-colors">
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: '#d1fae5' }}>
                        <BookOpen size={16} style={{ color: '#059669' }} />
                      </div>
                      <span className="font-semibold text-gray-800">คู่มือผู้ดูแล</span>
                    </div>
                  </td>
                  <td className="px-5 py-3.5 text-gray-500">เอกสารการใช้งานระบบสำหรับเจ้าหน้าที่</td>
                  <td className="px-5 py-3.5 text-right">
                    <a href="/manual-admin.html" target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1.5 ml-auto text-xs font-semibold px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-100 transition-colors w-fit">
                      เปิด <ExternalLink size={11} />
                    </a>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
      </div>
      </div>
    </div>
  )
}
