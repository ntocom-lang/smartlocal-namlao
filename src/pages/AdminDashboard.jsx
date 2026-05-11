import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import {
  RefreshCw, ClipboardList, Clock, Loader2,
  CheckCircle2, XCircle, AlertCircle, ChevronRight,
  Filter, Search, Phone, Trash2, Plus, PhoneCall, LogOut, Users, Shield,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useTenant } from '../contexts/TenantContext'

// ─── Status config ────────────────────────────────────────────────────────────
const STATUS = {
  pending:     { label: 'รอดำเนินการ',    color: '#f59e0b', bg: '#fef3c7', text: '#92400e' },
  received:    { label: 'รับเรื่องแล้ว',   color: '#3b82f6', bg: '#dbeafe', text: '#1e40af' },
  in_progress: { label: 'กำลังดำเนินการ', color: '#8b5cf6', bg: '#ede9fe', text: '#5b21b6' },
  completed:   { label: 'เสร็จสิ้น',      color: '#10b981', bg: '#d1fae5', text: '#065f46' },
  rejected:    { label: 'ปฏิเสธ',         color: '#ef4444', bg: '#fee2e2', text: '#991b1b' },
}

const NEXT_ACTION = {
  pending:     { label: 'รับเรื่อง',       next: 'received' },
  received:    { label: 'เริ่มดำเนินการ', next: 'in_progress' },
  in_progress: { label: 'ปิดงาน',         next: 'completed' },
}

const CATEGORY_LABEL = {
  road: 'ถนน/ทางสาธารณะ', light: 'ไฟฟ้าส่องสว่าง',
  trash: 'ขยะ/ความสะอาด', water: 'น้ำประปา',
  flood: 'น้ำท่วม/ระบายน้ำ', tree: 'ต้นไม้/สวนสาธารณะ',
  noise: 'เหตุรำคาญ', other: 'อื่นๆ',
}

const FILTER_TABS = ['ทั้งหมด', ...Object.values(STATUS).map((s) => s.label)]
const FILTER_KEYS = [null, ...Object.keys(STATUS)]

// ─── Sub-components ───────────────────────────────────────────────────────────
function StatCard({ label, value, icon: Icon, color }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex items-center gap-4">
      <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
           style={{ backgroundColor: `${color}20` }}>
        <Icon size={22} style={{ color }} />
      </div>
      <div>
        <p className="text-2xl font-bold text-gray-800 leading-none">{value}</p>
        <p className="text-xs text-gray-500 mt-0.5">{label}</p>
      </div>
    </div>
  )
}

function StatusBadge({ status }) {
  const s = STATUS[status] ?? STATUS.pending
  return (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap"
          style={{ backgroundColor: s.bg, color: s.text }}>
      {s.label}
    </span>
  )
}

function ActionButton({ status, id, onUpdate, loading }) {
  const action = NEXT_ACTION[status]
  if (!action) return null
  return (
    <button onClick={() => onUpdate(id, action.next)} disabled={loading === id}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-white transition-all active:scale-95 disabled:opacity-50"
      style={{ backgroundColor: 'var(--color-primary)' }}>
      {loading === id
        ? <Loader2 size={12} className="animate-spin" />
        : <ChevronRight size={12} />}
      {action.label}
    </button>
  )
}

function RejectButton({ status, id, onUpdate, loading }) {
  if (status === 'completed' || status === 'rejected') return null
  return (
    <button onClick={() => onUpdate(id, 'rejected')} disabled={loading === id}
      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 transition-colors disabled:opacity-50">
      <XCircle size={12} /> ปฏิเสธ
    </button>
  )
}

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null
  const { name, value } = payload[0]
  return (
    <div className="bg-white shadow-lg rounded-xl px-3 py-2 text-sm border border-gray-100">
      <p className="font-medium text-gray-700">{name}</p>
      <p className="text-gray-500">{value} รายการ</p>
    </div>
  )
}

// ─── User Manager ─────────────────────────────────────────────────────────────
const ROLE_LABELS = {
  superadmin: { label: 'Super Admin', color: '#7c3aed', bg: '#ede9fe' },
  admin:      { label: 'แอดมิน',     color: '#1d4ed8', bg: '#dbeafe' },
  citizen:    { label: 'สมาชิก',     color: '#374151', bg: '#f3f4f6' },
}

function UserManager({ tenant, currentUserRole }) {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(null)

  const fetchUsers = useCallback(async () => {
    setLoading(true)
    // superadmin เห็นทุกคน, admin เห็นเฉพาะ municipality ตัวเอง
    let query = supabase.from('profiles').select('*').order('created_at', { ascending: false })
    if (currentUserRole === 'admin') {
      query = query.eq('municipality_id', tenant?.id)
    }
    const { data } = await query
    setUsers(data ?? [])
    setLoading(false)
  }, [tenant?.id, currentUserRole])

  useEffect(() => { fetchUsers() }, [fetchUsers])

  async function updateRole(userId, newRole, municipalityId) {
    setSaving(userId)
    await supabase.from('profiles').update({
      role: newRole,
      municipality_id: newRole === 'admin' ? (municipalityId || tenant?.id) : null,
    }).eq('id', userId)
    setUsers((prev) => prev.map((u) =>
      u.id === userId ? { ...u, role: newRole, municipality_id: newRole === 'admin' ? (municipalityId || tenant?.id) : null } : u
    ))
    setSaving(null)
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
        <h3 className="font-semibold text-gray-700 flex items-center gap-2">
          <Users size={16} /> จัดการผู้ใช้งาน
        </h3>
        <button onClick={fetchUsers} className="text-gray-400 hover:text-gray-600 transition-colors">
          <RefreshCw size={15} />
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-10 text-gray-400">
          <Loader2 size={20} className="animate-spin" />
        </div>
      ) : users.length === 0 ? (
        <p className="text-center py-10 text-gray-400 text-sm">ยังไม่มีผู้ใช้งาน</p>
      ) : (
        <div className="divide-y divide-gray-50">
          {users.map((u) => {
            const rs = ROLE_LABELS[u.role] ?? ROLE_LABELS.citizen
            const isSelf = false
            return (
              <div key={u.id} className="flex items-center gap-3 px-5 py-3">
                <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0"
                     style={{ backgroundColor: rs.color }}>
                  {(u.full_name || u.email || '?')[0].toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-800 text-sm truncate">{u.full_name || '—'}</p>
                  <p className="text-xs text-gray-400 truncate">{u.email}</p>
                </div>
                <span className="text-xs font-medium px-2 py-0.5 rounded-full shrink-0"
                      style={{ backgroundColor: rs.bg, color: rs.color }}>
                  {rs.label}
                </span>
                {/* เปลี่ยน role ได้ถ้าไม่ใช่ superadmin อีกคน */}
                {u.role !== 'superadmin' && currentUserRole === 'superadmin' && (
                  <select
                    value={u.role}
                    disabled={saving === u.id}
                    onChange={(e) => updateRole(u.id, e.target.value, u.municipality_id)}
                    className="text-xs border border-gray-200 rounded-lg px-2 py-1 text-gray-700 focus:outline-none shrink-0"
                  >
                    <option value="citizen">สมาชิก</option>
                    <option value="admin">แอดมิน</option>
                    <option value="superadmin">Super Admin</option>
                  </select>
                )}
                {u.role !== 'superadmin' && currentUserRole === 'admin' && u.role !== 'admin' && (
                  <select
                    value={u.role}
                    disabled={saving === u.id}
                    onChange={(e) => updateRole(u.id, e.target.value, u.municipality_id)}
                    className="text-xs border border-gray-200 rounded-lg px-2 py-1 text-gray-700 focus:outline-none shrink-0"
                  >
                    <option value="citizen">สมาชิก</option>
                    <option value="admin">แอดมิน</option>
                  </select>
                )}
                {saving === u.id && <Loader2 size={14} className="animate-spin text-gray-400 shrink-0" />}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Emergency Contacts Manager ───────────────────────────────────────────────
function EmergencyManager({ tenant }) {
  const [contacts, setContacts] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ label: '', number: '', emoji: '📞', color: '#1d4ed8', bg: '#dbeafe' })

  const fetchContacts = useCallback(async () => {
    if (!tenant?.id) return
    setLoading(true)
    const { data } = await supabase
      .from('emergency_contacts')
      .select('*')
      .eq('municipality_id', tenant.id)
      .order('display_order')
    setContacts(data ?? [])
    setLoading(false)
  }, [tenant?.id])

  useEffect(() => { fetchContacts() }, [fetchContacts])

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
    await supabase.from('emergency_contacts').delete().eq('id', id)
    setContacts((prev) => prev.filter((c) => c.id !== id))
  }

  return (
    <div className="space-y-4">
      {/* Add form */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
        <p className="font-semibold text-gray-700 text-sm">เพิ่มสายด่วนใหม่</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <input value={form.emoji} onChange={(e) => setForm({ ...form, emoji: e.target.value })}
            className="border border-gray-200 rounded-xl px-3 py-2 text-sm text-center text-gray-800"
            placeholder="emoji" maxLength={2} />
          <input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })}
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
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          {contacts.map((c, i) => (
            <div key={c.id} className={`flex items-center gap-3 px-4 py-3 ${i < contacts.length - 1 ? 'border-b border-gray-50' : ''}`}>
              <div className="w-10 h-10 rounded-full flex items-center justify-center text-xl shrink-0"
                   style={{ backgroundColor: c.bg }}>
                {c.emoji}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-800 text-sm">{c.label}</p>
                <p className="text-xs text-gray-400">{c.number}</p>
              </div>
              <a href={`tel:${c.number}`}
                 className="p-2 rounded-xl text-gray-400 hover:text-green-600 hover:bg-green-50 transition-colors">
                <PhoneCall size={15} />
              </a>
              <button onClick={() => deleteContact(c.id)}
                className="p-2 rounded-xl text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors">
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Main page ─────────────────────────────────────────────────────────────────
export default function AdminDashboard() {
  const { tenant } = useTenant()
  const navigate = useNavigate()
  const [complaints, setComplaints] = useState([])
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(null)
  const [filterTab, setFilterTab] = useState(0)
  const [search, setSearch] = useState('')
  const [activePage, setActivePage] = useState('complaints')
  const [currentUserRole, setCurrentUserRole] = useState(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) return
      supabase.from('profiles').select('role').eq('id', data.session.user.id).single()
        .then(({ data: p }) => setCurrentUserRole(p?.role ?? 'citizen'))
    })
  }, [])

  async function handleLogout() {
    await supabase.auth.signOut()
    navigate('/admin/login')
  }

  const fetchComplaints = useCallback(async () => {
    if (!tenant?.id) return
    setLoading(true)
    const { data } = await supabase
      .from('complaints')
      .select('*')
      .eq('municipality_id', tenant.id)
      .order('created_at', { ascending: false })
    setComplaints(data ?? [])
    setLoading(false)
  }, [tenant?.id])

  useEffect(() => { fetchComplaints() }, [fetchComplaints])

  async function updateStatus(id, nextStatus) {
    setUpdating(id)
    await supabase.from('complaints').update({ status: nextStatus }).eq('id', id)
    setComplaints((prev) =>
      prev.map((c) => c.id === id ? { ...c, status: nextStatus } : c)
    )
    setUpdating(null)
  }

  // ─── Derived data ──────────────────────────────────────────────────────────
  const statsData = Object.entries(STATUS).map(([key, s]) => ({
    name: s.label,
    value: complaints.filter((c) => c.status === key).length,
    color: s.color,
  })).filter((d) => d.value > 0)

  const filtered = complaints.filter((c) => {
    const matchStatus = FILTER_KEYS[filterTab] ? c.status === FILTER_KEYS[filterTab] : true
    const matchSearch = search === '' ||
      c.detail.includes(search) ||
      (CATEGORY_LABEL[c.category] ?? '').includes(search) ||
      (c.phone ?? '').includes(search)
    return matchStatus && matchSearch
  })

  const counts = Object.fromEntries(
    Object.keys(STATUS).map((k) => [k, complaints.filter((c) => c.status === k).length])
  )

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-800">แผงควบคุมเจ้าหน้าที่</h1>
          <p className="text-sm text-gray-400">{tenant?.name}</p>
        </div>
        <div className="flex items-center gap-2">
          {activePage === 'complaints' && (
            <button onClick={fetchComplaints} disabled={loading}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border border-gray-200 bg-white hover:bg-gray-50 transition-colors disabled:opacity-50">
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
              รีเฟรช
            </button>
          )}
          <button onClick={handleLogout}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border border-red-200 text-red-500 bg-white hover:bg-red-50 transition-colors">
            <LogOut size={15} />
            ออกจากระบบ
          </button>
        </div>
      </div>

      {/* Tab navigation */}
      <div className="flex gap-2">
        <button onClick={() => setActivePage('complaints')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
            activePage === 'complaints'
              ? 'text-white shadow-sm'
              : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
          }`}
          style={activePage === 'complaints' ? { backgroundColor: 'var(--color-primary)' } : {}}>
          <ClipboardList size={15} /> คำร้อง
        </button>
        <button onClick={() => setActivePage('emergency')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
            activePage === 'emergency'
              ? 'text-white shadow-sm'
              : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
          }`}
          style={activePage === 'emergency' ? { backgroundColor: '#ef4444' } : {}}>
          <Phone size={15} /> สายด่วนฉุกเฉิน
        </button>
        {(currentUserRole === 'admin' || currentUserRole === 'superadmin') && (
          <button onClick={() => setActivePage('users')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
              activePage === 'users'
                ? 'text-white shadow-sm'
                : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
            style={activePage === 'users' ? { backgroundColor: '#7c3aed' } : {}}>
            <Shield size={15} /> จัดการผู้ใช้
          </button>
        )}
      </div>

      {activePage === 'emergency' ? (
        <EmergencyManager tenant={tenant} />
      ) : activePage === 'users' ? (
        <UserManager tenant={tenant} currentUserRole={currentUserRole} />
      ) : (
        <>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="ทั้งหมด"        value={complaints.length}      icon={ClipboardList} color="#64748b" />
        <StatCard label="รอดำเนินการ"    value={counts.pending ?? 0}    icon={Clock}         color="#f59e0b" />
        <StatCard label="กำลังดำเนินการ" value={counts.in_progress ?? 0} icon={AlertCircle}  color="#8b5cf6" />
        <StatCard label="เสร็จสิ้น"      value={counts.completed ?? 0}  icon={CheckCircle2}  color="#10b981" />
      </div>

      {/* Chart + filter row */}
      <div className="grid md:grid-cols-3 gap-4">
        {/* Pie chart */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <h2 className="font-semibold text-gray-700 text-sm mb-4">สัดส่วนตามสถานะ</h2>
          {statsData.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-gray-400 text-sm">
              ยังไม่มีข้อมูล
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={statsData} cx="50%" cy="50%" innerRadius={50} outerRadius={80}
                     paddingAngle={3} dataKey="value">
                  {statsData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
                <Legend iconType="circle" iconSize={8}
                        formatter={(value) => <span className="text-xs text-gray-600">{value}</span>} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Quick status summary */}
        <div className="md:col-span-2 bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <h2 className="font-semibold text-gray-700 text-sm mb-4">สรุปสถานะ</h2>
          <div className="space-y-2.5">
            {Object.entries(STATUS).map(([key, s]) => {
              const count = counts[key] ?? 0
              const pct = complaints.length ? Math.round((count / complaints.length) * 100) : 0
              return (
                <div key={key}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-gray-600">{s.label}</span>
                    <span className="font-semibold text-gray-700">{count} ({pct}%)</span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2">
                    <div className="h-2 rounded-full transition-all duration-500"
                         style={{ width: `${pct}%`, backgroundColor: s.color }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Table section */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {/* Table header */}
        <div className="px-5 pt-5 pb-3 border-b border-gray-100">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <h2 className="font-semibold text-gray-700 flex-1">รายการคำร้อง</h2>
            {/* Search */}
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="ค้นหาคำร้อง..."
                className="pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:border-transparent w-52"
                style={{ '--tw-ring-color': 'var(--color-primary)' }} />
            </div>
          </div>

          {/* Filter tabs */}
          <div className="flex gap-1 mt-3 overflow-x-auto pb-1">
            {FILTER_TABS.map((tab, i) => (
              <button key={i} onClick={() => setFilterTab(i)}
                className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  filterTab === i
                    ? 'text-white'
                    : 'text-gray-500 bg-gray-100 hover:bg-gray-200'
                }`}
                style={filterTab === i ? { backgroundColor: 'var(--color-primary)' } : {}}>
                <span className="flex items-center gap-1">
                  <Filter size={10} />
                  {tab}
                  {i > 0 && (
                    <span className={`ml-1 px-1.5 rounded-full text-[10px] font-bold ${
                      filterTab === i ? 'bg-white/25' : 'bg-gray-200 text-gray-600'
                    }`}>
                      {complaints.filter((c) => c.status === FILTER_KEYS[i]).length}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-400">
            <Loader2 size={24} className="animate-spin mr-2" /> กำลังโหลด...
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <ClipboardList size={36} className="mb-2 opacity-30" />
            <p className="text-sm">ไม่มีรายการคำร้อง</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-gray-500 text-xs">
                  <th className="px-5 py-3 text-left font-medium">วันที่</th>
                  <th className="px-5 py-3 text-left font-medium">หมวดหมู่</th>
                  <th className="px-5 py-3 text-left font-medium hidden md:table-cell">รายละเอียด</th>
                  <th className="px-5 py-3 text-left font-medium hidden sm:table-cell">โทรศัพท์</th>
                  <th className="px-5 py-3 text-left font-medium">สถานะ</th>
                  <th className="px-5 py-3 text-left font-medium">การดำเนินการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map((c) => (
                  <tr key={c.id} className="hover:bg-gray-50/70 transition-colors">
                    <td className="px-5 py-4 text-gray-500 whitespace-nowrap text-xs">
                      {new Date(c.created_at).toLocaleDateString('th-TH', {
                        day: '2-digit', month: 'short', year: '2-digit',
                      })}
                    </td>
                    <td className="px-5 py-4 font-medium text-gray-700 whitespace-nowrap">
                      {CATEGORY_LABEL[c.category] ?? c.category}
                    </td>
                    <td className="px-5 py-4 text-gray-500 max-w-xs hidden md:table-cell">
                      <p className="truncate">{c.detail}</p>
                    </td>
                    <td className="px-5 py-4 text-gray-500 hidden sm:table-cell">
                      {c.phone ?? <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-5 py-4">
                      <StatusBadge status={c.status} />
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        <ActionButton status={c.status} id={c.id} onUpdate={updateStatus} loading={updating} />
                        <RejectButton status={c.status} id={c.id} onUpdate={updateStatus} loading={updating} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="px-5 py-3 text-xs text-gray-400 border-t border-gray-50">
              แสดง {filtered.length} จาก {complaints.length} รายการ
            </p>
          </div>
        )}
      </div>
      </>
      )}
    </div>
  )
}
