import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, FileText, Clock, CheckCircle2, XCircle,
  RefreshCw, Loader2, ChevronRight, X, Search, Download,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useTenant } from '../contexts/TenantContext'

const DOC_TYPES = {
  residence_cert: 'ใบรับรองการอยู่อาศัย',
  personal_cert:  'หนังสือรับรองบุคคล',
  conduct_cert:   'หนังสือรับรองความประพฤติ',
  tax_notice:     'ใบแจ้งชำระภาษีที่ดินและสิ่งปลูกสร้าง',
  other:          'คำขออื่นๆ',
}

const STATUS = {
  pending:    { label: 'รอดำเนินการ',    color: '#f59e0b', bg: '#fef3c7', Icon: Clock },
  processing: { label: 'กำลังดำเนินการ', color: '#3b82f6', bg: '#dbeafe', Icon: RefreshCw },
  completed:  { label: 'เสร็จสิ้น',      color: '#10b981', bg: '#d1fae5', Icon: CheckCircle2 },
  rejected:   { label: 'ปฏิเสธ',         color: '#ef4444', bg: '#fee2e2', Icon: XCircle },
}

const STEPS = ['pending', 'processing', 'completed']

function dateTH(s) {
  if (!s) return ''
  return new Date(s).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function StatusBadge({ status }) {
  const s = STATUS[status]; if (!s) return null
  const { Icon } = s
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{ backgroundColor: s.bg, color: s.color }}>
      <Icon size={10} /> {s.label}
    </span>
  )
}

function DocCard({ req, onClick }) {
  const docLabel = DOC_TYPES[req.document_type] ?? req.document_type
  return (
    <button onClick={onClick}
      className="w-full bg-white rounded-2xl shadow-sm border border-gray-100 p-4 text-left hover:shadow-md active:scale-[0.99] transition-all flex items-start gap-3">
      <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
        <FileText size={18} className="text-blue-500" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2 mb-0.5">
          <p className="text-sm font-bold text-gray-800 truncate">{docLabel}</p>
          <StatusBadge status={req.status} />
        </div>
        <p className="text-xs text-gray-400">เลขอ้างอิง: <span className="font-mono font-semibold">{req.id.slice(0,8).toUpperCase()}</span></p>
        {req.purpose && <p className="text-xs text-gray-400 mt-0.5 truncate">{req.purpose}</p>}
        <p className="text-[11px] text-gray-300 mt-1">{dateTH(req.created_at)}</p>
        {req.document_url && req.status === 'completed' && (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 mt-1">
            <Download size={10} /> เอกสารพร้อมดาวน์โหลด
          </span>
        )}
      </div>
      <ChevronRight size={16} className="text-gray-300 shrink-0 mt-1" />
    </button>
  )
}

function DocDetailSheet({ req, onClose }) {
  const docLabel = DOC_TYPES[req.document_type] ?? req.document_type

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end md:items-center justify-center">
      <div className="bg-white w-full md:max-w-lg md:rounded-3xl rounded-t-3xl max-h-[93vh] flex flex-col overflow-hidden shadow-2xl">

        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 shrink-0">
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100 text-gray-500 transition-colors">
            <X size={18} />
          </button>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-gray-800 truncate">{docLabel}</p>
            <p className="text-xs text-gray-400">เลขอ้างอิง: <span className="font-mono font-semibold">{req.id.slice(0,8).toUpperCase()}</span></p>
          </div>
          <StatusBadge status={req.status} />
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-5 space-y-5">

          {/* Timeline */}
          <div>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-3">สถานะการดำเนินการ</p>
            <div className="space-y-3">
              {req.status === 'rejected' ? (
                <>
                  {/* pending step always done */}
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
                      <CheckCircle2 size={15} className="text-emerald-500" />
                    </div>
                    <p className="text-sm font-semibold text-gray-700">รอดำเนินการ</p>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center shrink-0">
                      <XCircle size={15} className="text-red-500" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-red-600">ปฏิเสธคำขอ</p>
                      {req.reject_reason && (
                        <p className="text-xs text-red-400 mt-0.5 leading-relaxed">{req.reject_reason}</p>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                STEPS.map(step => {
                  const s = STATUS[step]
                  const SIcon = s.Icon
                  const stepIdx  = STEPS.indexOf(step)
                  const curIdx   = STEPS.indexOf(req.status)
                  const isDone   = stepIdx <= curIdx
                  const isCurrent = step === req.status
                  return (
                    <div key={step} className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-colors ${isDone ? 'bg-emerald-100' : 'bg-gray-100'}`}>
                        <SIcon size={15} className={isDone ? 'text-emerald-500' : 'text-gray-300'} />
                      </div>
                      <div>
                        <p className={`text-sm font-semibold ${isDone ? 'text-gray-800' : 'text-gray-300'}`}>{s.label}</p>
                        {isCurrent && <p className="text-[11px] text-blue-500 font-medium">● สถานะปัจจุบัน</p>}
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>

          {/* Details */}
          <div className="bg-gray-50 rounded-2xl p-4 space-y-2.5">
            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide">รายละเอียดคำขอ</p>
            {[
              { label: 'ประเภทเอกสาร', value: docLabel },
              req.purpose       && { label: 'วัตถุประสงค์', value: req.purpose },
              req.requester_name && { label: 'ชื่อ-สกุล',    value: req.requester_name },
              req.requester_phone && { label: 'โทรศัพท์',    value: req.requester_phone },
              { label: 'วันที่ยื่น', value: dateTH(req.created_at) },
            ].filter(Boolean).map(({ label, value }) => (
              <div key={label} className="flex gap-2 text-xs">
                <span className="text-gray-400 w-24 shrink-0">{label}</span>
                <span className="text-gray-700 leading-relaxed">{value}</span>
              </div>
            ))}
          </div>

          {/* Staff note */}
          {req.staff_notes && (
            <div className="bg-blue-50 rounded-xl p-3.5">
              <p className="text-[11px] font-bold text-blue-400 uppercase tracking-wide mb-1">บันทึกเจ้าหน้าที่</p>
              <p className="text-sm text-blue-800 leading-relaxed">{req.staff_notes}</p>
            </div>
          )}

          {/* Download issued document */}
          {req.document_url && req.status === 'completed' && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 space-y-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 size={18} className="text-emerald-500 shrink-0" />
                <div>
                  <p className="text-sm font-bold text-emerald-700">เอกสารออกให้แล้ว</p>
                  <p className="text-xs text-emerald-500">เปิดหรือบันทึกเอกสารดิจิทัลของท่านได้เลย</p>
                </div>
              </div>
              <a href={req.document_url} target="_blank" rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 w-full py-3 rounded-xl font-bold text-white text-sm active:scale-[0.98] transition-all"
                style={{ backgroundColor: '#10b981' }}>
                <Download size={16} /> เปิด / ดาวน์โหลดเอกสาร
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function MyDocRequests() {
  const navigate  = useNavigate()
  const { tenant } = useTenant()
  const [session, setSession]       = useState(undefined)
  const [requests, setRequests]     = useState([])
  const [loading, setLoading]       = useState(true)
  const [selected, setSelected]     = useState(null)
  const [searchRef, setSearchRef]   = useState('')
  const [searching, setSearching]   = useState(false)
  const [searchResult, setSearchResult] = useState(null)
  const [searched, setSearched]     = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
  }, [])

  useEffect(() => {
    if (session === undefined || !tenant?.id) return
    if (!session) { setLoading(false); return }
    setLoading(true)
    supabase.from('document_requests')
      .select('*')
      .eq('municipality_id', tenant.id)
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => { setRequests(data ?? []); setLoading(false) })
  }, [session, tenant?.id])

  async function handleSearch() {
    const ref = searchRef.trim().toLowerCase()
    if (!ref || !tenant?.id) return
    setSearching(true); setSearched(true); setSearchResult(null)
    // UUID starts with the 8-char ref (hex)
    const { data } = await supabase.from('document_requests')
      .select('*')
      .eq('municipality_id', tenant.id)
      .ilike('id', `${ref}%`)
      .limit(1)
    setSearchResult(data?.[0] ?? null)
    setSearching(false)
  }

  if (session === undefined) return null

  return (
    <div className="min-h-screen bg-gray-50">

      {/* Header */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3 shadow-sm">
        <button onClick={() => navigate(-1)} className="p-2 rounded-xl hover:bg-gray-100 text-gray-500 transition-colors">
          <ArrowLeft size={18} />
        </button>
        <div>
          <p className="font-bold text-gray-800">ติดตามคำขอเอกสาร</p>
          <p className="text-xs text-gray-400">สถานะใบรับรองและเอกสารราชการ</p>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-5 pb-12 space-y-5">

        {session ? (
          /* ── Logged in: own requests ── */
          <>
            {loading ? (
              <div className="flex justify-center py-16">
                <Loader2 size={28} className="animate-spin text-gray-200" />
              </div>
            ) : requests.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                <FileText size={44} className="mb-3 opacity-20" />
                <p className="text-sm font-semibold text-gray-500">ยังไม่มีคำขอเอกสาร</p>
                <p className="text-xs text-gray-400 mt-1 mb-5">คำขอที่ท่านยื่นจะแสดงที่นี่</p>
                <button onClick={() => navigate('/doc-request')}
                  className="px-6 py-3 rounded-2xl font-bold text-white text-sm active:scale-95 transition-all"
                  style={{ backgroundColor: 'var(--color-primary)' }}>
                  ยื่นคำขอเอกสาร
                </button>
              </div>
            ) : (
              <div className="space-y-2.5">
                <p className="text-xs text-gray-400 font-semibold px-1">{requests.length} คำขอ</p>
                {requests.map(req => (
                  <DocCard key={req.id} req={req} onClick={() => setSelected(req)} />
                ))}
              </div>
            )}
          </>
        ) : (
          /* ── Not logged in: search by ref ── */
          <div className="space-y-4">
            <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 text-center space-y-2">
              <p className="text-sm font-bold text-blue-700">เข้าสู่ระบบเพื่อดูคำขอทั้งหมด</p>
              <p className="text-xs text-blue-500">หรือค้นหาด้วยเลขอ้างอิงด้านล่าง</p>
              <button onClick={() => navigate('/auth', { state: { from: '/my-docs' } })}
                className="px-5 py-2 rounded-xl font-bold text-sm text-white"
                style={{ backgroundColor: 'var(--color-primary)' }}>
                เข้าสู่ระบบ
              </button>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 space-y-3">
              <p className="text-sm font-bold text-gray-700">ค้นหาด้วยเลขอ้างอิง</p>
              <p className="text-xs text-gray-400">เลข 8 ตัวที่ได้รับหลังยื่นคำขอ เช่น 3F9A1B2C</p>
              <div className="flex gap-2">
                <input type="text" value={searchRef}
                  onChange={e => { setSearchRef(e.target.value.toUpperCase()); setSearched(false) }}
                  placeholder="3F9A1B2C" maxLength={8}
                  className="flex-1 border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-200 font-mono tracking-widest uppercase"
                  onKeyDown={e => e.key === 'Enter' && handleSearch()} />
                <button onClick={handleSearch} disabled={searching || searchRef.length < 6}
                  className="px-4 py-2.5 rounded-xl font-semibold text-white text-sm disabled:opacity-50 flex items-center gap-1.5 transition-opacity"
                  style={{ backgroundColor: 'var(--color-primary)' }}>
                  {searching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                  ค้นหา
                </button>
              </div>
              {searched && !searching && !searchResult && (
                <p className="text-xs text-red-500">ไม่พบเลขอ้างอิงนี้ ลองตรวจสอบอีกครั้ง</p>
              )}
              {searchResult && (
                <DocCard req={searchResult} onClick={() => setSelected(searchResult)} />
              )}
            </div>
          </div>
        )}
      </div>

      {selected && <DocDetailSheet req={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
