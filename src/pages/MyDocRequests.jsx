import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, FileText, Clock, CheckCircle2, XCircle,
  RefreshCw, Loader2, ChevronRight, X, Search, Download,
  Share2, Copy, Check, Plus, Printer,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useTenant } from '../contexts/TenantContext'
import { buildBuildingPermitHtml } from '../lib/buildingPermitPrint'
import { generateDraftPdfBlob } from '../lib/generateDraftPdf'
import { thaiDate } from '../lib/thaiDate'
import { resolvePrivateFileUrl, isPrivateDriveRef, driveFileIdFromRef } from '../lib/driveStorage'

const BASE_DOC_TYPES = {
  residence_cert:   'ใบรับรองการอยู่อาศัย',
  personal_cert:    'หนังสือรับรองบุคคล',
  tax_notice:       'ค่าธรรมเนียม/ภาษี',
  waste_collection: 'ค่าธรรมเนียมขยะ',
  building_permit:  'ขออนุญาตก่อสร้างบ้าน',
}
let _customDocLabels = {}
function docTypeLabel(key) {
  return BASE_DOC_TYPES[key] ?? _customDocLabels[key] ?? key
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

const FEE_INQUIRY_TYPES = ['tax_notice', 'waste_collection']

function DocCard({ req, onClick }) {
  const docLabel = docTypeLabel(req.document_type)
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
  const [signedResult, setSignedResult] = useState({ path: null, url: null, error: '' })
  const isLegacyPublicUrl = url?.startsWith('http')
  const accessUrl = isLegacyPublicUrl
    ? url
    : (signedResult.path === url ? signedResult.url : null)
  const urlError = signedResult.path === url ? signedResult.error : ''
  // เอกสารจาก Drive ได้ accessUrl เป็น blob: (อยู่ในหน่วยความจำเบราว์เซอร์ตอนนี้เท่านั้น) ใช้ดาวน์โหลด
  // ตรงได้ปกติ แต่ "แชร์"/"คัดลอกลิงก์" ใช้ไม่ได้จริง — เอาไปแปะที่อื่น/ส่งให้คนอื่นแล้วเปิดไม่ขึ้นแน่นอน
  // (ต่างจาก Supabase signed URL เดิมที่เป็นลิงก์ http จริง แชร์/วางที่ไหนก็เปิดได้ภายในเวลาที่กำหนด)
  // ปิดปุ่มไว้กันหลอกผู้ใช้ว่า "คัดลอกสำเร็จ" ทั้งที่ลิงก์ใช้ไม่ได้จริง
  const isDriveSourced = isPrivateDriveRef(url)

  // url อาจเป็น Supabase Storage path เดิม (เอกสารเก่าก่อนย้ายระบบ) หรือ marker 'drive:fileId' ของใหม่
  // (เอกสารที่ออกหลังย้ายไป Google Drive) ต้องเช็คแล้วดึงคนละทาง — isLegacyPublicUrl ด้านบนจับ URL ที่
  // ขึ้นต้น http ไว้แล้ว (ของเก่าสุดที่ยังไม่มี path แบบมี bucket) เหลือแค่ 2 กรณีนี้ให้ต่อ
  useEffect(() => {
    let cancelled = false
    let revoke = null
    if (!url || url.startsWith('http')) return undefined

    if (isPrivateDriveRef(url)) {
      resolvePrivateFileUrl(driveFileIdFromRef(url)).then(({ url: blobUrl, error }) => {
        if (cancelled) return
        if (error || !blobUrl) {
          setSignedResult({ path: url, url: null, error: 'ไม่สามารถสร้างลิงก์ดาวน์โหลดได้ กรุณาลองใหม่' })
          return
        }
        revoke = blobUrl
        setSignedResult({ path: url, url: blobUrl, error: '' })
      })
    } else {
      supabase.storage.from('document-certs').createSignedUrl(url, 3600)
        .then(({ data, error }) => {
          if (cancelled) return
          if (error || !data?.signedUrl) {
            setSignedResult({ path: url, url: null, error: 'ไม่สามารถสร้างลิงก์ดาวน์โหลดได้ กรุณาลองใหม่' })
            return
          }
          setSignedResult({ path: url, url: data.signedUrl, error: '' })
        })
    }
    return () => { cancelled = true; if (revoke) URL.revokeObjectURL(revoke) }
  }, [url])

  async function handleShare() {
    if (!accessUrl) return
    if (navigator.share) {
      try {
        await navigator.share({
          title: docLabel ?? 'เอกสารราชการ',
          text: 'เอกสารดิจิทัลจากระบบ SmartLocal',
          url: accessUrl,
        })
      } catch {
        return
      }
    } else {
      handleCopy()
    }
  }

  async function handleCopy() {
    if (!accessUrl) return
    try {
      await navigator.clipboard.writeText(accessUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      return
    }
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
        <a href={accessUrl || undefined} target="_blank" rel="noopener noreferrer" download
          aria-disabled={!accessUrl}
          className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-white text-sm active:scale-[0.98] transition-all ${!accessUrl ? 'pointer-events-none opacity-50' : ''}`}
          style={{ backgroundColor: '#10b981' }}>
          {accessUrl ? <Download size={15} /> : <Loader2 size={15} className="animate-spin" />}
          {accessUrl ? 'ดาวน์โหลด' : 'กำลังเตรียมลิงก์'}
        </a>
        <button onClick={handleShare} disabled={!accessUrl || isDriveSourced}
          className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm active:scale-[0.98] transition-all border-2 border-emerald-400 text-emerald-700 bg-white disabled:opacity-40">
          <Share2 size={15} /> แชร์
        </button>
        <button onClick={handleCopy} disabled={!accessUrl || isDriveSourced} title={isDriveSourced ? 'เอกสารนี้คัดลอกลิงก์ไม่ได้ กรุณากดดาวน์โหลดแทน' : 'คัดลอกลิงก์'}
          className="w-12 flex items-center justify-center rounded-xl border-2 border-gray-200 text-gray-500 bg-white active:scale-[0.98] transition-all disabled:opacity-40">
          {copied ? <Check size={15} className="text-emerald-500" /> : <Copy size={15} />}
        </button>
      </div>
      {urlError && <p className="text-xs font-semibold text-red-500">{urlError}</p>}
      {accessUrl && !isDriveSourced && <p className="text-[11px] text-emerald-600">ลิงก์ดาวน์โหลดมีอายุ 1 ชั่วโมงเพื่อป้องกันการเปิดเอกสารโดยไม่ได้รับอนุญาต</p>}
      {accessUrl && isDriveSourced && <p className="text-[11px] text-gray-400">กดดาวน์โหลดเพื่อบันทึกเอกสารไว้ในเครื่อง (แชร์/คัดลอกลิงก์ใช้กับเอกสารนี้ไม่ได้)</p>}
    </div>
  )
}

function DocDetailSheet({ req, onClose, tenant }) {
  const docLabel = docTypeLabel(req.document_type)
  const [pdfBusy, setPdfBusy]         = useState(false)

  function handlePrintPermit() {
    const html = buildBuildingPermitHtml({ form: req.permit_form_data, tenant, thDate: thaiDate(req.created_at) })
    const w = window.open('', '_blank', 'width=860,height=1100')
    if (!w) return
    w.document.write(html)
    w.document.close()
    setTimeout(() => { w.focus(); w.print() }, 400)
  }

  async function handleDownloadPermitPdf() {
    setPdfBusy(true)
    try {
      const html = buildBuildingPermitHtml({ form: req.permit_form_data, tenant, thDate: thaiDate(req.created_at) })
      const blob = await generateDraftPdfBlob(html)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `แบบ-ข1-${req.id.slice(0, 8).toUpperCase()}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setPdfBusy(false)
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

          {FEE_INQUIRY_TYPES.includes(req.document_type) && (
            <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 flex items-start gap-3">
              <Clock size={18} className="text-blue-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-bold text-blue-800">
                  {req.fee_amount > 0
                    ? `ยอดที่เจ้าหน้าที่แจ้ง ${(req.fee_amount ?? 0).toLocaleString()} บาท`
                    : 'รอเจ้าหน้าที่ตรวจสอบยอด'}
                </p>
                <p className="text-xs text-blue-600 mt-1 leading-relaxed">
                  ระบบนี้ใช้สอบถามข้อมูลเท่านั้น ไม่มีการรับชำระเงินหรือแนบสลิป กรุณาชำระที่สำนักงานเทศบาล
                </p>
              </div>
            </div>
          )}

          {/* พิมพ์/ดาวน์โหลดแบบ ข.๑ ซ้ำ — เฉพาะคำขอที่ยื่นผ่าน wizard เต็มรูปแบบ (มี permit_form_data) */}
          {req.document_type === 'building_permit' && req.permit_form_data && (
            <div className="space-y-2">
              <button onClick={handlePrintPermit}
                className="w-full py-3 rounded-2xl font-semibold text-white text-sm flex items-center justify-center gap-2 active:scale-[0.98] transition-all"
                style={{ backgroundColor: '#7c3aed' }}>
                <Printer size={15} /> พิมพ์แบบร่าง ข.๑
              </button>
              <button onClick={handleDownloadPermitPdf} disabled={pdfBusy}
                className="w-full py-3 rounded-2xl font-semibold text-violet-700 bg-violet-50 border border-violet-200 text-sm flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.98] transition-all">
                {pdfBusy ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
                {pdfBusy ? 'กำลังสร้างไฟล์...' : 'ดาวน์โหลด PDF'}
              </button>
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

  useEffect(() => {
    _customDocLabels = (tenant?.fee_schedule?._custom_types || []).reduce((acc, t) => {
      acc[t.value] = `${t.emoji || ''} ${t.label}`.trim()
      return acc
    }, {})
  }, [tenant?.fee_schedule?._custom_types])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (!data.session) navigate('/auth', { state: { from: '/my-docs' }, replace: true })
    })
  }, [navigate])

  useEffect(() => {
    if (session === undefined || !tenant?.id) return
    if (!session) { setLoading(false); return }
    setLoading(true)
    supabase.from('document_requests')
      .select('*')
      .eq('municipality_id', tenant.id)
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => setRequests(data ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
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
                  สอบถามยอดชำระเรื่องนั้นๆ
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
                        <th className="text-center text-white/80 text-xs font-semibold px-4 py-2.5 border-r border-white/10">เลขอ้างอิง</th>
                        <th className="text-left text-white/80 text-xs font-semibold px-4 py-2.5 border-r border-white/10">ประเภทเอกสาร</th>
                        <th className="text-center text-white/80 text-xs font-semibold px-4 py-2.5 border-r border-white/10">สถานะ</th>
                        <th className="text-left text-white/80 text-xs font-semibold px-4 py-2.5">วันที่ยื่น</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {requests.map((req, i) => {
                        const docLabel = docTypeLabel(req.document_type)
                        return (
                          <tr key={req.id}
                            className="cursor-pointer transition-colors hover:bg-[#dbeafe]"
                            style={{ backgroundColor: i % 2 === 0 ? '#fff' : '#f5f8fc' }}
                            onClick={() => setSelected(req)}>
                            <td className="px-4 py-3 text-center text-xs text-gray-400 border-r border-gray-100">{i + 1}</td>
                            <td className="px-4 py-3 text-center text-xs font-mono font-bold text-gray-600 border-r border-gray-100">{req.id.slice(0,8).toUpperCase()}</td>
                            <td className="px-4 py-3 font-medium text-gray-800 border-r border-gray-100">{docLabel}</td>
                            <td className="px-4 py-3 text-center border-r border-gray-100"><StatusBadge status={req.status} /></td>
                            <td className="px-4 py-3 text-xs text-gray-500">{dateTH(req.created_at)}</td>
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
        />
      )}
    </div>
  )
}
