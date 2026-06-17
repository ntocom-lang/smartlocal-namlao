import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, FileText, Clock, CheckCircle2, XCircle,
  RefreshCw, Loader2, ChevronRight, X, Search, Download,
  CreditCard, Upload, ImageIcon, Share2, Copy, Check, Plus,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useTenant } from '../contexts/TenantContext'
import { notifyTelegram } from '../lib/notifyTelegram'

const DOC_TYPES = {
  residence_cert:   'ใบรับรองการอยู่อาศัย',
  personal_cert:    'หนังสือรับรองบุคคล',
  conduct_cert:     'หนังสือรับรองความประพฤติ',
  tax_notice:       'ชำระภาษีที่ดินและสิ่งปลูกสร้าง',
  waste_collection: 'ชำระค่าธรรมเนียมเก็บขนขยะ',
  other:            'คำขออื่นๆ',
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

const PAY_BADGE = {
  pending:  { label: '💳 รอชำระค่าธรรมเนียม', cls: 'text-amber-600 bg-amber-50 border-amber-200' },
  uploaded: { label: '⏳ รอเจ้าหน้าที่ยืนยัน',  cls: 'text-orange-600 bg-orange-50 border-orange-200' },
  verified: { label: '✅ ชำระแล้ว',             cls: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
  waived:   { label: '✅ ยกเว้นค่าธรรมเนียม',   cls: 'text-gray-500 bg-gray-50 border-gray-200' },
}

const SET_FEE_TYPES = ['tax_notice', 'waste_collection']

function DocCard({ req, onClick }) {
  const docLabel = DOC_TYPES[req.document_type] ?? req.document_type
  const awaitingFee = SET_FEE_TYPES.includes(req.document_type) && req.payment_status === 'not_required'
  const payBadge = awaitingFee
    ? { label: '⏳ รอแจ้งยอดค่าชำระ', cls: 'text-amber-600 bg-amber-50 border-amber-200' }
    : req.payment_status && req.payment_status !== 'not_required'
      ? PAY_BADGE[req.payment_status] : null
  return (
    <button onClick={onClick}
      className="w-full bg-white rounded-2xl shadow-sm border border-gray-100 p-4 text-left hover:shadow-md active:scale-[0.99] transition-all flex items-center gap-3">
      <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
        <FileText size={18} className="text-blue-500" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-gray-800 leading-snug">{docLabel}</p>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <StatusBadge status={req.status} />
          <span className="text-xs text-gray-400 font-mono">{req.id.slice(0,8).toUpperCase()}</span>
        </div>
        {payBadge && (
          <span className={`inline-flex items-center text-[11px] font-bold px-2 py-0.5 rounded-full border mt-1 ${payBadge.cls}`}>
            {payBadge.label}
          </span>
        )}
        {req.purpose && <p className="text-xs text-gray-400 mt-0.5 truncate">{req.purpose}</p>}
        <p className="text-[11px] text-gray-300 mt-0.5">{dateTH(req.created_at)}</p>
        {req.document_url && req.status === 'completed' && (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 mt-1">
            <Download size={10} /> เอกสารพร้อมดาวน์โหลด
          </span>
        )}
      </div>
      <ChevronRight size={16} className="text-gray-300 shrink-0" />
    </button>
  )
}

function DocDownloadShare({ url, docLabel }) {
  const [copied, setCopied] = useState(false)

  async function handleShare() {
    if (navigator.share) {
      try {
        await navigator.share({
          title: docLabel ?? 'เอกสารราชการ',
          text: 'เอกสารดิจิทัลจากระบบ SmartLocal',
          url,
        })
      } catch (_) {}
    } else {
      handleCopy()
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (_) {}
  }

  return (
    <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <CheckCircle2 size={18} className="text-emerald-500 shrink-0" />
        <div>
          <p className="text-sm font-bold text-emerald-700">เอกสารออกให้แล้ว</p>
          <p className="text-xs text-emerald-500">ดาวน์โหลดหรือแชร์เพื่อนำไปปริ้นได้เลย</p>
        </div>
      </div>
      <div className="flex gap-2">
        <a href={url} target="_blank" rel="noopener noreferrer" download
          className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-white text-sm active:scale-[0.98] transition-all"
          style={{ backgroundColor: '#10b981' }}>
          <Download size={15} /> ดาวน์โหลด
        </a>
        <button onClick={handleShare}
          className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm active:scale-[0.98] transition-all border-2 border-emerald-400 text-emerald-700 bg-white">
          <Share2 size={15} /> แชร์
        </button>
        <button onClick={handleCopy} title="คัดลอกลิงก์"
          className="w-12 flex items-center justify-center rounded-xl border-2 border-gray-200 text-gray-500 bg-white active:scale-[0.98] transition-all">
          {copied ? <Check size={15} className="text-emerald-500" /> : <Copy size={15} />}
        </button>
      </div>
    </div>
  )
}

function DocDetailSheet({ req, onClose, tenant, onRefresh }) {
  const docLabel = DOC_TYPES[req.document_type] ?? req.document_type
  const [slipFile, setSlipFile]       = useState(null)
  const [slipPreview, setSlipPreview] = useState(null)
  const [uploading, setUploading]     = useState(false)
  const [slipSignedUrl, setSlipSignedUrl] = useState(null)

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

  const hasPayment     = req.payment_status && req.payment_status !== 'not_required'
  const needsPayment   = req.payment_status === 'pending'
  const hasBankAccount = needsPayment && !!tenant?.bank_account_no

  function handleSlipChange(e) {
    const f = e.target.files?.[0]
    if (!f) return
    setSlipFile(f)
    setSlipPreview(URL.createObjectURL(f))
  }

  async function handleUploadSlip() {
    if (!slipFile) return
    setUploading(true)
    try {
      const ext  = slipFile.name.split('.').pop()
      const path = `${req.municipality_id}/${req.id}/slip.${ext}`
      const { error: upErr } = await supabase.storage
        .from('payment-slips').upload(path, slipFile, { upsert: true })
      if (upErr) throw upErr
      const { error: dbErr } = await supabase.from('document_requests')
        .update({ payment_status: 'uploaded', payment_slip_url: path }).eq('id', req.id)
      if (dbErr) throw dbErr
      notifyTelegram(tenant?.telegram_group_id,
        `📎 <b>สลิปชำระเงินใหม่</b>\nประเภท: ${docLabel}\nผู้ขอ: ${req.requester_name}\nยอด: ${(req.fee_amount ?? 0).toLocaleString()} บาท\nรอเจ้าหน้าที่ตรวจสอบ`
      )
      onRefresh?.()
      onClose()
    } catch (err) {
      alert('อัปโหลดไม่สำเร็จ: ' + err.message)
    } finally {
      setUploading(false)
    }
  }

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

        <div className="flex-1 overflow-y-auto px-4 pt-5 pb-24 space-y-5">

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

          {/* Awaiting fee calculation for tax/waste types */}
          {SET_FEE_TYPES.includes(req.document_type) && (!req.payment_status || req.payment_status === 'not_required') && (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-3">
              <Clock size={18} className="text-amber-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-bold text-amber-800">รอเจ้าหน้าที่แจ้งยอดค่าชำระ</p>
                <p className="text-xs text-amber-600 mt-1 leading-relaxed">
                  เจ้าหน้าที่กำลังคำนวณยอดจากระบบ อปท. เมื่อแจ้งยอดแล้ว ข้อมูลบัญชีธนาคารสำหรับชำระจะแสดงที่นี่
                </p>
              </div>
            </div>
          )}

          {/* Payment section */}
          {hasPayment && (
            <div className="space-y-3">
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wide">ค่าธรรมเนียม</p>

              {/* Status banner */}
              {req.payment_status === 'pending' && (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 space-y-4">
                  <div className="flex items-center gap-3">
                    <CreditCard size={20} className="text-amber-500 shrink-0" />
                    <div>
                      <p className="text-sm font-bold text-amber-800">กรุณาชำระค่าธรรมเนียม</p>
                      <p className="text-xl font-black text-amber-700">{(req.fee_amount ?? 0).toLocaleString()} บาท</p>
                    </div>
                  </div>

                  {hasBankAccount && (
                    <div className="bg-white rounded-xl border border-amber-100 p-3 space-y-1.5">
                      <p className="text-xs text-amber-700 font-semibold mb-2">โอนเงินเข้าบัญชีธนาคาร</p>
                      <div className="flex justify-between">
                        <span className="text-xs text-gray-500">ธนาคาร</span>
                        <span className="text-xs font-bold text-gray-800">{tenant.bank_name || '-'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-xs text-gray-500">เลขบัญชี</span>
                        <span className="text-xs font-bold text-gray-800 font-mono tracking-wider">{tenant.bank_account_no}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-xs text-gray-500">ชื่อบัญชี</span>
                        <span className="text-xs font-bold text-gray-800 text-right">{tenant.bank_account_name || '-'}</span>
                      </div>
                    </div>
                  )}

                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-amber-700">อัปโหลดสลิปเพื่อยืนยัน</p>
                    <label className={`flex flex-col items-center gap-2 p-3 rounded-xl border-2 border-dashed cursor-pointer transition-colors ${slipFile ? 'border-emerald-300 bg-emerald-50' : 'border-amber-200 hover:border-amber-300 bg-white'}`}>
                      {slipPreview
                        ? <img src={slipPreview} alt="slip" className="max-h-32 rounded-lg object-contain" />
                        : <><ImageIcon size={22} className="text-amber-300" /><p className="text-xs text-amber-600">แตะเพื่อเลือกรูปสลิป</p></>
                      }
                      <input type="file" accept="image/*,application/pdf" className="hidden" onChange={handleSlipChange} />
                    </label>
                    {slipFile && (
                      <button onClick={handleUploadSlip} disabled={uploading}
                        className="w-full py-3 rounded-xl font-bold text-white text-sm flex items-center justify-center gap-2 disabled:opacity-50 active:scale-95 transition-all"
                        style={{ backgroundColor: '#f59e0b' }}>
                        {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                        {uploading ? 'กำลังส่ง...' : 'ส่งหลักฐานการชำระ'}
                      </button>
                    )}
                  </div>
                </div>
              )}

              {req.payment_status === 'uploaded' && (
                <div className="bg-orange-50 border border-orange-200 rounded-2xl p-4 flex items-start gap-3">
                  <CreditCard size={18} className="text-orange-500 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-orange-800">ส่งสลิปแล้ว — รอเจ้าหน้าที่ยืนยัน</p>
                    <p className="text-xs text-orange-500 mt-0.5">ค่าธรรมเนียม {(req.fee_amount ?? 0).toLocaleString()} บาท</p>
                    {slipSignedUrl && (
                      <a href={slipSignedUrl} target="_blank" rel="noopener noreferrer"
                        className="text-xs text-blue-500 underline mt-1 block">ดูสลิปที่ส่ง</a>
                    )}
                  </div>
                </div>
              )}

              {(req.payment_status === 'verified' || req.payment_status === 'waived') && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-3.5 flex items-center gap-3">
                  <CheckCircle2 size={18} className="text-emerald-500 shrink-0" />
                  <div>
                    <p className="text-sm font-bold text-emerald-700">
                      {req.payment_status === 'verified' ? 'ยืนยันการชำระเรียบร้อย' : 'ได้รับการยกเว้นค่าธรรมเนียม'}
                    </p>
                    {req.payment_status === 'verified' && (
                      <p className="text-xs text-emerald-500">{(req.fee_amount ?? 0).toLocaleString()} บาท</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Staff note */}
          {req.staff_notes && (
            <div className="bg-blue-50 rounded-xl p-3.5">
              <p className="text-[11px] font-bold text-blue-400 uppercase tracking-wide mb-1">บันทึกเจ้าหน้าที่</p>
              <p className="text-sm text-blue-800 leading-relaxed">{req.staff_notes}</p>
            </div>
          )}

          {/* Download + Share issued document */}
          {req.document_url && req.status === 'completed' && (
            <DocDownloadShare url={req.document_url} docLabel={docLabel} />
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
  const [refreshKey, setRefreshKey] = useState(0)

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
  }, [session, tenant?.id, refreshKey])

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
    <div className="min-h-screen" style={{ backgroundColor: '#eef2f7' }}>

      {/* Mobile header */}
      <div className="md:hidden sticky top-0 z-10 bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3 shadow-sm">
        <button onClick={() => navigate(-1)} className="p-2 rounded-xl hover:bg-gray-100 text-gray-500 transition-colors">
          <ArrowLeft size={18} />
        </button>
        <div>
          <p className="font-bold text-gray-800">เอกสารของฉัน</p>
          <p className="text-xs text-gray-400">สถานะใบรับรองและเอกสารราชการ</p>
        </div>
      </div>

      {/* PC header — government breadcrumb */}
      <div className="hidden md:block">
        <div className="px-8 py-1.5 flex items-center justify-between border-b"
          style={{ backgroundColor: '#dce8f5', borderColor: '#b8cfea' }}>
          <p className="text-[11px] text-gray-600">
            ระบบบริการอิเล็กทรอนิกส์ › {tenant?.name ?? ''} ›{' '}
            <span className="font-semibold text-gray-700">เอกสารของฉัน</span>
          </p>
          <p className="text-[11px] text-gray-500">
            {new Date().toLocaleDateString('th-TH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <div className="px-8 py-3 flex items-center justify-between bg-white border-b border-gray-200 shadow-sm">
          <div>
            <h1 className="text-base font-bold text-gray-800">เอกสารของฉัน</h1>
            <p className="text-[11px] text-gray-400 mt-0.5">{tenant?.name} — คำขอเอกสารและใบรับรองราชการ</p>
          </div>
          <button onClick={() => navigate('/doc-request')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white"
            style={{ backgroundColor: '#1a3a5c' }}>
            <Plus size={13} /> ยื่นคำขอใหม่
          </button>
        </div>
      </div>

      <div className="max-w-lg md:max-w-5xl mx-auto px-4 md:px-8 py-5 md:py-6 pb-12 space-y-5">

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
              <>
                {/* Mobile: cards */}
                <div className="md:hidden space-y-2.5">
                  <p className="text-xs text-gray-400 font-semibold px-1">{requests.length} คำขอ</p>
                  {requests.map(req => (
                    <DocCard key={req.id} req={req} onClick={() => setSelected(req)} />
                  ))}
                </div>

                {/* PC: table */}
                <div className="hidden md:block bg-white border border-gray-200 overflow-hidden shadow-sm">
                  <div className="px-5 py-3 flex items-center justify-between border-b border-gray-200"
                    style={{ backgroundColor: '#f5f8fc' }}>
                    <p className="text-xs font-semibold text-gray-600">รายการคำขอเอกสารทั้งหมด</p>
                    <p className="text-xs text-gray-400">{requests.length} รายการ</p>
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ backgroundColor: '#1a3a5c' }}>
                        <th className="text-center text-white/80 text-xs font-semibold px-4 py-2.5 w-10 border-r border-white/10">ที่</th>
                        <th className="text-left text-white/80 text-xs font-semibold px-4 py-2.5 border-r border-white/10">ประเภทเอกสาร</th>
                        <th className="text-center text-white/80 text-xs font-semibold px-4 py-2.5 border-r border-white/10">สถานะ</th>
                        <th className="text-center text-white/80 text-xs font-semibold px-4 py-2.5 border-r border-white/10">การชำระเงิน</th>
                        <th className="text-left text-white/80 text-xs font-semibold px-4 py-2.5 border-r border-white/10">วันที่ยื่น</th>
                        <th className="text-center text-white/80 text-xs font-semibold px-4 py-2.5">เลขอ้างอิง</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {requests.map((req, i) => {
                        const docLabel = DOC_TYPES[req.document_type] ?? req.document_type
                        const awaitingFee = SET_FEE_TYPES.includes(req.document_type) && req.payment_status === 'not_required'
                        const payBadge = awaitingFee
                          ? { label: 'รอแจ้งยอด',  cls: 'text-amber-700 bg-amber-50' }
                          : req.payment_status === 'pending'  ? { label: 'รอชำระ',   cls: 'text-amber-700 bg-amber-50' }
                          : req.payment_status === 'uploaded' ? { label: 'รอยืนยัน', cls: 'text-orange-700 bg-orange-50' }
                          : req.payment_status === 'verified' ? { label: 'ชำระแล้ว', cls: 'text-emerald-700 bg-emerald-50' }
                          : req.payment_status === 'waived'   ? { label: 'ยกเว้น',   cls: 'text-gray-500 bg-gray-100' }
                          : null
                        return (
                          <tr key={req.id}
                            className="cursor-pointer transition-colors hover:bg-[#dbeafe]"
                            style={{ backgroundColor: i % 2 === 0 ? '#fff' : '#f5f8fc' }}
                            onClick={() => setSelected(req)}>
                            <td className="px-4 py-3 text-center text-xs text-gray-400 border-r border-gray-100">{i + 1}</td>
                            <td className="px-4 py-3 font-medium text-gray-800 border-r border-gray-100">{docLabel}</td>
                            <td className="px-4 py-3 text-center border-r border-gray-100"><StatusBadge status={req.status} /></td>
                            <td className="px-4 py-3 text-center border-r border-gray-100">
                              {payBadge
                                ? <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${payBadge.cls}`}>{payBadge.label}</span>
                                : <span className="text-xs text-gray-300">—</span>}
                            </td>
                            <td className="px-4 py-3 text-xs text-gray-500 border-r border-gray-100">{dateTH(req.created_at)}</td>
                            <td className="px-4 py-3 text-center text-xs font-mono font-bold text-gray-600">{req.id.slice(0,8).toUpperCase()}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </>
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

      {selected && (
        <DocDetailSheet
          req={selected}
          tenant={tenant}
          onClose={() => setSelected(null)}
          onRefresh={() => setRefreshKey(k => k + 1)}
        />
      )}
    </div>
  )
}
