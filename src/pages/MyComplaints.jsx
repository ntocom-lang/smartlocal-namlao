import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useTenant } from '../contexts/TenantContext'
import { fmtNo } from '../lib/formatComplaintNo'
import {
  ClipboardList, Loader2, ChevronRight, X, MapPin,
  Phone, FileText, ArrowLeft, Check, XCircle, Navigation, Camera, AlignLeft,
} from 'lucide-react'

const STATUS = {
  pending:     { label: 'รอดำเนินการ',    bg: '#fef3c7', text: '#92400e' },
  received:    { label: 'รับเรื่องแล้ว',   bg: '#dbeafe', text: '#1e40af' },
  in_progress: { label: 'กำลังดำเนินการ', bg: '#ede9fe', text: '#5b21b6' },
  completed:   { label: 'เสร็จสิ้น',      bg: '#d1fae5', text: '#065f46' },
  rejected:    { label: 'ปฏิเสธ',         bg: '#fee2e2', text: '#991b1b' },
}

const STATUS_FLOW = ['pending', 'received', 'in_progress', 'completed']
const STATUS_FLOW_LABEL = {
  pending:     { label: 'รอดำเนินการ',    desc: 'คำร้องของคุณถูกส่งเข้าระบบแล้ว' },
  received:    { label: 'รับเรื่องแล้ว',   desc: 'เจ้าหน้าที่รับทราบและตรวจสอบ' },
  in_progress: { label: 'กำลังดำเนินการ', desc: 'อยู่ระหว่างดำเนินการแก้ไข' },
  completed:   { label: 'เสร็จสิ้น',      desc: 'ดำเนินการเสร็จสิ้นแล้ว' },
}

const CATEGORY_LABEL = {
  road: 'ถนน/ทางสาธารณะ', light: 'ไฟฟ้าส่องสว่าง',
  trash: 'ขยะ/ความสะอาด', water: 'น้ำประปา',
  flood: 'น้ำท่วม/ระบายน้ำ', tree: 'ตัดต้นไม้',
  noise: 'แจ้งเหตุรำคาญ', drain: 'ท่อระบายน้ำ',
  waste_water: 'น้ำเสีย', suction: 'ดูดสิ่งปฏิกูล',
  manhole: 'ฝาท่อระบายน้ำ', vendor: 'ขายของบนทางสาธารณะ',
  building: 'ตรวจสอบอาคาร', mosquito: 'พ่นยุง',
  pollution: 'กลิ่นควัน/มลพิษ', corruption: 'แจ้งการทุจริต',
  tax: 'ภาษีและค่าธรรมเนียม', canal: 'ลอกคลอง',
  animals: 'สุนัขและแมวจรจัด', other: 'อื่นๆ',
}

const CATEGORY_EMOJI = {
  road: '🛣️', light: '💡', trash: '🗑️', water: '🚰',
  flood: '🌊', tree: '🌳', noise: '📢', drain: '🕳️',
  waste_water: '💧', suction: '🚛', manhole: '⚙️', vendor: '🏪',
  building: '🏗️', mosquito: '🦟', pollution: '🌫️', corruption: '⚖️',
  tax: '📋', canal: '🏞️', animals: '🐕', other: '📝',
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

function StatusStepper({ status }) {
  if (status === 'rejected') {
    return (
      <div className="flex items-center gap-3 p-4 bg-red-50 rounded-2xl border border-red-100">
        <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center shrink-0">
          <XCircle size={20} className="text-red-500" />
        </div>
        <div>
          <p className="text-sm font-semibold text-red-700">คำร้องถูกปฏิเสธ</p>
          <p className="text-xs text-red-400 mt-0.5">เจ้าหน้าที่ไม่สามารถดำเนินการได้</p>
        </div>
      </div>
    )
  }

  const currentIdx = STATUS_FLOW.indexOf(status)

  return (
    <div className="space-y-0">
      {STATUS_FLOW.map((step, i) => {
        const done = i <= currentIdx
        const isCurrent = i === currentIdx
        const isLast = i === STATUS_FLOW.length - 1
        const info = STATUS_FLOW_LABEL[step]

        return (
          <div key={step} className="flex gap-4">
            {/* line + dot column */}
            <div className="flex flex-col items-center">
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 border-2 transition-all mt-1"
                style={done
                  ? { backgroundColor: 'var(--color-primary)', borderColor: 'var(--color-primary)' }
                  : { backgroundColor: '#fff', borderColor: '#e5e7eb' }}
              >
                {done && !isCurrent ? (
                  <Check size={14} className="text-white" />
                ) : isCurrent ? (
                  <div className="w-2.5 h-2.5 rounded-full bg-white" />
                ) : (
                  <div className="w-2.5 h-2.5 rounded-full bg-gray-200" />
                )}
              </div>
              {!isLast && (
                <div
                  className="w-0.5 flex-1 my-1 rounded-full"
                  style={{ backgroundColor: i < currentIdx ? 'var(--color-primary)' : '#e5e7eb', minHeight: '28px' }}
                />
              )}
            </div>

            {/* text column */}
            <div className={`pb-5 pt-0.5 ${isLast ? 'pb-0' : ''}`}>
              <p className={`text-sm font-semibold transition-colors ${done ? 'text-gray-800' : 'text-gray-300'}`}>
                {info.label}
                {isCurrent && (
                  <span className="ml-2 text-[13px] font-medium px-1.5 py-0.5 rounded-full"
                    style={{ backgroundColor: 'color-mix(in srgb, var(--color-primary) 15%, transparent)', color: 'var(--color-primary)' }}>
                    ปัจจุบัน
                  </span>
                )}
              </p>
              <p className={`text-xs mt-0.5 transition-colors ${done ? 'text-gray-400' : 'text-gray-200'}`}>
                {info.desc}
              </p>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function DetailSheet({ complaint: c, onClose }) {
  if (!c) return null
  const attachments = c.attachments ?? []
  const categoryLabel = CATEGORY_LABEL[c.category] ?? c.category
  const categoryEmoji = CATEGORY_EMOJI[c.category] ?? '📄'
  const dateStr = new Date(c.created_at).toLocaleDateString('th-TH', {
    day: '2-digit', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full sm:max-w-lg bg-white sm:rounded-2xl rounded-t-3xl shadow-2xl max-h-[93dvh] flex flex-col overflow-hidden">

        {/* gradient header */}
        <div className="shrink-0 px-5 pt-6 pb-5 relative"
             style={{ background: 'linear-gradient(135deg, var(--color-primary) 0%, color-mix(in srgb, var(--color-primary) 70%, #7c3aed) 100%)' }}>
          <button onClick={onClose}
            className="absolute top-4 right-4 p-2 rounded-xl bg-white/20 hover:bg-white/30 text-white transition-colors">
            <X size={16} />
          </button>

          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-2xl bg-white/20 flex items-center justify-center text-2xl shrink-0">
              {categoryEmoji}
            </div>
            <div className="flex-1 min-w-0 pr-10">
              <p className="text-white/70 text-xs font-medium">ประเภทคำร้อง</p>
              <p className="text-white font-bold text-base leading-tight mt-0.5">{categoryLabel}</p>
              {c.subject && (
                <p className="text-white/80 text-sm mt-1 leading-snug">{c.subject}</p>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between mt-4 pt-4 border-t border-white/20">
            <div>
              <p className="text-white/60 text-[13px] uppercase tracking-wider">เลขที่คำร้อง</p>
              <p className="text-white font-black text-xl tracking-wider mt-0.5">
                {c.complaint_number ? fmtNo(c.complaint_number, c.created_at) : '—'}
              </p>
            </div>
            <div className="text-right">
              <p className="text-white/60 text-[13px] uppercase tracking-wider">ยื่นเมื่อ</p>
              <p className="text-white/90 text-xs font-medium mt-0.5">{dateStr} น.</p>
            </div>
          </div>
        </div>

        {/* scrollable body */}
        <div className="overflow-y-auto flex-1 px-5 py-5 space-y-5">

          {/* status stepper */}
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">ความคืบหน้า</p>
            <StatusStepper status={c.status} />
          </div>

          {/* location + phone */}
          {(c.location_name || c.village || c.phone || c.latitude) && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">ข้อมูลติดต่อ</p>
              <div className="bg-gray-50 rounded-2xl divide-y divide-gray-100 overflow-hidden">
                {(c.location_name || c.village) && (
                  <div className="flex items-center gap-3 px-4 py-3">
                    <div className="w-8 h-8 rounded-xl bg-orange-50 flex items-center justify-center shrink-0">
                      <MapPin size={15} className="text-orange-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] text-gray-400">สถานที่เกิดเหตุ</p>
                      <p className="text-sm font-medium text-gray-800 truncate">{c.location_name ?? c.village}</p>
                    </div>
                  </div>
                )}
                {c.phone && (
                  <a href={`tel:${c.phone}`}
                     className="flex items-center gap-3 px-4 py-3 hover:bg-gray-100 transition-colors active:bg-gray-100">
                    <div className="w-8 h-8 rounded-xl bg-green-50 flex items-center justify-center shrink-0">
                      <Phone size={15} className="text-green-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] text-gray-400">เบอร์โทรติดต่อ</p>
                      <p className="text-sm font-medium text-gray-800">{c.phone}</p>
                    </div>
                    <span className="text-xs text-green-600 font-medium shrink-0">โทร</span>
                  </a>
                )}
                {c.latitude && (
                  <a href={`https://maps.google.com/?q=${c.latitude},${c.longitude}`}
                     target="_blank" rel="noreferrer"
                     className="flex items-center gap-3 px-4 py-3 hover:bg-gray-100 transition-colors">
                    <div className="w-8 h-8 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
                      <Navigation size={15} className="text-blue-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] text-gray-400">พิกัดสถานที่</p>
                      <p className="text-sm font-medium text-gray-800">
                        {c.latitude.toFixed(5)}, {c.longitude.toFixed(5)}
                      </p>
                    </div>
                    <span className="text-xs text-blue-600 font-medium shrink-0">เปิดแผนที่</span>
                  </a>
                )}
              </div>
            </div>
          )}

          {/* detail */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">รายละเอียดปัญหา</p>
            <div className="bg-gray-50 rounded-2xl px-4 py-3">
              <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{c.detail}</p>
            </div>
          </div>

          {/* attachments - before */}
          {attachments.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                ก่อนดำเนินการ ({attachments.length})
              </p>
              <div className="grid grid-cols-3 gap-2">
                {attachments.map((url, i) => (
                  <a key={i} href={url} target="_blank" rel="noreferrer"
                     className="aspect-square rounded-xl overflow-hidden border border-gray-100 bg-gray-50 flex items-center justify-center shadow-sm">
                    {/\.(jpg|jpeg|png|gif|webp)$/i.test(url) ? (
                      <img src={url} alt={`รูป ${i + 1}`} className="w-full h-full object-cover" />
                    ) : (
                      <div className="flex flex-col items-center gap-1">
                        <FileText size={22} className="text-gray-400" />
                        <span className="text-[13px] text-gray-400">ไฟล์</span>
                      </div>
                    )}
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* work photos - after */}
          {(c.work_photos ?? []).length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                <Camera size={11} /> หลังดำเนินการ ({c.work_photos.length})
              </p>
              <div className="grid grid-cols-3 gap-2">
                {c.work_photos.map((url, i) => (
                  <a key={i} href={url} target="_blank" rel="noreferrer"
                     className="aspect-square rounded-xl overflow-hidden border border-green-200 bg-green-50 flex items-center justify-center shadow-sm">
                    <img src={url} alt={`ผลงาน ${i + 1}`} className="w-full h-full object-cover" />
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* technician note */}
          {c.technician_note && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                <AlignLeft size={11} /> บันทึกจากเจ้าหน้าที่
              </p>
              <div className="bg-green-50 rounded-2xl px-4 py-3 border border-green-100">
                <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{c.technician_note}</p>
              </div>
            </div>
          )}
        </div>

        {/* footer */}
        <div className="px-5 py-4 border-t border-gray-100 shrink-0">
          <button onClick={onClose}
            className="w-full py-3 rounded-xl text-sm font-semibold bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors">
            ปิด
          </button>
        </div>
      </div>
    </div>
  )
}

export default function MyComplaints() {
  const { tenant } = useTenant()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const openId = searchParams.get('id')
  const [complaints, setComplaints] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [session, setSession] = useState(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
  }, [])

  useEffect(() => {
    if (!tenant?.id || !session?.user?.id) return
    setLoading(true)
    supabase
      .from('complaints')
      .select('*')
      .eq('municipality_id', tenant.id)
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        const list = data ?? []
        setComplaints(list)
        setLoading(false)
        if (openId) setSelected(list.find((c) => c.id === openId) ?? null)
      })
  }, [tenant?.id, session?.user?.id, openId])

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 pb-24">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate(-1)}
          className="p-2 rounded-xl hover:bg-gray-100 text-gray-500 transition-colors">
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-lg font-bold text-gray-800">คำร้องของฉัน</h1>
          <p className="text-xs text-gray-400">ติดตามสถานะคำร้องที่ยื่น</p>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 size={28} className="animate-spin text-gray-300" />
        </div>
      ) : complaints.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400">
          <ClipboardList size={48} className="mb-3 opacity-20" />
          <p className="font-medium text-gray-500">ยังไม่มีคำร้อง</p>
          <p className="text-sm mt-1">กดยื่นคำร้องเพื่อแจ้งปัญหา</p>
          <button onClick={() => navigate('/complaint')}
            className="mt-5 px-5 py-2.5 rounded-xl text-sm font-semibold text-white"
            style={{ backgroundColor: 'var(--color-primary)' }}>
            ยื่นคำร้อง
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {complaints.map((c, i) => (
            <div key={c.id}
              onClick={() => setSelected(c)}
              className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 cursor-pointer hover:shadow-md active:scale-[0.99] transition-all">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0 bg-gray-50">
                  {CATEGORY_EMOJI[c.category] ?? '📄'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-0.5">
                    <p className="font-semibold text-gray-800 text-sm truncate">
                      <span className="text-gray-400 font-mono font-normal mr-1">{i + 1}.</span>
                      {CATEGORY_LABEL[c.category] ?? c.category}
                    </p>
                    <ChevronRight size={14} className="text-gray-300 shrink-0" />
                  </div>
                  {c.subject && (
                    <p className="text-xs text-gray-500 truncate">{c.subject}</p>
                  )}
                  <div className="flex items-center gap-2 mt-2">
                    <StatusBadge status={c.status} />
                    {c.complaint_number && (
                      <span className="text-[13px] text-gray-400 font-mono">
                        {fmtNo(c.complaint_number, c.created_at)}
                      </span>
                    )}
                  </div>
                  <p className="text-[13px] text-gray-300 mt-1.5">
                    {new Date(c.created_at).toLocaleDateString('th-TH', {
                      day: '2-digit', month: 'short', year: '2-digit',
                      hour: '2-digit', minute: '2-digit',
                    })} น.
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {selected && <DetailSheet complaint={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
