import { useEffect, useState, useCallback } from 'react'
import {
  MapPin, Plus, X, Loader2, RefreshCw, Trash2, Pencil, ChevronLeft,
  Image, AlertTriangle, CheckCircle2, Calendar, Banknote, Building2,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import MapPicker from '../MapPicker'

const THIS_YEAR = new Date().getFullYear() + 543
const TODAY     = new Date().toISOString().slice(0, 10)
const FISCAL_YEARS = Array.from({ length: 8 }, (_, i) => String(THIS_YEAR - 3 + i))

const STATUS_CFG = {
  planned:     { label: 'วางแผน',          color: '#64748b', bg: '#f1f5f9', text: '#475569', autoProgress: 0,    canEdit: false, needsReason: false },
  approved:    { label: 'อนุมัติแล้ว',      color: '#3b82f6', bg: '#dbeafe', text: '#1e40af', autoProgress: 0,    canEdit: false, needsReason: false },
  in_progress: { label: 'กำลังดำเนินการ',  color: '#f97316', bg: '#ffedd5', text: '#9a3412', autoProgress: null, canEdit: true,  needsReason: false },
  completed:   { label: 'แล้วเสร็จ',       color: '#10b981', bg: '#d1fae5', text: '#065f46', autoProgress: 100,  canEdit: false, needsReason: false },
  cancelled:   { label: 'ยกเลิก',          color: '#ef4444', bg: '#fee2e2', text: '#991b1b', autoProgress: null, canEdit: false, needsReason: true  },
  suspended:   { label: 'ระงับชั่วคราว',   color: '#f59e0b', bg: '#fef3c7', text: '#92400e', autoProgress: null, canEdit: false, needsReason: true  },
}

const PROJECT_TYPES = [
  { value: 'road',         label: 'ถนน/ทางหลวง',       icon: '🛣️' },
  { value: 'drain',        label: 'ระบบระบายน้ำ',       icon: '🕳️' },
  { value: 'bridge',       label: 'สะพาน/ท่อลอด',      icon: '🌉' },
  { value: 'light',        label: 'ไฟฟ้าสาธารณะ',      icon: '💡' },
  { value: 'waterway',     label: 'ลำเหมือง/คลอง',     icon: '🏞️' },
  { value: 'building',     label: 'อาคาร/สิ่งก่อสร้าง', icon: '🏗️' },
  { value: 'irrigation',   label: 'ระบบชลประทาน',      icon: '💧' },
  { value: 'water_supply', label: 'ประปาหมู่บ้าน',      icon: '🚰' },
  { value: 'other',        label: 'อื่นๆ',               icon: '📝' },
]

const DEPARTMENTS = [
  { value: 'civil',   label: 'กองช่าง' },
  { value: 'sp',      label: 'สำนักปลัด' },
  { value: 'edu',     label: 'กองการศึกษา' },
  { value: 'finance', label: 'กองคลัง' },
  { value: 'other',   label: 'หน่วยงานอื่น' },
]

const EMPTY_FORM = {
  project_no: '', fiscal_year: String(THIS_YEAR), title: '', description: '',
  project_type: 'road', status: 'planned', department: 'civil', progress_pct: 0,
  village: '', subdistrict: '', district: '', province: '', location_desc: '',
  budget_amount: '', contract_amount: '', paid_amount: '',
  contractor_name: '', contract_no: '',
  start_date: '', end_date: '',
  cancel_reason: '', note: '',
}

function StatusBadge({ status }) {
  const cfg = STATUS_CFG[status]
  if (!cfg) return null
  return (
    <span className="text-[11px] font-bold px-2 py-0.5 rounded-full"
          style={{ backgroundColor: cfg.bg, color: cfg.text }}>
      {cfg.label}
    </span>
  )
}

function ProgressBar({ pct, status }) {
  const color = STATUS_CFG[status]?.color ?? '#94a3b8'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all"
             style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="text-[10px] font-bold text-gray-400 shrink-0">{pct}%</span>
    </div>
  )
}

function Field({ label, required, children, half }) {
  return (
    <div className={half ? '' : 'col-span-2'}>
      {label && (
        <label className="block text-xs font-semibold text-gray-500 mb-1">
          {label}{required && <span className="text-red-400 ml-0.5">*</span>}
        </label>
      )}
      {children}
    </div>
  )
}

const inputCls = 'w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-200 focus:border-violet-300'
const selectCls = inputCls

export default function CivilProjectAdmin({ tenant, currentUserRole }) {
  const [view, setView]     = useState('list')
  const [editId, setEditId] = useState(null)
  const [projects, setProjects] = useState([])
  const [loading, setLoading]   = useState(false)
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterYear, setFilterYear]     = useState(String(THIS_YEAR))

  const [form, setForm]                 = useState({ ...EMPTY_FORM })
  const [geo, setGeo]                   = useState({ lat: null, lng: null })
  const [photos, setPhotos]             = useState([])
  const [existingPhotos, setExisting]   = useState([])
  const [showMap, setShowMap]           = useState(false)
  const [submitting, setSubmitting]     = useState(false)
  const [formError, setFormError]       = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState(null)

  const isReadOnly = currentUserRole === 'viewer' || currentUserRole === 'council'
  const canDelete  = currentUserRole === 'admin' || currentUserRole === 'superadmin'

  const fetchProjects = useCallback(async () => {
    if (!tenant?.id) return
    setLoading(true)
    let q = supabase.from('civil_projects').select('*').eq('municipality_id', tenant.id)
    if (filterStatus !== 'all') q = q.eq('status', filterStatus)
    if (filterYear  !== 'all') q = q.eq('fiscal_year', filterYear)
    const { data } = await q.order('created_at', { ascending: false }).limit(200)
    setProjects(data ?? [])
    setLoading(false)
  }, [tenant?.id, filterStatus, filterYear])

  useEffect(() => { fetchProjects() }, [fetchProjects])

  function handleStatusChange(newStatus) {
    const cfg = STATUS_CFG[newStatus]
    setForm(p => ({
      ...p,
      status: newStatus,
      progress_pct: cfg.autoProgress !== null ? cfg.autoProgress : p.progress_pct,
    }))
  }

  function openCreate() {
    setEditId(null)
    setForm({ ...EMPTY_FORM })
    setGeo({ lat: null, lng: null })
    setPhotos([])
    setExisting([])
    setFormError(null)
    setView('form')
  }

  function openEdit(p) {
    setEditId(p.id)
    setForm({
      project_no: p.project_no ?? '', fiscal_year: p.fiscal_year, title: p.title,
      description: p.description ?? '', project_type: p.project_type,
      status: p.status, department: p.department ?? 'civil', progress_pct: p.progress_pct,
      village: p.village ?? '', subdistrict: p.subdistrict ?? '',
      district: p.district ?? '', province: p.province ?? '',
      location_desc: p.location_desc ?? '',
      budget_amount: p.budget_amount ?? '', contract_amount: p.contract_amount ?? '',
      paid_amount: p.paid_amount ?? '', contractor_name: p.contractor_name ?? '',
      contract_no: p.contract_no ?? '', start_date: p.start_date ?? '',
      end_date: p.end_date ?? '', cancel_reason: p.cancel_reason ?? '', note: p.note ?? '',
    })
    setGeo({ lat: p.latitude ?? null, lng: p.longitude ?? null })
    setExisting(p.photos ?? [])
    setPhotos([])
    setFormError(null)
    setView('form')
  }

  async function uploadPhotos(newPhotos, id) {
    const urls = []
    for (const item of newPhotos) {
      const ext  = item.file.name.split('.').pop()
      const path = `civil/${id}/${Date.now()}.${ext}`
      const { error } = await supabase.storage.from('complaint-attachments').upload(path, item.file)
      if (!error) {
        const { data } = supabase.storage.from('complaint-attachments').getPublicUrl(path)
        urls.push(data.publicUrl)
      }
    }
    return urls
  }

  function addPhotos(e) {
    const files = Array.from(e.target.files ?? [])
    const items = files.map(f => ({ file: f, preview: URL.createObjectURL(f) }))
    setPhotos(prev => [...prev, ...items].slice(0, 5))
    e.target.value = ''
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.title.trim())     { setFormError('กรุณาระบุชื่อโครงการ'); return }
    if (!form.fiscal_year)      { setFormError('กรุณาเลือกปีงบประมาณ'); return }
    const needsReason = STATUS_CFG[form.status]?.needsReason
    if (needsReason && !form.cancel_reason.trim()) {
      setFormError('กรุณาระบุสาเหตุของการยกเลิก/ระงับโครงการ')
      return
    }
    setFormError(null)
    setSubmitting(true)
    const { data: { session } } = await supabase.auth.getSession()
    const id       = editId ?? crypto.randomUUID()
    const newUrls  = await uploadPhotos(photos, id)
    const allPhotos = [...existingPhotos, ...newUrls]
    const record = {
      municipality_id: tenant.id,
      created_by:      session.user.id,
      project_no:      form.project_no?.trim()      || null,
      fiscal_year:     form.fiscal_year,
      title:           form.title.trim(),
      description:     form.description?.trim()     || null,
      project_type:    form.project_type,
      status:          form.status,
      department:      form.department,
      progress_pct:    Number(form.progress_pct),
      village:         form.village?.trim()         || null,
      subdistrict:     form.subdistrict?.trim()     || null,
      district:        form.district?.trim()        || null,
      province:        form.province?.trim()        || null,
      location_desc:   form.location_desc?.trim()   || null,
      latitude:        geo.lat  ?? null,
      longitude:       geo.lng  ?? null,
      budget_amount:   form.budget_amount   ? parseFloat(form.budget_amount)   : null,
      contract_amount: form.contract_amount ? parseFloat(form.contract_amount) : null,
      paid_amount:     form.paid_amount     ? parseFloat(form.paid_amount)     : null,
      contractor_name: form.contractor_name?.trim() || null,
      contract_no:     form.contract_no?.trim()     || null,
      start_date:      form.start_date || null,
      end_date:        form.end_date   || null,
      cancel_reason:   form.cancel_reason?.trim()   || null,
      photos:          allPhotos,
      note:            form.note?.trim()            || null,
      updated_at:      new Date().toISOString(),
    }
    let dbErr
    if (editId) {
      const { error } = await supabase.from('civil_projects').update(record).eq('id', editId)
      dbErr = error
    } else {
      const { error } = await supabase.from('civil_projects').insert({ id, ...record })
      dbErr = error
    }
    setSubmitting(false)
    if (dbErr) { setFormError(`บันทึกไม่สำเร็จ: ${dbErr.message}`); return }
    setView('list')
    setEditId(null)
    fetchProjects()
  }

  async function deleteProject(id) {
    await supabase.from('civil_projects').delete().eq('id', id)
    setDeleteConfirm(null)
    fetchProjects()
  }

  const typeIcon = (t) => PROJECT_TYPES.find(x => x.value === t)?.icon ?? '📝'
  const typeLabel = (t) => PROJECT_TYPES.find(x => x.value === t)?.label ?? t
  const fmt = (n) => n != null ? Number(n).toLocaleString('th-TH') : '—'
  const incomplete = (p) => !p.project_no && !p.budget_amount

  // ─── LIST VIEW ──────────────────────────────────────────────────────────────
  if (view === 'list') return (
    <div className="space-y-4">

      {/* Delete confirm */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-5 shadow-xl max-w-xs w-full space-y-4">
            <p className="font-bold text-gray-800">ลบโครงการนี้?</p>
            <p className="text-sm text-gray-500 truncate">{deleteConfirm.title}</p>
            <div className="flex gap-2">
              <button onClick={() => deleteProject(deleteConfirm.id)}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white bg-red-500 hover:bg-red-600">ลบ</button>
              <button onClick={() => setDeleteConfirm(null)}
                className="flex-1 py-2.5 rounded-xl text-sm text-gray-500 bg-gray-100 hover:bg-gray-200">ยกเลิก</button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-violet-100 flex items-center justify-center">
            <Building2 size={16} className="text-violet-600" />
          </div>
          <div>
            <h2 className="font-bold text-gray-800">โครงการกองช่าง</h2>
            <p className="text-xs text-gray-400">ติดตามสถานะ · งบประมาณ · พิกัด GPS</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchProjects} disabled={loading}
            className="p-2 rounded-xl border border-gray-200 text-gray-400 hover:bg-gray-50 disabled:opacity-50">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
          {!isReadOnly && (
            <button onClick={openCreate}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-bold text-white"
              style={{ backgroundColor: '#7c3aed' }}>
              <Plus size={14} /> สร้างโครงการ
            </button>
          )}
        </div>
      </div>

      {/* Alert: รอรายละเอียด */}
      {!isReadOnly && projects.some(incomplete) && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 text-xs text-amber-800 flex items-center gap-2">
          <AlertTriangle size={13} className="shrink-0" />
          <span><b>{projects.filter(incomplete).length} โครงการ</b> ที่ช่างปักหมุดไว้ยังไม่มีเลขที่โครงการ/งบประมาณ — กด ✏️ เพื่อเพิ่มรายละเอียด</span>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <select value={filterYear} onChange={e => setFilterYear(e.target.value)}
          className="text-xs font-semibold border border-gray-200 rounded-xl px-3 py-1.5 bg-white text-gray-700 focus:outline-none">
          <option value="all">ทุกปีงบ</option>
          {FISCAL_YEARS.map(y => <option key={y} value={y}>พ.ศ. {y}</option>)}
        </select>
        <div className="flex flex-wrap gap-1">
          {['all', ...Object.keys(STATUS_CFG)].map(s => (
            <button key={s} onClick={() => setFilterStatus(s)}
              className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-all ${
                filterStatus === s ? 'bg-gray-800 text-white border-gray-800' : 'bg-white text-gray-500 border-gray-200'
              }`}>
              {s === 'all' ? `ทั้งหมด (${projects.length})` : `${STATUS_CFG[s].label} (${projects.filter(p => p.status === s).length})`}
            </button>
          ))}
        </div>
      </div>

      {/* Summary bar */}
      {projects.length > 0 && (() => {
        const totalBudget = projects.reduce((s, p) => s + (Number(p.budget_amount) || 0), 0)
        const totalPaid   = projects.reduce((s, p) => s + (Number(p.paid_amount)   || 0), 0)
        return (
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'โครงการทั้งหมด', value: `${projects.length} โครงการ`, color: '#7c3aed' },
              { label: 'งบรวม',          value: totalBudget ? `${(totalBudget/1e6).toFixed(2)} ล้าน ฿` : '—', color: '#0891b2' },
              { label: 'เบิกจ่ายแล้ว',  value: totalPaid   ? `${(totalPaid/1e6).toFixed(2)} ล้าน ฿` : '—', color: '#10b981' },
            ].map(card => (
              <div key={card.label} className="bg-white rounded-xl border border-gray-100 p-3 text-center">
                <p className="text-xs text-gray-400">{card.label}</p>
                <p className="text-sm font-bold mt-0.5" style={{ color: card.color }}>{card.value}</p>
              </div>
            ))}
          </div>
        )
      })()}

      {/* Project list */}
      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 size={22} className="animate-spin text-gray-300" />
        </div>
      ) : projects.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <Building2 size={36} className="mx-auto mb-2 opacity-20" />
          <p className="text-sm">ยังไม่มีโครงการ</p>
        </div>
      ) : (
        <div className="space-y-2">
          {projects.map(p => (
            <div key={p.id}
              className={`bg-white rounded-2xl border shadow-sm p-4 ${incomplete(p) ? 'border-amber-200' : 'border-gray-100'}`}>
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-violet-50 flex items-center justify-center text-xl shrink-0">
                  {typeIcon(p.project_type)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {p.project_no && <span className="text-[10px] font-mono text-gray-400">{p.project_no}</span>}
                    <StatusBadge status={p.status} />
                    {incomplete(p) && <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full">รอรายละเอียด</span>}
                  </div>
                  <p className="text-sm font-bold text-gray-800 mt-1 leading-snug">{p.title}</p>
                  <p className="text-xs text-gray-400 mt-0.5 truncate">
                    {typeLabel(p.project_type)}
                    {p.village ? ` · ${p.village}` : ''}
                    {p.fiscal_year ? ` · พ.ศ. ${p.fiscal_year}` : ''}
                  </p>
                  <div className="mt-2">
                    <ProgressBar pct={p.progress_pct} status={p.status} />
                  </div>
                  {p.budget_amount && (
                    <p className="text-xs text-gray-400 mt-1.5">
                      <span className="font-semibold text-gray-600">งบ {fmt(p.budget_amount)} ฿</span>
                      {p.paid_amount ? ` · เบิกแล้ว ${fmt(p.paid_amount)} ฿` : ''}
                    </p>
                  )}
                  {(p.start_date || p.end_date) && (
                    <p className="text-[10px] text-gray-400 mt-0.5">
                      📅 {p.start_date ? new Date(p.start_date).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: '2-digit' }) : '?'}
                      {' → '}
                      {p.end_date ? new Date(p.end_date).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: '2-digit' }) : '?'}
                    </p>
                  )}
                  {p.cancel_reason && (
                    <p className="text-[11px] text-red-500 bg-red-50 rounded-lg px-2 py-1 mt-1.5">
                      ⚠️ {p.cancel_reason}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0 mt-0.5">
                  {!isReadOnly && (
                    <button onClick={() => openEdit(p)}
                      className="p-1.5 rounded-lg hover:bg-violet-50 text-gray-300 hover:text-violet-600 transition-colors">
                      <Pencil size={13} />
                    </button>
                  )}
                  {canDelete && (
                    <button onClick={() => setDeleteConfirm(p)}
                      className="p-1.5 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-400 transition-colors">
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )

  // ─── FORM VIEW ──────────────────────────────────────────────────────────────
  const statusCfg = STATUS_CFG[form.status]
  const needsReason = statusCfg?.needsReason

  return (
    <div className="space-y-4 max-w-2xl">

      {showMap && (
        <MapPicker
          initialPos={geo.lat ? { lat: geo.lat, lng: geo.lng } : null}
          onConfirm={({ lat, lng, address }) => {
            setGeo({ lat, lng })
            if (address && !form.location_desc) setForm(p => ({ ...p, location_desc: address }))
            setShowMap(false)
          }}
          onClose={() => setShowMap(false)}
        />
      )}

      {/* Form header */}
      <div className="flex items-center gap-3">
        <button onClick={() => setView('list')}
          className="p-1.5 rounded-xl hover:bg-gray-100 text-gray-400 transition-colors">
          <ChevronLeft size={18} />
        </button>
        <div>
          <h2 className="font-bold text-gray-800">{editId ? 'แก้ไขโครงการ' : 'เพิ่มโครงการใหม่'}</h2>
          <p className="text-xs text-gray-400">กรอกข้อมูลโครงการให้ครบถ้วน</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">

        {/* ── ข้อมูลพื้นฐาน ── */}
        <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
          <h3 className="text-sm font-bold text-gray-700 border-b border-gray-100 pb-2">ข้อมูลพื้นฐาน</h3>
          <div className="grid grid-cols-2 gap-3">
            <Field label="เลขที่โครงการ" half>
              <input value={form.project_no} onChange={e => setForm(p => ({ ...p, project_no: e.target.value }))}
                placeholder="เช่น 2568-001" className={inputCls} />
            </Field>
            <Field label="ปีงบประมาณ" required half>
              <select value={form.fiscal_year} onChange={e => setForm(p => ({ ...p, fiscal_year: e.target.value }))} className={selectCls}>
                {FISCAL_YEARS.map(y => <option key={y} value={y}>พ.ศ. {y}</option>)}
              </select>
            </Field>
            <Field label="ชื่อโครงการ" required>
              <input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} required
                placeholder="ชื่อโครงการเต็ม" className={inputCls} />
            </Field>
            <Field label="รายละเอียดโครงการ">
              <textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                rows={3} placeholder="อธิบายรายละเอียดโครงการ"
                className={inputCls + ' resize-none'} />
            </Field>
            <Field label="ประเภทโครงการ" required half>
              <select value={form.project_type} onChange={e => setForm(p => ({ ...p, project_type: e.target.value }))} className={selectCls}>
                {PROJECT_TYPES.map(t => <option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}
              </select>
            </Field>
            <Field label="สถานะ" required half>
              <select value={form.status} onChange={e => handleStatusChange(e.target.value)} className={selectCls}>
                {Object.entries(STATUS_CFG).map(([v, c]) => <option key={v} value={v}>{c.label}</option>)}
              </select>
            </Field>
            <Field label="กอง/หน่วยงาน" required half>
              <select value={form.department} onChange={e => setForm(p => ({ ...p, department: e.target.value }))} className={selectCls}>
                {DEPARTMENTS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </Field>
            <Field label={`ความคืบหน้า (${form.progress_pct}%)`} half>
              <input type="number" min="0" max="100"
                value={form.progress_pct}
                disabled={!statusCfg?.canEdit}
                onChange={e => setForm(p => ({ ...p, progress_pct: Math.min(100, Math.max(0, Number(e.target.value))) }))}
                className={inputCls + (!statusCfg?.canEdit ? ' opacity-50 cursor-not-allowed' : '')} />
              <div className="mt-1.5">
                <ProgressBar pct={form.progress_pct} status={form.status} />
              </div>
            </Field>
          </div>
          {needsReason && (
            <Field label="สาเหตุที่ยกเลิก / ระงับโครงการ" required>
              <textarea value={form.cancel_reason}
                onChange={e => setForm(p => ({ ...p, cancel_reason: e.target.value }))} rows={2}
                placeholder="อธิบายปัญหา/สาเหตุที่ทำให้โครงการหยุดชะงัก"
                className={inputCls + ' resize-none border-red-200 focus:ring-red-200'} />
            </Field>
          )}
        </section>

        {/* ── ที่ตั้งโครงการ ── */}
        <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
          <h3 className="text-sm font-bold text-gray-700 border-b border-gray-100 pb-2">ที่ตั้งโครงการ</h3>
          <div className="grid grid-cols-2 gap-3">
            <Field label="หมู่บ้าน/ชุมชน" half>
              <input value={form.village} onChange={e => setForm(p => ({ ...p, village: e.target.value }))}
                placeholder="เช่น หมู่ 3 บ้านนา" className={inputCls} />
            </Field>
            <Field label="ตำบล" half>
              <input value={form.subdistrict} onChange={e => setForm(p => ({ ...p, subdistrict: e.target.value }))}
                className={inputCls} />
            </Field>
            <Field label="อำเภอ" half>
              <input value={form.district} onChange={e => setForm(p => ({ ...p, district: e.target.value }))}
                className={inputCls} />
            </Field>
            <Field label="จังหวัด" half>
              <input value={form.province} onChange={e => setForm(p => ({ ...p, province: e.target.value }))}
                className={inputCls} />
            </Field>
            <Field label="คำอธิบายที่ตั้ง">
              <input value={form.location_desc} onChange={e => setForm(p => ({ ...p, location_desc: e.target.value }))}
                placeholder="เช่น บริเวณสำนักงานเทศบาล" className={inputCls} />
            </Field>
          </div>

          {/* GPS */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-2">พิกัดที่ตั้ง</label>
            {geo.lat && (
              <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-xl px-3 py-2 mb-2">
                <MapPin size={13} className="text-blue-500 shrink-0" />
                <span className="text-xs font-mono text-blue-700">พิกัด: {geo.lat.toFixed(7)}, {geo.lng.toFixed(7)}</span>
                <button type="button" onClick={() => setGeo({ lat: null, lng: null })}
                  className="ml-auto text-red-400 hover:text-red-600 text-xs font-semibold flex items-center gap-1">
                  <Trash2 size={11} /> ล้าง
                </button>
              </div>
            )}
            <button type="button" onClick={() => setShowMap(true)}
              className="w-full border border-dashed border-gray-300 rounded-xl py-3 text-xs text-gray-500 hover:bg-gray-50 transition-colors flex items-center justify-center gap-2">
              <MapPin size={13} /> {geo.lat ? 'คลิกเพื่อแก้ไขพิกัด' : 'คลิกแผนที่เพื่อปักหมุด หรือพิมพ์พิกัดโดยตรง'}
            </button>
            <div className="grid grid-cols-2 gap-2 mt-2">
              <input type="number" step="any" value={geo.lat ?? ''}
                onChange={e => setGeo(p => ({ ...p, lat: e.target.value ? parseFloat(e.target.value) : null }))}
                placeholder="ละติจูด" className={inputCls} />
              <input type="number" step="any" value={geo.lng ?? ''}
                onChange={e => setGeo(p => ({ ...p, lng: e.target.value ? parseFloat(e.target.value) : null }))}
                placeholder="ลองจิจูด" className={inputCls} />
            </div>
            <p className="text-[10px] text-gray-400 mt-1">คลิกแผนที่เพื่อปักหมุด หรือพิมพ์พิกัดโดยตรง</p>
          </div>
        </section>

        {/* ── งบประมาณและสัญญา ── */}
        <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
          <h3 className="text-sm font-bold text-gray-700 border-b border-gray-100 pb-2">งบประมาณและสัญญา</h3>
          <div className="grid grid-cols-2 gap-3">
            <Field label="วงเงินงบประมาณ (บาท)" required half>
              <input type="number" step="0.01" value={form.budget_amount}
                onChange={e => setForm(p => ({ ...p, budget_amount: e.target.value }))}
                placeholder="0.00" className={inputCls} />
            </Field>
            <Field label="ราคาสัญญา (บาท)" half>
              <input type="number" step="0.01" value={form.contract_amount}
                onChange={e => setForm(p => ({ ...p, contract_amount: e.target.value }))}
                placeholder="0.00" className={inputCls} />
            </Field>
            <Field label="เบิกจ่ายแล้ว (บาท)" half>
              <input type="number" step="0.01" value={form.paid_amount}
                onChange={e => setForm(p => ({ ...p, paid_amount: e.target.value }))}
                placeholder="0.00" className={inputCls} />
            </Field>
            <div /> {/* spacer */}
            <Field label="ชื่อผู้รับจ้าง" half>
              <input value={form.contractor_name} onChange={e => setForm(p => ({ ...p, contractor_name: e.target.value }))}
                className={inputCls} />
            </Field>
            <Field label="เลขที่สัญญา" half>
              <input value={form.contract_no} onChange={e => setForm(p => ({ ...p, contract_no: e.target.value }))}
                className={inputCls} />
            </Field>
          </div>
        </section>

        {/* ── ระยะเวลาดำเนินการ ── */}
        <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
          <h3 className="text-sm font-bold text-gray-700 border-b border-gray-100 pb-2">ระยะเวลาดำเนินการ</h3>
          <div className="grid grid-cols-2 gap-3">
            <Field label="วันที่เริ่มต้น" half>
              <input type="date" value={form.start_date}
                onChange={e => setForm(p => ({ ...p, start_date: e.target.value }))}
                className={inputCls} />
            </Field>
            <Field label="วันที่สิ้นสุด" half>
              <input type="date" value={form.end_date}
                onChange={e => setForm(p => ({ ...p, end_date: e.target.value }))}
                className={inputCls} />
            </Field>
          </div>
        </section>

        {/* ── รูปภาพและหมายเหตุ ── */}
        <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
          <h3 className="text-sm font-bold text-gray-700 border-b border-gray-100 pb-2">รูปภาพและหมายเหตุ</h3>

          {existingPhotos.length > 0 && (
            <div>
              <p className="text-xs text-gray-400 mb-1.5">รูปภาพที่มีอยู่</p>
              <div className="grid grid-cols-5 gap-1.5">
                {existingPhotos.map((url, i) => (
                  <div key={i} className="relative aspect-square rounded-xl overflow-hidden bg-gray-100">
                    <img src={url} alt="" className="w-full h-full object-cover" />
                    <button type="button" onClick={() => setExisting(p => p.filter((_, j) => j !== i))}
                      className="absolute top-0.5 right-0.5 bg-black/50 rounded-full p-0.5">
                      <X size={9} className="text-white" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <label className="flex items-center gap-2 cursor-pointer border border-dashed border-gray-200 rounded-xl px-4 py-2.5 hover:bg-gray-50 transition-colors">
            <Image size={14} className="text-gray-400" />
            <span className="text-xs text-gray-500">เพิ่มรูปภาพ (ไม่เกิน 5 รูป)</span>
            <input type="file" accept="image/*" multiple className="hidden" onChange={addPhotos} />
          </label>
          {photos.length > 0 && (
            <div className="grid grid-cols-5 gap-1.5">
              {photos.map((p, i) => (
                <div key={i} className="relative aspect-square rounded-xl overflow-hidden bg-gray-100">
                  <img src={p.preview} alt="" className="w-full h-full object-cover" />
                  <button type="button" onClick={() => setPhotos(prev => prev.filter((_, j) => j !== i))}
                    className="absolute top-0.5 right-0.5 bg-black/50 rounded-full p-0.5">
                    <X size={9} className="text-white" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <Field label="หมายเหตุ">
            <textarea value={form.note} onChange={e => setForm(p => ({ ...p, note: e.target.value }))}
              rows={3} placeholder="หมายเหตุเพิ่มเติม"
              className={inputCls + ' resize-none'} />
          </Field>
        </section>

        {/* Error + Submit */}
        {formError && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600 flex items-center gap-2">
            <AlertTriangle size={14} className="shrink-0" />
            {formError}
          </div>
        )}

        <div className="flex gap-3 pb-6">
          <button type="submit" disabled={submitting}
            className="flex-1 py-3 rounded-xl text-sm font-bold text-white disabled:opacity-50 flex items-center justify-center gap-2"
            style={{ backgroundColor: '#7c3aed' }}>
            {submitting
              ? <><Loader2 size={14} className="animate-spin" /> กำลังบันทึก...</>
              : <><CheckCircle2 size={14} /> บันทึกโครงการ</>}
          </button>
          <button type="button" onClick={() => setView('list')}
            className="px-5 py-3 rounded-xl text-sm text-gray-500 bg-gray-100 hover:bg-gray-200 font-medium">
            ยกเลิก
          </button>
        </div>
      </form>
    </div>
  )
}
