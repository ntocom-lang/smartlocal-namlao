import { useState, useEffect, useCallback } from 'react'
import { Shield, Trash2, RefreshCw, User, Clock, ChevronDown, ChevronUp, Search, Eye } from 'lucide-react'
import { supabase } from '../../lib/supabase'

const ACTION_INFO = {
  delete:        { label: 'ลบ',              bg: '#fee2e2', color: '#991b1b', Icon: Trash2 },
  update_status: { label: 'อัปเดตสถานะ',     bg: '#dbeafe', color: '#1e40af', Icon: RefreshCw },
  approve:       { label: 'อนุมัติ',          bg: '#d1fae5', color: '#065f46', Icon: Shield },
  reject:        { label: 'ปฏิเสธ',           bg: '#fee2e2', color: '#991b1b', Icon: Shield },
  assign:        { label: 'มอบหมาย',          bg: '#ede9fe', color: '#5b21b6', Icon: User },
  view_pii:      { label: 'เปิดดูข้อมูลส่วนบุคคล', bg: '#fef3c7', color: '#92400e', Icon: Eye },
}

const RESOURCE_LABEL = {
  complaint:          'คำร้อง',
  event:              'กิจกรรม',
  document:           'เอกสาร',
  document_request:   'คำขอเอกสาร',
  civil_project:      'โครงการ',
  infrastructure_work:'งานโครงสร้าง',
  tourism_place:      'สถานที่ท่องเที่ยว',
  tourism_review:     'รีวิว',
  public_holiday:     'วันหยุดราชการ',
}

const ROLE_LABEL = {
  admin: 'ผู้ดูแล', superadmin: 'Super Admin', staff: 'เจ้าหน้าที่',
  officer: 'หัวหน้ากอง', technician: 'ช่าง', viewer: 'ผู้ชม', council: 'สภา',
}

function timeStr(dateStr) {
  const d = new Date(dateStr)
  return d.toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: '2-digit' })
    + ' ' + d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })
}

function MetaRow({ label, value }) {
  if (!value && value !== 0) return null
  return (
    <div className="flex gap-2 text-xs">
      <span className="text-gray-400 shrink-0 w-20">{label}</span>
      <span className="text-gray-600 font-mono break-all">{String(value)}</span>
    </div>
  )
}

function LogRow({ log }) {
  const [open, setOpen] = useState(false)
  const info = ACTION_INFO[log.action] ?? { label: log.action, bg: '#f3f4f6', color: '#374151', Icon: Shield }
  const Icon = info.Icon
  const resLabel = RESOURCE_LABEL[log.resource_type] ?? log.resource_type
  const roleLabel = ROLE_LABEL[log.actor_role] ?? log.actor_role

  return (
    <div className={`border-b border-gray-50 transition-colors ${log.action === 'delete' ? 'bg-red-50/30' : ''}`}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors">

        {/* action badge */}
        <div className="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center mt-0.5"
             style={{ backgroundColor: info.bg }}>
          <Icon size={15} style={{ color: info.color }} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-bold px-2 py-0.5 rounded-full"
                  style={{ backgroundColor: info.bg, color: info.color }}>
              {info.label}
            </span>
            <span className="text-xs text-gray-500">{resLabel}</span>
            {log.resource_label && (
              <span className="text-xs text-gray-700 font-semibold truncate max-w-[180px]">
                {log.resource_label}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1">
            <span className="text-[11px] text-gray-500 flex items-center gap-1">
              <User size={10} /> {log.actor_name}
              {roleLabel && <span className="text-gray-400">({roleLabel})</span>}
            </span>
            <span className="text-[11px] text-gray-400 flex items-center gap-1">
              <Clock size={10} /> {timeStr(log.created_at)}
            </span>
          </div>
        </div>

        <div className="shrink-0 mt-1 text-gray-300">
          {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </div>
      </button>

      {open && (
        <div className="px-4 pb-3 pt-0 ml-12 space-y-1 bg-gray-50/50">
          <MetaRow label="Resource ID" value={log.resource_id} />
          {log.metadata && Object.entries(log.metadata).map(([k, v]) => (
            <MetaRow key={k} label={k} value={v} />
          ))}
        </div>
      )}
    </div>
  )
}

export default function AuditLogViewer({ tenant }) {
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterAction, setFilterAction] = useState('all')
  const [filterType, setFilterType] = useState('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(50)
  const [totalCount, setTotalCount] = useState(0)

  const fetchLogs = useCallback(async () => {
    if (!tenant?.id) return
    setLoading(true)
    let q = supabase
      .from('audit_logs')
      .select('*', { count: 'exact' })
      .eq('municipality_id', tenant.id)
      .order('created_at', { ascending: false })

    if (filterAction !== 'all') q = q.eq('action', filterAction)
    if (filterType !== 'all')   q = q.eq('resource_type', filterType)
    if (pageSize !== 'all') q = q.range(page * pageSize, page * pageSize + pageSize - 1)

    try {
      const { data, count } = await q
      setLogs(data ?? [])
      setTotalCount(count ?? 0)
    } catch (err) {
      // fetch ของ client ตัวนี้ครอบ timeout 25 วิไว้ พอ abort จะ reject จริง ถ้าไม่ดัก
      // setLoading(false) ไม่ได้รัน แล้วสปินเนอร์หมุนค้างตลอดไป
      console.error('[audit-log] โหลดประวัติไม่สำเร็จ:', err?.message ?? err)
      setLogs([])
      setTotalCount(0)
    } finally {
      setLoading(false)
    }
  }, [tenant?.id, filterAction, filterType, page, pageSize])

  useEffect(() => { fetchLogs() }, [fetchLogs])
  useEffect(() => { setPage(0) }, [filterAction, filterType, search, pageSize])

  const filtered = search.trim()
    ? logs.filter(l =>
        l.actor_name?.includes(search) ||
        l.resource_label?.includes(search) ||
        l.resource_id?.includes(search)
      )
    : logs

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-red-50 flex items-center justify-center">
            <Shield size={16} className="text-red-500" />
          </div>
          <div>
            <h2 className="font-bold text-gray-800 text-sm">บันทึกกิจกรรม</h2>
            <p className="text-[11px] text-gray-400">ประวัติการลบและแก้ไขข้อมูลโดย staff/admin</p>
          </div>
        </div>
        <button onClick={fetchLogs} className="p-2 rounded-xl hover:bg-gray-100 text-gray-400 transition-colors">
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[160px]">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="ค้นหาชื่อ / รายการ"
            className="w-full pl-8 pr-3 py-2 text-xs rounded-xl border border-gray-200 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-200" />
        </div>
        <select value={filterAction} onChange={e => setFilterAction(e.target.value)}
          className="px-3 py-2 text-xs rounded-xl border border-gray-200 bg-white text-gray-700 focus:outline-none">
          <option value="all">ทุก action</option>
          <option value="delete">ลบ</option>
          <option value="update_status">อัปเดตสถานะ</option>
          <option value="view_pii">เปิดดูข้อมูลส่วนบุคคล</option>
          <option value="approve">อนุมัติ</option>
          <option value="reject">ปฏิเสธ</option>
        </select>
        <select value={filterType} onChange={e => setFilterType(e.target.value)}
          className="px-3 py-2 text-xs rounded-xl border border-gray-200 bg-white text-gray-700 focus:outline-none">
          <option value="all">ทุกประเภท</option>
          {Object.entries(RESOURCE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </div>

      {/* List */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <RefreshCw size={20} className="animate-spin text-gray-300" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <Shield size={32} className="text-gray-200 mb-3" />
            <p className="text-sm font-semibold text-gray-500">ยังไม่มีบันทึกกิจกรรม</p>
            <p className="text-xs text-gray-400 mt-1">การลบข้อมูลและ action สำคัญจะแสดงที่นี่</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {filtered.map(log => <LogRow key={log.id} log={log} />)}
          </div>
        )}
      </div>

      {/* Pagination */}
      {!search && totalCount > 0 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-gray-400">
          <div className="flex items-center gap-2">
            <span>แสดง</span>
            <select value={pageSize}
              onChange={e => setPageSize(e.target.value === 'all' ? 'all' : Number(e.target.value))}
              className="bg-white border border-gray-200 rounded-lg px-2 py-1 text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-200">
              {[10, 20, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
              <option value="all">ทั้งหมด</option>
            </select>
            <span>รายการ</span>
            <span>
              ({pageSize === 'all' ? 1 : page * pageSize + 1}–{pageSize === 'all' ? totalCount : Math.min((page + 1) * pageSize, totalCount)} จาก {totalCount})
            </span>
          </div>
          {pageSize !== 'all' && totalCount > pageSize && (
            <div className="flex gap-2">
              <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                className="px-3 py-1.5 rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50 transition-colors">
                ก่อนหน้า
              </button>
              <span className="px-1 py-1.5">หน้า {page + 1} / {Math.max(1, Math.ceil(totalCount / pageSize))}</span>
              <button onClick={() => setPage(p => p + 1)} disabled={(page + 1) * pageSize >= totalCount}
                className="px-3 py-1.5 rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50 transition-colors">
                ถัดไป
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
