import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, Search, XCircle } from 'lucide-react'
import { useTenant } from '../contexts/TenantContext'
import { supabase } from '../lib/supabase'
import { validateReopenReason, REOPEN_REASON_MAX, PARKED_PUBLIC_NOTE } from '../lib/complaintWorkflow'
import {
  TRACK_BUSY_MESSAGE, TRACK_RATE_ERRORS, TRACK_REOPEN_ERRORS,
  buildTrackSteps, formatTrackDateTime, isTrackBusy, isTrackFinished, isTrackToken,
} from '../lib/complaintTrack'

// หน้าที่ผู้แจ้งเปิดจากลิงก์ที่ สท./เจ้าหน้าที่ส่งให้ (/t/<โทเคน>) — ไม่ต้องล็อกอิน
// ข้อมูลทั้งหมดมาจาก get_complaint_by_track_token() ซึ่งไม่ส่งชื่อ เบอร์ พิกัด หรือรายละเอียดที่ผู้แจ้งพิมพ์มาให้ตั้งแต่ฝั่งฐานข้อมูล
// หน้านี้จึงไม่มีทางแสดงข้อมูลเหล่านั้นได้ต่อให้โค้ดผิด (tests/complaint-track.test.mjs ตรวจว่าไม่อ้างคอลัมน์เหล่านั้น)

// คำเรียกคะแนนตรงกับ SatisfactionPage/SatisfactionModal — ผู้ใช้เห็นหน้าตาเดียวกันทุกทางเข้า
const RATINGS = [
  { value: 5, emoji: '😄', label: 'ยอดเยี่ยม' },
  { value: 4, emoji: '😊', label: 'ดี' },
  { value: 3, emoji: '😐', label: 'พอสมควร' },
  { value: 2, emoji: '😢', label: 'แย่' },
  { value: 1, emoji: '😡', label: 'แย่มาก' },
]

const card = 'bg-white rounded-2xl border border-gray-100 shadow-sm p-4'
const sectionLabel = 'text-xs font-semibold text-gray-400 uppercase tracking-wider'

function Dot({ state }) {
  const base = 'w-6 h-6 rounded-full grid place-items-center text-[11px] font-bold shrink-0 relative z-10'
  if (state === 'done') return <span className={`${base} bg-green-500 text-white`} aria-hidden="true">✓</span>
  if (state === 'stop') return <span className={`${base} bg-red-500 text-white`} aria-hidden="true">!</span>
  // hold = ขึ้นทะเบียนรอดำเนินการ: สีเทาน้ำเงิน ไม่ใช่แดง (ไม่ใช่การปฏิเสธ) ไม่ใช่เขียว (ยังไม่เสร็จ)
  if (state === 'hold') return <span className={`${base} bg-slate-500 text-white`} aria-hidden="true">⏸</span>
  if (state === 'now') {
    return (
      <span className={`${base} bg-white border-2`} style={{ borderColor: 'var(--color-primary)', color: 'var(--color-primary)', boxShadow: '0 0 0 3px color-mix(in srgb, var(--color-primary) 18%, white)' }} aria-hidden="true">●</span>
    )
  }
  return <span className={`${base} bg-white border-2 border-gray-200 text-gray-300`} aria-hidden="true">○</span>
}

function Steps({ steps }) {
  const STATE_TEXT = { done: 'เสร็จแล้ว', now: 'ขั้นตอนปัจจุบัน', todo: 'ยังไม่ถึงขั้นนี้', stop: 'ไม่สามารถดำเนินการได้', hold: 'รับไว้ในทะเบียนแล้ว ยังไม่มีกำหนดดำเนินการ' }
  return (
    <ol className="space-y-0">
      {steps.map((step, i) => (
        <li key={step.key} className="grid grid-cols-[24px_1fr] gap-3 relative pb-4 last:pb-0" aria-current={step.state === 'now' ? 'step' : undefined}>
          {i < steps.length - 1 && <span className="absolute left-[11px] top-6 -bottom-0.5 w-0.5 bg-gray-100" aria-hidden="true" />}
          <Dot state={step.state} />
          <div className="min-w-0">
            <p className={`text-sm font-semibold ${step.state === 'todo' ? 'text-gray-400' : 'text-gray-800'}`}>
              {step.label}
              <span className="sr-only"> — {STATE_TEXT[step.state]}</span>
            </p>
            {(step.at || step.note) && (
              <p className="text-xs text-gray-500 mt-0.5">
                {step.at ? formatTrackDateTime(step.at) : ''}
                {step.at && step.note ? ' · ' : ''}
                {step.note}
              </p>
            )}
          </div>
        </li>
      ))}
    </ol>
  )
}

function RatingCard({ busy, error, onSubmit }) {
  const [selected, setSelected] = useState(null)
  const [comment, setComment] = useState('')
  return (
    <section className={`${card} space-y-3`} aria-labelledby="track-rate-title">
      <h2 id="track-rate-title" className="text-sm font-bold text-gray-800">พอใจกับการดำเนินการไหม</h2>
      <div className="grid grid-cols-5 gap-1.5" role="group" aria-label="ให้คะแนนความพึงพอใจ">
        {RATINGS.map(r => (
          <button key={r.value} type="button" aria-pressed={selected === r.value} onClick={() => setSelected(r.value)}
            className="min-h-[64px] rounded-xl border-2 flex flex-col items-center justify-center gap-0.5 transition-colors active:scale-95"
            style={selected === r.value
              ? { borderColor: 'var(--color-primary)', backgroundColor: 'color-mix(in srgb, var(--color-primary) 10%, white)' }
              : { borderColor: '#e5e7eb', backgroundColor: '#f9fafb' }}>
            <span className="text-2xl leading-none" aria-hidden="true">{r.emoji}</span>
            <span className="text-[11px] text-gray-600 leading-tight">{r.label}</span>
          </button>
        ))}
      </div>
      {selected && (
        <div className="space-y-1">
          <label htmlFor="track-rate-comment" className="block text-xs font-semibold text-gray-600">
            ความคิดเห็นเพิ่มเติม <span className="font-normal text-gray-400">(ไม่บังคับ)</span>
          </label>
          <textarea id="track-rate-comment" rows={2} maxLength={500} value={comment} onChange={e => setComment(e.target.value)}
            className="w-full border-2 border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 bg-white resize-none focus:outline-none focus:border-gray-400" />
        </div>
      )}
      {error && <p role="alert" className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{error}</p>}
      <button type="button" disabled={!selected || busy} onClick={() => onSubmit(selected, comment.trim())}
        className="w-full min-h-[48px] rounded-xl text-sm font-bold text-white disabled:opacity-40"
        style={{ backgroundColor: 'var(--color-primary)' }}>
        {busy ? 'กำลังส่ง...' : 'ส่งคะแนน'}
      </button>
    </section>
  )
}

function ReopenCard({ daysLeft, busy, error, onSubmit }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [localError, setLocalError] = useState('')
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="w-full min-h-[48px] rounded-2xl border-2 border-orange-200 bg-orange-50 px-4 text-sm font-bold text-orange-800">
        ยังไม่เรียบร้อย แจ้งกลับ <span className="font-normal">(เหลือ {daysLeft} วัน)</span>
      </button>
    )
  }
  function submit() {
    const invalid = validateReopenReason(reason)
    if (invalid) { setLocalError(invalid); return }
    setLocalError('')
    onSubmit(reason.trim())
  }
  return (
    <section className="rounded-2xl border-2 border-orange-200 bg-orange-50 p-4 space-y-3" aria-labelledby="track-reopen-title">
      <div>
        <h2 id="track-reopen-title" className="text-sm font-bold text-orange-900">แจ้งว่ายังไม่เรียบร้อย</h2>
        <p className="text-xs text-orange-800/80 mt-0.5">เรื่องจะกลับไปที่เจ้าหน้าที่ผู้รับผิดชอบทันที แจ้งกลับได้ 1 ครั้งภายใน 7 วันหลังดำเนินการแล้ว</p>
      </div>
      <div className="space-y-1">
        <label htmlFor="track-reopen-reason" className="block text-xs font-semibold text-orange-900">เหตุผล</label>
        <textarea id="track-reopen-reason" rows={3} maxLength={REOPEN_REASON_MAX} value={reason} onChange={e => setReason(e.target.value)}
          placeholder="เช่น ไฟยังไม่ติด / ซ่อมแล้วแต่ยังเสียเหมือนเดิม"
          className="w-full border-2 border-orange-200 rounded-xl px-3 py-2 text-sm text-gray-800 bg-white resize-none focus:outline-none focus:border-orange-400" />
        <p className="text-right text-[11px] text-orange-800/70">{reason.length}/{REOPEN_REASON_MAX}</p>
      </div>
      {(localError || error) && <p role="alert" className="text-sm text-red-600 bg-white border border-red-100 rounded-xl px-3 py-2">{localError || error}</p>}
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <button type="button" disabled={busy} onClick={submit}
          className="min-h-[48px] rounded-xl text-sm font-bold text-white bg-orange-600 disabled:opacity-40">
          {busy ? 'กำลังส่ง...' : 'ส่งเรื่องกลับ'}
        </button>
        <button type="button" disabled={busy} onClick={() => setOpen(false)}
          className="min-h-[48px] px-4 rounded-xl text-sm font-semibold text-orange-900 bg-white border border-orange-200">
          ยกเลิก
        </button>
      </div>
    </section>
  )
}

function Notice({ tone = 'green', children }) {
  const tones = {
    green: 'bg-green-50 border-green-200 text-green-800',
    amber: 'bg-amber-50 border-amber-200 text-amber-900',
    gray: 'bg-gray-50 border-gray-200 text-gray-700',
  }
  return <p role="status" className={`rounded-2xl border px-4 py-3 text-sm ${tones[tone]}`}>{children}</p>
}

export default function TrackComplaint() {
  const { token } = useParams()
  const { tenant } = useTenant()
  const orgName = tenant?.name || 'หน่วยงาน'
  const tokenOk = isTrackToken(token)

  const [phase, setPhase] = useState(tokenOk ? 'loading' : 'notfound') // loading | ready | notfound | error | busy
  const [data, setData] = useState(null)
  const [acting, setActing] = useState('') // '' | 'rate' | 'reopen'
  const [actionError, setActionError] = useState(null) // { scope: 'rate' | 'reopen', message } — แยกตามกล่อง ไม่งั้นข้อความผิดพลาดของกล่องหนึ่งโผล่ในอีกกล่อง
  const [justRated, setJustRated] = useState(false)
  const [justReopened, setJustReopened] = useState(false)

  // ลิงก์ที่แชร์ต่อไม่ควรไปโผล่ในผลค้นหา
  useEffect(() => {
    const meta = document.createElement('meta')
    meta.name = 'robots'
    meta.content = 'noindex'
    document.head.appendChild(meta)
    return () => meta.remove()
  }, [])

  const tenantId = tenant?.id ?? null

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!tokenOk || !tenantId) return
    if (!quiet) setPhase('loading')
    const { data: result, error } = await supabase.rpc('get_complaint_by_track_token', { _token: token, _municipality_id: tenantId })
    if (error) { setPhase(isTrackBusy(error) ? 'busy' : 'error'); return }
    if (!result?.found) { setPhase('notfound'); return }
    setData(result)
    setPhase('ready')
  }, [token, tokenOk, tenantId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- โหลดข้อมูลจากลิงก์ครั้งแรกตอนเปิดหน้า (async ภายใน load)
    load()
  }, [load])

  async function rate(rating, comment) {
    setActing('rate'); setActionError(null)
    const { data: res, error } = await supabase.rpc('rate_complaint_by_track_token', {
      _token: token, _municipality_id: tenantId, p_rating: rating, p_comment: comment || null,
    })
    setActing('')
    if (error) { setActionError({ scope: 'rate', message: isTrackBusy(error) ? TRACK_BUSY_MESSAGE : 'ส่งคะแนนไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' }); return }
    // already_rated = มีคะแนนอยู่แล้ว (เช่นกดซ้ำตอนสัญญาณช้า) ถือว่าสำเร็จ ไม่บังคับให้กดจนยอมแพ้
    if (!res?.ok && res?.code !== 'already_rated') { setActionError({ scope: 'rate', message: TRACK_RATE_ERRORS[res?.code] ?? 'ส่งคะแนนไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' }); return }
    setJustRated(true)
    await load({ quiet: true })
  }

  async function reopen(reason) {
    setActing('reopen'); setActionError(null)
    const { data: res, error } = await supabase.rpc('reopen_complaint_by_track_token', {
      _token: token, _municipality_id: tenantId, p_reason: reason,
    })
    setActing('')
    if (error) { setActionError({ scope: 'reopen', message: isTrackBusy(error) ? TRACK_BUSY_MESSAGE : 'ส่งไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' }); return }
    if (!res?.ok) { setActionError({ scope: 'reopen', message: TRACK_REOPEN_ERRORS[res?.code] ?? 'ส่งไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' }); return }
    setJustReopened(true)
    await load({ quiet: true })
  }

  const steps = data ? buildTrackSteps(data) : []
  const finished = data ? isTrackFinished(data.status) : false
  const rejected = data?.status === 'rejected'
  const parked = data?.status === 'parked'

  return (
    <div className="min-h-screen pb-28 md:pb-12" style={{ backgroundColor: '#eef2f7' }}>
      <header style={{ background: 'linear-gradient(135deg, var(--color-primary-dark) 0%, var(--color-primary) 100%)' }}>
        <div className="max-w-lg mx-auto px-4 py-5 text-white">
          <p className="text-xs text-white/75">{orgName}</p>
          <h1 className="text-lg font-bold leading-tight">ติดตามเรื่องของคุณ</h1>
        </div>
      </header>

      <main data-track-page className="max-w-lg mx-auto px-4 py-4 space-y-3">
        {phase === 'loading' && (
          <div className={`${card} flex items-center justify-center gap-2 py-10 text-sm text-gray-500`} role="status">
            <Loader2 size={18} className="animate-spin" aria-hidden="true" /> กำลังโหลด...
          </div>
        )}

        {phase === 'notfound' && (
          <div className={`${card} text-center space-y-3 py-8`}>
            <Search size={32} className="mx-auto text-gray-300" aria-hidden="true" />
            <p className="text-base font-bold text-gray-800">ไม่พบเรื่องนี้</p>
            <p className="text-sm text-gray-500">ลิงก์อาจไม่ครบหรือพิมพ์ผิด ขอลิงก์ใหม่จากผู้ที่ส่งให้ หรือค้นหาด้วยเลขที่อ้างอิง</p>
            <Link to="/my-complaints" className="inline-flex items-center justify-center min-h-[48px] px-5 rounded-xl text-sm font-bold text-white" style={{ backgroundColor: 'var(--color-primary)' }}>
              ค้นหาด้วยเลขที่อ้างอิง
            </Link>
          </div>
        )}

        {(phase === 'error' || phase === 'busy') && (
          <div className={`${card} text-center space-y-3 py-8`}>
            <AlertTriangle size={32} className="mx-auto text-amber-400" aria-hidden="true" />
            <p className="text-sm text-gray-700">{phase === 'busy' ? 'เปิดดูถี่เกินไป กรุณารอสักครู่แล้วลองใหม่' : 'โหลดไม่สำเร็จ เครือข่ายอาจช้าหรือขาดช่วง'}</p>
            <button type="button" onClick={() => load()} className="inline-flex items-center justify-center gap-2 min-h-[48px] px-5 rounded-xl text-sm font-bold text-white" style={{ backgroundColor: 'var(--color-primary)' }}>
              <RefreshCw size={16} aria-hidden="true" /> ลองใหม่
            </button>
          </div>
        )}

        {phase === 'ready' && data && (
          <>
            <section className={card} aria-label="ข้อมูลเรื่อง">
              <p className="text-xs text-gray-400">เลขที่อ้างอิง</p>
              <p className="text-xl font-black text-gray-800 tracking-widest font-mono break-all">{data.ref_no}</p>
              <div className="flex flex-wrap gap-1.5 mt-2">
                <span className="text-xs font-semibold rounded-full px-2.5 py-0.5 bg-gray-100 text-gray-700">{data.category_label}</span>
                {data.village && <span className="text-xs font-semibold rounded-full px-2.5 py-0.5 bg-gray-100 text-gray-700">{data.village}</span>}
              </div>
              <p className="text-xs text-gray-400 mt-2">แจ้งเมื่อ {formatTrackDateTime(data.created_at)}</p>
            </section>

            {data.viewer === 'staff' && (
              <Notice tone="gray">คุณกำลังดูในฐานะเจ้าหน้าที่ ให้คะแนนหรือแจ้งกลับแทนผู้แจ้งไม่ได้</Notice>
            )}

            <section className={card} aria-labelledby="track-steps-title">
              <h2 id="track-steps-title" className={`${sectionLabel} mb-3`}>ความคืบหน้า</h2>
              <Steps steps={steps} />
              {data.is_adhoc && (
                <p className="text-xs text-gray-500 mt-3">เรื่องประเภทนี้เจ้าหน้าที่รวบรวมไปวิเคราะห์ ไม่มีสถานะรายเรื่อง</p>
              )}
              {parked && (
                <p className="mt-3 text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 leading-relaxed">
                  {PARKED_PUBLIC_NOTE}
                </p>
              )}
              {rejected && data.reject_reason && (
                <p className="mt-3 text-sm text-red-700 bg-red-50 border border-red-100 rounded-xl px-3 py-2 whitespace-pre-wrap break-words">
                  <XCircle size={14} className="inline -mt-0.5 mr-1" aria-hidden="true" />{data.reject_reason}
                </p>
              )}
            </section>

            {justReopened && !finished && (
              <Notice tone="amber">ส่งเรื่องกลับให้เจ้าหน้าที่แล้ว จะดำเนินการต่อและอัปเดตสถานะที่หน้านี้</Notice>
            )}

            {finished && data.result_note && (
              <section className={card} aria-labelledby="track-note-title">
                <h2 id="track-note-title" className={`${sectionLabel} mb-2`}>บันทึกจากเจ้าหน้าที่</h2>
                <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap break-words bg-green-50 border border-green-100 rounded-xl px-3 py-2">{data.result_note}</p>
              </section>
            )}

            {justRated && (
              <Notice><CheckCircle2 size={16} className="inline -mt-0.5 mr-1" aria-hidden="true" />ขอบคุณสำหรับความคิดเห็น เราจะนำไปปรับปรุงการให้บริการ</Notice>
            )}
            {!justRated && data.rated && finished && (
              <Notice><CheckCircle2 size={16} className="inline -mt-0.5 mr-1" aria-hidden="true" />ให้คะแนนเรื่องนี้แล้ว ขอบคุณที่ให้ความเห็น</Notice>
            )}
            {data.can_rate && !justRated && (
              <RatingCard busy={acting === 'rate'} error={actionError?.scope === 'rate' ? actionError.message : ''} onSubmit={rate} />
            )}

            {data.can_reopen && (
              <ReopenCard daysLeft={data.reopen_days_left} busy={acting === 'reopen'} error={actionError?.scope === 'reopen' ? actionError.message : ''} onSubmit={reopen} />
            )}
            {!data.can_reopen && data.reopened && finished && (
              <Notice tone="gray">เรื่องนี้เคยแจ้งกลับแล้ว หากยังมีปัญหา กรุณายื่นเรื่องใหม่</Notice>
            )}

            <p className="text-center text-xs text-gray-400 px-4 pt-2">
              ลิงก์นี้ใช้ดูเฉพาะเรื่องนี้ ไม่แสดงชื่อและเบอร์โทรของผู้แจ้ง<br />
              <Link to="/my-complaints" className="underline">ค้นหาเรื่องอื่นด้วยเลขที่อ้างอิง</Link>
            </p>
          </>
        )}
      </main>
    </div>
  )
}
