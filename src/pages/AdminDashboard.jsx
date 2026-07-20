import { useEffect, useState, useCallback, useRef } from 'react'
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
  Search, Phone, Trash2, Plus, PhoneCall, LogOut, Users, Shield, MapPin, GripVertical,
  X, Home, LayoutGrid, Tag, ChevronUp, ChevronDown, Pencil, Wrench, Camera,
  TrendingUp, AlertTriangle, Printer, UserCircle2, CalendarDays, Paperclip, BookOpen, Bell, ExternalLink, Settings, Download, Banknote, Star, MessageSquare, Car, ShieldCheck
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { compressImage } from '../lib/imageUtils'
import { attachReporterProfiles } from '../lib/attachReporterProfiles'
import { useTenant } from '../contexts/TenantContext'
import MapDashboardAdmin from '../components/admin/MapDashboardAdmin'
import CivilProjectAdmin from '../components/admin/CivilProjectAdmin'
import CivilProjectReport from '../components/admin/CivilProjectReport'
import SystemSettingsAdmin from '../components/admin/SystemSettingsAdmin'
import FeeSettingsAdmin from '../components/admin/FeeSettingsAdmin'
import EventsManagerComponent from '../components/admin/EventsManager'
import { InboxModule } from './StaffDashboard'
import ReportManagerComponent from '../components/admin/ReportManager'
import AuditLogViewer from '../components/admin/AuditLogViewer'
import FleetSetup from '../components/fleet/FleetSetup'
import SuperAdminPanel from '../components/admin/SuperAdminPanel'

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
  noise: 'เหตุรำคาญ', other: 'อื่นๆ',
}

let CATEGORY_EMOJI = {
  road: '', light: '', trash: '', water: '',
  flood: '', tree: '', noise: '', drain: '',
  waste_water: '', suction: '', manhole: '', vendor: '',
  building: '', mosquito: '', pollution: '', corruption: '',
  tax: '', canal: '', animals: '', other: '',
}


// ─── User Manager ─────────────────────────────────────────────────────────────
const ROLE_LABELS = {
  superadmin:  { label: 'Super Admin',   color: '#7c3aed', bg: '#ede9fe' },
  admin:       { label: 'แอดมินระบบ',   color: '#1d4ed8', bg: '#dbeafe' },
  officer:     { label: 'แอดมินกอง',    color: '#0891b2', bg: '#e0f2fe' },
  technician:  { label: 'ปฏิบัติงาน',   color: '#d97706', bg: '#fef3c7' },
  staff:       { label: 'เจ้าหน้าที่',  color: '#0ea5e9', bg: '#e0f2fe' },
  viewer:      { label: 'ผู้บริหาร',    color: '#059669', bg: '#d1fae5' },
  council:     { label: 'สภาเทศบาล',    color: '#f59e0b', bg: '#fff7ed' },
  citizen:     { label: 'ประชาชน',       color: '#374151', bg: '#f3f4f6' },
}

const NON_CITIZEN_ROLES = ['staff', 'officer', 'technician', 'admin', 'superadmin', 'council', 'viewer']

function UserManager({ tenant, currentUserRole }) {
  const [subTab, setSubTab] = useState('staff') // 'staff' | 'citizen'
  const [users, setUsers] = useState([])
  const [depts, setDepts] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(null)
  const [editingNameId, setEditingNameId] = useState(null)
  const [editingNameValue, setEditingNameValue] = useState('')
  const [editingPositionId, setEditingPositionId] = useState(null)
  const [editingPositionValue, setEditingPositionValue] = useState('')
  const [editingAddressId, setEditingAddressId] = useState(null)
  const [editingAddressValue, setEditingAddressValue] = useState('')
  const [editingRoleId, setEditingRoleId] = useState(null)
  const [editingRoleValue, setEditingRoleValue] = useState('')
  const [viewingUserId, setViewingUserId] = useState(null)
  // derive จาก users list เสมอ (ไม่เก็บ snapshot แยก) กัน UI ค้างข้อมูลเก่าหลังแก้ไขในหน้ารายละเอียด
  const viewingUser = viewingUserId ? users.find(u => u.id === viewingUserId) : null
  const [deletingUser, setDeletingUser] = useState(null)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [sortConfig, setSortConfig] = useState({ key: 'created_at', direction: 'desc' })

  const [search, setSearch] = useState('')
  const [filterRole, setFilterRole] = useState('')

  useEffect(() => {
    if (!tenant?.id) return
    supabase.from('departments').select('id, name, short_name')
      .eq('municipality_id', tenant.id).eq('is_active', true).order('sort_order')
      .then(({ data }) => setDepts(data ?? []))
  }, [tenant?.id])

  const fetchUsers = useCallback(async (opts = {}) => {
    if (!['admin', 'superadmin', 'officer'].includes(currentUserRole)) return
    if (currentUserRole !== 'superadmin' && !tenant?.id) return
    const searchTerm = (opts.search ?? '').trim()
    // แท็บประชาชน: ไม่โหลดจนกว่าจะพิมพ์ค้นหา (กันโหลดผู้ใช้เป็นพันคนมาทีเดียว)
    if (subTab === 'citizen' && !searchTerm) { setUsers([]); setLoading(false); return }
    setLoading(true)
    try {
      // superadmin ส่ง null → SQL คืน users ทุก municipality, แล้ว filter ใน JS
      const p_muni = currentUserRole === 'superadmin' ? null : tenant?.id
      const { data, error } = await supabase.rpc('get_users_with_email', {
        p_municipality_id: p_muni,
        p_roles: subTab === 'citizen' ? ['citizen'] : NON_CITIZEN_ROLES,
        p_search: subTab === 'citizen' ? searchTerm : null,
        p_limit: subTab === 'citizen' ? 50 : null,
      })
      if (error) { console.error('get_users_with_email:', error.message); return }
      const filtered = tenant?.id
        ? (data ?? []).filter(u => u.municipality_id === tenant.id || u.municipality_id === null)
        : (data ?? [])
      setUsers(filtered)
    } finally {
      setLoading(false)
    }
  }, [tenant?.id, currentUserRole, subTab])

  useEffect(() => {
    setSearch('')
    setFilterRole('')
    if (subTab === 'staff') {
      fetchUsers()
    } else {
      setUsers([])
      setLoading(false)
    }
    const safety = setTimeout(() => setLoading(false), 12000)
    return () => clearTimeout(safety)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subTab])

  // แท็บประชาชน: ค้นหาแบบ debounce (พิมพ์แล้วรอ 400ms ค่อยยิง query กันสแปมทุกตัวอักษร)
  useEffect(() => {
    if (subTab !== 'citizen') return
    if (!search.trim()) { setUsers([]); return }
    const t = setTimeout(() => fetchUsers({ search }), 400)
    return () => clearTimeout(t)
  }, [search, subTab, fetchUsers])

  async function updateName(userId) {
    const name = editingNameValue.trim()
    if (!name) return
    setSaving(userId)
    const { error } = await supabase.from('profiles').update({ full_name: name }).eq('id', userId)
    if (error) {
      alert(`บันทึกไม่สำเร็จ: ${error.message}`)
    } else {
      setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, full_name: name } : u))
      setEditingNameId(null)
    }
    setSaving(null)
  }

  async function updateRole(userId, newRole, municipalityId) {
    setSaving(userId)
    const needsMuni = ['admin', 'staff', 'technician', 'officer', 'viewer', 'council'].includes(newRole)
    const muni = needsMuni ? (municipalityId || tenant?.id) : null
    const { error } = await supabase.from('profiles').update({ role: newRole, municipality_id: muni }).eq('id', userId)
    if (error) {
      console.error('updateRole failed:', error.message)
      alert(`บันทึกไม่สำเร็จ: ${error.message}`)
    } else {
      setUsers((prev) => prev.map((u) =>
        u.id === userId ? { ...u, role: newRole, municipality_id: muni } : u
      ))
      setEditingRoleId(null)
    }
    setSaving(null)
  }

  async function updatePosition(userId) {
    const val = editingPositionValue.trim()
    setSaving(userId)
    const { error } = await supabase.from('profiles').update({ job_title: val || null }).eq('id', userId)
    if (error) {
      alert(`บันทึกไม่สำเร็จ: ${error.message}`)
    } else {
      setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, job_title: val || null } : u))
      setEditingPositionId(null)
    }
    setSaving(null)
  }

  async function updateAddress(userId) {
    const val = editingAddressValue.trim()
    setSaving(userId)
    const { error } = await supabase.from('profiles').update({ address: val || null }).eq('id', userId)
    if (error) {
      alert(`บันทึกไม่สำเร็จ: ${error.message}`)
    } else {
      setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, address: val || null } : u))
      setEditingAddressId(null)
    }
    setSaving(null)
  }

  async function updateDepartment(userId, deptId) {
    setSaving(userId)
    const dept = depts.find(d => d.id === deptId)
    const { error } = await supabase.from('profiles').update({ department_id: deptId || null }).eq('id', userId)
    if (error) {
      alert(`บันทึกไม่สำเร็จ: ${error.message}`)
    } else {
      setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, department_id: deptId || null, department_name: dept?.name ?? null } : u))
    }
    setSaving(null)
  }

  async function toggleDeptHead(userId, current) {
    setSaving(userId)
    const { error } = await supabase.from('profiles').update({ is_dept_head: !current }).eq('id', userId)
    if (error) {
      alert(`บันทึกไม่สำเร็จ: ${error.message}`)
    } else {
      setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, is_dept_head: !current } : u))
    }
    setSaving(null)
  }

  // บันทึกทุกแท็บ (บัญชี/ส่วนตัว/สังกัด) ในหน้ารายละเอียดพร้อมกันครั้งเดียว แทนการกดบันทึกทีละฟิลด์
  async function saveUserEdits(user, changes) {
    setSaving(user.id)
    const needsMuni = ['admin', 'staff', 'technician', 'officer', 'viewer', 'council'].includes(changes.role)
    const payload = { ...changes, municipality_id: needsMuni ? (user.municipality_id || tenant?.id) : null }
    const { error } = await supabase.from('profiles').update(payload).eq('id', user.id)
    setSaving(null)
    if (error) {
      const msg = error.code === '23505' ? 'เลขบัตรประชาชนนี้ถูกใช้กับบัญชีอื่นแล้ว' : error.message
      return { ok: false, error: msg }
    }
    const dept = depts.find(d => d.id === changes.department_id)
    setUsers((prev) => prev.map((u) => u.id === user.id ? { ...u, ...payload, department_name: dept?.name ?? null } : u))
    return { ok: true }
  }

  async function deleteUser(userId) {
    setDeleteLoading(true)
    const { error } = await supabase.rpc('delete_user_by_id', { p_user_id: userId })
    setDeleteLoading(false)
    if (error) {
      alert(`ลบไม่สำเร็จ: ${error.message}`)
    } else {
      setUsers((prev) => prev.filter((u) => u.id !== userId))
      setDeletingUser(null)
      if (viewingUserId === userId) setViewingUserId(null) // กันหน้ารายละเอียดค้างชี้ user ที่ลบไปแล้ว
    }
  }

  const handleSort = (key) => {
    setSortConfig(current => ({
      key,
      direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc'
    }))
  }

  const filtered = users.filter((u) => {
    const q = search.toLowerCase()
    const matchSearch = !q || (u.full_name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q) || (u.phone || '').includes(q)
    const matchRole = !filterRole || u.role === filterRole
    return matchSearch && matchRole
  }).sort((a, b) => {
    const { key, direction } = sortConfig;
    let aVal = '';
    let bVal = '';

    if (key === 'job_title') {
      const aRoleLabel = (ROLE_LABELS[a.role] ?? ROLE_LABELS.citizen).label;
      const bRoleLabel = (ROLE_LABELS[b.role] ?? ROLE_LABELS.citizen).label;
      aVal = aRoleLabel + (a.job_title || '');
      bVal = bRoleLabel + (b.job_title || '');
    } else {
      aVal = a[key] || '';
      bVal = b[key] || '';
    }
    
    // Sort logically for text, case insensitive
    if (typeof aVal === 'string') aVal = aVal.toLowerCase();
    if (typeof bVal === 'string') bVal = bVal.toLowerCase();

    if (aVal < bVal) return direction === 'asc' ? -1 : 1;
    if (aVal > bVal) return direction === 'asc' ? 1 : -1;
    return 0;
  })

  if (viewingUser) {
    return (
      <UserDetailPage
        user={viewingUser}
        onBack={() => setViewingUserId(null)}
        currentUserRole={currentUserRole}
        tenant={tenant}
        depts={depts}
        saving={saving}
        editingNameId={editingNameId} editingNameValue={editingNameValue} setEditingNameId={setEditingNameId} setEditingNameValue={setEditingNameValue} updateName={updateName}
        editingPositionId={editingPositionId} editingPositionValue={editingPositionValue} setEditingPositionId={setEditingPositionId} setEditingPositionValue={setEditingPositionValue} updatePosition={updatePosition}
        editingAddressId={editingAddressId} editingAddressValue={editingAddressValue} setEditingAddressId={setEditingAddressId} setEditingAddressValue={setEditingAddressValue} updateAddress={updateAddress}
        updateDepartment={updateDepartment} toggleDeptHead={toggleDeptHead}
        editingRoleId={editingRoleId} editingRoleValue={editingRoleValue} setEditingRoleId={setEditingRoleId} setEditingRoleValue={setEditingRoleValue} updateRole={updateRole}
        deletingUser={deletingUser} setDeletingUser={setDeletingUser} deleteLoading={deleteLoading} deleteUser={deleteUser}
        saveUserEdits={saveUserEdits}
      />
    )
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
        <h3 className="font-semibold text-gray-700 flex items-center gap-2">
          <Users size={16} /> จัดการผู้ใช้งาน
          {!loading && users.length > 0 && (
            <span className="text-xs font-normal text-gray-400">({users.length} คน)</span>
          )}
        </h3>
        <button onClick={() => fetchUsers(subTab === 'citizen' ? { search } : {})} className="text-gray-400 hover:text-gray-600 transition-colors">
          <RefreshCw size={15} />
        </button>
      </div>

      {/* แท็บย่อย: เจ้าหน้าที่ / ประชาชน — แยก query กันโหลดผู้ใช้ทั้งหมดมาทีเดียว */}
      <div className="px-4 pt-3 flex gap-2">
        {[
          { key: 'staff',   label: 'เจ้าหน้าที่' },
          { key: 'citizen', label: 'ผู้ใช้งานประชาชน' },
        ].map(({ key, label }) => (
          <button key={key} onClick={() => setSubTab(key)}
            className={`px-3.5 py-1.5 rounded-xl text-sm font-semibold transition-colors ${
              subTab === key ? 'text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
            style={subTab === key ? { backgroundColor: '#7c3aed' } : {}}>
            {label}
          </button>
        ))}
      </div>

      {/* ตัวกรอง */}
      <div className="px-4 py-3 border-b border-gray-50 flex gap-2 flex-wrap">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={subTab === 'citizen' ? 'พิมพ์ชื่อ, เบอร์โทร, เลขบัตร เพื่อค้นหา...' : 'ค้นหาชื่อ, อีเมล, เบอร์...'}
            className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:border-blue-400 text-gray-900 bg-white"
          />
        </div>
        {subTab === 'staff' && (
        <select
          value={filterRole}
          onChange={(e) => setFilterRole(e.target.value)}
          className="text-xs border border-gray-200 rounded-xl px-2 py-2 text-gray-600 focus:outline-none shrink-0"
        >
          <option value="">ทุกตำแหน่ง ({users.length})</option>
          {[
            { value: 'staff',      label: 'เจ้าหน้าที่' },
            { value: 'viewer',     label: 'ผู้บริหาร' },
            { value: 'council',    label: 'สภาเทศบาล' },
            { value: 'officer',    label: 'แอดมินกอง' },
            { value: 'technician', label: 'ปฏิบัติงาน' },
            { value: 'admin',      label: 'แอดมินระบบ' },
            ...(currentUserRole === 'superadmin' ? [{ value: 'superadmin', label: 'Super Admin' }] : []),
          ].map(({ value, label }) => {
            const count = users.filter((u) => u.role === value).length
            return count > 0 ? <option key={value} value={value}>{label} ({count})</option> : null
          })}
        </select>
        )}
        {(search || filterRole) && (
          <button
            onClick={() => { setSearch(''); setFilterRole('') }}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-red-500 border border-gray-200 rounded-xl px-2.5 py-2 transition-colors shrink-0"
          >
            <X size={12} /> ล้าง
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-10 text-gray-400">
          <Loader2 size={20} className="animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-center py-10 text-gray-400 text-sm">
          {subTab === 'citizen' && !search.trim()
            ? 'พิมพ์ชื่อ, เบอร์โทร หรือเลขบัตรประชาชน เพื่อค้นหาผู้ใช้งาน'
            : users.length === 0 ? 'ยังไม่มีผู้ใช้งาน' : 'ไม่พบผู้ใช้ที่ค้นหา'}
        </p>
      ) : (
        <>
        <div className="md:hidden divide-y divide-gray-50">
          {filtered.map((u, i) => {
            const rs = ROLE_LABELS[u.role] ?? ROLE_LABELS.citizen
            const isSelf = false
            return (
              <div key={u.id} className="flex flex-col px-4 py-3 gap-2 cursor-pointer hover:bg-gray-50/70 transition-colors"
                onClick={(e) => { if (e.target.closest('button, select, input, a, label')) return; setViewingUserId(u.id) }}>
                {/* แถว 1: avatar + ชื่อ + badge */}
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-400 font-mono w-5 text-right shrink-0">{i + 1}</span>
                  <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0"
                       style={{ backgroundColor: rs.color }}>
                    {(u.full_name || u.email || '?')[0].toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="font-medium text-gray-800 text-sm">
                        {u.full_name || '—'}
                        {u.staff_title && <span className="text-gray-400 font-normal"> ({u.staff_title})</span>}
                      </p>
                      {(currentUserRole === 'admin' || currentUserRole === 'superadmin') && u.role !== 'superadmin' && (
                        <button
                          onClick={() => { setEditingNameId(u.id); setEditingNameValue(u.full_name || '') }}
                          className="text-gray-300 hover:text-gray-500 transition-colors"
                        >
                          <Pencil size={12} />
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 break-all mt-0.5">{u.email || '—'}</p>
                    {u.phone && <p className="text-xs text-gray-500 mt-0.5">📞 {u.phone}</p>}
                    {u.id_card && (
                      <p className="text-xs font-mono text-gray-400 mt-0.5">
                        🪪 {u.id_card.replace(/(\d{1})(\d{4})(\d{5})(\d{2})(\d{1})/, '$1-$2-$3-$4-$5')}
                      </p>
                    )}
                    {(currentUserRole === 'admin' || currentUserRole === 'superadmin') && u.role !== 'superadmin' && (
                      <div className="flex flex-col gap-0.5 mt-0.5">
                        <div className="flex items-center gap-1">
                          <p className="text-xs text-gray-400">
                            {u.job_title || <span className="italic text-gray-300">ยังไม่ระบุตำแหน่งงาน</span>}
                          </p>
                          <button
                            onClick={() => { setEditingPositionId(u.id); setEditingPositionValue(u.job_title || '') }}
                            className="text-gray-300 hover:text-gray-500 transition-colors"
                          >
                            <Pencil size={11} />
                          </button>
                        </div>
                        <div className="flex items-center gap-1">
                          <p className="text-xs text-gray-400">
                            {u.address || <span className="italic text-gray-300">ยังไม่ระบุที่อยู่</span>}
                          </p>
                          <button
                            onClick={() => { setEditingAddressId(u.id); setEditingAddressValue(u.address || '') }}
                            className="text-gray-300 hover:text-gray-500 transition-colors"
                          >
                            <Pencil size={11} />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full shrink-0"
                        style={{ backgroundColor: rs.bg, color: rs.color }}>
                    {rs.label}
                  </span>
                </div>
                {/* แถว 2: dropdown เปลี่ยน role (เฉพาะ admin/superadmin) */}
                {u.role !== 'superadmin' && (currentUserRole === 'superadmin' || currentUserRole === 'admin') && (
                  <div className="flex items-center gap-2 pl-[68px] mt-1 justify-start">
                    {editingRoleId === u.id ? (
                      <>
                        <select
                          value={editingRoleValue}
                          disabled={saving === u.id}
                          onChange={(e) => setEditingRoleValue(e.target.value)}
                          className="text-xs border border-gray-200 rounded-xl px-2 py-1.5 text-gray-700 focus:outline-none bg-gray-50"
                        >
                          <option value="citizen">ประชาชน</option>
                          <option value="staff">เจ้าหน้าที่</option>
                          <option value="viewer">ผู้บริหาร</option>
                          <option value="council">สภาเทศบาล</option>
                          <option value="officer">แอดมินกอง</option>
                          <option value="technician">ปฏิบัติงาน</option>
                          <option value="admin">แอดมินระบบ</option>
                          {currentUserRole === 'superadmin' && <option value="superadmin">Super Admin</option>}
                        </select>
                        <button onClick={() => updateRole(u.id, editingRoleValue, u.municipality_id)} disabled={saving === u.id} className="text-xs text-blue-600 font-medium px-2">ยืนยัน</button>
                        <button onClick={() => setEditingRoleId(null)} className="text-xs text-gray-400">ยกเลิก</button>
                        {saving === u.id && <Loader2 size={14} className="animate-spin text-gray-400 shrink-0" />}
                      </>
                    ) : (
                      <button onClick={() => { setEditingRoleId(u.id); setEditingRoleValue(u.role) }} className="text-xs text-gray-500 hover:text-gray-700 font-medium px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors whitespace-nowrap">
                        เปลี่ยนบทบาท
                      </button>
                    )}
                  </div>
                )}
                {subTab === 'staff' && (
                  <div className="flex items-center gap-2 pl-[68px] mt-1 flex-wrap">
                    {(currentUserRole === 'admin' || currentUserRole === 'superadmin') ? (
                      <select value={u.department_id ?? ''} disabled={saving === u.id}
                        onChange={(e) => updateDepartment(u.id, e.target.value)}
                        className="text-xs border border-gray-200 rounded-lg px-2 py-1 text-gray-600 focus:outline-none bg-gray-50">
                        <option value="">— ไม่ระบุกอง —</option>
                        {depts.map(d => <option key={d.id} value={d.id}>{d.short_name || d.name}</option>)}
                      </select>
                    ) : (
                      <span className="text-xs text-gray-400">{u.department_name || 'ไม่ระบุกอง'}</span>
                    )}
                    {u.department_id && (currentUserRole === 'admin' || currentUserRole === 'superadmin') && (
                      <label className="flex items-center gap-1 text-[11px] text-gray-400 cursor-pointer">
                        <input type="checkbox" checked={!!u.is_dept_head} disabled={saving === u.id}
                          onChange={() => toggleDeptHead(u.id, u.is_dept_head)}
                          className="w-3.5 h-3.5" />
                        หัวหน้ากอง
                      </label>
                    )}
                  </div>
                )}
                <div className="flex items-center gap-2 pl-[68px] mt-1">
                  <button onClick={() => setViewingUserId(u.id)} className="text-[11px] text-blue-500 hover:text-blue-700 font-medium px-2 py-1 bg-blue-50 hover:bg-blue-100 rounded transition-colors">
                    ดูรายละเอียด
                  </button>
                  {(currentUserRole === 'superadmin' || currentUserRole === 'admin') && u.role !== 'superadmin' && (
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
                {editingPositionId === u.id && (
                  <div className="flex items-center gap-2 pl-12">
                    <input
                      autoFocus
                      value={editingPositionValue}
                      onChange={(e) => setEditingPositionValue(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') updatePosition(u.id); if (e.key === 'Escape') setEditingPositionId(null) }}
                      placeholder="เช่น นายกเทศมนตรีตำบลน้ำเลา, ช่างโยธา"
                      className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:border-blue-400 bg-white text-gray-900"
                    />
                    <button
                      onClick={() => updatePosition(u.id)}
                      disabled={saving === u.id}
                      className="text-xs bg-blue-500 text-white px-3 py-1.5 rounded-lg font-medium disabled:opacity-50"
                    >
                      บันทึก
                    </button>
                    <button
                      onClick={() => setEditingPositionId(null)}
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
        
        <div className="hidden md:block overflow-x-auto border border-gray-200">
          <table className="w-full text-sm text-left text-gray-600 table-fixed border-collapse">
            <thead>
              <tr style={{ backgroundColor: '#2c5282' }}>
                <th className="px-2 py-2.5 text-[11px] font-bold text-white border-r border-white/10 w-[5%]">ลำดับ</th>
                <th className="px-2 py-2.5 text-[11px] font-bold text-white border-r border-white/10 w-[18%] cursor-pointer hover:bg-white/10 transition-colors" onClick={() => handleSort('full_name')}>
                  <div className="flex items-center gap-1">ชื่อ-นามสกุล {sortConfig.key === 'full_name' && (sortConfig.direction === 'asc' ? <ChevronUp size={14}/> : <ChevronDown size={14}/>)}</div>
                </th>
                <th className="px-2 py-2.5 text-[11px] font-bold text-white border-r border-white/10 w-[20%]">อีเมล</th>
                <th className="px-2 py-2.5 text-[11px] font-bold text-white border-r border-white/10 w-[15%] cursor-pointer hover:bg-white/10 transition-colors" onClick={() => handleSort('role')}>
                  <div className="flex items-center gap-1">บทบาท/สิทธิ์ {sortConfig.key === 'role' && (sortConfig.direction === 'asc' ? <ChevronUp size={14}/> : <ChevronDown size={14}/>)}</div>
                </th>
                <th className="px-2 py-2.5 text-[11px] font-bold text-white border-r border-white/10 w-[17%]">สังกัด</th>
                <th className="px-2 py-2.5 text-[11px] font-bold text-white w-[25%] cursor-pointer hover:bg-white/10 transition-colors" onClick={() => handleSort('job_title')}>
                  <div className="flex items-center gap-1">ตำแหน่งงาน {sortConfig.key === 'job_title' && (sortConfig.direction === 'asc' ? <ChevronUp size={14}/> : <ChevronDown size={14}/>)}</div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {filtered.map((u, i) => {
                const rs = ROLE_LABELS[u.role] ?? ROLE_LABELS.citizen
                return (
                  <tr key={u.id}
                    className="transition-colors cursor-pointer"
                    style={{ backgroundColor: i % 2 === 0 ? '#fff' : '#f5f8fc' }}
                    onMouseEnter={e => e.currentTarget.style.backgroundColor = '#dbeafe'}
                    onMouseLeave={e => e.currentTarget.style.backgroundColor = i % 2 === 0 ? '#fff' : '#f5f8fc'}
                    onClick={(e) => { if (e.target.closest('button, select, input, a, label')) return; setViewingUserId(u.id) }}>
                    <td className="px-2 py-3 text-xs text-gray-400 font-mono border-r border-gray-200">{i + 1}</td>
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
                              {(currentUserRole === 'admin' || currentUserRole === 'superadmin') && u.role !== 'superadmin' && (
                                <button onClick={() => { setEditingNameId(u.id); setEditingNameValue(u.full_name || '') }} className="text-gray-300 hover:text-gray-500 shrink-0">
                                  <Pencil size={12} />
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    {/* อีเมล */}
                    <td className="px-2 py-3 overflow-hidden border-r border-gray-200">
                      <span className="text-xs text-gray-600 break-all">{u.email || <span className="italic text-gray-300">ยังไม่ระบุ</span>}</span>
                    </td>
                    {/* บทบาท/สิทธิ์: role badge เท่านั้น */}
                    <td className="px-2 py-3 overflow-hidden border-r border-gray-200">
                      <span className="text-[10px] font-medium px-2 py-0.5 rounded-full inline-block" style={{ backgroundColor: rs.bg, color: rs.color }}>
                        {rs.label}
                      </span>
                    </td>
                    {/* สังกัด: กอง + หัวหน้ากอง — stopPropagation กันคลิกในคอลัมน์นี้เด้งเข้าหน้ารายละเอียดโดยไม่ตั้งใจ (มี select/checkbox ที่ต้องเลือกละเอียด) */}
                    <td className="px-2 py-3 overflow-hidden border-r border-gray-200" onClick={(e) => e.stopPropagation()}>
                      {subTab === 'staff' ? (
                        <div className="flex flex-col items-start gap-1 w-full">
                          {(currentUserRole === 'admin' || currentUserRole === 'superadmin') ? (
                            <select value={u.department_id ?? ''} disabled={saving === u.id}
                              onChange={(e) => updateDepartment(u.id, e.target.value)}
                              className="text-[11px] border border-gray-200 rounded px-1.5 py-0.5 text-gray-600 focus:outline-none bg-white max-w-full">
                              <option value="">— ไม่ระบุกอง —</option>
                              {depts.map(d => <option key={d.id} value={d.id}>{d.short_name || d.name}</option>)}
                            </select>
                          ) : (
                            <span className="text-[11px] text-gray-400 truncate">{u.department_name || 'ไม่ระบุกอง'}</span>
                          )}
                          {u.department_id && (currentUserRole === 'admin' || currentUserRole === 'superadmin') && (
                            <label className="flex items-center gap-1 text-[10px] text-gray-400 shrink-0 cursor-pointer">
                              <input type="checkbox" checked={!!u.is_dept_head} disabled={saving === u.id}
                                onChange={() => toggleDeptHead(u.id, u.is_dept_head)}
                                className="w-3 h-3" />
                              หัวหน้ากอง
                            </label>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>
                    {/* ตำแหน่งงาน (job_title) — ย้ายมาจากคอลัมน์บทบาท/สิทธิ์เดิม — stopPropagation เหมือนคอลัมน์สังกัด เพราะมีช่องกรอกข้อความที่ต้องพิมพ์เอง */}
                    <td className="px-2 py-3 overflow-hidden" onClick={(e) => e.stopPropagation()}>
                      {editingPositionId === u.id ? (
                        <div className="flex items-center gap-2">
                          <input
                            autoFocus
                            value={editingPositionValue}
                            onChange={(e) => setEditingPositionValue(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') updatePosition(u.id); if (e.key === 'Escape') setEditingPositionId(null) }}
                            placeholder="ตำแหน่งงาน"
                            className="w-full text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:border-blue-400 bg-white text-gray-900"
                          />
                          <button onClick={() => updatePosition(u.id)} disabled={saving === u.id} className="text-xs text-blue-600 font-medium">บันทึก</button>
                          <button onClick={() => setEditingPositionId(null)} className="text-xs text-gray-400">ยกเลิก</button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 text-xs text-gray-500 min-w-0 w-full">
                          <span className="truncate">{u.job_title || <span className="italic text-gray-300">ไม่มีตำแหน่ง</span>}</span>
                          {(currentUserRole === 'admin' || currentUserRole === 'superadmin') && u.role !== 'superadmin' && (
                            <button onClick={() => { setEditingPositionId(u.id); setEditingPositionValue(u.job_title || '') }} className="text-gray-300 hover:text-gray-500 shrink-0">
                              <Pencil size={11} />
                            </button>
                          )}
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

      <DeleteUserConfirmModal deletingUser={deletingUser} setDeletingUser={setDeletingUser} deleteLoading={deleteLoading} deleteUser={deleteUser} />

    </div>
  )
}

// ─── User Detail Page (แท็บ, ต่อเพิ่มได้เรื่อยๆ แค่เพิ่ม entry ใน USER_DETAIL_TABS) ─────

// ใช้ร่วมกันทั้งจากตารางและหน้ารายละเอียด กันเขียนซ้ำ
function DeleteUserConfirmModal({ deletingUser, setDeletingUser, deleteLoading, deleteUser }) {
  if (!deletingUser) return null
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4" onClick={() => !deleteLoading && setDeletingUser(null)}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-col items-center text-center gap-3">
          <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center">
            <Trash2 size={24} className="text-red-500" />
          </div>
          <h3 className="text-lg font-semibold text-gray-800">ยืนยันการลบผู้ใช้งาน</h3>
          <p className="text-sm text-gray-500 leading-relaxed">
            คุณกำลังจะลบ <strong className="text-gray-800">{deletingUser.full_name || deletingUser.email || 'ผู้ใช้นี้'}</strong> ออกจากระบบถาวร<br />
            ข้อมูลทั้งหมดจะหายไปและไม่สามารถกู้คืนได้
          </p>
          <div className="flex gap-3 w-full mt-2">
            <button
              onClick={() => setDeletingUser(null)}
              disabled={deleteLoading}
              className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              ยกเลิก
            </button>
            <button
              onClick={() => deleteUser(deletingUser.id)}
              disabled={deleteLoading}
              className="flex-1 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {deleteLoading ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
              {deleteLoading ? 'กำลังลบ...' : 'ลบออกจากระบบ'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function AccountInfoTab(props) {
  const { user, currentUserRole, isEditing, draft, setDraft } = props
  const rs = ROLE_LABELS[(isEditing ? draft.role : user.role)] || ROLE_LABELS.citizen
  const providerBadge = {
    'email':       { label: 'Email/Password', bg: '#f3f4f6', color: '#374151', icon: '✉️' },
    'google':      { label: 'Google',          bg: '#fef9c3', color: '#854d0e', icon: '🔵' },
    'custom:line': { label: 'LINE',             bg: '#dcfce7', color: '#166534', icon: '💚' },
  }
  const providers = user.providers || []
  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">บทบาท</p>
        {isEditing ? (
          <select
            value={draft.role}
            onChange={(e) => setDraft(d => ({ ...d, role: e.target.value }))}
            className="text-sm border border-gray-200 rounded-lg px-3 py-2 text-gray-700 focus:outline-none bg-white"
          >
            <option value="citizen">ประชาชน</option>
            <option value="staff">เจ้าหน้าที่</option>
            <option value="viewer">ผู้บริหาร</option>
            <option value="council">สภาเทศบาล</option>
            <option value="officer">แอดมินกอง</option>
            <option value="technician">ปฏิบัติงาน</option>
            <option value="admin">แอดมินระบบ</option>
            {currentUserRole === 'superadmin' && <option value="superadmin">Super Admin</option>}
          </select>
        ) : (
          <span className="text-sm font-medium px-3 py-1 rounded-full inline-block" style={{ backgroundColor: rs.bg, color: rs.color }}>{rs.label}</span>
        )}
      </div>
      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">อีเมล</p>
        <p className="text-sm text-gray-800 break-all">{user.email || '—'}</p>
      </div>
      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">ช่องทางเชื่อมต่อบัญชี</p>
        {providers.length === 0 ? (
          <p className="text-xs text-gray-300 italic">ไม่พบข้อมูล</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {providers.map((p) => {
              const b = providerBadge[p] ?? { label: p, bg: '#f3f4f6', color: '#374151', icon: '🔗' }
              return (
                <span key={p} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold"
                      style={{ backgroundColor: b.bg, color: b.color }}>
                  {b.icon} {b.label}
                </span>
              )
            })}
          </div>
        )}
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
  return (
    <div className="space-y-5">
      <PersonalInfoField
        label="ชื่อ-นามสกุล"
        isEditing={isEditing}
        displayValue={user.full_name}
        editValue={draft?.full_name ?? ''}
        onChange={(e) => setDraft(d => ({ ...d, full_name: e.target.value }))}
      />
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
      <PersonalInfoField
        label="ตำแหน่งงาน"
        isEditing={isEditing}
        displayValue={user.job_title}
        editValue={draft?.job_title ?? ''}
        placeholder="เช่น นายกเทศมนตรีตำบลน้ำเลา, ช่างโยธา"
        onChange={(e) => setDraft(d => ({ ...d, job_title: e.target.value }))}
      />
    </div>
  )
}

function DepartmentTab({ user, depts, isEditing, draft, setDraft }) {
  const activeDeptId = isEditing ? draft.department_id : (user.department_id ?? '')
  return (
    <div className="space-y-5">
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
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input type="checkbox" checked={!!draft.is_dept_head}
                onChange={() => setDraft(d => ({ ...d, is_dept_head: !d.is_dept_head }))} className="w-4 h-4" />
              เป็นหัวหน้ากอง
            </label>
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

// เพิ่มแท็บใหม่ในอนาคต: เพิ่ม entry ตรงนี้ + เขียน component ใหม่ ไม่ต้องแก้โครงสร้าง UserDetailPage เลย
const USER_DETAIL_TABS = [
  { key: 'account',    label: 'ข้อมูลบัญชี',   Component: AccountInfoTab },
  { key: 'personal',   label: 'ข้อมูลส่วนตัว',  Component: PersonalInfoTab },
  { key: 'department', label: 'สังกัด',         Component: DepartmentTab },
]

// ตำบลของ tenant อนุมานจากชื่อได้เฉพาะ เทศบาลตำบล/อบต. เท่านั้น (เทศบาลเมือง/นคร มักคลุมหลายตำบล เลยไม่เดาให้)
function tenantDefaultSubdistrict(tenant) {
  if (!tenant?.name) return ''
  if (tenant.org_type === 'เทศบาลตำบล' && tenant.name.startsWith('เทศบาลตำบล')) {
    return tenant.name.replace(/^เทศบาลตำบล/, '')
  }
  if (tenant.org_type === 'อบต.' && tenant.name.startsWith('องค์การบริหารส่วนตำบล')) {
    return tenant.name.replace(/^องค์การบริหารส่วนตำบล/, '')
  }
  return ''
}

function UserDetailPage(props) {
  const { user, onBack, currentUserRole, tenant, saving, deletingUser, setDeletingUser, deleteLoading, deleteUser, saveUserEdits } = props
  const [activeTab, setActiveTab] = useState('account')
  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState(null)
  const [saveError, setSaveError] = useState('')
  const rs = ROLE_LABELS[user.role] || ROLE_LABELS.citizen
  const ActiveComponent = USER_DETAIL_TABS.find(t => t.key === activeTab)?.Component ?? AccountInfoTab
  const canDelete = (currentUserRole === 'superadmin' || currentUserRole === 'admin') && user.role !== 'superadmin'
  const canEdit = canDelete // เงื่อนไขสิทธิ์เดียวกัน: admin/superadmin แก้ไข/ลบได้ ยกเว้นบัญชี superadmin
  const isSaving = saving === user.id

  function startEdit() {
    setDraft({
      full_name: user.full_name || '',
      phone: user.phone || '',
      id_card: user.id_card || '',
      address_province: user.address_province || tenant?.province || '',
      address_district: user.address_district || tenant?.district || '',
      address_subdistrict: user.address_subdistrict || tenantDefaultSubdistrict(tenant),
      address_moo: user.address_moo || '',
      address_detail: user.address_detail || '',
      job_title: user.job_title || '',
      role: user.role,
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
    const changes = {
      full_name: draft.full_name.trim() || null,
      phone: draft.phone.trim() || null,
      id_card: draft.id_card.trim() || null,
      address_province: draft.address_province.trim() || null,
      address_district: draft.address_district.trim() || null,
      address_subdistrict: draft.address_subdistrict.trim() || null,
      address_moo: draft.address_moo.trim() || null,
      address_detail: draft.address_detail.trim() || null,
      job_title: draft.job_title.trim() || null,
      role: draft.role,
      department_id: draft.department_id || null,
      is_dept_head: draft.is_dept_head,
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
                  <Pencil size={14} /> แก้ไข
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
      <DeleteUserConfirmModal deletingUser={deletingUser} setDeletingUser={setDeletingUser} deleteLoading={deleteLoading} deleteUser={deleteUser} />
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

// ─── Assignment Manager ───────────────────────────────────────────────────────
const DEFAULT_CATS = [
  { value: 'light',            label: 'ไฟฟ้าสาธารณะ',           emoji: '💡' },
  { value: 'road',             label: 'ซ่อมแซมถนน',             emoji: '🛣️' },
  { value: 'mosquito',         label: 'พ่นยุง',                 emoji: '🦟' },
  { value: 'tree',             label: 'ตัดต้นไม้',              emoji: '🌳' },
  { value: 'trash',            label: 'ขยะ / ความสะอาด',       emoji: '🗑️' },
  { value: 'water_supply',     label: 'สนับสนุนน้ำอุปโภค',      emoji: '🚿' },
  { value: 'borrow_equipment', label: 'ยืมพัสดุ',               emoji: '📦' },
  { value: 'corruption',       label: 'แจ้งการทุจริต',          emoji: '⚖️' },
  { value: 'grievance',        label: 'ร้องทุกข์/ร้องเรียน',    emoji: '📣' },
  { value: 'other',            label: 'อื่นๆ',                  emoji: '📝' },
]

function AssignmentManager({ tenant, readOnly = false }) {
  const [cats, setCats] = useState(DEFAULT_CATS)
  const [techs, setTechs] = useState([])
  const [assignments, setAssignments] = useState({}) // { category: technician_id }
  const [slaMap, setSlaMap] = useState({})            // { category: sla_days }
  const [saving, setSaving] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!tenant?.id) return
    const safety = setTimeout(() => setLoading(false), 12000)
    Promise.all([
      supabase.from('complaint_categories').select('value,label,emoji').eq('municipality_id', tenant.id).order('sort_order'),
      supabase.from('profiles').select('id,full_name,email').eq('municipality_id', tenant.id).eq('role', 'technician').order('full_name'),
      supabase.from('category_assignments').select('category,technician_id,sla_days').eq('municipality_id', tenant.id),
    ]).then(([catsRes, techsRes, assignRes]) => {
      if (catsRes.data?.length > 0) setCats(catsRes.data)
      setTechs(techsRes.data ?? [])
      const map = {}
      const slaM = {}
      for (const a of assignRes.data ?? []) {
        map[a.category] = a.technician_id ?? ''
        slaM[a.category] = a.sla_days ?? 3
      }
      setAssignments(map)
      setSlaMap(slaM)
    }).finally(() => { clearTimeout(safety); setLoading(false) })
  }, [tenant?.id])

  async function handleChange(category, technicianId) {
    setSaving(category)
    setAssignments((prev) => ({ ...prev, [category]: technicianId }))
    await supabase.from('category_assignments').upsert({
      municipality_id: tenant.id,
      category,
      technician_id: technicianId || null,
    }, { onConflict: 'municipality_id,category' })
    setSaving(null)
  }

  async function handleSlaChange(category, rawDays) {
    const days = Math.max(1, parseInt(rawDays) || 1)
    setSlaMap((prev) => ({ ...prev, [category]: days }))
    setSaving(category)
    await supabase.from('category_assignments').upsert({
      municipality_id: tenant.id,
      category,
      sla_days: days,
    }, { onConflict: 'municipality_id,category' })
    setSaving(null)
  }

  if (loading) return <div className="flex justify-center py-12"><Loader2 size={22} className="animate-spin text-gray-300" /></div>

  if (techs.length === 0) return (
    <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 text-sm text-amber-800 space-y-1">
      <p className="font-semibold">ยังไม่มีช่างในระบบ</p>
      <p className="text-amber-600">ไปที่ "จัดการผู้ใช้" → เปลี่ยน role ผู้ใช้เป็น "ช่าง" ก่อน แล้วกลับมาตั้งค่าที่นี่</p>
    </div>
  )

  return (
    <div className="space-y-3">
      <div className="bg-blue-50 border border-blue-100 rounded-2xl px-4 py-3 text-xs text-blue-700">
        เมื่อประชาชนส่งคำร้อง ระบบจะ <strong>มอบหมายให้ช่างที่ตั้งไว้อัตโนมัติ</strong> — กำหนด <strong>ระยะเวลาดำเนินการ</strong> (วัน) แต่ละประเภทสำหรับการประเมิน LPA
      </div>
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {cats.map((cat, i) => {
          const currentTech = assignments[cat.value] ?? ''
          const currentSla = slaMap[cat.value] ?? 3
          const isSaving = saving === cat.value
          return (
            <div key={cat.value}
                 className={`flex items-center gap-3 px-4 py-3.5 ${i < cats.length - 1 ? 'border-b border-gray-50' : ''}`}>
              <div className="w-9 h-9 rounded-xl bg-gray-50 flex items-center justify-center text-lg shrink-0">
                {cat.emoji}
              </div>
              <p className="flex-1 text-sm font-medium text-gray-700 min-w-0 truncate">{cat.label}</p>
              <div className="flex items-center gap-2 shrink-0">
                {isSaving && <Loader2 size={13} className="animate-spin text-gray-300" />}
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min="1"
                    max="365"
                    value={currentSla}
                    onChange={(e) => !readOnly && setSlaMap((prev) => ({ ...prev, [cat.value]: e.target.value }))}
                    onBlur={(e) => !readOnly && handleSlaChange(cat.value, e.target.value)}
                    disabled={isSaving || readOnly}
                    className={`w-12 text-xs border border-gray-200 rounded-xl px-2 py-1.5 bg-white text-gray-900 text-center focus:outline-none focus:border-amber-400 ${readOnly ? 'opacity-60 cursor-not-allowed' : ''}`}
                  />
                  <span className="text-xs text-gray-400">วัน</span>
                </div>
                <select
                  value={currentTech}
                  onChange={(e) => !readOnly && handleChange(cat.value, e.target.value)}
                  disabled={isSaving || readOnly}
                  className={`text-xs border border-gray-200 rounded-xl px-2 py-1.5 bg-white text-gray-700 focus:outline-none max-w-32 ${readOnly ? 'opacity-60 cursor-not-allowed' : ''}`}
                >
                  <option value="">— ไม่ระบุ —</option>
                  {techs.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.full_name ? `${t.full_name} (${t.email || ''})` : t.email}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Staff Manager ───────────────────────────────────────────────────────────
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
    const path = `staff/${staffId}/photo_${Date.now()}.${ext}`
    const compressed = await compressImage(file, 400)
    const { error: uploadErr } = await supabase.storage
      .from('complaint-attachments')
      .upload(path, compressed, { upsert: true })
    if (uploadErr) {
      setError('อัปโหลดรูปไม่สำเร็จ: ' + uploadErr.message)
      setUploading(null)
      return
    }
    const { data: urlData } = supabase.storage.from('complaint-attachments').getPublicUrl(path)
    const { error: updateErr } = await supabase
      .from('staff')
      .update({ photo_url: urlData.publicUrl })
      .eq('id', staffId)
    if (updateErr) {
      setError('บันทึกข้อมูลไม่สำเร็จ: ' + updateErr.message)
    } else {
      setStaff((prev) => prev.map((s) => s.id === staffId ? { ...s, photo_url: urlData.publicUrl } : s))
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

function EmojiPickerModal({ cat, onSelect, onClose }) {
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
            <span className="text-2xl">{customInput || cat?.emoji || '📝'}</span>
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

function SortableCatItem({ cat, idx, total, onDelete, onMove, onEdit, onToggleActive, onEditEmoji, techs = [], techId = '', slaDays = 3, onTechChange, onSlaChange, savingAssign = false }) {
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
          className="w-8 h-8 rounded-xl flex items-center justify-center text-base shrink-0 hover:ring-2 hover:ring-blue-400 transition-all active:scale-90"
          style={{ backgroundColor: cat.color }}
        >{cat.emoji}</button>

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
          className={`px-2 py-1 rounded-full text-[10px] font-bold shrink-0 transition-colors ${cat.is_active === false ? 'bg-gray-200 text-gray-500 hover:bg-green-100 hover:text-green-700' : 'bg-green-100 text-green-700 hover:bg-gray-200 hover:text-gray-500'}`}
        >
          {cat.is_active === false ? 'ปิด' : 'เปิด'}
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
          className="flex-1 min-w-0 text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-700 focus:outline-none"
        >
          <option value="">— ไม่ระบุ —</option>
          {techs.map((t) => (
            <option key={t.id} value={t.id}>
              {t.full_name || t.email}{t.role === 'staff' ? ' (เจ้าหน้าที่)' : t.role === 'admin' ? ' (แอดมิน)' : ' (ช่าง)'}
            </option>
          ))}
        </select>
        <SlaInput value={slaDays} onCommit={onSlaChange} />
      </div>
    </div>
  )
}

function SortableDesktopRow({ cat, idx, draft, assign, isSaving, techs, onSetDraft, onSaveRow, onCancelRow, onStartLabelEdit, onToggleActive, onDeleteCat, onEditEmoji }) {
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
              className="text-xl hover:bg-gray-100 rounded-lg p-1 transition-colors active:scale-90 shrink-0"
            >{cat.emoji}</button>
            <span className="font-medium text-gray-800">{cat.label}</span>
          </div>
        )}
      </td>
      <td className="px-4 py-3">
        <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
          style={{ backgroundColor: color.color, color: color.textColor }}>
          {cat.emoji} {cat.label}
        </span>
      </td>
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-1.5">
          {isSaving && <Loader2 size={12} className="animate-spin text-gray-300 shrink-0" />}
          <select
            value={currentTechId}
            onChange={(e) => onSetDraft(cat.value, { technician_id: e.target.value })}
            className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-700 focus:outline-none max-w-40"
          >
            <option value="">— ไม่ระบุ —</option>
            {techs.map((t) => (
              <option key={t.id} value={t.id}>
                {t.full_name || t.email}{t.role === 'staff' ? ' (เจ้าหน้าที่)' : t.role === 'admin' ? ' (แอดมิน)' : ' (ช่าง)'}
              </option>
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
    supabase.from('profiles').select('id,full_name,email,role').eq('municipality_id', tenant.id).in('role', ['technician', 'staff', 'admin']).order('full_name')
      .then(({ data }) => setTechs(data ?? []))
  }, [tenant?.id])

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

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-8"><Loader2 size={22} className="animate-spin text-gray-300" /></div>
      ) : cats.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-6">
          ยังไม่มีประเภทคำร้อง — กด <strong>โหลดค่าเริ่มต้น</strong> หรือเพิ่มเองด้านบน
        </p>
      ) : (
        <>
          {/* Mobile: DnD sortable cards */}
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={cats.map((c) => c.id)} strategy={verticalListSortingStrategy}>
              <div className="md:hidden space-y-2">
                {cats.map((cat, idx) => (
                  <SortableCatItem key={cat.id} cat={cat} idx={idx} total={cats.length}
                    onDelete={deleteCat} onMove={moveCat} onEdit={editCat} onToggleActive={toggleActive}
                    onEditEmoji={setIconPickerCat}
                    techs={techs}
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
            <SortableContext items={cats.map((c) => c.id)} strategy={verticalListSortingStrategy}>
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
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 w-20">จัดการ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {cats.map((cat, idx) => (
                      <SortableDesktopRow
                        key={cat.id}
                        cat={cat}
                        idx={idx}
                        draft={rowDrafts[cat.value]}
                        assign={assignMap[cat.value]}
                        isSaving={savingAssign === cat.value || savingAll}
                        techs={techs}
                        onSetDraft={setDraft}
                        onSaveRow={saveRow}
                        onCancelRow={cancelRow}
                        onStartLabelEdit={startLabelEdit}
                        onToggleActive={toggleActive}
                        onDeleteCat={deleteCat}
                        onEditEmoji={setIconPickerCat}
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
  <p>อัตราการปิดงาน <b>${rate}%</b>${avgDays !== null ? ` &nbsp;|&nbsp; เฉลี่ยระยะเวลาดำเนินการ <b>${avgDays} วัน</b>` : ''}</p>

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
    ? Math.round(closedData.reduce((s, c) =>
        s + (new Date(c.updated_at) - new Date(c.created_at)) / 86400000, 0
      ) / closedData.length)
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
    ? Math.round(prevClosedData.reduce((s, c) => s + (new Date(c.updated_at) - new Date(c.created_at)) / 86400000, 0) / prevClosedData.length)
    : null

  // SLA compliance — breakdown ระยะเวลาปิดงาน
  const slaIn3    = closedData.filter(c => (new Date(c.updated_at) - new Date(c.created_at)) / 86400000 <= 3).length
  const slaIn7    = closedData.filter(c => (new Date(c.updated_at) - new Date(c.created_at)) / 86400000 <= 7).length
  const slaIn14   = closedData.filter(c => (new Date(c.updated_at) - new Date(c.created_at)) / 86400000 <= 14).length
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
    techMap[name].totalDays += (new Date(c.updated_at) - new Date(c.created_at)) / 86400000
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

  const nowMs = now.getTime()

  // คำร้องค้างนานเกิน 15 วัน
  const overdue = complaints
    .filter(c => !['completed','rejected'].includes(c.status) &&
      (nowMs - new Date(c.created_at)) > 15 * 86400000)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    .slice(0, 6)

  // รับเรื่องแล้ว (received) แต่ช่างยังไม่รับงานต่อเกิน 7 วัน
  const noTechAction = complaints
    .filter(c => c.status === 'received' &&
      (nowMs - new Date(c.updated_at)) > 7 * 86400000)
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
          { label: 'เฉลี่ยวันปิดงาน',  value: avgDays !== null ? avgDays : '—', color: '#8b5cf6', sub: avgDays !== null ? 'วัน' : 'ไม่มีข้อมูล', delta: view === 'month' && avgDays !== null && prevAvgDays !== null ? prevAvgDays - avgDays : null, unit: 'วัน' },
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
              SLA — ระยะเวลาแก้ไขปัญหา
            </h3>
            {slaRate7 !== null && (
              <span className={`text-sm font-bold px-3 py-1 rounded-full ${slaRate7 >= 70 ? 'bg-green-50 text-green-600' : slaRate7 >= 40 ? 'bg-yellow-50 text-yellow-600' : 'bg-red-50 text-red-500'}`}>
                {slaRate7 >= 70 ? '✅' : slaRate7 >= 40 ? '⚠️' : '🔴'} {slaRate7}% แก้ภายใน 7 วัน
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: '0–3 วัน', count: slaIn3,            color: '#10b981', bg: '#d1fae5', emoji: '🟢' },
              { label: '4–7 วัน', count: slaIn7 - slaIn3,  color: '#3b82f6', bg: '#dbeafe', emoji: '🔵' },
              { label: '8–14 วัน', count: slaIn14 - slaIn7, color: '#f59e0b', bg: '#fef3c7', emoji: '🟡' },
              { label: '15+ วัน',  count: slaOver14,          color: '#ef4444', bg: '#fee2e2', emoji: '🔴' },
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
                    <p className="text-[11px] text-gray-400">เฉลี่ย {t.avgDays} วัน/งาน</p>
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
              รอช่างรับงานเกิน 7 วัน
            </h3>
            <p className="text-xs text-gray-400 mb-4">ค้างเกิน 7 วันหลังรับเรื่อง · ทั้งระบบ {noTechAction.length} รายการ</p>
            {noTechAction.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-gray-400">
                <CheckCircle2 size={28} className="text-green-400 mb-2" />
                <p className="text-sm text-green-600 font-medium">ช่างรับงานทุกรายการแล้ว</p>
              </div>
            ) : (
              <div className="space-y-0 divide-y divide-gray-50">
                {noTechAction.map(c => {
                  const days = Math.floor((nowMs - new Date(c.updated_at)) / 86400000)
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
                        {days} วัน
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
              คำร้องค้างเกิน 15 วัน
            </h3>
            <p className="text-xs text-gray-400 mb-4">ค้างเกิน 15 วัน · ทั้งระบบ {overdue.length} รายการ</p>
            {overdue.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-gray-400">
                <CheckCircle2 size={28} className="text-green-400 mb-2" />
                <p className="text-sm text-green-600 font-medium">ไม่มีคำร้องค้าง</p>
              </div>
            ) : (
              <div className="space-y-0 divide-y divide-gray-50">
                {overdue.map(c => {
                  const days = Math.floor((nowMs - new Date(c.created_at)) / 86400000)
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
                        {days} วัน
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

// ─── Events Manager ────────────────────────────────────────────────────────────
const EVENTS_CATEGORIES = ['ประชาสัมพันธ์', 'ประชุม', 'กำหนดการ', 'อบรม', 'อื่นๆ']
const EVENTS_CATEGORY_COLOR = {
  'ประชาสัมพันธ์': '#10b981', 'ประชุม': '#3b82f6', 'กำหนดการ': '#f97316',
  'อบรม': '#8b5cf6', 'อื่นๆ': '#6b7280',
}
const AUDIENCE_OPTIONS = [
  { value: 'public',     label: 'ประชาชน',                    color: '#10b981' },
  { value: 'staff',      label: 'เจ้าหน้าที่',                 color: '#3b82f6' },
  { value: 'management', label: 'ผู้บริหาร',                   color: '#8b5cf6' },
  { value: 'council',    label: 'สภาเทศบาล',                  color: '#f59e0b' },
]

function EventCard({ ev, onEdit, onDelete, deleting }) {
  const [confirmDel, setConfirmDel] = useState(false)
  const color = EVENTS_CATEGORY_COLOR[ev.category] ?? '#6b7280'
  const d = new Date(ev.event_date + 'T00:00:00')
  const dateStr = d.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex gap-3">
      <div className="w-1 rounded-full shrink-0" style={{ backgroundColor: color }} />
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 mb-1 flex-wrap">
              <span
                className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold text-white"
                style={{ backgroundColor: color }}
              >
                {ev.category}
              </span>
              {ev.audience && (() => {
                const aud = AUDIENCE_OPTIONS.find(a => a.value === ev.audience)
                return aud ? (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border"
                    style={{ color: aud.color, borderColor: aud.color, backgroundColor: aud.color + '18' }}>
                    {ev.audience !== 'public' ? '🔒 ' : '👥 '}{aud.label}
                  </span>
                ) : null
              })()}
            </div>
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-bold text-gray-800 leading-tight">{ev.title}</p>
              {ev.attachment_url && <Paperclip size={12} className="text-gray-400 shrink-0" />}
            </div>
            <p className="text-xs text-gray-500 mt-0.5">
              {dateStr}
              {!ev.is_all_day && ev.event_time
                ? ` · ${ev.event_time.slice(0, 5)}${ev.end_time ? ` – ${ev.end_time.slice(0, 5)}` : ''} น.`
                : ''}
            </p>
            {ev.location && <p className="text-xs text-gray-400 mt-0.5">📍 {ev.location}</p>}
            {ev.creator?.full_name && (
              <p className="text-xs text-gray-400 mt-0.5">✍️ {ev.creator.full_name}</p>
            )}
            {ev.description && (
              <p className="text-xs text-gray-500 mt-1 leading-relaxed line-clamp-2">{ev.description}</p>
            )}
          </div>
          {onEdit && (
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={() => onEdit(ev)}
                className="p-1.5 rounded-xl hover:bg-gray-100 text-gray-400 transition-colors"
              >
                <Pencil size={14} />
              </button>
              {confirmDel ? (
                <div className="flex gap-1">
                  <button
                    onClick={() => { onDelete(ev.id); setConfirmDel(false) }}
                    disabled={deleting === ev.id}
                    className="px-2 py-1 rounded-lg bg-red-500 text-white text-xs font-bold"
                  >
                    {deleting === ev.id ? '...' : 'ลบ'}
                  </button>
                  <button
                    onClick={() => setConfirmDel(false)}
                    className="px-2 py-1 rounded-lg bg-gray-100 text-gray-600 text-xs"
                  >
                    ยกเลิก
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmDel(true)}
                  className="p-1.5 rounded-xl hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function EventsManager({ tenant, currentUserRole }) {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingEvent, setEditingEvent] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const emptyForm = { title: '', description: '', event_date: '', event_time: '', end_time: '', end_date: '', location: '', category: 'อื่นๆ', is_all_day: true, audience: 'public', attachment_url: '', attachment_file: null }
  const [form, setForm] = useState(emptyForm)
  const [filterMonth, setFilterMonth] = useState('all')
  const [filterCategory, setFilterCategory] = useState('all')
  const [filterAudience, setFilterAudience] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState('upcoming')
  const [pageSize, setPageSize] = useState(10)
  const [currentPage, setCurrentPage] = useState(1)

  useEffect(() => {
    setCurrentPage(1)
  }, [activeTab, searchQuery, filterMonth, filterCategory, filterAudience, pageSize])

  useEffect(() => { fetchEvents() }, [tenant?.id, currentUserRole])

  async function fetchEvents() {
    setLoading(true)
    try {
      let query = supabase
        .from('events')
        .select('*, creator:profiles!events_created_by_fkey(full_name)')
        .eq('municipality_id', tenant.id)
        .order('event_date', { ascending: true })
      if (currentUserRole === 'council') {
        query = query.in('audience', ['public', 'staff', 'council'])
      }
      const { data } = await query
      setEvents(data ?? [])
    } finally {
      setLoading(false)
    }
  }

  function openAdd() {
    const today = new Date().toISOString().split('T')[0]
    setForm({ ...emptyForm, event_date: today })
    setEditingEvent(null)
    setShowForm(true)
  }

  function openEdit(ev) {
    setForm({
      title: ev.title,
      description: ev.description ?? '',
      event_date: ev.event_date,
      event_time: ev.event_time ?? '',
      end_date: ev.end_date ?? '',
      location: ev.location ?? '',
      category: ev.category ?? 'อื่นๆ',
      is_all_day: ev.is_all_day ?? true,
      audience: ev.audience ?? 'public',
      attachment_url: ev.attachment_url ?? '',
      attachment_file: null,
      end_time: ev.end_time ?? '',
    })
    setEditingEvent(ev)
    setShowForm(true)
  }

  // อัปโหลดไฟล์แนบแยกเป็นขั้นหลังบันทึกกิจกรรมเสร็จแล้ว (ไม่บล็อกการบันทึกข้อมูลหลัก)
  async function uploadEventAttachment(eventId, file) {
    if (!file || !eventId) return
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error('ไฟล์ใหญ่เกินไป (สูงสุด 20 MB)')
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const path = `${tenant.id}/${Date.now()}_${safeName}`

      const doUpload = async () => {
        const toUpload = await compressImage(file, undefined)
        const contentType = toUpload.type || (/\.pdf$/i.test(toUpload.name ?? '') ? 'application/pdf' : 'application/octet-stream')

        let storageBucket = 'event-attachments'
        let uploadRes = await supabase.storage
          .from(storageBucket)
          .upload(path, toUpload, { upsert: false, contentType })

        if (uploadRes.error) {
          console.warn('Failed upload to event-attachments, trying complaint-attachments:', uploadRes.error)
          storageBucket = 'complaint-attachments'
          uploadRes = await supabase.storage
            .from(storageBucket)
            .upload(path, toUpload, { upsert: false, contentType })
        }

        if (uploadRes.error) throw new Error(uploadRes.error.message)
        const { data: { publicUrl } } = supabase.storage.from(storageBucket).getPublicUrl(path)
        const { error: updErr } = await supabase.from('events').update({ attachment_url: publicUrl }).eq('id', eventId)
        if (updErr) throw new Error(updErr.message)
      }

      await Promise.race([
        doUpload(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('หมดเวลาอัปโหลด (20 วินาที)')), 20_000)),
      ])
      fetchEvents()
    } catch (err) {
      console.error('uploadEventAttachment error:', err)
      alert('บันทึกกิจกรรมสำเร็จ แต่แนบไฟล์ไม่สำเร็จ: ' + (err?.message ?? 'เกิดข้อผิดพลาด') + '\n\nเปิดแก้ไขกิจกรรมนี้แล้วลองแนบไฟล์ใหม่อีกครั้ง')
    }
  }

  async function handleSave() {
    if (!form.title.trim() || !form.event_date) return
    setSaving(true)

    try {
      const payload = {
        municipality_id: tenant.id,
        title: form.title.trim(),
        description: form.description.trim() || null,
        event_date: form.event_date,
        event_time: form.is_all_day ? null : (form.event_time || null),
        end_time: form.is_all_day ? null : (form.end_time || null),
        end_date: form.end_date || null,
        location: form.location.trim() || null,
        category: form.category,
        is_all_day: form.is_all_day,
        audience: form.audience,
        attachment_url: form.attachment_url || null,
        updated_at: new Date().toISOString(),
      }
      let eventId = editingEvent?.id ?? null
      if (editingEvent) {
        await supabase.from('events').update(payload).eq('id', editingEvent.id)
      } else {
        const { data: { user } } = await supabase.auth.getUser()
        const { data: insData } = await supabase.from('events')
          .insert({ ...payload, created_by: user?.id ?? null }).select('id').single()
        eventId = insData?.id ?? null
      }
      setShowForm(false)
      fetchEvents()
      if (form.attachment_file && eventId) uploadEventAttachment(eventId, form.attachment_file)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id) {
    setDeleting(id)
    await supabase.from('events').delete().eq('id', id)
    setDeleting(null)
    setEvents((prev) => prev.filter((e) => e.id !== id))
  }

  let filteredEvents = events
  if (filterMonth !== 'all') {
    filteredEvents = filteredEvents.filter(e => e.event_date.startsWith(filterMonth))
  }
  if (filterCategory !== 'all') {
    filteredEvents = filteredEvents.filter(e => e.category === filterCategory)
  }
  if (filterAudience !== 'all') {
    filteredEvents = filteredEvents.filter(e => e.audience === filterAudience)
  }
  if (searchQuery.trim()) {
    const q = searchQuery.trim().toLowerCase()
    filteredEvents = filteredEvents.filter(e => e.title.toLowerCase().includes(q) || (e.description && e.description.toLowerCase().includes(q)))
  }

  const now = new Date()
  now.setHours(0, 0, 0, 0)
  const upcoming = filteredEvents.filter((e) => new Date(e.event_date + 'T00:00:00') >= now)
  const past = filteredEvents.filter((e) => new Date(e.event_date + 'T00:00:00') < now)

  const currentList = activeTab === 'upcoming' ? upcoming : [...past].reverse()
  const totalItems = currentList.length
  const totalPages = pageSize === 'all' ? 1 : Math.ceil(totalItems / pageSize)
  const paginatedList = pageSize === 'all' ? currentList : currentList.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-gray-700">ปฏิทินกิจกรรม</h2>
        <button
          onClick={openAdd}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-white"
          style={{ backgroundColor: 'var(--color-primary)' }}
        >
          <Plus size={16} /> เพิ่มกิจกรรม
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[160px]">
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="ค้นหาชื่อหรือรายละเอียดกิจกรรม..."
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
          </div>
          <div className="min-w-[140px]">
            <select value={filterMonth} onChange={e => setFilterMonth(e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-200">
              <option value="all">ทุกเดือน</option>
              {Array.from(new Set(events.map(e => e.event_date.slice(0, 7)))).sort().reverse().map(ym => {
                const [y, m] = ym.split('-')
                const d = new Date(Number(y), Number(m) - 1, 1)
                const label = d.toLocaleDateString('th-TH', { month: 'long', year: 'numeric' })
                return <option key={ym} value={ym}>{label}</option>
              })}
            </select>
          </div>
          <div className="min-w-[140px]">
            <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-200">
              <option value="all">ทุกประเภท</option>
              {EVENTS_CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
            </select>
          </div>
          <div className="min-w-[140px]">
            <select value={filterAudience} onChange={e => setFilterAudience(e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-200">
              <option value="all">ทุกกลุ่มเป้าหมาย</option>
              {AUDIENCE_OPTIONS.filter((opt) => currentUserRole === 'council' ? opt.value !== 'management' : true).map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          {(searchQuery || filterMonth !== 'all' || filterCategory !== 'all' || filterAudience !== 'all') && (
            <button onClick={() => { setSearchQuery(''); setFilterMonth('all'); setFilterCategory('all'); setFilterAudience('all'); }}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold text-gray-500 bg-gray-100 hover:bg-gray-200 transition-colors">
              <X size={16} /> ล้าง
            </button>
          )}
        </div>
      </div>

      {showForm && (
        /* Mobile: bottom sheet  |  Desktop: centered dialog */
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50 px-4 pb-4 md:p-6">
          <div className="w-full max-w-md md:max-w-2xl bg-white rounded-t-3xl md:rounded-2xl shadow-2xl flex flex-col max-h-[90vh] md:max-h-[88vh] overflow-hidden">

            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
              <h3 className="font-bold text-gray-800">
                {editingEvent ? 'แก้ไขกิจกรรม' : 'เพิ่มกิจกรรม'}
              </h3>
              <button onClick={() => setShowForm(false)} className="p-1.5 rounded-xl hover:bg-gray-100">
                <X size={18} className="text-gray-500" />
              </button>
            </div>

            {/* Body — scrollable */}
            <div className="flex-1 overflow-y-auto">
              <div className="px-6 py-4 space-y-4">

                <div>
                  <label className="text-xs font-semibold text-gray-500 mb-1 block">ชื่อกิจกรรม *</label>
                  <input
                    value={form.title}
                    onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
                    placeholder="เช่น ประชุมสภา อบต."
                    className="w-full px-4 py-3 rounded-2xl border border-gray-200 text-sm text-gray-900 bg-white focus:outline-none focus:border-blue-400"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-gray-500 mb-1 block">วันที่เริ่ม *</label>
                    <input
                      type="date"
                      value={form.event_date}
                      onChange={(e) => setForm((p) => ({ ...p, event_date: e.target.value }))}
                      className="w-full px-4 py-3 rounded-2xl border border-gray-200 text-sm text-gray-900 bg-white focus:outline-none focus:border-blue-400"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-500 mb-1 block">วันสิ้นสุด</label>
                    <input
                      type="date"
                      value={form.end_date}
                      onChange={(e) => setForm((p) => ({ ...p, end_date: e.target.value }))}
                      className="w-full px-4 py-3 rounded-2xl border border-gray-200 text-sm text-gray-900 bg-white focus:outline-none focus:border-blue-400"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="flex items-center gap-2 cursor-pointer select-none w-fit">
                    <input
                      type="checkbox"
                      checked={form.is_all_day}
                      onChange={(e) => setForm((p) => ({ ...p, is_all_day: e.target.checked, event_time: '', end_time: '' }))}
                      className="w-4 h-4 rounded"
                    />
                    <span className="text-sm text-gray-700">ทั้งวัน</span>
                  </label>
                  {!form.is_all_day && (
                    <div className="flex items-center gap-2">
                      <div className="flex-1">
                        <label className="text-xs text-gray-400 mb-1 block">เริ่ม</label>
                        <input
                          type="time"
                          value={form.event_time}
                          onChange={(e) => setForm((p) => ({ ...p, event_time: e.target.value }))}
                          className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-900 bg-white focus:outline-none focus:border-blue-400"
                        />
                      </div>
                      <span className="text-gray-400 text-sm mt-5">–</span>
                      <div className="flex-1">
                        <label className="text-xs text-gray-400 mb-1 block">สิ้นสุด</label>
                        <input
                          type="time"
                          value={form.end_time}
                          onChange={(e) => setForm((p) => ({ ...p, end_time: e.target.value }))}
                          className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-900 bg-white focus:outline-none focus:border-blue-400"
                        />
                      </div>
                    </div>
                  )}
                </div>

                <div className="md:grid md:grid-cols-2 md:gap-6 space-y-4 md:space-y-0">
                  <div>
                    <label className="text-xs font-semibold text-gray-500 mb-1 block">ประเภทกิจกรรม</label>
                    <div className="flex flex-wrap gap-2">
                      {EVENTS_CATEGORIES.map((cat) => (
                        <button
                          key={cat}
                          onClick={() => setForm((p) => ({ ...p, category: cat }))}
                          className="px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors"
                          style={
                            form.category === cat
                              ? { backgroundColor: EVENTS_CATEGORY_COLOR[cat], color: 'white' }
                              : { backgroundColor: '#f3f4f6', color: '#374151' }
                          }
                        >
                          {cat}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-gray-500 mb-1 block">กลุ่มเป้าหมาย</label>
                    <div className="grid grid-cols-2 gap-2">
                      {AUDIENCE_OPTIONS.filter((opt) => currentUserRole === 'council' ? opt.value !== 'management' : true).map((opt) => (
                        <button
                          key={opt.value}
                          onClick={() => setForm((p) => ({ ...p, audience: opt.value }))}
                          className="px-3 py-2 rounded-xl text-xs font-semibold text-left transition-colors border"
                          style={
                            form.audience === opt.value
                              ? { backgroundColor: opt.color, color: 'white', borderColor: opt.color }
                              : { backgroundColor: 'white', color: '#374151', borderColor: '#e5e7eb' }
                          }
                        >
                          {opt.value !== 'public' && '🔒 '}{opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="md:grid md:grid-cols-2 md:gap-6 space-y-4 md:space-y-0">
                  <div>
                    <label className="text-xs font-semibold text-gray-500 mb-1 block">สถานที่</label>
                    <input
                      value={form.location}
                      onChange={(e) => setForm((p) => ({ ...p, location: e.target.value }))}
                      placeholder="เช่น ห้องประชุมสภา"
                      className="w-full px-4 py-3 rounded-2xl border border-gray-200 text-sm text-gray-900 bg-white focus:outline-none focus:border-blue-400"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-gray-500 mb-1 block">รายละเอียด</label>
                    <textarea
                      value={form.description}
                      onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                      placeholder="รายละเอียดเพิ่มเติม..."
                      rows={3}
                      className="w-full px-4 py-3 rounded-2xl border border-gray-200 text-sm text-gray-900 bg-white focus:outline-none focus:border-blue-400 resize-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-gray-500 mb-1.5 block">เอกสารแนบ</label>
                  {form.attachment_url && !form.attachment_file ? (
                    <div className="flex items-center gap-2 px-3 py-2.5 bg-blue-50 border border-blue-100 rounded-xl">
                      <Paperclip size={14} className="text-blue-500 shrink-0" />
                      <a href={form.attachment_url} target="_blank" rel="noopener noreferrer"
                        className="flex-1 text-xs text-blue-600 font-medium truncate hover:underline">
                        ดูไฟล์แนบปัจจุบัน
                      </a>
                      <button type="button"
                        onClick={() => setForm((p) => ({ ...p, attachment_url: '' }))}
                        className="p-1 rounded-lg hover:bg-blue-100 text-red-400 transition-colors">
                        <X size={13} />
                      </button>
                    </div>
                  ) : form.attachment_file ? (
                    <div className="flex items-center gap-2 px-3 py-2.5 bg-green-50 border border-green-100 rounded-xl">
                      <Paperclip size={14} className="text-green-500 shrink-0" />
                      <span className="flex-1 text-xs text-green-700 font-medium truncate">{form.attachment_file.name}</span>
                      <button type="button"
                        onClick={() => setForm((p) => ({ ...p, attachment_file: null }))}
                        className="p-1 rounded-lg hover:bg-green-100 text-red-400 transition-colors">
                        <X size={13} />
                      </button>
                    </div>
                  ) : (
                    <label className="flex items-center gap-2 px-3 py-2.5 rounded-xl border-2 border-dashed border-gray-200 cursor-pointer hover:border-blue-300 hover:bg-blue-50/50 transition-colors">
                      <Paperclip size={15} className="text-gray-400 shrink-0" />
                      <span className="text-sm text-gray-400">แนบ PDF หรือรูปภาพ (สูงสุด 20 MB)</span>
                      <input type="file" accept="image/*,application/pdf,.pdf" className="hidden"
                        onChange={(e) => setForm((p) => ({ ...p, attachment_file: e.target.files?.[0] ?? null }))} />
                    </label>
                  )}
                </div>

                {formError && <p className="text-xs text-red-500">{formError}</p>}
              </div>
            </div>

            {/* Footer */}
            <div className="border-t border-gray-100 shrink-0">
              <div className="px-6 py-4 flex gap-3">
                <button
                  onClick={() => setShowForm(false)}
                  className="flex-1 py-3 rounded-2xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50"
                >
                  ยกเลิก
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || !form.title.trim() || !form.event_date}
                  className="flex-1 py-3 rounded-2xl text-sm font-bold text-white disabled:opacity-50"
                  style={{ backgroundColor: 'var(--color-primary)' }}
                >
                  {saving ? 'กำลังบันทึก...' : 'บันทึก'}
                </button>
              </div>
            </div>

          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-10 text-gray-400">
          <Loader2 size={24} className="animate-spin" />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex bg-gray-100 p-1 rounded-xl w-fit">
              <button
                onClick={() => setActiveTab('upcoming')}
                className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors ${activeTab === 'upcoming' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              >
                กิจกรรมที่จะมาถึง ({upcoming.length})
              </button>
              <button
                onClick={() => setActiveTab('past')}
                className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors ${activeTab === 'past' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              >
                กิจกรรมที่ผ่านมา ({past.length})
              </button>
            </div>

            {paginatedList.length > 0 && (
              <div className="flex flex-wrap items-center gap-4 bg-white px-3 py-2 rounded-xl border border-gray-100 shadow-sm w-fit">
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <span>แสดง</span>
                  <select
                    value={pageSize}
                    onChange={(e) => setPageSize(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                    className="bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  >
                    <option value={10}>10</option>
                    <option value={20}>20</option>
                    <option value={50}>50</option>
                    <option value="all">ทั้งหมด</option>
                  </select>
                  <span>รายการ</span>
                </div>
                
                {pageSize !== 'all' && totalPages > 1 && (
                  <div className="flex items-center gap-1 border-l pl-4 border-gray-100">
                    <button
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                      className="p-1 rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <span className="text-sm font-medium text-gray-700 px-2">
                      หน้า {currentPage} / {totalPages}
                    </span>
                    <button
                      onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages}
                      className="p-1 rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          <div>
            {paginatedList.length === 0 ? (
              <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center text-gray-400 text-sm">
                {activeTab === 'upcoming' ? 'ยังไม่มีกิจกรรม กด "เพิ่มกิจกรรม" เพื่อเริ่มต้น' : 'ยังไม่มีกิจกรรมที่ผ่านมา'}
              </div>
            ) : (
              <div className={`space-y-2 ${activeTab === 'past' ? 'opacity-80' : ''}`}>
                {paginatedList.map((ev) => (
                  <EventCard key={ev.id} ev={ev} onEdit={openEdit} onDelete={handleDelete} deleting={deleting} />
                ))}
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
  staff: 'รูปผู้บริหาร',
  events: 'กิจกรรม',
  'doc-requests': 'คำขอเอกสาร',
  report: 'รายงานสรุป',
  categories: 'ประเภทคำร้อง',
  'fee-settings': 'ค่าธรรมเนียม',
  assignments: 'ผู้รับผิดชอบ',
  emergency: 'สายด่วน',
  locations: 'สถานที่เกิดเหตุ',
  'system-settings': 'ตั้งค่าระบบ',
  superadmin: 'SuperAdmin',
  users: 'จัดการผู้ใช้',
  map: 'แผนที่คำร้อง',
  'civil-project': 'โครงการโยธา',
  'civil-report': 'รายงานโยธา',
  'audit-log': 'บันทึกกิจกรรม',
  'satisfaction': 'ผลการประเมิน',
  'fleet-setup': 'ตั้งค่ายานพาหนะ',
}

// ─── SatisfactionAdmin ────────────────────────────────────────────────────────
const RATING_LABELS = { 5: 'ยอดเยี่ยม', 4: 'ดี', 3: 'พอสมควร', 2: 'แย่', 1: 'แย่มาก' }
const RATING_COLORS = { 5: '#22c55e', 4: '#3b82f6', 3: '#f59e0b', 2: '#f97316', 1: '#ef4444' }
const RATING_EMOJI  = { 5: '😄', 4: '😊', 3: '😐', 2: '😢', 1: '😡' }

function SatisfactionAdmin({ tenant }) {
  const [ratings, setRatings]   = useState([])
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    if (!tenant?.id) return
    setLoading(true)
    supabase.from('satisfaction_ratings')
      .select('*')
      .eq('municipality_id', tenant.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => { setRatings(data ?? []); setLoading(false) })
  }, [tenant?.id])

const avg = ratings.length ? (ratings.reduce((s, r) => s + r.rating, 0) / ratings.length).toFixed(1) : '-'
  const counts = [5,4,3,2,1].map(v => ({ v, count: ratings.filter(r => r.rating === v).length }))

  function thDate(iso) {
    const d = new Date(iso)
    return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  function handlePrint() {
    const now = new Date().toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' })
    const avgScore = ratings.length ? (ratings.reduce((s, r) => s + r.rating, 0) / ratings.length).toFixed(2) : '-'
    const bars = [5,4,3,2,1].map(v => {
      const c = ratings.filter(r => r.rating === v).length
      const pct = ratings.length ? Math.round(c / ratings.length * 100) : 0
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
<p class="sub">รายงานผลการประเมินความพึงพอใจการให้บริการ &nbsp;|&nbsp; วันที่พิมพ์ ${now}</p>
<div class="stats">
  <div class="stat-box"><div class="stat-num">${avgScore}</div><div class="stat-lbl">คะแนนเฉลี่ย (จาก 5)</div></div>
  <div class="stat-box"><div class="stat-num">${ratings.length}</div><div class="stat-lbl">ผู้ประเมินทั้งหมด</div></div>
  <div class="stat-box"><div class="stat-num" style="color:#22c55e">${ratings.filter(r=>r.rating>=4).length}</div><div class="stat-lbl">พึงพอใจ (ดี/ยอดเยี่ยม)</div></div>
  <div class="stat-box"><div class="stat-num" style="color:#ef4444">${ratings.filter(r=>r.rating<=2).length}</div><div class="stat-lbl">ไม่พึงพอใจ (แย่/แย่มาก)</div></div>
</div>
<div class="section">สัดส่วนคะแนน</div>
<table><thead><tr><th>ระดับ</th><th>สัดส่วน</th><th style="width:50px;text-align:center">จำนวน</th><th style="width:60px;text-align:center">ร้อยละ</th></tr></thead>
<tbody>${bars}</tbody></table>
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

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 flex flex-col items-center gap-1">
          <Star size={22} className="text-yellow-400" />
          <p className="text-3xl font-black text-gray-800">{avg}</p>
          <p className="text-xs text-gray-400">คะแนนเฉลี่ย</p>
        </div>
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 flex flex-col items-center gap-1">
          <MessageSquare size={22} className="text-blue-400" />
          <p className="text-3xl font-black text-gray-800">{ratings.length}</p>
          <p className="text-xs text-gray-400">ผู้ประเมินทั้งหมด</p>
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
                style={{ width: ratings.length ? `${(count / ratings.length) * 100}%` : '0%', backgroundColor: RATING_COLORS[v] }} />
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
    await supabase.auth.signOut()
    navigate('/admin/login')
  }

  const fetchComplaints = useCallback(async () => {
    if (!tenant?.id || currentUserRole === null) return
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('complaints')
        .select('*')
        .eq('municipality_id', tenant.id)
        .order('created_at', { ascending: false })
      if (error) console.error('fetch complaints error:', error.message)
      setComplaints(data ? await attachReporterProfiles(data, 'id, full_name, email, phone, role') : [])
    } finally {
      setLoading(false)
    }
  }, [tenant?.id, currentUserRole])

  useEffect(() => {
    fetchComplaints()
    const safety = setTimeout(() => setLoading(false), 12000)
    return () => clearTimeout(safety)
  }, [fetchComplaints])

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
            <div className="text-right">
              <p className="text-xs font-bold text-white">{ROLE_LABELS[currentUserRole]?.label ?? 'ผู้ดูแลระบบ'}</p>
            </div>
            <div className="w-8 h-8 rounded-full bg-white/20 border border-white/40 flex items-center justify-center text-sm font-bold text-white shrink-0">A</div>
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

        {/* Nav tabs */}
        <nav className="relative z-10 flex items-center gap-1 px-6 pb-3 flex-wrap">
          {[
            { key: 'dashboard',      label: 'หน้าหลัก',      Icon: Home,          show: true },
            { key: 'report',         label: 'รายงาน',         Icon: TrendingUp,    show: true },
            { key: 'map',            label: 'แผนที่',          Icon: MapPin,        show: currentUserRole !== 'council' },
            { key: 'events',         label: 'กิจกรรม',        Icon: CalendarDays,  show: currentUserRole !== 'viewer' },
            { key: 'users',          label: 'จัดการผู้ใช้',   Icon: Users,         show: currentUserRole === 'admin' || currentUserRole === 'superadmin' },
            { key: 'system-settings',label: 'ตั้งค่าระบบ',    Icon: Settings,      show: currentUserRole === 'admin' || currentUserRole === 'superadmin' },
            { key: 'superadmin',     label: 'SuperAdmin',    Icon: ShieldCheck,   show: currentUserRole === 'superadmin' },
          ].filter(i => i.show).map(({ key, label, Icon }) => {
            const isActive = activePage === key
            return (
              <button key={key} onClick={() => setActivePage(key)}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-bold transition-all"
                style={isActive
                  ? { backgroundColor: 'rgba(255,255,255,0.25)', color: '#fff' }
                  : { color: 'rgba(255,255,255,0.7)' }}>
                <Icon size={14} />
                {label}
              </button>
            )
          })}
        </nav>
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
            <p className="text-white/70 text-[11px] mt-0.5">แผงควบคุม Admin</p>
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

      {/* ─── Content ─── */}
      <div className="px-4 py-4 pb-24 md:py-6 md:pb-8 md:px-6 space-y-4 md:space-y-6 max-w-5xl mx-auto">

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
            <Shield size={15} /> จัดการผู้ใช้
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
        ].filter(i => i.show).map(({ key, label, Icon }) => {
          const isActive = activePage === key
          return (
            <button key={key} onClick={() => setActivePage(key)}
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
            {[
              {
                group: 'รายงานและสถิติ',
                items: [
                  { key: 'map',          label: 'แผนที่',           Icon: MapPin,        color: '#0891b2', bg: '#e0f2fe', show: currentUserRole !== 'council' },
                  { key: 'report',       label: 'รายงาน',           Icon: TrendingUp,    color: '#059669', bg: '#d1fae5', show: true },
                  { key: 'satisfaction', label: 'ผลการประเมิน',     Icon: Star,          color: '#d97706', bg: '#fef3c7', show: true },
                ],
              },
              {
                group: 'จัดการเนื้อหา',
                items: [
                  { key: 'staff',        label: 'รูปผู้บริหาร',    Icon: UserCircle2,   color: '#7c3aed', bg: '#ede9fe', show: currentUserRole !== 'viewer' },
                  { key: 'events',       label: 'กิจกรรม',          Icon: Bell,          color: '#f59e0b', bg: '#fef3c7', show: currentUserRole !== 'viewer' },
                ],
              },
              {
                group: 'ตั้งค่าระบบ',
                items: [
                  { key: 'categories',     label: 'ประเภทคำร้อง',   Icon: Tag,         color: '#d97706', bg: '#fef3c7', show: currentUserRole !== 'viewer' },
                  { key: 'emergency',      label: 'สายด่วน',         Icon: Phone,       color: '#ef4444', bg: '#fee2e2', show: currentUserRole !== 'viewer' },
                  { key: 'locations',      label: 'สถานที่เกิดเหตุ', Icon: MapPin,      color: '#0891b2', bg: '#e0f2fe', show: currentUserRole !== 'viewer' },
                  { key: 'fee-settings',   label: 'ค่าธรรมเนียม',   Icon: Banknote,    color: '#10b981', bg: '#d1fae5', show: currentUserRole === 'admin' || currentUserRole === 'superadmin' },
                  { key: 'fleet-setup',    label: 'ยานพาหนะ',        Icon: Car,         color: '#0369a1', bg: '#e0f2fe', show: currentUserRole === 'admin' || currentUserRole === 'superadmin' },
                  { key: 'system-settings',label: 'ตั้งค่าระบบ',     Icon: Settings,    color: '#3b82f6', bg: '#dbeafe', show: currentUserRole === 'admin' || currentUserRole === 'superadmin' },
                  { key: 'users',          label: 'จัดการผู้ใช้',    Icon: Shield,      color: '#7c3aed', bg: '#ede9fe', show: currentUserRole === 'admin' || currentUserRole === 'superadmin' },
                  { key: 'superadmin',     label: 'SuperAdmin',      Icon: ShieldCheck, color: '#a855f7', bg: '#faf5ff', show: currentUserRole === 'superadmin' },
                  { key: 'audit-log',      label: 'บันทึกกิจกรรม',  Icon: BookOpen,    color: '#ef4444', bg: '#fee2e2', show: currentUserRole === 'admin' || currentUserRole === 'superadmin' },
                ],
              },
              {
                group: 'ทรัพยากร',
                items: [
                  { key: 'manual',         label: 'คู่มือผู้ดูแล',  Icon: BookOpen,    color: '#059669', bg: '#d1fae5', show: true, isExternal: true, href: '/manual-admin.html' },
                  { key: 'manual-citizen', label: 'คู่มือประชาชน',  Icon: BookOpen,    color: '#059669', bg: '#d1fae5', show: true, isExternal: true, href: '/manual-citizen.html' },
                ],
              },
            ].map(({ group, items }) => {
              const visible = items.filter(i => i.show)
              if (!visible.length) return null
              return (
                <div key={group}>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">{group}</p>
                  <div className="grid grid-cols-3 md:grid-cols-5 gap-2">
                    {visible.map(({ key, label, Icon, color, bg, isExternal, href }) =>
                      isExternal ? (
                        <a key={key} href={href} target="_blank" rel="noopener noreferrer"
                          className="flex flex-col items-center gap-2 bg-white rounded-2xl border border-gray-100 shadow-sm p-3 hover:shadow-md active:scale-95 transition-all">
                          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: bg }}>
                            <Icon size={18} style={{ color }} />
                          </div>
                          <p className="text-[11px] font-semibold text-gray-700 text-center leading-tight">{label}</p>
                        </a>
                      ) : (
                        <button key={key} onClick={() => setActivePage(key)}
                          className="flex flex-col items-center gap-2 bg-white rounded-2xl border border-gray-100 shadow-sm p-3 hover:shadow-md active:scale-95 transition-all">
                          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: bg }}>
                            <Icon size={18} style={{ color }} />
                          </div>
                          <p className="text-[11px] font-semibold text-gray-700 text-center leading-tight">{label}</p>
                        </button>
                      )
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {loading && (
            <div className="flex items-center justify-center py-10">
              <Loader2 size={24} className="animate-spin text-gray-400" />
            </div>
          )}
        </div>
      ) : activePage === 'doc-requests' ? (
        <InboxModule tenant={tenant} staffId={currentUserId} />
      ) : activePage === 'events' ? (
        <EventsManagerComponent tenant={tenant} currentUserRole={currentUserRole} />
      ) : activePage === 'satisfaction' ? (
        <SatisfactionAdmin tenant={tenant} />
      ) : activePage === 'report' ? (
        <ReportManagerComponent complaints={complaints} tenant={tenant} technicians={technicians} />
      ) : activePage === 'staff' ? (
        <StaffManager tenant={tenant} />
      ) : activePage === 'emergency' ? (
        <EmergencyManager tenant={tenant} />
      ) : activePage === 'users' ? (
        <UserManager tenant={tenant} currentUserRole={currentUserRole} />
      ) : activePage === 'locations' ? (
        <LocationManager tenant={tenant} />
      ) : activePage === 'categories' ? (
        <CategoryManager tenant={tenant} />
      ) : activePage === 'assignments' ? (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            {currentUserRole !== 'viewer' && (
              <button onClick={() => setActivePage('more')} className="p-1.5 rounded-xl hover:bg-gray-100 text-gray-400 transition-colors">
                <ChevronRight size={16} className="rotate-180" />
              </button>
            )}
            <h2 className="font-bold text-gray-700">ผู้รับผิดชอบแต่ละประเภทคำร้อง</h2>
          </div>
          <AssignmentManager tenant={tenant} readOnly={currentUserRole === 'viewer'} />
        </div>
      ) : activePage === 'civil-report' ? (
        <CivilProjectReport tenant={tenant} />
      ) : activePage === 'map' ? (
        <MapDashboardAdmin tenant={tenant} currentUserRole={currentUserRole}
          onNavigate={(page) => setActivePage(page)}
          onEditComplaint={(id) => navigate('/staff', { state: { module: 'complaints', openComplaintId: id } })}
          onEditProject={() => navigate('/staff', { state: { module: 'projects' } })} />
      ) : activePage === 'fee-settings' ? (
        <FeeSettingsAdmin tenant={tenant} />
      ) : activePage === 'superadmin' && currentUserRole === 'superadmin' ? (
        <SuperAdminPanel tenant={tenant} />
      ) : activePage === 'system-settings' ? (
        <SystemSettingsAdmin tenant={tenant} onUpdateTenant={(updated) => window.location.reload()} />
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
                  <p className="text-sm font-bold text-gray-800">จัดการผู้ใช้</p>
                  <p className="text-[13px] text-gray-400 mt-0.5">สิทธิ์และบทบาท</p>
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
            {currentUserRole !== 'viewer' && (
              <button onClick={() => setActivePage('staff')}
                className="flex flex-col items-center gap-3 bg-white rounded-2xl shadow-sm border border-gray-100 p-5 hover:bg-gray-50 active:scale-95 transition-all text-center">
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ backgroundColor: '#ede9fe' }}>
                  <UserCircle2 size={24} style={{ color: '#7c3aed' }} />
                </div>
                <div>
                  <p className="text-sm font-bold text-gray-800">รูปผู้บริหาร</p>
                  <p className="text-[13px] text-gray-400 mt-0.5">อัปโหลดรูปนายก/ทีมงาน</p>
                </div>
              </button>
            )}
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
            {currentUserRole === 'superadmin' && (
              <button onClick={() => setActivePage('superadmin')}
                className="flex flex-col items-center gap-3 bg-white rounded-2xl shadow-sm border border-gray-100 p-5 hover:bg-gray-50 active:scale-95 transition-all text-center">
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ backgroundColor: '#fae8ff' }}>
                  <ShieldCheck size={24} style={{ color: '#a855f7' }} />
                </div>
                <div>
                  <p className="text-sm font-bold text-gray-800">SuperAdmin</p>
                  <p className="text-[13px] text-gray-400 mt-0.5">ธีมแอป / จัดการโมดูล</p>
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
            <a href="/manual-citizen.html" target="_blank" rel="noopener noreferrer"
              className="flex flex-col items-center gap-3 bg-white rounded-2xl shadow-sm border border-gray-100 p-5 hover:bg-gray-50 active:scale-95 transition-all text-center">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ backgroundColor: '#d1fae5' }}>
                <BookOpen size={24} style={{ color: '#059669' }} />
              </div>
              <div>
                <p className="text-sm font-bold text-gray-800">คู่มือประชาชน</p>
                <p className="text-[13px] text-gray-400 mt-0.5">คู่มือสำหรับประชาชน</p>
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
                  { key: 'categories',  Icon: Tag,    color: '#d97706', bg: '#fef3c7', label: 'ประเภทคำร้อง', desc: 'จัดการหมวดหมู่คำร้อง',       show: currentUserRole !== 'viewer' },
                  { key: 'assignments', Icon: Wrench, color: '#d97706', bg: '#fef3c7', label: 'ผู้รับผิดชอบ', desc: 'มอบหมายงานตามประเภทคำร้อง', show: false },
                  { key: 'emergency',   Icon: Phone,       color: '#ef4444', bg: '#fee2e2', label: 'สายด่วนฉุกเฉิน',  desc: 'จัดการรายชื่อและเบอร์ติดต่อ',     show: currentUserRole !== 'viewer' },
                  { key: 'locations',   Icon: MapPin,      color: '#0891b2', bg: '#e0f2fe', label: 'สถานที่เกิดเหตุ', desc: 'จัดการหมู่บ้าน / ตำบลในพื้นที่',  show: currentUserRole !== 'viewer' },
                  { key: 'staff',            Icon: UserCircle2, color: '#7c3aed', bg: '#ede9fe', label: 'รูปผู้บริหาร',       desc: 'อัปโหลดรูปนายก/รองนายก/ทีมงาน',       show: currentUserRole !== 'viewer' },
                  { key: 'fleet-setup',      Icon: Car,         color: '#0369a1', bg: '#e0f2fe', label: 'ตั้งค่ายานพาหนะ', desc: 'กอง/หน่วยงาน งบประมาณ สิทธิ์ผู้ใช้', show: currentUserRole === 'admin' || currentUserRole === 'superadmin' },
                  { key: 'system-settings',  Icon: Settings,    color: '#3b82f6', bg: '#dbeafe', label: 'ตั้งค่าระบบ',    desc: 'ตั้งค่าชื่อระบบและข้อมูลพื้นฐาน',   show: currentUserRole === 'admin' || currentUserRole === 'superadmin' },
                  { key: 'users',           Icon: Shield,      color: '#7c3aed', bg: '#ede9fe', label: 'จัดการผู้ใช้',    desc: 'สิทธิ์การเข้าถึงและบทบาท',        show: currentUserRole === 'admin' || currentUserRole === 'superadmin' },
                  { key: 'superadmin',      Icon: ShieldCheck, color: '#a855f7', bg: '#fae8ff', label: 'SuperAdmin',    desc: 'ธีมแอป และจัดการโมดูล',            show: currentUserRole === 'superadmin' },
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
                <tr className="hover:bg-gray-50 transition-colors">
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: '#d1fae5' }}>
                        <BookOpen size={16} style={{ color: '#059669' }} />
                      </div>
                      <span className="font-semibold text-gray-800">คู่มือประชาชน</span>
                    </div>
                  </td>
                  <td className="px-5 py-3.5 text-gray-500">เอกสารการใช้งานระบบสำหรับประชาชน</td>
                  <td className="px-5 py-3.5 text-right">
                    <a href="/manual-citizen.html" target="_blank" rel="noopener noreferrer"
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
  )
}
